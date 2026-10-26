import 'server-only';
import { localePath, resolveLocale, localeCookie } from '../i18n/routing';
import { translate } from '../i18n/messages';
import type { Pool } from 'pg';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { accessConfig, accessAudit, recordAccessDenial, AccessDenied, RateLimited, ManagementConflict, requireSession, requireFinance, requireUnit,
  authority, consumeAction, exchangeGuestLink, rateLimit, revokeSession, uuid } from './access';
import { AuthorizationDeniedError } from './cancellation-authority';
import { startAdminLogin, finishAdminLogin } from './admin-auth';
import { renewGuestAccess } from './guest-management';
import { blockInput, createOperatorBlock, releaseOperatorBlock, replaceOperatorBlock } from './accommodation-management';
import { identityInput, manageIdentity, manageGuestAccess } from './admin-management';
import { cancelBooking } from './cancellation';
import { requestBalanceCheckout, dispatchBalanceSessionCreate } from './balance-payment';
import { approveCancellationAssessment } from './cancellation-assessment';
import { requestRefund } from './refund-worker';
import { stripeGateway } from './stripe-adapter';

export function cookieName(kind:'guest'|'admin'|'oidc') {return `${accessConfig().secure?'__Host-':''}zce_${kind}`;}
export function cookieValue(request:Request,kind:'guest'|'admin'|'oidc') {
  const name=cookieName(kind);return request.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${name}=`))?.slice(name.length+1);
}
function sessionCookie(response:NextResponse,kind:'guest'|'admin'|'oidc',value:string,maxAge:number) {
  response.cookies.set(cookieName(kind),value,{httpOnly:true,secure:accessConfig().secure,sameSite:'lax',path:'/',maxAge});return response;
}
export const privateHeaders={'Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
export async function sameOrigin(pool:Pool,request:Request) {
  if(request.headers.get('origin')!==accessConfig().origin ||
    request.headers.get('sec-fetch-site') && request.headers.get('sec-fetch-site')!=='same-origin') {
    await accessAudit(pool,'request.csrf_denied');throw new AccessDenied();
  }
}
class InvalidRequest extends Error {}
async function boundedBody(request:Request) {
  const reader=request.body?.getReader();if(!reader)throw new InvalidRequest();
  const chunks:Uint8Array[]=[];let length=0;
  for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>16_384){await reader.cancel();throw new InvalidRequest();}chunks.push(value);}
  const body=Buffer.concat(chunks).toString('utf8');
  if(request.headers.get('content-type')?.split(';')[0]==='application/json')return JSON.parse(body);
  if(request.headers.get('content-type')?.split(';')[0]!=='application/x-www-form-urlencoded')throw new InvalidRequest();
  const fields=new URLSearchParams(body);if([...fields.keys()].some(k=>fields.getAll(k).length!==1))throw new InvalidRequest();
  return Object.fromEntries(fields);
}
const base={actionToken:z.string(),confirmed:z.literal('yes')};
const cents=z.string().regex(/^(0|[1-9]\d{0,14})$/).transform(BigInt);
const evidence=z.object({operationKey:z.string(),expectedRevision:z.number().int().nonnegative(),chargeCents:cents,documentedLossCents:cents,avoidedCostsCents:cents,
  replacements:z.array(z.object({bookingId:uuid,arrivalDate:z.string(),departureDate:z.string(),recoveredCents:cents,provenance:z.string().min(1).max(2000)}).strict()).max(30),
  evidenceRef:z.string().min(1).max(2000),provenance:z.string().min(1).max(2000),legalConstraints:z.string().min(1).max(2000),rationale:z.string().min(1).max(2000)}).strict();
const pageRedirect=(path:string)=>NextResponse.redirect(new URL(path,accessConfig().origin),{status:303,headers:privateHeaders});
/** Explicit route dispatcher. It never deserializes InternalAuthority or provider parameters. */
export async function accessRequest(pool:Pool,request:Request,path:string) {
  let form=false;
  const locale=resolveLocale(request.headers.get('cookie')?.split(';').map(c=>c.trim()).find(c=>c.startsWith(`${localeCookie}=`))?.slice(localeCookie.length+1));
  const redirect=(path:string)=>pageRedirect(localePath(locale,path));
  try {
    if(request.method==='GET'&&path==='admin/callback') {
      const raw=await finishAdminLogin(pool,new URL(request.url),cookieValue(request,'oidc'));
      return sessionCookie(sessionCookie(redirect('/admin'), 'oidc','',0),'admin',raw,3600);
    }
    if(request.method!=='POST')return new NextResponse(null,{status:405,headers:{...privateHeaders,Allow:'POST'}});
    await sameOrigin(pool,request);
    await rateLimit(pool,'access-writes:global',240);
    const input=await boundedBody(request);form=request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded')??false;
    if(path==='guest/exchange') {
      const v=z.object({token:z.string()}).strict().parse(input),raw=await exchangeGuestLink(pool,v.token);
      return sessionCookie(NextResponse.json({ok:true},{headers:privateHeaders}),'guest',raw,1800);
    }
    if(path==='admin/login') {
      z.object({}).strict().parse(input);const login=await startAdminLogin(pool);
      return sessionCookie(NextResponse.redirect(login.url,{status:303,headers:privateHeaders}),'oidc',login.cookie,600);
    }
    const kind=path.startsWith('guest/')?'guest':'admin';
    const raw=cookieValue(request,kind)??'';
    const s=await requireSession(pool,raw,kind);
    await rateLimit(pool,`write:${s.id}`,30);
    if(path===`${kind}/logout`) {
      z.object({}).strict().parse(input);await revokeSession(pool,raw,kind);
      return sessionCookie(redirect(kind==='guest'?'/manage/access':'/admin/signin'),kind,'',0);
    }
    if(path==='guest/renew') {
      const v=z.object(base).strict().parse(input);
      await requireSession(pool,raw,'guest','booking:renew');const ref=await consumeAction(pool,s,v.actionToken,'booking:renew',s.booking_id!);
      await renewGuestAccess(pool,raw,ref);return redirect('/manage?notice=link-queued');
    }
    if(path==='guest/cancel') {
      const v=z.object({...base,reason:z.enum(['GUEST_REQUEST','CHANGE_OF_PLANS'])}).strict().parse(input);
      await requireSession(pool,raw,'guest','booking:cancel');
      const ref=await consumeAction(pool,s,v.actionToken,'booking:cancel',s.booking_id!);
      const result=await cancelBooking(pool,stripeGateway(),s.booking_id!,authority(s,ref),{kind:'GUEST',reason:v.reason});
      return redirect(`/manage?notice=${result==='UNCERTAIN'?'cancellation-pending':'cancellation-reviewed'}`);
    }
    if(path==='guest/balance') {
      const v=z.object(base).strict().parse(input);await requireSession(pool,raw,'guest','booking:balance');
      await consumeAction(pool,s,v.actionToken,'booking:balance',s.booking_id!);
      const a=await requestBalanceCheckout(pool,s.booking_id!,async client=>{await requireSession(client,raw,'guest','booking:balance',s.booking_id!);});
      if(!a)return redirect('/manage?notice=balance-unavailable');
      // The durable service owns accepted amount, original Session and idempotency key.
      const ready=await dispatchBalanceSessionCreate(pool,stripeGateway(),a.attemptId,`guest-${s.id}`,
        {successUrl:`${accessConfig().origin}/manage?notice=payment-return`,cancelUrl:`${accessConfig().origin}/manage?notice=payment-return`});
      await requireSession(pool,raw,'guest','booking:balance');
      if(ready.status==='READY') {
        const url=new URL(ready.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Invalid checkout destination');
        return NextResponse.redirect(url,{status:303,headers:privateHeaders});
      }
      return redirect('/manage?notice=payment-pending');
    }
    if(kind!=='admin')throw new AccessDenied();
    if(path==='admin/block/create'||path==='admin/block/replace') {
      const v=z.object({...base,operationKey:z.string(),unitId:uuid,arrivalDate:z.string(),departureDate:z.string(),reason:z.string(),
        ...(path.endsWith('replace')?{blockId:uuid}:{})}).strict().parse(input);
      const block=blockInput.parse({unitId:v.unitId,arrivalDate:v.arrivalDate,departureDate:v.departureDate,reason:v.reason});
      await requireUnit(pool,s,block.unitId);await consumeAction(pool,s,v.actionToken,path);
      if('blockId' in v)await replaceOperatorBlock(pool,raw,v.operationKey,String(v.blockId),block);
      else await createOperatorBlock(pool,raw,v.operationKey,block);
      return redirect('/admin/calendar?notice=block-saved');
    }
    if(path==='admin/block/release') {
      const v=z.object({...base,operationKey:z.string(),blockId:uuid,reason:z.enum(['PLANS_CHANGED','WORK_COMPLETE','CORRECTION'])}).strict().parse(input);
      await consumeAction(pool,s,v.actionToken,path);await releaseOperatorBlock(pool,raw,v.operationKey,v.blockId,v.reason);
      return redirect('/admin/calendar?notice=block-released');
    }
    if(path==='admin/cancel') {
      const v=z.object({...base,bookingId:uuid,reason:z.enum(['PROVIDER_UNAVAILABLE','SAFETY_CLOSURE'])}).strict().parse(input);
      if(s.role==='operations') {
        const b=(await pool.query<{unit_id:string}>('SELECT unit_id FROM bookings WHERE id=$1',[v.bookingId])).rows[0];
        if(!b)throw new AccessDenied();await requireUnit(pool,s,b.unit_id);
      }
      const ref=await consumeAction(pool,s,v.actionToken,path,v.bookingId);
      const result=await cancelBooking(pool,stripeGateway(),v.bookingId,authority(s,ref),{kind:'PROVIDER',reason:v.reason});
      return redirect(`/admin/bookings/${v.bookingId}?notice=${result==='UNCERTAIN'?'cancellation-pending':'cancellation-reviewed'}`);
    }
    if(path==='admin/assessment') {
      const v=z.object({...base,bookingId:uuid,evidence:z.string().max(14000)}).strict().parse(input);await requireFinance(pool,s);
      const e=evidence.parse(JSON.parse(v.evidence));const ref=await consumeAction(pool,s,v.actionToken,path,v.bookingId);
      await approveCancellationAssessment(pool,v.bookingId,authority(s,ref),e);
      return redirect(`/admin/bookings/${v.bookingId}?notice=assessment-saved`);
    }
    if(path==='admin/refund') {
      const v=z.object({...base,obligationId:uuid,bookingId:uuid}).strict().parse(input);await requireFinance(pool,s);
      const match=await pool.query('SELECT id FROM refund_obligations WHERE id=$1 AND booking_id=$2',[v.obligationId,v.bookingId]);
      if(!match.rowCount)throw new AccessDenied();
      const ref=await consumeAction(pool,s,v.actionToken,path,v.bookingId);
      await requestRefund(pool,v.obligationId,authority(s,ref));return redirect(`/admin/bookings/${v.bookingId}?notice=refund-queued`);
    }
    if(path==='admin/guest-access') {
      const v=z.object({...base,bookingId:uuid,operation:z.enum(['issue','revoke']),operationKey:uuid}).strict().parse(input);
      await consumeAction(pool,s,v.actionToken,path,v.bookingId);
      await manageGuestAccess(pool,raw,v.bookingId,v.operation,v.operationKey);
      return redirect(`/admin/bookings/${v.bookingId}?notice=${v.operation==='issue'?'link-queued':'guest-access-revoked'}`);
    }
    if(path==='admin/identity') {
      const v=z.object({...base,id:z.string(),subject:z.string(),role:z.string(),enabled:z.enum(['true','false']),unitIds:z.string(),operationKey:z.string(),reason:z.string()}).strict().parse(input);
      await requireFinance(pool,s);if(s.role!=='administrator')throw new AccessDenied();
      const parsed=identityInput.parse({id:v.id||null,subject:v.subject,role:v.role,enabled:v.enabled==='true',unitIds:v.unitIds.split(',').map(x=>x.trim()).filter(Boolean),operationKey:v.operationKey,reason:v.reason});
      await consumeAction(pool,s,v.actionToken,path);await manageIdentity(pool,raw,parsed);return redirect('/admin/identities?notice=identity-saved');
    }
    throw new AccessDenied();
  }catch(e) {
    const denied=e instanceof AccessDenied||e instanceof AuthorizationDeniedError;
    const status=denied?404:e instanceof RateLimited?429:e instanceof ManagementConflict?409:e instanceof z.ZodError||e instanceof SyntaxError||e instanceof InvalidRequest?400:503;
    if(e instanceof AccessDenied)await recordAccessDenial(pool,e);
    const message=translate(locale,status===404?'Access is unavailable. Sign in again or request a fresh link through the sandbox operator workflow.':status===429?'Please wait before trying again.':status===409?'The dates or operation key are already in use. Review current availability before submitting a new operation.':status===400?'The request was not accepted. Review every field and confirm the action before submitting.':'The operation could not be completed. Refresh to inspect its current state before retrying.');
    if(form)return redirect(`${path.startsWith('guest/')?'/manage':'/admin'}?notice=${status===409?'conflict':status===404?'access-denied':status===400?'invalid-input':'retry'}`);
    return NextResponse.json({error:message},{status,headers:{...privateHeaders,...status===429?{'Retry-After':'60'}:{}}});
  }
}
