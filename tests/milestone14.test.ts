import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { planned, seed } from '../scripts/seed-reference.mjs';
import { quoteStay } from '../src/server/quote';
import { acceptBooking } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { reconcileInitialAttempt } from '../src/server/payment-reconciliation';
import { deliverOneSandboxNotice, MemorySandboxTransport } from '../src/server/sandbox-notification-worker';
import { type RefundGateway, type RefundRequest, type RefundEvidence, requestRefund } from '../src/server/refund-worker';
import type { CheckoutRequest, CheckoutSession, PaymentEvidence, StripeGateway } from '../src/server/stripe-adapter';
import { issueGuestToken, exchangeGuestLink, requireSession, requireUnit, requireFinance, opaque, digest, mintAction, consumeAction, authority, rateLimit, AccessDenied, RateLimited, revokeSession } from '../src/server/access';
import { guestBooking, renewGuestAccess } from '../src/server/guest-management';
import { managementCalendar, managementHistory, createOperatorBlock, releaseOperatorBlock, replaceOperatorBlock } from '../src/server/accommodation-management';
import { adminBooking, adminBookings, adminIdentities, adminIncidents, manageIdentity, manageGuestAccess } from '../src/server/admin-management';
import { accessRequest } from '../src/server/access-http';
import { startAdminLogin, finishAdminLogin } from '../src/server/admin-auth';
import { cancelBooking } from '../src/server/cancellation';
import { approveCancellationAssessment } from '../src/server/cancellation-assessment';

if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const url=new URL(process.env.MIGRATION_DATABASE_URL??'');
if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_dev'))throw new Error('Local dev database required');
process.env.ALLOW_DEV_REFERENCE_SEED='1';process.env.APP_ORIGIN='http://localhost:3000';process.env.ACCESS_SECRET='a'.repeat(64);
const admin=new Pool({connectionString:url.toString(),max:8}),runtime=new Pool({connectionString:process.env.DATABASE_URL,max:8});
const urls={successUrl:'http://localhost:3000/return',cancelUrl:'http://localhost:3000/cancel'};
beforeAll(async()=>{await seed(url.toString());});
afterAll(async()=>{await runtime.end();await admin.end();});
class FakeGateway implements StripeGateway, RefundGateway {
  refunds=new Map<string,RefundEvidence>(); refundKeys=new Map<string,string>(); creates=0; outcome="succeeded"; timeout=false;
  async createRefund(q:RefundRequest) {
    this.creates++; if(this.timeout)throw new Error("unknown");
    const previous=this.refundKeys.get(q.idempotencyKey);if(previous)return this.refunds.get(previous)!;
    const id=`re_${randomUUID()}`,r:RefundEvidence={id,accountId:this.accountId,livemode:false,paymentIntentId:q.paymentIntentId,chargeId:q.chargeId,amount:q.amountCents,currency:"eur",status:this.outcome,metadata:{attemptId:q.attemptId,commandId:q.commandId,obligationId:q.obligationId,paymentRecordId:q.paymentRecordId}};
    this.refunds.set(id,r);this.refundKeys.set(q.idempotencyKey,id);return r;
  }
  async retrieveRefund(id:string){const r=this.refunds.get(id);if(!r)throw new Error("refund missing");return r;}
  async listRefunds(id:string){return [...this.refunds.values()].filter(r=>r.paymentIntentId===id);}

  readonly accountId='acct_test_fixture';
  sessions=new Map<string,CheckoutSession>();intents=new Map<string,PaymentEvidence>();
  async createSession(request:CheckoutRequest) {
    const c=request.correlation,id=`cs_test_${randomUUID()}`;
    const s:CheckoutSession={id,accountId:this.accountId,url:`https://checkout.stripe.test/${id}`,
      created:request.expiresAt-1800,expiresAt:request.expiresAt,status:'open',paymentStatus:'unpaid',paymentIntentId:null,
      amountTotal:request.amountCents,currency:'eur',livemode:false,mode:'payment',paymentMethodTypes:['card'],
      clientReferenceId:c.bookingId,metadata:{...c}};
    this.sessions.set(id,s);return s;
  }
  async retrieveSession(id:string) {const s=this.sessions.get(id);if(!s)throw new Error('missing Session');return s;}
  async findSessionForPaymentIntent(id:string) {return [...this.sessions.values()].find(s=>s.paymentIntentId===id)??null;}
  async retrievePaymentIntent(id:string) {const p=this.intents.get(id);if(!p)throw new Error('missing intent');return p;}
  async expireSession(id:string) {const s=await this.retrieveSession(id);if(s.status==='open')s.status='expired';return s;}
  verifyEvent(raw:Buffer) {const e=JSON.parse(raw.toString()) as {id:string;type:string;objectType:string;objectId:string};return {...e,created:1,livemode:false,accountId:this.accountId};}
  pay(sessionId:string,when=new Date()) {
    const s=this.sessions.get(sessionId)!,id=`pi_test_${randomUUID()}`;
    s.status='complete';s.paymentStatus='paid';s.paymentIntentId=id;
    this.intents.set(id,{id,status:'succeeded',amountReceived:s.amountTotal!,currency:'eur',livemode:false,
      metadata:s.metadata,chargeId:`ch_test_${randomUUID()}`,chargePaid:true,chargeCaptured:true,
      chargeAmount:s.amountTotal,chargeCurrency:'eur',chargeCreated:Math.floor(when.getTime()/1000)});
    return id;
  }
}

async function fixture(locale:'lt'|'en'|'de'='en',deliverConfirmation=true,arrivalDate='2027-07-02') {
  const unit=randomUUID(),schedule=randomUUID(),guest=randomUUID();
  await admin.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES($1,$2,2,true,1)',[unit,`m14-${unit}`]);
  await admin.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state) VALUES($1,$2,1,'DRAFT')",[schedule,unit]);
  const rates=await admin.query<{start_date:string;end_date:string;day_class:string;nightly_cents:string}>(
    'SELECT start_date::text,end_date::text,day_class,nightly_cents::text FROM seasonal_rates WHERE rate_schedule_version_id=$1',[planned()[0].scheduleId]);
  for(const r of rates.rows) await admin.query(`INSERT INTO seasonal_rates(id,rate_schedule_version_id,start_date,end_date,day_class,nightly_cents,currency)
    VALUES($1,$2,$3,$4,$5,$6,'EUR')`,[randomUUID(),schedule,r.start_date,r.end_date,r.day_class,r.nightly_cents]);
  await admin.query("UPDATE rate_schedule_versions SET state='ACTIVE',activated_at=clock_timestamp() WHERE id=$1",[schedule]);
  await admin.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,$2,$3,'SYNTHETIC')",[guest,Buffer.from('synthetic'),locale]);
  const acceptedAt=arrivalDate==='2027-07-02'?new Date('2027-06-05T10:00:00Z'):new Date(new Date(`${arrivalDate}T10:00:00Z`).getTime()-30*86400000);
  const departureDate=new Date(new Date(`${arrivalDate}T00:00:00Z`).getTime()+3*86400000).toISOString().slice(0,10);
  const quote=await quoteStay(runtime,{unitId:unit,arrivalDate,departureDate,guestCount:2},acceptedAt);
  const booking=await acceptBooking(runtime,{operationKey:randomUUID(),guestId:guest,locale,quote,
    termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:quote.previewSplit.initialCents,
    syntheticPortfolioOnly:true},{testAcceptanceInstant:acceptedAt});
  const gateway=new FakeGateway();
  const ready=await dispatchSessionCreate(runtime,gateway,booking.attemptId,'worker-m14-initial',urls);
  if(ready.status!=='READY')throw new Error('No initial Session');
  gateway.pay(ready.sessionId,acceptedAt);
  expect(await reconcileInitialAttempt(runtime,gateway,booking.attemptId)).toBe('CONFIRMED');
  if(deliverConfirmation) expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),new Date(Date.now()+1000),booking.bookingId)).toBe('SENT');
  return {booking,gateway,unit,guest};
}

