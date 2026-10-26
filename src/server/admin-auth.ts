import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { AccessDenied, accessConfig, accessAudit, opaque, digest, deny, rateLimit } from './access';

const flowSchema=z.object({state:z.string(),nonce:z.string(),verifier:z.string(),expires:z.number()});
function seal(value:unknown) {
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',accessConfig().key,iv);
  c.setAAD(Buffer.from('zemaitija:oidc-flow:v1'));
  const encrypted=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);
  return Buffer.concat([iv,c.getAuthTag(),encrypted]).toString('base64url');
}
function unseal(raw:string) {
  if(raw.length>3000)throw new Error('Invalid flow');
  const b=Buffer.from(raw,'base64url'),d=createDecipheriv('aes-256-gcm',accessConfig().key,b.subarray(0,12));
  d.setAAD(Buffer.from('zemaitija:oidc-flow:v1'));d.setAuthTag(b.subarray(12,28));
  return flowSchema.parse(JSON.parse(Buffer.concat([d.update(b.subarray(28)),d.final()]).toString('utf8')));
}
function settings() {
  const env=z.object({ADMIN_OIDC_ISSUER:z.url().startsWith('https://'),ADMIN_OIDC_CLIENT_ID:z.string().min(1),
    ADMIN_OIDC_CLIENT_SECRET:z.string().min(16),ADMIN_OIDC_MFA_ACR:z.string().min(1)}).parse(process.env);
  const issuer=new URL(env.ADMIN_OIDC_ISSUER);
  if(issuer.username||issuer.password||issuer.search||issuer.hash)throw new Error('Invalid identity issuer');
  return {...env,callback:`${accessConfig().origin}/api/access/admin/callback`};
}
// Configuration is trusted environment, never a request-provided issuer or key set.
async function configuration() {
  const e=settings();
  const c=await oidc.discovery(new URL(e.ADMIN_OIDC_ISSUER),e.ADMIN_OIDC_CLIENT_ID,
    {client_secret:e.ADMIN_OIDC_CLIENT_SECRET,id_token_signed_response_alg:'RS256'},oidc.ClientSecretPost(e.ADMIN_OIDC_CLIENT_SECRET),{timeout:8});
  oidc.enableNonRepudiationChecks(c);
  return {c,e};
}
export async function startAdminLogin(pool:Pool) {
  await rateLimit(pool,'admin-login:global',30);
  const {c,e}=await configuration(),state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier();
  const url=oidc.buildAuthorizationUrl(c,{redirect_uri:e.callback,scope:'openid',state,nonce,
    code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',
    acr_values:e.ADMIN_OIDC_MFA_ACR,max_age:'0',prompt:'login'});
  return {url:url.href,cookie:seal({state,nonce,verifier,expires:Date.now()+600_000})};
}
/** Called only with claims verified by openid-client. Not an HTTP/session bypass. */
async function createAdminSession(pool:Pool,subject:string,authenticatedAt:Date) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const identity=(await client.query<{id:string}>('SELECT id FROM admin_users WHERE external_subject=$1',[subject])).rows[0];
    if(identity)await client.query('SELECT lock_admin_identity($1)',[identity.id]);
    const a=(await client.query<{id:string;auth_version:number}>(`SELECT id,auth_version FROM admin_users
      WHERE external_subject=$1 AND enabled AND disabled_at IS NULL
        AND role IN ('operations','finance','administrator')`,[subject])).rows[0];
    if(!a){await client.query('ROLLBACK');return await deny(client);}
    const raw=opaque(),id=randomUUID();
    await client.query(`INSERT INTO access_sessions(id,token_hash,admin_user_id,admin_version,scopes,authenticated_at,expires_at)
      VALUES($1,$2,$3,$4,'{}',$5,$5::timestamptz+interval '1 hour')`,[id,digest(raw),a.id,a.auth_version,authenticatedAt]);
    await accessAudit(client,'admin.authenticated',undefined,a.id,{sessionRef:id});
    await client.query('COMMIT');return raw;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function finishAdminLogin(pool:Pool,currentUrl:URL,flowCookie:string|undefined) {
  await rateLimit(pool,'admin-callback:global',60);
  try {
    if(!flowCookie)throw new Error('Missing flow');
    const flow=unseal(flowCookie);
    if(flow.expires<=Date.now()||flow.expires>Date.now()+600_000||currentUrl.searchParams.get('state')!==flow.state)throw new Error('Invalid flow');
    // The encrypted browser-bound flow is consumed before any token exchange.
    await rateLimit(pool,`oidc-once:${flow.state}`,1,1200);
    const {c,e}=await configuration();
    if(currentUrl.origin!==accessConfig().origin||currentUrl.pathname!=='/api/access/admin/callback')throw new Error('Invalid callback');
    const result=await oidc.authorizationCodeGrant(c,currentUrl,{pkceCodeVerifier:flow.verifier,expectedState:flow.state,
      expectedNonce:flow.nonce,idTokenExpected:true,maxAge:300});
    const claims=result.claims();
    if(!claims || claims.acr!==e.ADMIN_OIDC_MFA_ACR || typeof claims.auth_time!=='number' ||
      claims.auth_time*1000<Date.now()-300_000 || claims.auth_time*1000>Date.now()+30_000)throw new Error('Fresh MFA required');
    // Issuer+subject prevents collisions between identity providers.
    return await createAdminSession(pool,`${e.ADMIN_OIDC_ISSUER}|${claims.sub}`,new Date(claims.auth_time*1000));
  }catch(e) {if(e instanceof AccessDenied)throw e;return deny(pool);}
}
