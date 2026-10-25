import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool, type PoolClient, type QueryResult } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { planned, seed } from '../scripts/seed-reference.mjs';
import { quoteDeadlines } from '../src/server/quote-math';
import { quoteStay } from '../src/server/quote';
import { acceptBooking } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { reconcileInitialAttempt } from '../src/server/payment-reconciliation';
import { requestBalanceCheckout, dispatchBalanceSessionCreate, reconcileBalanceAttempt } from '../src/server/balance-payment';
import { deliverOneSandboxNotice, MemorySandboxTransport } from '../src/server/sandbox-notification-worker';
import { cancelBooking } from '../src/server/cancellation';
import { approveCancellationAssessment, assessmentAmounts, cancellationSettlement, type MitigationEvidence } from '../src/server/cancellation-assessment';
import { requestRefund, dispatchRefund, reconcileRefund, type RefundGateway, type RefundRequest, type RefundEvidence } from '../src/server/refund-worker';
import { ingestStripeWebhook, processWebhookInbox } from '../src/server/stripe-webhooks';
import { financialNoticeContent, backfillGuestFinancialUpdates } from '../src/server/financial-notifications';
import { paymentPosition } from '../src/server/payment-position';
import { AuthorizationDeniedError, type InternalAuthority } from '../src/server/cancellation-authority';
import type { CheckoutRequest, CheckoutSession, PaymentEvidence, StripeGateway } from '../src/server/stripe-adapter';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url=new URL(process.env.MIGRATION_DATABASE_URL??'');
if (!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_dev')) throw new Error('Local dev DB required');
process.env.ALLOW_DEV_REFERENCE_SEED='1';
const admin=new Pool({connectionString:url.toString(),max:6});
const runtime=new Pool({connectionString:process.env.DATABASE_URL,max:6});
const urls={successUrl:'http://localhost:3000/return',cancelUrl:'http://localhost:3000/cancel'};
beforeAll(async()=>{
  const guard=await admin.query("SELECT has_column_privilege('zemaitija_app','payment_records','refund_encumbered_cents','UPDATE') ok");
  if (!guard.rows[0].ok) throw new Error('Apply 0026 migration before Milestone 13 tests');
  await seed(url.toString());
});
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
  await admin.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES($1,$2,2,true,1)',[unit,`m13-${unit}`]);
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
  const ready=await dispatchSessionCreate(runtime,gateway,booking.attemptId,'worker-m13-initial',urls);
  if(ready.status!=='READY')throw new Error('No initial Session');
  gateway.pay(ready.sessionId,acceptedAt);
  expect(await reconcileInitialAttempt(runtime,gateway,booking.attemptId)).toBe('CONFIRMED');
  if(deliverConfirmation) expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),new Date(Date.now()+1000),booking.bookingId)).toBe('SENT');
  return {booking,gateway,unit,guest};
}

type Fixture=Awaited<ReturnType<typeof fixture>>;
const guestAuthority=(f:Fixture):InternalAuthority=>({kind:'GUEST',guestId:f.guest,bookingId:f.booking.bookingId,scope:'booking:cancel',service:'m13-test',authorizationRef:randomUUID(),expiresAt:new Date(Date.now()+600_000)});
async function finance(role='finance'):Promise<InternalAuthority> {
  const id=randomUUID();await admin.query('INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,$3,true)',[id,`synthetic:${id}`,role]);
  return {kind:'OPERATOR',adminId:id,service:'m13-test',authorizationRef:randomUUID(),expiresAt:new Date(Date.now()+600_000)};
}
const cutoff=quoteDeadlines('2027-07-02').balance;
async function cancel(f:Fixture,late=false) {
  return cancelBooking(runtime,f.gateway,f.booking.bookingId,guestAuthority(f),{kind:'GUEST',reason:'SYNTHETIC_GUEST_REQUEST',testNow:new Date(cutoff.getTime()-(late?0:1))});
}
async function obligations(f:Fixture) {return (await runtime.query<{id:string;amount_cents:string;refund_encumbered_cents:string}>('SELECT id,amount_cents::text,refund_encumbered_cents::text FROM refund_obligations WHERE booking_id=$1 ORDER BY created_at,id',[f.booking.bookingId])).rows;}
function evidence(overrides:Partial<MitigationEvidence>={}):MitigationEvidence {
  return {operationKey:randomUUID(),expectedRevision:0,chargeCents:5000n,documentedLossCents:10000n,avoidedCostsCents:2000n,replacements:[],
    evidenceRef:'synthetic:loss-report',provenance:'Synthetic loss calculation, test fixture',legalConstraints:'Portfolio approved cap; live terms require legal review',rationale:'Actual documented net loss with avoided costs deducted',...overrides};
}
async function fullyPaid(f:Fixture) {
  const a=(await requestBalanceCheckout(runtime,f.booking.bookingId))!;
  const ready=await dispatchBalanceSessionCreate(runtime,f.gateway,a.attemptId,'worker-m13-balance',urls);
  if(ready.status!=='READY')throw new Error('No balance Session');f.gateway.pay(ready.sessionId);
  expect(await reconcileBalanceAttempt(runtime,f.gateway,a.attemptId)).toBe('PAID_IN_FULL');
}
async function refundAll(f:Fixture,actor:InternalAuthority) {
  for(const o of await obligations(f))for(let i=0;i<4;i++) {
    const a=await requestRefund(runtime,o.id,actor);if(!a)break;
    expect(await dispatchRefund(runtime,f.gateway,a)).toBe('SUCCEEDED');
  }
}