type Fixture=Awaited<ReturnType<typeof fixture>>;
async function actor(role='operations',units:string[]=[]) {
  const id=randomUUID(),raw=opaque(),sessionId=randomUUID();
  await admin.query('INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,$3,true)',[id,`synthetic:m14:${id}`,role]);
  for(const u of units)await admin.query('INSERT INTO admin_unit_access(id,admin_user_id,unit_id) VALUES($1,$2,$3)',[randomUUID(),id,u]);
  await admin.query(`INSERT INTO access_sessions(id,token_hash,admin_user_id,admin_version,scopes,expires_at)
    VALUES($1,$2,$3,1,'{}',now()+interval '55 minutes')`,[sessionId,digest(raw),id]);
  return {id,raw,sessionId};
}
async function guest(f:Fixture,scopes:Parameters<typeof issueGuestToken>[2]=undefined) {
  const t=await issueGuestToken(runtime,f.booking.bookingId,scopes);return {token:t,raw:await exchangeGuestLink(runtime,t.raw)};
}
async function unit() {
  const id=randomUUID();await admin.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES($1,$2,6,true,1)',[id,`m14-unit-${id}`]);return id;
}
const block=(unitId:string,start='2027-08-10',end='2027-08-17',reason:'PRIVATE_USE'|'MAINTENANCE'|'OTHER'='PRIVATE_USE')=>({unitId,arrivalDate:start,departureDate:end,reason});
const req=(path:string,body:unknown,cookie='',origin='http://localhost:3000')=>new Request(`http://localhost:3000/api/access/${path}`,{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify(body)});
async function auditCount(action:string){return Number((await admin.query('SELECT count(*) n FROM audit_events WHERE action=$1',[action])).rows[0].n);}
async function guestCancel(f:Fixture,raw:string) {
  const s=await requireSession(runtime,raw,'guest','booking:cancel');
  const a=await mintAction(runtime,raw,'guest','booking:cancel',s.booking_id!);
  const ref=await consumeAction(runtime,s,a,'booking:cancel',s.booking_id!);
  return cancelBooking(runtime,f.gateway,f.booking.bookingId,authority(s,ref),{kind:'GUEST',reason:'SYNTHETIC_REQUEST'});
}

describe('Milestone 14 guest credentials and trusted action context',()=>{
  it('stores only a 256-bit token digest, exchanges once and binds the session to one booking',async()=>{
    const f=await fixture(),t=await issueGuestToken(runtime,f.booking.bookingId);
    expect(Buffer.from(t.raw,'base64url')).toHaveLength(32);
    const stored=(await admin.query('SELECT token_hash,scope,expires_at,created_at FROM guest_access_tokens WHERE id=$1',[t.id])).rows[0];
    expect(stored.token_hash).toEqual(digest(t.raw));expect(stored.scope).toContain('booking:cancel');
    expect(stored.expires_at.getTime()-stored.created_at.getTime()).toBeLessThanOrEqual(901000);
    const raw=await exchangeGuestLink(runtime,t.raw);expect((await requireSession(runtime,raw,'guest')).booking_id).toBe(f.booking.bookingId);
    await expect(exchangeGuestLink(runtime,t.raw)).rejects.toBeInstanceOf(AccessDenied);
  });
  it('only one concurrent exchange wins, with one persisted session',async()=>{
    const f=await fixture(),t=await issueGuestToken(runtime,f.booking.bookingId);
    const r=await Promise.allSettled([exchangeGuestLink(runtime,t.raw),exchangeGuestLink(runtime,t.raw)]);
    expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect((await admin.query('SELECT count(*)::int n FROM access_sessions WHERE guest_token_id=$1',[t.id])).rows[0].n).toBe(1);
  });
  it.each(['expired','revoked','invalid'] as const)('denies %s links without revealing booking identity',async kind=>{
    const f=await fixture(),t=await issueGuestToken(runtime,f.booking.bookingId);
    if(kind==='expired')await admin.query("UPDATE guest_access_tokens SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",[t.id]);
    if(kind==='revoked')await admin.query('UPDATE guest_access_tokens SET revoked_at=clock_timestamp() WHERE id=$1',[t.id]);
    await expect(exchangeGuestLink(runtime,kind==='invalid'?opaque():t.raw)).rejects.toThrow('Access unavailable');
  });
  it('denies cross-booking reads, guest-to-admin access and absent view scope',async()=>{
    const a=await fixture(),b=await fixture(),g=await guest(a);
    await expect(guestBooking(runtime,g.raw,b.booking.bookingId)).rejects.toBeInstanceOf(AccessDenied);
    await expect(requireSession(runtime,g.raw,'admin')).rejects.toBeInstanceOf(AccessDenied);
    const narrow=await guest(a,['booking:balance']);await expect(guestBooking(runtime,narrow.raw)).rejects.toBeInstanceOf(AccessDenied);
  });
  it('revocation takes effect on an existing guest session, and an expired session fails',async()=>{
    const f=await fixture(),g=await guest(f);await admin.query('UPDATE guest_access_tokens SET revoked_at=clock_timestamp() WHERE id=$1',[g.token.id]);
    await expect(requireSession(runtime,g.raw,'guest')).rejects.toBeInstanceOf(AccessDenied);
    const h=await guest(f);await admin.query("UPDATE access_sessions SET expires_at=clock_timestamp()-interval '1 second',authenticated_at=clock_timestamp()-interval '1 minute' WHERE token_hash=$1",[digest(h.raw)]);
    await expect(requireSession(runtime,h.raw,'guest')).rejects.toBeInstanceOf(AccessDenied);
  });
  it('consumes operation-bound actions once; another booking, operation or session cannot reuse them',async()=>{
    const f=await fixture(),g=await guest(f),h=await guest(f),s=await requireSession(runtime,g.raw,'guest'),other=await requireSession(runtime,h.raw,'guest');
    const t=await mintAction(runtime,g.raw,'guest','booking:cancel',s.booking_id!);
    await expect(consumeAction(runtime,other,t,'booking:cancel',s.booking_id!)).rejects.toBeInstanceOf(AccessDenied);
    await expect(consumeAction(runtime,s,t,'booking:balance',s.booking_id!)).rejects.toBeInstanceOf(AccessDenied);
    await expect(consumeAction(runtime,s,t,'booking:cancel',randomUUID())).rejects.toBeInstanceOf(AccessDenied);
    await consumeAction(runtime,s,t,'booking:cancel',s.booking_id!);
    await expect(consumeAction(runtime,s,t,'booking:cancel',s.booking_id!)).rejects.toBeInstanceOf(AccessDenied);
  });
  it('requires cancel scope and a consumed action before the existing cancellation service accepts guest authority',async()=>{
    const f=await fixture(),g=await guest(f,['booking:view']),s=await requireSession(runtime,g.raw,'guest');
    await expect(mintAction(runtime,g.raw,'guest','booking:cancel',f.booking.bookingId)).rejects.toBeInstanceOf(AccessDenied);
    await expect(cancelBooking(runtime,f.gateway,f.booking.bookingId,authority(s),{kind:'GUEST',reason:'SYNTHETIC'})).rejects.toThrow('authority denied');
    expect((await admin.query('SELECT status FROM bookings WHERE id=$1',[f.booking.bookingId])).rows[0].status).toBe('CONFIRMED');
    const allowed=await guest(f);expect(await guestCancel(f,allowed.raw)).toBe('CANCELLED');
    expect((await guestBooking(runtime,allowed.raw)).position?.refundDueCents).toBeGreaterThan(0n);
  });
  it('projects guest financial data without internal evidence, contacts or mutation endpoints',async()=>{
    const f=await fixture(),g=await guest(f),v=await guestBooking(runtime,g.raw);
    const text=JSON.stringify(v,(_,x)=>typeof x==='bigint'?x.toString():x);
    expect(text).not.toMatch(/ciphertext|stripe_|authorizationRef|evidence_ref|external_subject/);
    const r=await accessRequest(runtime,req('guest/assessment',{chargeCents:'0'},`zce_guest=${g.raw}`),'guest/assessment');
    expect(r.status).toBe(404);
    expect((await guestBooking(runtime,g.raw)).booking.total_cents).toBe(v.booking.total_cents);
  });
  it('uses durable shared rate limiting and generic malformed/unknown token responses',async()=>{
    const key=`m14-rate:${randomUUID()}`;await rateLimit(runtime,key,2);await rateLimit(runtime,key,2);
    await expect(rateLimit(runtime,key,2)).rejects.toBeInstanceOf(RateLimited);
    const malformed=await accessRequest(runtime,req('guest/exchange',{token:'bad'}),'guest/exchange');
    const unknown=await accessRequest(runtime,req('guest/exchange',{token:opaque()}),'guest/exchange');
    expect(malformed.status).toBe(unknown.status);expect(await malformed.json()).toEqual(await unknown.json());
  });
  it('issues a fresh single-use scoped link through the existing sandbox delivery worker',async()=>{
    const f=await fixture(),g=await guest(f);await renewGuestAccess(runtime,g.raw);
    const transport=new MemorySandboxTransport();expect(await deliverOneSandboxNotice(runtime,transport,new Date(Date.now()+1000),f.booking.bookingId)).toBe('SENT');
    const message=[...transport.messages.values()][0].message.body;
    expect(message).toContain('/manage/access#');const raw=message.split('/manage/access#')[1].trim();
    const fresh=await exchangeGuestLink(runtime,raw);expect((await requireSession(runtime,fresh,'guest')).booking_id).toBe(f.booking.bookingId);
    const audit=JSON.stringify((await admin.query("SELECT details FROM audit_events WHERE action LIKE 'guest.%' AND occurred_at>now()-interval '5 minutes'")).rows);
    expect(audit).not.toContain(raw);
  });
});

