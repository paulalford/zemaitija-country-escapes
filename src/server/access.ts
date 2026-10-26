import 'server-only';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import type { InternalAuthority } from './cancellation-authority';

export const guestScopes = ['booking:view','booking:balance','booking:cancel','booking:renew'] as const;
export const adminRoles = ['operations','finance','administrator'] as const;
export const isAdminRole = (role:unknown):role is typeof adminRoles[number] =>
  typeof role==='string' && (adminRoles as readonly string[]).includes(role);
export type GuestScope = typeof guestScopes[number];
export const opaque = () => randomBytes(32).toString('base64url');
export const digest = (value:string) => createHash('sha256').update(value).digest();
export const credential = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const uuid = z.string().uuid();
export class AccessDenied extends Error {
  readonly auditId=randomUUID();readonly occurredAt=new Date();
  constructor(readonly session?:Session){super('Access unavailable. Request a fresh link or sign in again.');}
}
export class RateLimited extends Error { constructor(){super('Please wait before trying again.');} }
export class ManagementConflict extends Error {}
export type Session = { id:string; admin_user_id:string|null; guest_token_id:string|null; booking_id:string|null;
  guest_id:string|null; role:'operations'|'finance'|'administrator'|null; scopes:string[]; expires_at:Date; authenticated_at:Date };

export function accessConfig() {
  const origin=new URL(z.string().url().parse(process.env.APP_ORIGIN));
  if(origin.origin!==process.env.APP_ORIGIN || origin.username || origin.password ||
    (origin.protocol!=='https:' && !(process.env.NODE_ENV!=='production' && ['localhost','127.0.0.1'].includes(origin.hostname))))
    throw new Error('A canonical secure APP_ORIGIN is required');
  const key=z.string().regex(/^[a-f0-9]{64}$/i).parse(process.env.ACCESS_SECRET);
  return {origin:origin.origin,key:Buffer.from(key,'hex'),secure:origin.protocol==='https:'};
}
export async function accessAudit(db:Pool|PoolClient,action:string,s?:Session,entityId?:string,details:Record<string,unknown>={}) {
  const id=randomUUID();
  await db.query(`INSERT INTO audit_events(id,booking_id,actor_kind,admin_user_id,guest_id,service_name,action,entity_type,entity_id,occurred_at,details)
    VALUES($1,$2,$3,$4,$5,'access-management',$6,'access',$7,clock_timestamp(),$8)`,
    [id,s?.booking_id??null,s?.admin_user_id?'ADMIN':s?.guest_id?'GUEST':'SERVICE',s?.admin_user_id??null,s?.guest_id??null,action,entityId??null,
      {...details,...s?{authorizationRef:s.id}: {}}]);
  return id;
}
export async function recordAccessDenial(db:Pool|PoolClient,error:AccessDenied) {
  const s=error.session;
  await db.query(`INSERT INTO audit_events(id,actor_kind,admin_user_id,guest_id,service_name,action,entity_type,reason_code,occurred_at,details)
    VALUES($1,$2,$3,$4,'access-management','authorization.denied','access','INVALID_SCOPE_OR_AUTHORITY',$5,$6) ON CONFLICT(id) DO NOTHING`,
    [error.auditId,s?.admin_user_id?'ADMIN':s?.guest_id?'GUEST':'SERVICE',s?.admin_user_id??null,s?.guest_id??null,error.occurredAt,
      s?{authorizationRef:s.id,scopes:s.scopes}:{}]);
}
export async function deny(db:Pool|PoolClient,s?:Session):Promise<never> {
  const error=new AccessDenied(s);await recordAccessDenial(db,error);throw error;
}
/** Durable shared counters; use a global ingress bucket as well as session/credential buckets.
 * Never trust arbitrary forwarding headers as the sole network identity. */