// Observe real PostgreSQL calls without adding scheduling hooks to production services.
function observedPool(pool:Pool,observe:(client:PoolClient|null,sql:string,values:unknown[],result:QueryResult)=>Promise<void>|void):Pool {
  function wrap<T extends Pool|PoolClient>(target:T,client:PoolClient|null):T {
    return new Proxy(target,{get(object,key){
      if(key==='connect'&&client===null)return async()=>{const connection=await pool.connect();return wrap(connection,connection);};
      if(key==='query')return async(...args:unknown[])=>{
        const result=await Reflect.apply(object.query,object,args) as QueryResult;
        await observe(client,String(args[0]),Array.isArray(args[1])?args[1]:[],result);
        return result;
      };
      const member=Reflect.get(object,key,object);
      return typeof member==='function'?member.bind(object):member;
    }});
  }
  return wrap(pool,null);
}
function signal() {
  let resolve!:()=>void;
  const promise=new Promise<void>(done=>{resolve=done;});
  return {promise,resolve};
}
async function boundedWait(promise:Promise<unknown>) {
  const timer=AbortSignal.timeout(3000);
  await new Promise<void>((resolve,reject)=>{
    const abort=()=>reject(new Error('Timed out waiting for test barrier'));
    timer.addEventListener('abort',abort,{once:true});
    promise.then(()=>{timer.removeEventListener('abort',abort);resolve();},error=>{timer.removeEventListener('abort',abort);reject(error);});
  });
}
async function domainState(f:Fixture) {
  return (await runtime.query(`SELECT jsonb_build_object(
    'booking',(SELECT to_jsonb(b) FROM bookings b WHERE id=$1),
    'claims',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM inventory_claims c WHERE booking_id=$1),
    'assessment',(SELECT to_jsonb(a) FROM cancellation_assessments a WHERE booking_id=$1),
    'revisions',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM assessment_revisions r JOIN cancellation_assessments a ON a.id=r.assessment_id WHERE a.booking_id=$1),
    'captures',(SELECT jsonb_agg(to_jsonb(p) ORDER BY id) FROM payment_records p WHERE booking_id=$1),
    'obligations',(SELECT jsonb_agg(to_jsonb(o) ORDER BY id) FROM refund_obligations o WHERE booking_id=$1),
    'refund_attempts',(SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM refund_attempts a JOIN refund_obligations o ON o.id=a.obligation_id WHERE o.booking_id=$1),
    'commands',(SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM provider_commands c WHERE c.payment_attempt_id IN (SELECT id FROM payment_attempts WHERE booking_id=$1)
      OR c.refund_attempt_id IN (SELECT a.id FROM refund_attempts a JOIN refund_obligations o ON o.id=a.obligation_id WHERE o.booking_id=$1)),
    'notices',(SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM notification_outbox n WHERE booking_id=$1)) state`,[f.booking.bookingId])).rows[0].state;
}
async function bookOnUnit(unit:Fixture['unit'],gateway:FakeGateway):Promise<Fixture> {
  const guest=randomUUID(),at=new Date('2027-06-05T10:00:00Z');
  await admin.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,$2,'en','SYNTHETIC')",[guest,Buffer.from('synthetic')]);
  const quote=await quoteStay(runtime,{unitId:unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},at);
  const booking=await acceptBooking(runtime,{operationKey:randomUUID(),guestId:guest,locale:'en',quote,termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,
    acknowledgedInitialCents:quote.previewSplit.initialCents,syntheticPortfolioOnly:true},{testAcceptanceInstant:at});
  const ready=await dispatchSessionCreate(runtime,gateway,booking.attemptId,'worker-m13-shared-unit',urls);
  if(ready.status!=='READY')throw new Error('No shared-unit Session');
  gateway.pay(ready.sessionId,at);expect(await reconcileInitialAttempt(runtime,gateway,booking.attemptId)).toBe('CONFIRMED');
  return {booking,gateway,unit,guest};
}