describe('Milestone 14 administrator roles, sessions and identity management',()=>{
  it('denies expired, revoked, disabled and role-changed administrator sessions',async()=>{
    for(const mode of ['expired','revoked','disabled','role']){
      const a=await actor();await requireSession(runtime,a.raw,'admin');
      if(mode==='expired')await admin.query("UPDATE access_sessions SET authenticated_at=now()-interval '1 hour',expires_at=now()-interval '1 second' WHERE id=$1",[a.sessionId]);
      if(mode==='revoked')await revokeSession(runtime,a.raw,'admin');
      if(mode==='disabled')await admin.query('UPDATE admin_users SET enabled=false,disabled_at=clock_timestamp() WHERE id=$1',[a.id]);
      if(mode==='role')await admin.query("UPDATE admin_users SET role='finance' WHERE id=$1",[a.id]);
      await expect(requireSession(runtime,a.raw,'admin')).rejects.toBeInstanceOf(AccessDenied);
    }
  });
  it('operations is limited to assigned units; finance cannot manage inventory; administrator sees all units',async()=>{
    const u=await unit(),other=await unit(),a=await actor('operations',[u]),f=await actor('finance'),root=await actor('administrator');
    const s=await requireSession(runtime,a.raw,'admin');await requireUnit(runtime,s,u);await expect(requireUnit(runtime,s,other)).rejects.toBeInstanceOf(AccessDenied);
    expect((await managementCalendar(runtime,a.raw,'2027-08-01','2027-09-01')).units.map(u=>u.id)).toEqual([u]);
    await expect(createOperatorBlock(runtime,f.raw,randomUUID(),block(u))).rejects.toBeInstanceOf(AccessDenied);
    expect((await managementCalendar(runtime,root.raw,'2027-08-01','2027-09-01',u)).units[0].id).toBe(u);
  });
  it('requires recent MFA for financial mutations and denies operations assessment/refund authority durably',async()=>{
    const f=await fixture(),g=await guest(f);await guestCancel(f,g.raw);
    const op=await actor('operations',[f.unit]),s=await requireSession(runtime,op.raw,'admin'),before=await auditCount('authorization.denied');
    await expect(approveCancellationAssessment(runtime,f.booking.bookingId,authority(s),{operationKey:randomUUID(),expectedRevision:0,chargeCents:0n,documentedLossCents:0n,avoidedCostsCents:0n,replacements:[],evidenceRef:'test',provenance:'test',legalConstraints:'test',rationale:'test'})).rejects.toThrow('authority denied');
    const o=(await runtime.query<{id:string}>('SELECT id FROM refund_obligations WHERE booking_id=$1',[f.booking.bookingId])).rows[0];
    await expect(requestRefund(runtime,o.id,authority(s))).rejects.toThrow('authority denied');
    expect(await auditCount('authorization.denied')).toBe(before+2);
    const finance=await actor('finance'),fs=await requireSession(runtime,finance.raw,'admin');await requireFinance(runtime,fs);
    await admin.query("UPDATE access_sessions SET authenticated_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()+interval '40 minutes' WHERE id=$1",[finance.sessionId]);
    await expect(requireFinance(runtime,await requireSession(runtime,finance.raw,'admin'))).rejects.toBeInstanceOf(AccessDenied);
    expect((await runtime.query('SELECT id FROM refund_attempts WHERE obligation_id=$1',[o.id])).rowCount).toBe(0);
  });
  it('does not expose cross-unit booking or identity information to operations',async()=>{
    const f=await fixture(),a=await actor();
    expect(await adminBookings(runtime,a.raw)).toEqual([]);
    await expect(adminBooking(runtime,a.raw,f.booking.bookingId)).rejects.toBeInstanceOf(AccessDenied);
    await expect(adminIdentities(runtime,a.raw)).rejects.toBeInstanceOf(AccessDenied);
    expect((await adminIncidents(runtime,a.raw)).incidents).toEqual([]);
  });
  it('only an administrator can provision identities; changes revoke sessions and cannot self-escalate',async()=>{
    const u=await unit(),root=await actor('administrator'),op=await actor('operations',[u]);
    const input={id:op.id,subject:`synthetic:m14:${op.id}`,role:'finance' as const,enabled:true,unitIds:[],operationKey:randomUUID(),reason:'Synthetic role review'};
    await expect(manageIdentity(runtime,op.raw,input)).rejects.toBeInstanceOf(AccessDenied);
    await manageIdentity(runtime,root.raw,input);await expect(requireSession(runtime,op.raw,'admin')).rejects.toBeInstanceOf(AccessDenied);
    await expect(manageIdentity(runtime,root.raw,{...input,id:root.id,subject:`synthetic:m14:${root.id}`,operationKey:randomUUID()})).rejects.toBeInstanceOf(AccessDenied);
    expect((await admin.query('SELECT role FROM admin_users WHERE id=$1',[root.id])).rows[0].role).toBe('administrator');
  });
  it('enforces origin, bounded strict input, confirmation and one-use mutation authorization at HTTP boundary',async()=>{
    const u=await unit(),a=await actor('operations',[u]),cookie=`zce_admin=${a.raw}`;
    const token=await mintAction(runtime,a.raw,'admin','admin/block/create');
    const body={unitId:u,arrivalDate:'2027-09-01',departureDate:'2027-09-03',reason:'PRIVATE_USE',operationKey:randomUUID(),actionToken:token,confirmed:'yes'};
    expect((await accessRequest(runtime,req('admin/block/create',body,cookie,'https://evil.example'),'admin/block/create')).status).toBe(404);
    expect((await accessRequest(runtime,req('admin/block/create',{...body,confirmed:'no'},cookie),'admin/block/create')).status).toBe(400);
    expect((await accessRequest(runtime,req('admin/block/create',{...body,role:'administrator'},cookie),'admin/block/create')).status).toBe(400);
    expect((await accessRequest(runtime,req('admin/block/create',body,cookie),'admin/block/create')).status).toBe(303);
    expect((await accessRequest(runtime,req('admin/block/create',body,cookie),'admin/block/create')).status).toBe(404);
    expect((await admin.query('SELECT count(*)::int n FROM operator_blocks WHERE unit_id=$1',[u])).rows[0].n).toBe(1);
    expect((await accessRequest(runtime,req('guest/exchange',{token:'x'.repeat(20000)}),'guest/exchange')).status).toBe(400);
  });
  it('runtime credentials cannot create admins, edit unit configuration, rewrite financial money or delete history',async()=>{
    const r=(await admin.query(`SELECT has_table_privilege('zemaitija_app','admin_users','INSERT') identities,
      has_table_privilege('zemaitija_app','admin_users','UPDATE') roles,
      has_table_privilege('zemaitija_app','accommodation_units','UPDATE') units,
      has_column_privilege('zemaitija_app','payment_records','captured_cents','UPDATE') captures,
      has_table_privilege('zemaitija_app','refund_records','DELETE') refunds,
      has_table_privilege('zemaitija_app','operator_blocks','DELETE') blocks,
      has_table_privilege('zemaitija_app','audit_events','UPDATE') audits`)).rows[0];
    expect(Object.values(r)).toEqual([false,false,false,false,false,false,false]);
    const u=await unit(),a=await actor('operations',[u]);
    await expect(runtime.query("UPDATE admin_users SET role='administrator' WHERE id=$1",[a.id])).rejects.toMatchObject({code:'42501'});
  });
});