export async function rateLimit(db:Pool|PoolClient,key:string,limit=20,seconds=60) {
  const hash=createHmac('sha256',accessConfig().key).update(key).digest();
  const r=await db.query<{attempts:number}>(`INSERT INTO access_rate_limits(bucket_hash,window_start,attempts)
    VALUES($1,clock_timestamp(),1) ON CONFLICT(bucket_hash) DO UPDATE SET
      attempts=CASE WHEN access_rate_limits.window_start<=clock_timestamp()-make_interval(secs=>$2) THEN 1 ELSE access_rate_limits.attempts+1 END,
      window_start=CASE WHEN access_rate_limits.window_start<=clock_timestamp()-make_interval(secs=>$2) THEN clock_timestamp() ELSE access_rate_limits.window_start END
    RETURNING attempts`,[hash,seconds]);
  if(r.rows[0].attempts>limit){await accessAudit(db,'access.rate_limited');throw new RateLimited();}
}
export async function requireSession(db:Pool|PoolClient,raw:string|undefined,kind:'guest'|'admin',scope?:GuestScope,bookingId?:string):Promise<Session> {
  if(!credential.safeParse(raw).success)return deny(db);
  const r=await db.query<Session>(`SELECT s.id,s.admin_user_id,s.guest_token_id,s.scopes,s.expires_at,s.authenticated_at,
    t.booking_id,b.guest_id,a.role FROM access_sessions s
    LEFT JOIN guest_access_tokens t ON t.id=s.guest_token_id LEFT JOIN bookings b ON b.id=t.booking_id
    LEFT JOIN admin_users a ON a.id=s.admin_user_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
      AND s.last_used_at>clock_timestamp()-interval '30 minutes'
      AND ((s.admin_user_id IS NOT NULL AND a.enabled AND a.disabled_at IS NULL AND a.auth_version=s.admin_version)
        OR (s.guest_token_id IS NOT NULL AND t.revoked_at IS NULL AND t.consumed_at IS NOT NULL))`,[digest(raw!)]);
  const s=r.rows[0];
  if(!s || (kind==='admin')!==!!s.admin_user_id || scope && !s.scopes.includes(scope) || kind==='guest' && bookingId && s.booking_id!==bookingId)return deny(db);
  if(s.admin_user_id) {
    await db.query('SELECT lock_admin_identity($1)',[s.admin_user_id]);
    const current=await db.query<{role:Session['role']}>(`SELECT a.role FROM admin_users a JOIN access_sessions x ON x.admin_user_id=a.id
      WHERE x.id=$1 AND a.enabled AND a.disabled_at IS NULL AND a.auth_version=x.admin_version AND x.revoked_at IS NULL`,[s.id]);
    if(!current.rowCount||!isAdminRole(current.rows[0].role))return deny(db,s);s.role=current.rows[0].role;
  }
  await db.query('UPDATE access_sessions SET last_used_at=clock_timestamp() WHERE id=$1',[s.id]);
  return s;
}
export async function requireUnit(db:Pool|PoolClient,s:Session,unitId:string) {
  if(!s.admin_user_id||!['operations','administrator'].includes(s.role??''))return deny(db,s);
  const allowed=await db.query(`SELECT u.id FROM accommodation_units u WHERE u.id=$1 AND
    ($2='administrator' OR EXISTS(SELECT 1 FROM admin_unit_access g WHERE g.unit_id=u.id AND g.admin_user_id=$3))`,[unitId,s.role,s.admin_user_id]);
  if(!allowed.rowCount)return deny(db,s);
}
export async function requireFinance(db:Pool|PoolClient,s:Session) {
  if(!s.admin_user_id||!['finance','administrator'].includes(s.role??'')||s.authenticated_at.getTime()<Date.now()-600_000)return deny(db,s);
}
export async function issueGuestToken(db:Pool|PoolClient,bookingId:string,scopes:readonly GuestScope[]=guestScopes) {
  uuid.parse(bookingId);
  if(!scopes.length||scopes.some(s=>!guestScopes.includes(s)))throw new Error('Invalid guest scopes');
  const b=(await db.query(`SELECT b.id FROM bookings b JOIN guests g ON g.id=b.guest_id WHERE b.id=$1 AND g.retention_state='SYNTHETIC'`,[bookingId])).rows[0];
  if(!b)throw new AccessDenied();
  const raw=opaque(),id=randomUUID();
  await db.query(`INSERT INTO guest_access_tokens(id,booking_id,token_hash,scope,expires_at)
    VALUES($1,$2,$3,$4,clock_timestamp()+interval '15 minutes')`,[id,bookingId,digest(raw),[...new Set(scopes)].join(' ')]);
  return {id,raw};
}
export async function exchangeGuestLink(pool:Pool,raw:string) {
  await rateLimit(pool,'guest-exchange:global',120);
  if(!credential.safeParse(raw).success)return deny(pool);
  await rateLimit(pool,`guest-exchange:${digest(raw).toString('hex')}`,6);
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const token=(await client.query<{id:string;booking_id:string;scope:string}>(`UPDATE guest_access_tokens
      SET consumed_at=clock_timestamp(),last_used_at=clock_timestamp() WHERE token_hash=$1 AND revoked_at IS NULL
      AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id,booking_id,scope`,[digest(raw)])).rows[0];
    if(!token){await client.query('ROLLBACK');return await deny(client);}
    const secret=opaque(),id=randomUUID();
    await client.query(`INSERT INTO access_sessions(id,token_hash,guest_token_id,scopes,expires_at)
      VALUES($1,$2,$3,$4,clock_timestamp()+interval '30 minutes')`,[id,digest(secret),token.id,token.scope.split(' ')]);
    await accessAudit(client,'guest.link_exchanged',undefined,token.id,{sessionRef:id});
    await client.query('COMMIT');return secret;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
export async function mintAction(pool:Pool,raw:string,kind:'guest'|'admin',operation:string,bookingId?:string) {
  const s=await requireSession(pool,raw,kind,kind==='guest'?operation as GuestScope:undefined,bookingId);
  await rateLimit(pool,`action:${s.id}`,40);
  const secret=opaque();
  await pool.query(`INSERT INTO access_actions(id,session_id,token_hash,operation,booking_id,expires_at)
    VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '5 minutes')`,[randomUUID(),s.id,digest(secret),operation,bookingId??null]);
  return secret;
}
export async function consumeAction(pool:Pool,s:Session,raw:string,operation:string,bookingId?:string) {
  if(!credential.safeParse(raw).success)return deny(pool,s);
  const a=await pool.query<{id:string}>(`UPDATE access_actions SET consumed_at=clock_timestamp() WHERE token_hash=$1 AND session_id=$2
    AND operation=$3 AND booking_id IS NOT DISTINCT FROM $4::uuid AND consumed_at IS NULL AND expires_at>clock_timestamp() RETURNING id`,
    [digest(raw),s.id,operation,bookingId??null]);
  if(!a.rowCount)return deny(pool,s);return a.rows[0].id;
}
export function authority(s:Session,actionRef?:string):InternalAuthority {
  const common={service:'access-adapter',authorizationRef:actionRef??s.id,sessionId:s.id,
    expiresAt:new Date(Math.min(s.expires_at.getTime(),Date.now()+5*60_000))};
  return s.admin_user_id?{...common,kind:'OPERATOR',adminId:s.admin_user_id}:
    {...common,kind:'GUEST',guestId:s.guest_id!,bookingId:s.booking_id!,scope:'booking:cancel'};
}
export async function revokeSession(pool:Pool,raw:string,kind:'guest'|'admin') {
  const s=await requireSession(pool,raw,kind);
  await pool.query('UPDATE access_sessions SET revoked_at=clock_timestamp() WHERE id=$1',[s.id]);
  await accessAudit(pool,'session.revoked',s);
}