describe('Milestone 13 cancellation, mitigation and durable refunds',()=>{
  it('cancels at D minus 1ms free, preserves captures, releases inventory and queues both recipients',async()=>{
    const f=await fixture();expect(await cancel(f)).toBe('CANCELLED');
    const a=(await runtime.query('SELECT * FROM cancellation_assessments WHERE booking_id=$1',[f.booking.bookingId])).rows[0];
    expect(a).toMatchObject({state:'NOT_REQUIRED',reason:'GUEST_EARLY',cap_cents:'0'});
    expect((await obligations(f))[0].amount_cents).toBe(String(f.booking.initialCents));
    expect((await runtime.query('SELECT released_at FROM inventory_claims WHERE booking_id=$1',[f.booking.bookingId])).rows[0].released_at).toBeTruthy();
    expect((await runtime.query("SELECT count(*)::int n FROM notification_outbox WHERE booking_id=$1 AND event_type='CANCELLED_GUEST'",[f.booking.bookingId])).rows[0].n).toBe(2);
    expect(await cancel(f)).toBe('ALREADY_CANCELLED');
    expect((await runtime.query('SELECT count(*)::int n FROM payment_records WHERE booking_id=$1',[f.booking.bookingId])).rows[0].n).toBe(1);
    const quote=await quoteStay(runtime,{unitId:f.unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},new Date('2027-06-05T10:00:00Z'));
    const accepted=await acceptBooking(runtime,{operationKey:randomUUID(),guestId:f.guest,locale:'en',quote,termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,
      acknowledgedInitialCents:quote.previewSplit.initialCents,syntheticPortfolioOnly:true},{testAcceptanceInstant:new Date('2027-06-05T10:00:00Z')});
    expect(accepted.bookingId).not.toBe(f.booking.bookingId);
  });
  it('cancellation at D is pending with no automatic advance retention or refund calculation',async()=>{
    const f=await fixture();expect(await cancel(f,true)).toBe('ASSESSMENT_PENDING');
    expect((await runtime.query('SELECT state,reason FROM cancellation_assessments WHERE booking_id=$1',[f.booking.bookingId])).rows[0]).toEqual({state:'PENDING',reason:'GUEST_LATE'});
    expect(await obligations(f)).toHaveLength(0);
    expect((await paymentPosition(runtime,f.booking.bookingId))?.position).toBe('ASSESSMENT_PENDING');
  });
  it.each(['2027-04-10','2027-11-13'])('uses local-calendar DST cutoff %s with exact equality',async arrival=>{
    const d=quoteDeadlines(arrival).balance;
    expect(d.toISOString()).toBe(arrival==='2027-04-10'?'2027-03-27T13:00:00.000Z':'2027-10-30T12:00:00.000Z');
    const early=await fixture('en',true,arrival),late=await fixture('en',true,arrival);
    expect(await cancelBooking(runtime,early.gateway,early.booking.bookingId,guestAuthority(early),{kind:'GUEST',reason:'DST_BOUNDARY',testNow:new Date(d.getTime()-1)})).toBe('CANCELLED');
    expect(await cancelBooking(runtime,late.gateway,late.booking.bookingId,guestAuthority(late),{kind:'GUEST',reason:'DST_BOUNDARY',testNow:d})).toBe('ASSESSMENT_PENDING');
  });
  it('reconciles and expires an open balance before cancellation, blocking uncertain processing',async()=>{
    const f=await fixture(),a=(await requestBalanceCheckout(runtime,f.booking.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,f.gateway,a.attemptId,'worker-m13-open',urls);if(ready.status!=='READY')throw new Error();
    const s=f.gateway.sessions.get(ready.sessionId)!;s.paymentIntentId='pi_processing';
    f.gateway.intents.set('pi_processing',{id:'pi_processing',status:'processing',amountReceived:0,currency:'eur',livemode:false,metadata:s.metadata,chargeId:null,chargePaid:false,chargeCaptured:false,chargeAmount:null,chargeCurrency:null});
    expect(await cancel(f)).toBe('UNCERTAIN');
    expect((await runtime.query('SELECT status FROM bookings WHERE id=$1',[f.booking.bookingId])).rows[0].status).toBe('CONFIRMED');
    f.gateway.intents.get('pi_processing')!.status='canceled';
    expect(await cancel(f)).toBe('CANCELLED');
  });
  it('fails closed for an unknown Session create command and leaves inventory owned',async()=>{
    const f=await fixture();await requestBalanceCheckout(runtime,f.booking.bookingId);
    expect(await cancel(f)).toBe('UNCERTAIN');
    expect((await runtime.query('SELECT released_at FROM inventory_claims WHERE booking_id=$1',[f.booking.bookingId])).rows[0].released_at).toBeNull();
  });
  it('requires scoped guest authority and finance role, and records denial',async()=>{
    const f=await fixture(),bad={...guestAuthority(f),bookingId:randomUUID()} as InternalAuthority;
    await expect(cancelBooking(runtime,f.gateway,f.booking.bookingId,bad,{kind:'GUEST',reason:'test'})).rejects.toThrow('denied');
    await cancel(f,true);const o=await finance('operations');
    await expect(approveCancellationAssessment(runtime,f.booking.bookingId,o,evidence())).rejects.toThrow('denied');
    expect((await runtime.query("SELECT count(*)::int n FROM audit_events WHERE action='authorization.denied'")).rows[0].n).toBeGreaterThan(0);
  });
  it('enforces floor 30% ceiling, documented net loss and avoids double counting mitigation',()=>{
    expect(assessmentAmounts(10001n,evidence({chargeCents:3000n})).cap).toBe(3000n);
    expect(()=>assessmentAmounts(10001n,evidence({chargeCents:3001n}))).toThrow('ceiling');
    expect(()=>assessmentAmounts(40000n,evidence({chargeCents:8001n}))).toThrow('net loss');
    expect(assessmentAmounts(40000n,evidence({chargeCents:1000n,replacements:[{bookingId:'x',arrivalDate:'2027-07-02',departureDate:'2027-07-03',recoveredCents:7000n,provenance:'synthetic'}]})).net).toBe(1000n);
  });
  it('finalizes immutable assessments and creates only incremental liabilities before any refund is sent',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f,true);
    const first=evidence(),r=await approveCancellationAssessment(runtime,f.booking.bookingId,actor,first);
    expect(await approveCancellationAssessment(runtime,f.booking.bookingId,actor,first)).toEqual({...r,replayed:true});
    const paid=BigInt(f.booking.initialCents);
    expect((await obligations(f))[0].amount_cents).toBe((paid-5000n).toString());
    await approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({expectedRevision:1,chargeCents:2000n}));
    expect((await obligations(f)).map(o=>o.amount_cents)).toEqual([(paid-5000n).toString(),'3000']);
    await expect(approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({expectedRevision:2,chargeCents:2001n}))).rejects.toThrow('increase');
    await expect(admin.query('UPDATE assessment_revisions SET charge_cents=0 WHERE id=$1',[r.revisionId])).rejects.toMatchObject({code:'23514'});
    await expect(approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({expectedRevision:0,chargeCents:0n}))).rejects.toThrow('Stale');
  });
  it('serializes concurrent assessment approvals and prevents duplicate liabilities',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f,true);
    const result=await Promise.allSettled([approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence()),approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence())]);
    expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(await obligations(f)).toHaveLength(1);
  });
  it('validates replacement identity, dates, captured recovery and provenance',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f,true);
    await expect(approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({replacements:[{bookingId:randomUUID(),arrivalDate:'2027-07-02',departureDate:'2027-07-03',recoveredCents:100n,provenance:'synthetic'}]}))).rejects.toThrow('captured revenue');
    await expect(approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({replacements:[{bookingId:randomUUID(),arrivalDate:'2027-07-01',departureDate:'2027-07-03',recoveredCents:100n,provenance:'synthetic'}]}))).rejects.toThrow('dates');
  });
  it('provider cancellation refunds 100% across advance and balance captures without compensation',async()=>{
    const f=await fixture(),actor=await finance();await fullyPaid(f);
    expect(await cancelBooking(runtime,f.gateway,f.booking.bookingId,actor,{kind:'PROVIDER',reason:'SYNTHETIC_PROVIDER_CLOSURE'})).toBe('CANCELLED');
    const owed=(await obligations(f)).reduce((s,o)=>s+BigInt(o.amount_cents),0n);
    const total=(await runtime.query('SELECT total_cents FROM price_snapshots WHERE booking_id=$1',[f.booking.bookingId])).rows[0].total_cents;
    expect(owed).toBe(BigInt(total));await refundAll(f,actor);
    expect((await runtime.query('SELECT count(*)::int n FROM refund_records WHERE booking_id=$1',[f.booking.bookingId])).rows[0].n).toBe(2);
    expect((await paymentPosition(runtime,f.booking.bookingId))?.position).toBe('REFUNDED_FULL');
  });
  it('allocates a single assessment obligation sequentially across multiple original captures',async()=>{
    const f=await fixture(),actor=await finance();await fullyPaid(f);await cancel(f,true);
    await approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({chargeCents:0n}));
    await refundAll(f,actor);
    expect((await runtime.query('SELECT count(*)::int n FROM refund_records WHERE booking_id=$1',[f.booking.bookingId])).rows[0].n).toBe(2);
  });
  it('deduplicates concurrent requests and provider dispatch with one reserved operation',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const o=(await obligations(f))[0];
    const ids=await Promise.all([requestRefund(runtime,o.id,actor),requestRefund(runtime,o.id,actor)]);expect(ids[0]).toBe(ids[1]);
    const results=await Promise.all([dispatchRefund(runtime,f.gateway,ids[0]!),dispatchRefund(runtime,f.gateway,ids[1]!)]);
    expect(results).toContain('SUCCEEDED');expect(f.gateway.creates).toBe(1);
    expect((await runtime.query('SELECT count(*)::int n FROM refund_records WHERE booking_id=$1',[f.booking.bookingId])).rows[0].n).toBe(1);
  });
  it('records failed provider refund, releases reservation and retains obligation before a linked replacement',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const o=(await obligations(f))[0],a=(await requestRefund(runtime,o.id,actor))!;
    f.gateway.outcome='failed';expect(await dispatchRefund(runtime,f.gateway,a)).toBe('FAILED');
    expect((await obligations(f))[0].refund_encumbered_cents).toBe('0');
    expect((await runtime.query('SELECT count(*)::int n FROM refund_records WHERE booking_id=$1',[f.booking.bookingId])).rows[0].n).toBe(0);
    await reconcileRefund(runtime,f.gateway,a);f.gateway.outcome='succeeded';const replacement=(await requestRefund(runtime,o.id,actor))!;
    expect(replacement).not.toBe(a);expect(await dispatchRefund(runtime,f.gateway,replacement)).toBe('SUCCEEDED');
  });
  it('keeps pending/requires_action processing without ledger debit, defers assessment revision',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f,true);await approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence());
    const o=(await obligations(f))[0],a=(await requestRefund(runtime,o.id,actor))!;f.gateway.outcome='pending';
    expect(await dispatchRefund(runtime,f.gateway,a)).toBe('PROCESSING');expect(await requestRefund(runtime,o.id,actor)).toBe(a);
    await expect(approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({expectedRevision:1,chargeCents:0n}))).rejects.toThrow('in-flight');
    const r=[...f.gateway.refunds.values()][0];r.status='requires_action';expect(await reconcileRefund(runtime,f.gateway,a)).toBe('PROCESSING');
    r.status='succeeded';expect(await reconcileRefund(runtime,f.gateway,a)).toBe('SUCCEEDED');
    await approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({expectedRevision:1,chargeCents:2000n}));
    expect((await obligations(f))[1].amount_cents).toBe('3000');
  });
  it('retains liability after unknown response and quarantines at exactly 24 hours without another POST',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const o=(await obligations(f))[0],a=(await requestRefund(runtime,o.id,actor))!;
    f.gateway.timeout=true;expect(await dispatchRefund(runtime,f.gateway,a)).toBe('PROCESSING');
    const command=(await runtime.query<{first_submitted_at:Date}>('SELECT first_submitted_at FROM provider_commands WHERE refund_attempt_id=$1',[a])).rows[0];
    expect(await dispatchRefund(runtime,f.gateway,a,{testNow:new Date(command.first_submitted_at.getTime()+86_400_000)})).toBe('QUARANTINED');expect(f.gateway.creates).toBe(1);
    expect((await obligations(f))[0].refund_encumbered_cents).toBe(o.amount_cents);
    expect((await runtime.query('SELECT state FROM refund_attempts WHERE id=$1',[a])).rows[0].state).toBe('PROCESSING');
  });
  it('recovers an unknown POST by original capture history without resubmission',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const a=(await requestRefund(runtime,(await obligations(f))[0].id,actor))!;
    const create=f.gateway.createRefund.bind(f.gateway);f.gateway.createRefund=async q=>{await create(q);throw new Error('response lost');};
    expect(await dispatchRefund(runtime,f.gateway,a)).toBe('PROCESSING');expect(await dispatchRefund(runtime,f.gateway,a)).toBe('SUCCEEDED');expect(f.gateway.creates).toBe(1);
  });
  it('retrieves current refund evidence for duplicate, delayed and out-of-order signed webhooks',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const a=(await requestRefund(runtime,(await obligations(f))[0].id,actor))!;f.gateway.outcome='pending';
    await dispatchRefund(runtime,f.gateway,a);const r=[...f.gateway.refunds.values()][0];r.status='succeeded';
    const raw=Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type:'refund.updated',objectType:'refund',objectId:r.id}));
    const event=await ingestStripeWebhook(runtime,f.gateway,raw,'synthetic');expect((await ingestStripeWebhook(runtime,f.gateway,raw,'synthetic')).duplicate).toBe(true);
    expect(await processWebhookInbox(runtime,f.gateway,1,event.eventId)).toBe(1);
    const stale=await ingestStripeWebhook(runtime,f.gateway,Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type:'refund.failed',objectType:'refund',objectId:r.id})),'synthetic');
    expect(await processWebhookInbox(runtime,f.gateway,1,stale.eventId)).toBe(1);
    expect((await runtime.query('SELECT count(*)::int n FROM refund_records WHERE booking_id=$1',[f.booking.bookingId])).rows[0].n).toBe(1);
    expect((await runtime.query("SELECT count(*)::int n FROM notification_outbox WHERE booking_id=$1 AND event_type='REFUND_SUCCEEDED'",[f.booking.bookingId])).rows[0].n).toBe(1);
  });
  it('quarantines mismatched refund evidence and never records money refunded',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const a=(await requestRefund(runtime,(await obligations(f))[0].id,actor))!;f.gateway.outcome='pending';await dispatchRefund(runtime,f.gateway,a);
    const r=[...f.gateway.refunds.values()][0];r.amount++;r.status='succeeded';
    expect(await reconcileRefund(runtime,f.gateway,a)).toBe('QUARANTINED');
    expect((await runtime.query('SELECT count(*)::int n FROM refund_records WHERE booking_id=$1',[f.booking.bookingId])).rows[0].n).toBe(0);
  });
  it('database rejects budget drift, capture edits, liability edits and terminal regressions under runtime role',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const o=(await obligations(f))[0];
    await expect(runtime.query('UPDATE refund_obligations SET amount_cents=1 WHERE id=$1',[o.id])).rejects.toMatchObject({code:'42501'});
    await expect(runtime.query('UPDATE payment_records SET captured_cents=1 WHERE booking_id=$1',[f.booking.bookingId])).rejects.toMatchObject({code:'42501'});
    await expect(runtime.query('UPDATE refund_obligations SET refund_encumbered_cents=1 WHERE id=$1',[o.id])).rejects.toMatchObject({code:'23514'});
    const a=(await requestRefund(runtime,o.id,actor))!;await dispatchRefund(runtime,f.gateway,a);
    await expect(runtime.query("UPDATE refund_attempts SET state='PROCESSING' WHERE id=$1",[a])).rejects.toMatchObject({code:'23514'});
    await expect(runtime.query('DELETE FROM refund_records WHERE refund_attempt_id=$1',[a])).rejects.toMatchObject({code:'42501'});
  });
  it('delivers cancellation, assessment, refund and guest-update notices in LT/EN/DE without premature success',async()=>{
    for(const locale of ['lt','en','de'] as const) {
      for(const event of ['CANCELLED_GUEST','CANCELLED_GUEST_LATE','CANCELLED_PROVIDER','ASSESSMENT_FINALIZED','REFUND_SUCCEEDED','GUEST_PAYMENT_UPDATE','REFUND_INTERVENTION'])expect(financialNoticeContent(event,locale,'1234','40000')).toBeTruthy();
    }
    const f=await fixture('de'),actor=await finance();await cancel(f);await refundAll(f,actor);const transport=new MemorySandboxTransport();
    for(let i=0;i<3;i++)expect(await deliverOneSandboxNotice(runtime,transport,new Date(Date.now()+1000),f.booking.bookingId)).toBe('SENT');
    expect([...transport.messages.values()].some(m=>m.message.locale==='de'&&m.message.body.includes('bestätigt'))).toBe(true);
  });
  it('backfills verified historical guest incident updates idempotently and records unknown association investigation',async()=>{
    const f=await fixture();const audit=randomUUID(),incident=randomUUID();
    await admin.query("INSERT INTO provider_incidents(id,kind,state,opened_at) VALUES($1,'SYNTHETIC_UNKNOWN','OPEN',clock_timestamp())",[incident]);
    await admin.query("INSERT INTO audit_events(id,actor_kind,service_name,action,entity_type,entity_id,occurred_at) VALUES($1,'SERVICE','m13-test','synthetic.incident','incident',$2,clock_timestamp())",[audit,incident]);
    const notice=randomUUID();await runtime.query(`INSERT INTO notification_outbox(id,provider_incident_id,source_audit_event_id,event_type,recipient_kind,locale,idempotency_key,due_at,state)
      VALUES($1,$2,$3,'UNALLOCATABLE_CAPTURE','OPERATIONS','en',$4,clock_timestamp(),'QUEUED')`,[notice,incident,audit,`synthetic:${notice}`]);
    expect((await runtime.query("SELECT count(*)::int n FROM audit_events WHERE operation_key=$1",[`guest-money-investigation:${notice}`])).rows[0].n).toBe(1);
    await backfillGuestFinancialUpdates(runtime,100,notice);await backfillGuestFinancialUpdates(runtime,100,notice);
    expect((await runtime.query("SELECT count(*)::int n FROM audit_events WHERE operation_key=$1",[`guest-money-investigation:${notice}`])).rows[0].n).toBe(1);
    expect(f.booking.bookingId).toBeTruthy();
  });
  it('uses a verified same-unit replacement as evidence, preserving actual avoided costs',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f,true);
    const at=new Date('2027-06-05T10:00:00Z');
    const quote=await quoteStay(runtime,{unitId:f.unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},at);
    const replacement=await acceptBooking(runtime,{operationKey:randomUUID(),guestId:f.guest,locale:'en',quote,termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,
      acknowledgedInitialCents:quote.previewSplit.initialCents,syntheticPortfolioOnly:true},{testAcceptanceInstant:at});
    const ready=await dispatchSessionCreate(runtime,f.gateway,replacement.attemptId,'worker-m13-replacement',urls);
    if(ready.status!=='READY')throw new Error();f.gateway.pay(ready.sessionId);await reconcileInitialAttempt(runtime,f.gateway,replacement.attemptId);
    const mitigation={bookingId:replacement.bookingId,arrivalDate:'2027-07-02',departureDate:'2027-07-05',recoveredCents:7000n,provenance:'synthetic:replacement-capture-allocation'};
    await approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({chargeCents:1000n,replacements:[mitigation]}));
    const r=(await runtime.query(`SELECT supportable_loss_cents,recovered_revenue_cents,evidence FROM assessment_revisions
      WHERE assessment_id=(SELECT id FROM cancellation_assessments WHERE booking_id=$1)`,[f.booking.bookingId])).rows[0];
    expect(r.supportable_loss_cents).toBe('1000');expect(r.recovered_revenue_cents).toBe('7000');
    expect(r.evidence.replacements[0].bookingId).toBe(replacement.bookingId);
    await expect(approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({expectedRevision:1,chargeCents:0n,replacements:[mitigation,mitigation]}))).rejects.toThrow('nonduplicated');
  });
  it('quarantines an unresolved operation whose first-submission age is unknown',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const a=(await requestRefund(runtime,(await obligations(f))[0].id,actor))!;
    await runtime.query("UPDATE provider_commands SET state='UNKNOWN' WHERE refund_attempt_id=$1",[a]);
    expect(await dispatchRefund(runtime,f.gateway,a)).toBe('QUARANTINED');expect(f.gateway.creates).toBe(0);
  });
  it('quarantines untracked original-capture refunds and provider-read failure before submission',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const a=(await requestRefund(runtime,(await obligations(f))[0].id,actor))!;
    const q=(await runtime.query<{request_params:RefundRequest}>('SELECT request_params FROM provider_commands WHERE refund_attempt_id=$1',[a])).rows[0].request_params;
    f.gateway.refunds.set('re_external',{id:'re_external',accountId:f.gateway.accountId,livemode:false,paymentIntentId:q.paymentIntentId,chargeId:q.chargeId,amount:1,currency:'eur',status:'succeeded',metadata:{}});
    expect(await dispatchRefund(runtime,f.gateway,a)).toBe('QUARANTINED');expect(f.gateway.creates).toBe(0);
    const other=await fixture();await cancel(other);const b=(await requestRefund(runtime,(await obligations(other))[0].id,actor))!;
    other.gateway.listRefunds=async()=>{throw new Error('provider unavailable');};
    expect(await dispatchRefund(runtime,other.gateway,b)).toBe('QUARANTINED');expect(other.gateway.creates).toBe(0);
  });
  it('quarantines ambiguous unknown-create refund history instead of submitting again',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const a=(await requestRefund(runtime,(await obligations(f))[0].id,actor))!;
    const q=(await runtime.query<{request_params:RefundRequest}>('SELECT request_params FROM provider_commands WHERE refund_attempt_id=$1',[a])).rows[0].request_params;
    const first=await f.gateway.createRefund(q);f.gateway.refunds.set('re_ambiguous',{...first,id:'re_ambiguous'});
    expect(await dispatchRefund(runtime,f.gateway,a)).toBe('QUARANTINED');expect(f.gateway.creates).toBe(1);
  });
  it('processes charge.refunded through current refund objects and refuses unmatched refund identities',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const a=(await requestRefund(runtime,(await obligations(f))[0].id,actor))!;
    f.gateway.outcome='pending';await dispatchRefund(runtime,f.gateway,a);const r=[...f.gateway.refunds.values()][0];r.status='succeeded';
    const e=await ingestStripeWebhook(runtime,f.gateway,Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type:'charge.refunded',objectType:'charge',objectId:r.chargeId})),'synthetic');
    expect(await processWebhookInbox(runtime,f.gateway,1,e.eventId)).toBe(1);
    f.gateway.refunds.set('re_unmatched',{...r,id:'re_unmatched',metadata:{}});
    const unmatched=await ingestStripeWebhook(runtime,f.gateway,Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type:'refund.created',objectType:'refund',objectId:'re_unmatched'})),'synthetic');
    expect(await processWebhookInbox(runtime,f.gateway,1,unmatched.eventId)).toBe(0);
    expect((await runtime.query('SELECT processing_state FROM stripe_webhook_events WHERE id=$1',[unmatched.eventId])).rows[0].processing_state).toBe('RETRY');
    expect((await runtime.query('SELECT count(*)::int n FROM refund_records WHERE booking_id=$1',[f.booking.bookingId])).rows[0].n).toBe(1);
  });
  it('database rejects extra liability and a fabricated refund ledger debit',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f);const o=(await obligations(f))[0];
    await expect(runtime.query(`INSERT INTO refund_obligations(id,booking_id,reason,amount_cents,business_key,currency)
      VALUES($1,$2,'SYNTHETIC_EXCESS',1,$3,'EUR')`,[randomUUID(),f.booking.bookingId,randomUUID()])).rejects.toMatchObject({code:'23514'});
    const a=(await requestRefund(runtime,o.id,actor))!;
    const row=(await runtime.query('SELECT payment_record_id FROM refund_attempts WHERE id=$1',[a])).rows[0];
    const rec=(await runtime.query('SELECT reconciliation_id FROM payment_records WHERE id=$1',[row.payment_record_id])).rows[0].reconciliation_id;
    await expect(runtime.query(`INSERT INTO refund_records(id,refund_attempt_id,payment_record_id,booking_id,stripe_refund_id,refunded_cents,currency,verified_at,reconciliation_id)
      VALUES($1,$2,$3,$4,$5,$6,'EUR',clock_timestamp(),$7)`,[randomUUID(),a,row.payment_record_id,f.booking.bookingId,`re_${randomUUID()}`,o.amount_cents,rec])).rejects.toMatchObject({code:'23514'});
  });
  it('creates no post-cancellation collection when the final charge consumes the advance',async()=>{
    const f=await fixture(),actor=await finance();await cancel(f,true);
    // A 30% advance can differ from the 30% cap by rounding; this fixture has the same amount.
    const total=BigInt((await runtime.query('SELECT total_cents FROM price_snapshots WHERE booking_id=$1',[f.booking.bookingId])).rows[0].total_cents);
    const charge=total*30n/100n;
    await approveCancellationAssessment(runtime,f.booking.bookingId,actor,evidence({chargeCents:charge,documentedLossCents:total,avoidedCostsCents:0n}));
    expect(await obligations(f)).toHaveLength(0);
    expect((await runtime.query("SELECT count(*)::int n FROM provider_commands pc JOIN payment_attempts pa ON pa.id=pc.payment_attempt_id WHERE pa.booking_id=$1 AND pc.kind='SESSION_CREATE'",[f.booking.bookingId])).rows[0].n).toBe(1);
    expect((await paymentPosition(runtime,f.booking.bookingId))?.outstandingCents).toBe(0n);
  });

  it('separates refund entitlement from an additional charge review item using integer cents',()=>{
    expect(cancellationSettlement(12000n,8000n)).toEqual({refundDue:4000n,additionalChargeReview:0n});
    expect(cancellationSettlement(1000n,2000n)).toEqual({refundDue:0n,additionalChargeReview:1000n});
  });

  it.each(['cancellation','assessment','refund'] as const)('persists one denial after rollback when authority is revoked before %s revalidation',async operation=>{
    const f=await fixture(),actor=await finance();
    if(actor.kind!=='OPERATOR')throw new Error('Expected finance operator');
    if(operation!=='cancellation')await cancel(f,operation==='assessment');
    const obligation=operation==='refund'?(await obligations(f))[0].id:null;
    const before=await domainState(f),trace:string[]=[];
    let revoked=false;
    const observed=observedPool(runtime,async(client,sql,values)=>{
      trace.push(sql);
      if(!client&&!revoked&&sql.startsWith('SELECT role FROM admin_users')&&values[0]===actor.adminId) {
        // The initial query has returned an allowed role; commit revocation before revalidation.
        await admin.query('UPDATE admin_users SET enabled=false,disabled_at=clock_timestamp() WHERE id=$1',[actor.adminId]);
        revoked=true;
      }
    });
    let denial:unknown;
    try {
      if(operation==='cancellation')await cancelBooking(observed,f.gateway,f.booking.bookingId,actor,{kind:'PROVIDER',reason:'SYNTHETIC_REVOKED_AUTHORITY'});
      else if(operation==='assessment')await approveCancellationAssessment(observed,f.booking.bookingId,actor,evidence());
      else await requestRefund(observed,obligation!,actor);
    }catch(error){denial=error;}
    expect(revoked).toBe(true);expect(denial).toBeInstanceOf(AuthorizationDeniedError);
    const error=denial as AuthorizationDeniedError;
    const audit=(await runtime.query('SELECT id,action,reason_code,occurred_at FROM audit_events WHERE id=$1',[error.auditId])).rows;
    expect(audit).toEqual([{id:error.auditId,action:'authorization.denied',reason_code:'INVALID_SCOPE_OR_AUTHORITY',occurred_at:error.occurredAt}]);
    const rollback=trace.lastIndexOf('ROLLBACK'),transactionStart=trace.lastIndexOf('BEGIN');
    expect(rollback).toBeGreaterThan(transactionStart);
    expect(trace.slice(rollback+1).filter(sql=>sql.startsWith('INSERT INTO audit_events'))).toHaveLength(1);
    expect(trace.slice(transactionStart)).not.toContain('COMMIT');expect(await domainState(f)).toEqual(before);
  });
  it('serializes different cancelled bookings on the installed unit lock before reading shared replacement attribution',async()=>{
    const definition=(await runtime.query<{definition:string}>("SELECT pg_get_functiondef('public.lock_acceptance_context(uuid,uuid)'::regprocedure) definition")).rows[0].definition;
    expect(definition).toMatch(/FROM accommodation_units WHERE id=p_unit FOR UPDATE/);
    const first=await fixture();await cancel(first,true);
    const second=await bookOnUnit(first.unit,first.gateway);await cancel(second,true);
    const replacement=await bookOnUnit(first.unit,first.gateway);
    expect(new Set([first.guest,second.guest,replacement.guest]).size).toBe(3);
    const paid=BigInt(replacement.booking.initialCents),each=paid/2n+1n;
    expect(each*2n).toBeGreaterThan(paid);
    const total=BigInt((await runtime.query('SELECT total_cents FROM price_snapshots WHERE booking_id=$1',[first.booking.bookingId])).rows[0].total_cents);
    const proposal=()=>evidence({chargeCents:0n,documentedLossCents:total,avoidedCostsCents:0n,replacements:[{
      bookingId:replacement.booking.bookingId,arrivalDate:'2027-07-02',departureDate:'2027-07-05',recoveredCents:each,provenance:'synthetic:shared-capture'}]});
    const read=signal(),release=signal(),secondStarted=signal();
    let firstPid=0,secondPid=0,secondRead=false;
    const firstPool=observedPool(runtime,async(client,sql,resultValues,result)=>{
      if(client&&sql==='BEGIN') {
        const connection=(await client.query("SELECT pg_backend_pid() pid,current_setting('transaction_isolation') isolation")).rows[0];
        firstPid=connection.pid;expect(connection.isolation).toBe('read committed');
      }
      if(client&&sql.includes("jsonb_array_elements(ar.evidence->'replacements')")) {
        expect(result.rows[0].used).toBe('0');read.resolve();await release.promise;
      }
    });
    const secondPool=observedPool(runtime,async(client,sql)=>{
      if(client&&sql==='BEGIN'){secondPid=(await client.query('SELECT pg_backend_pid() pid')).rows[0].pid;secondStarted.resolve();}
      if(client&&sql.includes("jsonb_array_elements(ar.evidence->'replacements')"))secondRead=true;
    });
    const actorA=await finance(),actorB=await finance();
    // Attach settlement handlers immediately so assertion failures still release and drain both workers.
    const attemptA=approveCancellationAssessment(firstPool,first.booking.bookingId,actorA,proposal()).then(value=>({value}),error=>({error}));
    let attemptB:Promise<{value:unknown}|{error:unknown}>|undefined;
    try {
      await boundedWait(read.promise);
      attemptB=approveCancellationAssessment(secondPool,second.booking.bookingId,actorB,proposal()).then(value=>({value}),error=>({error}));
      await boundedWait(secondStarted.promise);
      const deadline=Date.now()+3000;let blocked=false;
      while(Date.now()<deadline) {
        blocked=(await admin.query<{blocked:boolean}>('SELECT $2::int=ANY(pg_blocking_pids($1::int)) blocked',[secondPid,firstPid])).rows[0].blocked;
        if(blocked)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      expect(blocked).toBe(true);expect(secondRead).toBe(false);
      release.resolve();
      expect(await attemptA).toHaveProperty('value');
      const outcome=await attemptB;expect(outcome).toHaveProperty('error');
      if('error' in outcome)expect(outcome.error).toMatchObject({message:'Replacement revenue already attributed'});
      expect(secondRead).toBe(true);
      const attributed=(await runtime.query<{used:string;n:number}>(`SELECT COALESCE(sum((item->>'recoveredCents')::numeric),0)::text used,count(*)::int n
        FROM cancellation_assessments ca JOIN assessment_revisions ar ON ar.assessment_id=ca.id AND ar.revision_no=ca.current_revision_no,
        jsonb_array_elements(ar.evidence->'replacements') item WHERE item->>'bookingId'=$1`,[replacement.booking.bookingId])).rows[0];
      expect(attributed).toEqual({used:each.toString(),n:1});expect(BigInt(attributed.used)).toBeLessThanOrEqual(paid);
      expect((await runtime.query('SELECT state,current_revision_no FROM cancellation_assessments WHERE booking_id=$1',[second.booking.bookingId])).rows[0]).toEqual({state:'PENDING',current_revision_no:null});
      expect(await obligations(second)).toHaveLength(0);
    }finally {release.resolve();await attemptA;if(attemptB)await attemptB;}
  });

});