async function pausedUnitLock(match=(sql:string)=>sql.startsWith('SELECT lock_management_units')||sql.startsWith('SELECT lock_acceptance_context')) {
  let release!:()=>void,locked!:()=>void,pid=0;
  const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>locked=r);
  const proxied={connect:async()=>{
    const c=await runtime.connect();pid=(await c.query('SELECT pg_backend_pid() pid')).rows[0].pid;
    return {release:()=>c.release(),query:async(sql:string,args?:unknown[])=>{
      const r=await c.query(sql,args);
      if(match(sql)){locked();await gate;}
      return r;
    }};
  }} as unknown as Pool;
  return {pool:proxied,ready,release,get pid(){return pid;}};
}
async function waitBlocked(pid:number) {
  const until=Date.now()+4000;
  while(Date.now()<until){
    const r=await admin.query('SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))',[pid]);
    if(r.rowCount)return;
    await new Promise(r=>setTimeout(r,15));
  }
  throw new Error('Expected observed PostgreSQL lock contention');
}
describe('Milestone 14 shared inventory calendar and owner operations (AM01–AM18)',()=>{
  it('AM01/AM02: private use, maintenance and other blocks share one authoritative calendar with exclusive departure',async()=>{
    const u=await unit(),a=await actor('operations',[u]);
    for(const [i,reason] of (['PRIVATE_USE','MAINTENANCE','OTHER'] as const).entries())await createOperatorBlock(runtime,a.raw,randomUUID(),block(u,`2027-08-${10+i*7}`,`2027-08-${17+i*7}`,reason));
    const v=await managementCalendar(runtime,a.raw,'2027-08-01','2027-09-01');
    expect(v.occupancy.map(c=>c.status)).toEqual(['PRIVATE_USE','MAINTENANCE','OTHER']);
    expect(v.occupancy[0].arrival_date).toBe('2027-08-10');expect(v.occupancy[0].departure_date).toBe('2027-08-17');
    expect(JSON.stringify(v)).not.toMatch(/guest_id|email|payment|booking_id/);
  });
  it('AM03: cannot displace a confirmed booking; rejected block and audit roll back',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]);
    await expect(createOperatorBlock(runtime,a.raw,randomUUID(),block(f.unit,'2027-07-02','2027-07-05'))).rejects.toThrow('Dates already unavailable');
    expect((await admin.query('SELECT count(*)::int n FROM operator_blocks WHERE unit_id=$1',[f.unit])).rows[0].n).toBe(0);
    expect((await admin.query('SELECT status FROM bookings WHERE id=$1',[f.booking.bookingId])).rows[0].status).toBe('CONFIRMED');
  });
  it('AM04: pending and unresolved aged holds remain blocking and distinct from confirmed bookings',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]),at=new Date('2027-06-05T10:00:00Z');
    const q=await quoteStay(runtime,{unitId:f.unit,arrivalDate:'2027-08-10',departureDate:'2027-08-17',guestCount:2},at);
    const b=await acceptBooking(runtime,{operationKey:randomUUID(),guestId:f.guest,locale:'en',quote:q,termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:q.previewSplit.initialCents,syntheticPortfolioOnly:true},{testAcceptanceInstant:at});
    const aged=await admin.connect();try{await aged.query('BEGIN');await aged.query("UPDATE inventory_holds SET state='RECONCILING',started_at=now()-interval '1 day' WHERE id=$1",[b.holdId]);await aged.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1",[b.attemptId]);await aged.query('COMMIT');}finally{aged.release();}
    await expect(createOperatorBlock(runtime,a.raw,randomUUID(),block(f.unit))).rejects.toThrow('Dates already unavailable');
    const view=await managementCalendar(runtime,a.raw,'2027-08-01','2027-09-01');expect(view.occupancy[0].status).toBe('PENDING_HOLD');
    await expect(releaseOperatorBlock(runtime,a.raw,randomUUID(),b.holdId,'PLANS_CHANGED')).rejects.toBeInstanceOf(AccessDenied);
  });
  it('AM05: observes PostgreSQL blocking for two concurrent competing block requests; only one commits',async()=>{
    const u=await unit(),a=await actor('operations',[u]),barrier=await pausedUnitLock();
    const first=createOperatorBlock(barrier.pool,a.raw,randomUUID(),block(u));await barrier.ready;
    const second=createOperatorBlock(runtime,a.raw,randomUUID(),block(u));const settled=Promise.allSettled([first,second]);
    try{await waitBlocked(barrier.pid);}finally{barrier.release();}
    expect((await settled).filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect((await admin.query('SELECT count(*)::int n FROM inventory_claims WHERE unit_id=$1 AND released_at IS NULL',[u])).rows[0].n).toBe(1);
  });
  it('AM06: block versus guest acceptance races on one unit; loser creates no booking or provider command',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]),at=new Date('2027-06-05T10:00:00Z');
    const q=await quoteStay(runtime,{unitId:f.unit,arrivalDate:'2027-08-10',departureDate:'2027-08-17',guestCount:2},at);
    const barrier=await pausedUnitLock(),first=createOperatorBlock(barrier.pool,a.raw,randomUUID(),block(f.unit));await barrier.ready;
    const second=acceptBooking(runtime,{operationKey:randomUUID(),guestId:f.guest,locale:'en',quote:q,termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:q.previewSplit.initialCents,syntheticPortfolioOnly:true},{testAcceptanceInstant:at});
    const settled=Promise.allSettled([first,second]);try{await waitBlocked(barrier.pid);}finally{barrier.release();}
    const r=await settled;expect(r[0].status).toBe('fulfilled');expect(r[1].status).toBe('rejected');
    expect((await admin.query("SELECT count(*)::int n FROM bookings WHERE unit_id=$1 AND arrival_date='2027-08-10'",[f.unit])).rows[0].n).toBe(0);
    expect((await admin.query('SELECT count(*)::int n FROM provider_commands pc JOIN payment_attempts pa ON pa.id=pc.payment_attempt_id JOIN bookings b ON b.id=pa.booking_id WHERE b.unit_id=$1',[f.unit])).rows[0].n).toBe(1);
  });
  it('AM07/AM09: adjacent dates/different units coexist; concurrent identical keys return one result; changed input fails',async()=>{
    const u=await unit(),v=await unit(),a=await actor('operations',[u,v]),key=randomUUID();
    const r=await Promise.all([createOperatorBlock(runtime,a.raw,key,block(u)),createOperatorBlock(runtime,a.raw,key,block(u))]);
    expect(r[0]).toEqual(r[1]);await createOperatorBlock(runtime,a.raw,randomUUID(),block(u,'2027-08-17','2027-08-20'));
    await createOperatorBlock(runtime,a.raw,randomUUID(),block(v));
    await expect(createOperatorBlock(runtime,a.raw,key,block(u,'2027-08-10','2027-08-18'))).rejects.toThrow('Operation key already used');
    expect((await admin.query("SELECT count(*)::int n FROM audit_events WHERE action='block.created' AND entity_id=$1",[r[0].blockId])).rows[0].n).toBe(1);
  });
  it('AM08: denied finance/disabled/cross-unit mutations survive rollback as durable redacted audit',async()=>{
    const u=await unit(),a=await actor('finance'),op=await actor('operations'),disabled=await actor('operations',[u]);
    await admin.query('UPDATE admin_users SET enabled=false WHERE id=$1',[disabled.id]);
    for(const raw of [a.raw,op.raw,disabled.raw,opaque()]){
      const before=await auditCount('authorization.denied');await expect(createOperatorBlock(runtime,raw,randomUUID(),block(u))).rejects.toBeInstanceOf(AccessDenied);
      expect(await auditCount('authorization.denied')).toBe(before+1);
    }
    expect((await admin.query('SELECT id FROM operator_blocks WHERE unit_id=$1',[u])).rowCount).toBe(0);
  });
  it('AM10: forced claim/audit failures roll back the whole block transaction',async()=>{
    for(const match of ['INSERT INTO inventory_claims','INSERT INTO audit_events']){
      const u=await unit(),a=await actor('operations',[u]);
      const proxy={connect:async()=>{const c=await runtime.connect();return {release:()=>c.release(),query:async(sql:string,args?:unknown[])=>{if(sql.startsWith(match))throw new Error('synthetic injected failure');return c.query(sql,args);}};}} as unknown as Pool;
      await expect(createOperatorBlock(proxy,a.raw,randomUUID(),block(u))).rejects.toThrow('synthetic injected failure');
      expect((await admin.query('SELECT id FROM operator_blocks WHERE unit_id=$1',[u])).rowCount).toBe(0);
      expect((await admin.query('SELECT id FROM inventory_claims WHERE unit_id=$1',[u])).rowCount).toBe(0);
    }
  });
  it('AM11/AM12: release is atomic, idempotent, preserves history and cannot target a guest claim',async()=>{
    const u=await unit(),a=await actor('operations',[u]),b=await createOperatorBlock(runtime,a.raw,randomUUID(),block(u)),key=randomUUID();
    const result=await releaseOperatorBlock(runtime,a.raw,key,b.blockId,'PLANS_CHANGED');expect(await releaseOperatorBlock(runtime,a.raw,key,b.blockId,'PLANS_CHANGED')).toEqual(result);
    await releaseOperatorBlock(runtime,a.raw,randomUUID(),b.blockId,'PLANS_CHANGED');
    const r=(await admin.query('SELECT b.released_at block_at,c.released_at claim_at FROM operator_blocks b JOIN inventory_claims c ON c.operator_block_id=b.id WHERE b.id=$1',[b.blockId])).rows[0];
    expect(r.block_at).toEqual(r.claim_at);expect(r.block_at).toBeInstanceOf(Date);
    await expect(releaseOperatorBlock(runtime,a.raw,randomUUID(),randomUUID(),'PLANS_CHANGED')).rejects.toBeInstanceOf(AccessDenied);
  });
  it('AM13: release and two new claims serialize without overlapping committed ownership',async()=>{
    const u=await unit(),a=await actor('operations',[u]),b=await createOperatorBlock(runtime,a.raw,randomUUID(),block(u)),barrier=await pausedUnitLock();
    const release=releaseOperatorBlock(barrier.pool,a.raw,randomUUID(),b.blockId,'PLANS_CHANGED');await barrier.ready;
    const c1=createOperatorBlock(runtime,a.raw,randomUUID(),block(u)),c2=createOperatorBlock(runtime,a.raw,randomUUID(),block(u));
    const settled=Promise.allSettled([release,c1,c2]);try{await waitBlocked(barrier.pid);}finally{barrier.release();}
    expect((await settled).filter(r=>r.status==='fulfilled')).toHaveLength(2);
    expect((await admin.query('SELECT count(*)::int n FROM inventory_claims WHERE unit_id=$1 AND released_at IS NULL',[u])).rows[0].n).toBe(1);
  });
  it('AM14: replacement rolls back release on conflict, then replaces atomically on free dates',async()=>{
    const u=await unit(),v=await unit(),a=await actor('operations',[u,v]),original=await createOperatorBlock(runtime,a.raw,randomUUID(),block(u));
    await createOperatorBlock(runtime,a.raw,randomUUID(),block(v));
    await expect(replaceOperatorBlock(runtime,a.raw,randomUUID(),original.blockId,block(v))).rejects.toThrow('Dates already unavailable');
    expect((await admin.query('SELECT released_at FROM operator_blocks WHERE id=$1',[original.blockId])).rows[0].released_at).toBeNull();
    const key=randomUUID(),replacement=await replaceOperatorBlock(runtime,a.raw,key,original.blockId,block(v,'2027-08-17','2027-08-20'));
    expect(await replaceOperatorBlock(runtime,a.raw,key,original.blockId,block(v,'2027-08-17','2027-08-20'))).toEqual(replacement);
    expect(replacement.replacedBlockId).toBe(original.blockId);
  });
  it('AM17/AM18: managed claims cannot change owner, dates or release status independently, and remain in one exclusion domain',async()=>{
    const u=await unit(),a=await actor('operations',[u]),b=await createOperatorBlock(runtime,a.raw,randomUUID(),block(u));
    await expect(admin.query('UPDATE operator_blocks SET released_at=clock_timestamp() WHERE id=$1',[b.blockId])).rejects.toMatchObject({code:'23514'});
    await expect(admin.query("UPDATE inventory_claims SET arrival_date='2027-08-09' WHERE operator_block_id=$1",[b.blockId])).rejects.toMatchObject({code:'23514'});
    await expect(admin.query('DELETE FROM inventory_claims WHERE operator_block_id=$1',[b.blockId])).rejects.toMatchObject({code:'23514'});
    await admin.query('UPDATE accommodation_units SET enabled=false,config_version=config_version+1 WHERE id=$1',[u]);
    expect((await admin.query('SELECT released_at FROM inventory_claims WHERE operator_block_id=$1',[b.blockId])).rows[0].released_at).toBeNull();
    expect((await admin.query("SELECT count(*)::int n FROM pg_constraint WHERE conrelid='inventory_claims'::regclass AND contype='x'")).rows[0].n).toBe(1);
  });
});

const issuer='https://m14-idp.example.test';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...keys.publicKey.export({format:'jwk'}),kid:'synthetic-m14',alg:'RS256',use:'sig'};
function jwt(claims:Record<string,unknown>,badSignature=false) {
  const header=Buffer.from(JSON.stringify({alg:'RS256',kid:jwk.kid})).toString('base64url'),payload=Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signer=createSign('RSA-SHA256');signer.update(`${header}.${payload}`);signer.end();
  const signature=signer.sign(keys.privateKey);if(badSignature)signature[0]^=1;
  return `${header}.${payload}.${signature.toString('base64url')}`;
}
async function syntheticLogin(change:Record<string,unknown>={},badSignature=false,registered=true) {
  process.env.ADMIN_OIDC_ISSUER=issuer;process.env.ADMIN_OIDC_CLIENT_ID='m14-client';process.env.ADMIN_OIDC_CLIENT_SECRET='synthetic-secret-m14-not-production';process.env.ADMIN_OIDC_MFA_ACR='urn:synthetic:phishing-resistant-mfa';
  const subject=randomUUID();let nonce='';
  if(registered)await admin.query("INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,'operations',true)",[randomUUID(),`${issuer}|${subject}`]);
  const responses=(url:string|URL|Request,init?:RequestInit)=>{
    const location=String(url),headers={'content-type':'application/json'};
    if(location.endsWith('/.well-known/openid-configuration'))return Promise.resolve(new Response(JSON.stringify({issuer,authorization_endpoint:`${issuer}/authorize`,token_endpoint:`${issuer}/token`,jwks_uri:`${issuer}/jwks`,response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],code_challenge_methods_supported:['S256']}),{headers}));
    if(location.endsWith('/jwks'))return Promise.resolve(new Response(JSON.stringify({keys:[jwk]}),{headers}));
    if(location.endsWith('/token')){
      const body=new URLSearchParams(String(init?.body));expect(body.get('code_verifier')).toHaveLength(43);expect(body.get('grant_type')).toBe('authorization_code');
      const now=Math.floor(Date.now()/1000),claims={iss:issuer,sub:subject,aud:'m14-client',exp:now+300,iat:now,auth_time:now,nonce,acr:'urn:synthetic:phishing-resistant-mfa',...change};
      return Promise.resolve(new Response(JSON.stringify({access_token:'synthetic-access',token_type:'Bearer',expires_in:300,id_token:jwt(claims,badSignature)}),{headers}));
    }
    throw new Error('Unexpected identity-provider request');
  };
  vi.stubGlobal('fetch',responses);
  const started=await startAdminLogin(runtime),authorizeUrl=new URL(started.url);nonce=authorizeUrl.searchParams.get('nonce')!;
  expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');expect(authorizeUrl.searchParams.get('max_age')).toBe('0');
  const callback=new URL('http://localhost:3000/api/access/admin/callback');callback.searchParams.set('code','synthetic-code');callback.searchParams.set('state',authorizeUrl.searchParams.get('state')!);
  return {started,callback,subject};
}
describe('Milestone 14 OpenID Connect signed MFA authentication',()=>{
  it('verifies signed ID tokens, nonce, PKCE, issuer/audience and fresh MFA before mapping an enabled identity',async()=>{
    try{const flow=await syntheticLogin();const raw=await finishAdminLogin(runtime,flow.callback,flow.started.cookie);
      expect((await requireSession(runtime,raw,'admin')).role).toBe('operations');
      await expect(finishAdminLogin(runtime,flow.callback,flow.started.cookie)).rejects.toBeInstanceOf(AccessDenied);
    }finally{vi.unstubAllGlobals();}
  });
  it.each([
    ['signature',{},true],['nonce',{nonce:'wrong'},false],['issuer',{iss:'https://evil.example'},false],
    ['audience',{aud:'another-client'},false],['expired',{exp:1},false],['MFA',{acr:'password-only'},false],['stale',{auth_time:1},false],
  ] as const)('rejects invalid %s evidence without creating a session',async(_,change,bad)=>{
    try{const flow=await syntheticLogin(change,bad);await expect(finishAdminLogin(runtime,flow.callback,flow.started.cookie)).rejects.toBeInstanceOf(AccessDenied);}
    finally{vi.unstubAllGlobals();}
  });
  it('preserves the signed provider authentication time for subsequent financial freshness checks',async()=>{
    const authenticated=Math.floor(Date.now()/1000)-240;
    try{const flow=await syntheticLogin({auth_time:authenticated});const raw=await finishAdminLogin(runtime,flow.callback,flow.started.cookie);
      expect((await requireSession(runtime,raw,'admin')).authenticated_at.getTime()).toBe(authenticated*1000);
    }finally{vi.unstubAllGlobals();}
  });
  it('rejects unregistered external subjects and forged browser flow cookies',async()=>{
    try{
      const flow=await syntheticLogin({},false,false);await expect(finishAdminLogin(runtime,flow.callback,flow.started.cookie)).rejects.toBeInstanceOf(AccessDenied);
      const real=await syntheticLogin();await expect(finishAdminLogin(runtime,real.callback,opaque())).rejects.toBeInstanceOf(AccessDenied);
      await expect(finishAdminLogin(runtime,real.callback,undefined)).rejects.toBeInstanceOf(AccessDenied);
    }finally{vi.unstubAllGlobals();}
  });
});


describe('Milestone 14 administration review follow-up',()=>{
  it('binds administrator action tokens to a target without treating administrator identity as a guest booking',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]);
    const action=await mintAction(runtime,a.raw,'admin','admin/guest-access',f.booking.bookingId);
    const s=await requireSession(runtime,a.raw,'admin');
    await expect(consumeAction(runtime,s,action,'admin/guest-access',randomUUID())).rejects.toBeInstanceOf(AccessDenied);
    expect(await consumeAction(runtime,s,action,'admin/guest-access',f.booking.bookingId)).toMatch(/^[a-f0-9-]{36}$/);
  });
  it('operators issue scoped sandbox links and revoke current booking access; finance cannot impersonate guests',async()=>{
    const f=await fixture(),g=await guest(f),a=await actor('operations',[f.unit]),finance=await actor('finance');
    await expect(manageGuestAccess(runtime,finance.raw,f.booking.bookingId,'issue',randomUUID())).rejects.toBeInstanceOf(AccessDenied);
    await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'issue',randomUUID());
    await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'revoke',randomUUID());
    await expect(requireSession(runtime,g.raw,'guest')).rejects.toBeInstanceOf(AccessDenied);
    const transport=new MemorySandboxTransport();expect(await deliverOneSandboxNotice(runtime,transport,new Date(Date.now()+1000),f.booking.bookingId)).toBe('SUPPRESSED');
    expect(transport.messages.size).toBe(0);
  });
  it('management history includes only permitted units and carries the acting identity reference',async()=>{
    const u=await unit(),other=await unit(),a=await actor('operations',[u]);
    const b=await createOperatorBlock(runtime,a.raw,randomUUID(),block(u));await releaseOperatorBlock(runtime,a.raw,randomUUID(),b.blockId,'WORK_COMPLETE');
    const history=await managementHistory(runtime,a.raw,[u]);expect(history.map(r=>r.action)).toEqual(['block.released','block.created']);
    expect(history.every(r=>r.admin_user_id===a.id)).toBe(true);
    await expect(managementHistory(runtime,a.raw,[other])).rejects.toBeInstanceOf(AccessDenied);
  });
});


describe('Milestone 14 independent security review: access revocation fence',()=>{
  const accessLock=(sql:string)=>sql.startsWith('SELECT lock_guest_access');
  const deliveryTime=()=>new Date(Date.now()+1000);
  async function tokenCount(bookingId:string) {
    return (await admin.query('SELECT count(*)::int n FROM guest_access_tokens WHERE booking_id=$1',[bookingId])).rows[0].n;
  }
  it('revokes tokens and associated sessions, suppresses all old requests, and permits a new explicit idempotent request',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]),g=await guest(f),unused=await issueGuestToken(runtime,f.booking.bookingId);
    await renewGuestAccess(runtime,g.raw);
    const oldKey=randomUUID();await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'issue',oldKey);
    const before=await tokenCount(f.booking.bookingId),key=randomUUID();
    await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'revoke',key);
    await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'revoke',key);
    expect((await admin.query('SELECT generation FROM guest_access_boundaries WHERE booking_id=$1',[f.booking.bookingId])).rows[0].generation).toBe(1);
    expect((await admin.query('SELECT revoked_at FROM access_sessions WHERE token_hash=$1',[digest(g.raw)])).rows[0].revoked_at).toBeInstanceOf(Date);
    await expect(requireSession(runtime,g.raw,'guest')).rejects.toBeInstanceOf(AccessDenied);
    await expect(exchangeGuestLink(runtime,unused.raw)).rejects.toBeInstanceOf(AccessDenied);
    await expect(renewGuestAccess(runtime,g.raw)).rejects.toBeInstanceOf(AccessDenied);
    const transport=new MemorySandboxTransport();
    for(let i=0;i<2;i++)expect(await deliverOneSandboxNotice(runtime,transport,deliveryTime(),f.booking.bookingId)).toBe('SUPPRESSED');
    expect(await deliverOneSandboxNotice(runtime,transport,deliveryTime(),f.booking.bookingId)).toBeNull();
    expect(transport.messages.size).toBe(0);expect(await tokenCount(f.booking.bookingId)).toBe(before);
    const stopped=await admin.query(`SELECT n.state,n.suppression_reason,n.lease_until,a.result,a.error_code,a.finished_at
      FROM notification_outbox n JOIN notification_delivery_attempts a ON a.notification_id=n.id
      WHERE n.booking_id=$1 AND n.event_type='GUEST_ACCESS_LINK'`,[f.booking.bookingId]);
    expect(stopped.rows).toHaveLength(2);
    for(const n of stopped.rows){expect(n).toMatchObject({state:'SUPPRESSED',suppression_reason:'GUEST_ACCESS_REVOKED',lease_until:null,result:'SUPPRESSED',error_code:'GUEST_ACCESS_REVOKED'});expect(n.finished_at).toBeInstanceOf(Date);}
    // Replaying the old authorization cannot capture a later generation.
    await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'issue',oldKey);
    expect(await deliverOneSandboxNotice(runtime,transport,deliveryTime(),f.booking.bookingId)).toBeNull();
    const fresh=randomUUID();await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'issue',fresh);
    await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'issue',fresh);
    expect(await deliverOneSandboxNotice(runtime,transport,deliveryTime(),f.booking.bookingId)).toBe('SENT');
    const raw=[...transport.messages.values()][0].message.body.split('/manage/access#')[1].trim();
    expect((await requireSession(runtime,await exchangeGuestLink(runtime,raw),'guest')).booking_id).toBe(f.booking.bookingId);
    const stored=JSON.stringify((await admin.query('SELECT row_to_json(n) n FROM notification_outbox n WHERE booking_id=$1',[f.booking.bookingId])).rows)
      +JSON.stringify((await admin.query('SELECT details FROM audit_events WHERE entity_id=$1 OR booking_id=$1',[f.booking.bookingId])).rows);
    expect(stored).not.toContain(raw);
    await expect(runtime.query('UPDATE notification_outbox SET guest_access_generation=99 WHERE booking_id=$1',[f.booking.bookingId])).rejects.toMatchObject({code:'23514'});
    await expect(runtime.query('UPDATE guest_access_boundaries SET generation=0 WHERE booking_id=$1',[f.booking.bookingId])).rejects.toMatchObject({code:'42501'});
  });
  it('revocation winning the PostgreSQL lock suppresses an already leased delivery without issuing a token',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]);await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'issue',randomUUID());
    const before=await tokenCount(f.booking.bookingId),barrier=await pausedUnitLock(accessLock);
    const revocation=manageGuestAccess(barrier.pool,a.raw,f.booking.bookingId,'revoke',randomUUID());await barrier.ready;
    const transport=new MemorySandboxTransport(),delivery=deliverOneSandboxNotice(runtime,transport,deliveryTime(),f.booking.bookingId);
    const settled=Promise.allSettled([revocation,delivery]);try{await waitBlocked(barrier.pid);}finally{barrier.release();}
    expect(await settled).toEqual([{status:'fulfilled',value:undefined},{status:'fulfilled',value:'SUPPRESSED'}]);
    expect(transport.messages.size).toBe(0);expect(await tokenCount(f.booking.bookingId)).toBe(before);
  });
  it('issuance winning the PostgreSQL lock is subsequently revoked even if transport sends later',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]);await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'issue',randomUUID());
    const barrier=await pausedUnitLock(accessLock),transport=new MemorySandboxTransport();
    const delivery=deliverOneSandboxNotice(barrier.pool,transport,deliveryTime(),f.booking.bookingId);await barrier.ready;
    const revocation=manageGuestAccess(runtime,a.raw,f.booking.bookingId,'revoke',randomUUID());
    const settled=Promise.allSettled([delivery,revocation]);try{await waitBlocked(barrier.pid);}finally{barrier.release();}
    expect(await settled).toEqual([{status:'fulfilled',value:'SENT'},{status:'fulfilled',value:undefined}]);
    const raw=[...transport.messages.values()][0].message.body.split('/manage/access#')[1].trim();
    await expect(exchangeGuestLink(runtime,raw)).rejects.toBeInstanceOf(AccessDenied);
    expect((await admin.query('SELECT id FROM guest_access_tokens WHERE booking_id=$1 AND revoked_at IS NULL',[f.booking.bookingId])).rowCount).toBe(0);
  });
  it('rechecks a previously authenticated renewal after waiting for concurrent revocation',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]),g=await guest(f),barrier=await pausedUnitLock(accessLock);
    const revocation=manageGuestAccess(barrier.pool,a.raw,f.booking.bookingId,'revoke',randomUUID());await barrier.ready;
    const renewal=renewGuestAccess(runtime,g.raw),settled=Promise.allSettled([revocation,renewal]);
    try{await waitBlocked(barrier.pid);}finally{barrier.release();}
    const results=await settled;expect(results[0].status).toBe('fulfilled');expect(results[1]).toMatchObject({status:'rejected',reason:expect.any(AccessDenied)});
    expect((await admin.query("SELECT id FROM notification_outbox WHERE booking_id=$1 AND event_type='GUEST_ACCESS_LINK'",[f.booking.bookingId])).rowCount).toBe(0);
  });
  it('continues delivering payment and refund notices without obsolete credentials, including notices queued after revocation',async()=>{
    const f=await fixture('en',false),a=await actor('operations',[f.unit]);
    await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'revoke',randomUUID());
    const before=await tokenCount(f.booking.bookingId),transport=new MemorySandboxTransport();
    expect(await deliverOneSandboxNotice(runtime,transport,deliveryTime(),f.booking.bookingId)).toBe('SENT');
    // Copy the synthetic source evidence into independent refund-status notice fixtures.
    for(const type of ['GUEST_PAYMENT_UPDATE','REFUND_SUCCEEDED'])await admin.query(`INSERT INTO notification_outbox
      (id,booking_id,source_audit_event_id,event_type,recipient_kind,recipient_ref,locale,idempotency_key,due_at,state)
      SELECT gen_random_uuid(),booking_id,source_audit_event_id,$2,'GUEST',recipient_ref,locale,$3,clock_timestamp(),'QUEUED'
      FROM notification_outbox WHERE booking_id=$1 AND event_type='BOOKING_CONFIRMED'`,[f.booking.bookingId,type,randomUUID()]);
    for(let i=0;i<2;i++)expect(await deliverOneSandboxNotice(runtime,transport,deliveryTime(),f.booking.bookingId)).toBe('SENT');
    expect(transport.messages.size).toBe(3);expect([...transport.messages.values()].every(v=>!v.message.body.includes('/manage/access#'))).toBe(true);
    expect(await tokenCount(f.booking.bookingId)).toBe(before);
  });
  it('a transient credential delivery cannot regain access through its retry after revocation',async()=>{
    const f=await fixture(),a=await actor('operations',[f.unit]);await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'issue',randomUUID());
    const failed={sandbox:true as const,lookup:async()=>null,send:async()=>{throw new Error('synthetic transient failure');}};
    expect(await deliverOneSandboxNotice(runtime,failed,deliveryTime(),f.booking.bookingId)).toBe('RETRY_WAIT');
    await manageGuestAccess(runtime,a.raw,f.booking.bookingId,'revoke',randomUUID());
    const transport=new MemorySandboxTransport();expect(await deliverOneSandboxNotice(runtime,transport,new Date(Date.now()+120000),f.booking.bookingId)).toBe('SUPPRESSED');
    expect(transport.messages.size).toBe(0);
  });
});

describe('Milestone 14 independent security review: administrator identity and roles',()=>{
  it('the existing unique index rejects duplicate CLI-style inserts and concurrent identity provisioning',async()=>{
    const root=await actor('administrator'),subject=`synthetic:duplicate:${randomUUID()}`;
    const index=(await admin.query(`SELECT i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) definition
      FROM pg_index i WHERE i.indexrelid='admin_users_subject_key'::regclass`)).rows[0];
    expect(index).toMatchObject({indisunique:true,indisvalid:true});expect(index.definition).toContain('(external_subject)');
    const request=()=>({id:null,subject,role:'operations' as const,enabled:true,unitIds:[],operationKey:randomUUID(),reason:'Synthetic uniqueness review'});
    const r=await Promise.allSettled([manageIdentity(runtime,root.raw,request()),manageIdentity(runtime,root.raw,request())]);
    expect(r.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(r.find(x=>x.status==='rejected')).toMatchObject({reason:{code:'23505',constraint:'admin_users_subject_key'}});
    await expect(admin.query("INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,'operations',true)",[randomUUID(),subject])).rejects.toMatchObject({code:'23505',constraint:'admin_users_subject_key'});
    const other=await actor('operations');
    await expect(manageIdentity(runtime,root.raw,{...request(),id:other.id})).rejects.toMatchObject({code:'23505',constraint:'admin_users_subject_key'});
    expect((await admin.query('SELECT external_subject FROM admin_users WHERE id=$1',[other.id])).rows[0].external_subject).toBe(`synthetic:m14:${other.id}`);
    expect((await admin.query('SELECT count(*)::int n FROM admin_users WHERE external_subject=$1',[subject])).rows[0].n).toBe(1);
  });
  it('positively authorizes booking list and detail access for approved roles and assigned units',async()=>{
    const f=await fixture(),other=await fixture(),op=await actor('operations',[f.unit]);
    expect((await adminBookings(runtime,op.raw)).map(b=>b.id)).toEqual([f.booking.bookingId]);
    expect((await adminBooking(runtime,op.raw,f.booking.bookingId)).booking.id).toBe(f.booking.bookingId);
    await expect(adminBooking(runtime,op.raw,other.booking.bookingId)).rejects.toBeInstanceOf(AccessDenied);
    for(const role of ['finance','administrator']){const a=await actor(role);expect((await adminBooking(runtime,a.raw,other.booking.bookingId)).booking.id).toBe(other.booking.bookingId);}
  });
  it('rejects a historical unknown role at session, booking, incidents and signed administrator login boundaries',async()=>{
    const f=await fixture(),c=await admin.connect();
    try {
      const flow=await syntheticLogin({},false,false);
      await c.query('BEGIN');
      // NOT VALID permits historical rows in production. Build one solely inside
      // this rollback-only transaction; restore the constraint and discard all rows.
      await c.query('ALTER TABLE admin_users DROP CONSTRAINT admin_users_approved_role');
      const id=randomUUID(),raw=opaque();
      await c.query("INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,'unexpected-legacy-role',true)",[id,`${issuer}|${flow.subject}`]);
      await c.query('INSERT INTO admin_unit_access(id,admin_user_id,unit_id) VALUES($1,$2,$3)',[randomUUID(),id,f.unit]);
      await c.query("INSERT INTO access_sessions(id,token_hash,admin_user_id,admin_version,scopes,expires_at) VALUES($1,$2,$3,1,'{}',clock_timestamp()+interval '50 minutes')",[randomUUID(),digest(raw),id]);
      // The migration login intentionally cannot SET ROLE to runtime. This
      // rollback-only historical fixture exercises application authorization on
      // the same connection; separate tests enforce runtime database privileges.
      const db=c as unknown as Pool;
      await expect(requireSession(db,raw,'admin')).rejects.toBeInstanceOf(AccessDenied);
      await expect(adminBookings(db,raw)).rejects.toBeInstanceOf(AccessDenied);
      await expect(adminBooking(db,raw,f.booking.bookingId)).rejects.toBeInstanceOf(AccessDenied);
      await expect(adminIncidents(db,raw)).rejects.toBeInstanceOf(AccessDenied);
      const loginPool={query:c.query.bind(c),connect:async()=>({release:()=>{},query:async(sql:string,args?:unknown[])=>{
        if(sql==='BEGIN')return c.query('SAVEPOINT synthetic_login');
        if(sql==='COMMIT')return c.query('RELEASE SAVEPOINT synthetic_login');
        if(sql==='ROLLBACK')return c.query('ROLLBACK TO SAVEPOINT synthetic_login');
        return c.query(sql,args);
      }})} as unknown as Pool;
      await expect(finishAdminLogin(loginPool,flow.callback,flow.started.cookie)).rejects.toBeInstanceOf(AccessDenied);
      expect((await c.query('SELECT count(*)::int n FROM access_sessions WHERE admin_user_id=$1',[id])).rows[0].n).toBe(1);
    }finally{await c.query('ROLLBACK');c.release();vi.unstubAllGlobals();}
    expect((await admin.query("SELECT count(*)::int n FROM admin_users WHERE role NOT IN ('operations','finance','administrator')")).rows[0].n).toBe(0);
  });
});
