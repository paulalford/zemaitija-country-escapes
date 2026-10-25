import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { planned, seed } from '../scripts/seed-reference.mjs';
import { quoteDeadlines } from '../src/server/quote-math';
import { quoteStay } from '../src/server/quote';
import { acceptBooking } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { reconcileInitialAttempt } from '../src/server/payment-reconciliation';
import { requestBalanceCheckout, dispatchBalanceSessionCreate, reconcileBalanceAttempt } from '../src/server/balance-payment';
import { scheduleBalanceNotices, noticeContent, noticeEligibility } from '../src/server/nonpayment-notices';
import { cancelUnpaidBooking } from '../src/server/nonpayment-cancellation';
import { deliverOneSandboxNotice, recoverExpiredSandboxDelivery, MemorySandboxTransport, type SandboxTransport } from '../src/server/sandbox-notification-worker';
import type { CheckoutRequest, CheckoutSession, PaymentEvidence, StripeGateway } from '../src/server/stripe-adapter';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url=new URL(process.env.MIGRATION_DATABASE_URL??'');
if (!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_dev')) throw new Error('Local dev DB required');
process.env.ALLOW_DEV_REFERENCE_SEED='1';
const admin=new Pool({connectionString:url.toString(),max:6});
const runtime=new Pool({connectionString:process.env.DATABASE_URL,max:6});
const urls={successUrl:'http://localhost:3000/return',cancelUrl:'http://localhost:3000/cancel'};
beforeAll(async()=>{
  const guard=await admin.query("SELECT has_table_privilege('zemaitija_app','notification_delivery_attempts','INSERT') ok");
  if (!guard.rows[0].ok) throw new Error('Apply 0022 migration before Milestone 12 tests');
  await seed(url.toString());
});
afterAll(async()=>{await runtime.end();await admin.end();});

class FakeGateway implements StripeGateway {
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

async function fixture(locale:'lt'|'en'|'de'='en',deliverConfirmation=true) {
  const unit=randomUUID(),schedule=randomUUID(),guest=randomUUID();
  await admin.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES($1,$2,2,true,1)',[unit,`m12-${unit}`]);
  await admin.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state) VALUES($1,$2,1,'DRAFT')",[schedule,unit]);
  const rates=await admin.query<{start_date:string;end_date:string;day_class:string;nightly_cents:string}>(
    'SELECT start_date::text,end_date::text,day_class,nightly_cents::text FROM seasonal_rates WHERE rate_schedule_version_id=$1',[planned()[0].scheduleId]);
  for(const r of rates.rows) await admin.query(`INSERT INTO seasonal_rates(id,rate_schedule_version_id,start_date,end_date,day_class,nightly_cents,currency)
    VALUES($1,$2,$3,$4,$5,$6,'EUR')`,[randomUUID(),schedule,r.start_date,r.end_date,r.day_class,r.nightly_cents]);
  await admin.query("UPDATE rate_schedule_versions SET state='ACTIVE',activated_at=clock_timestamp() WHERE id=$1",[schedule]);
  await admin.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,$2,$3,'SYNTHETIC')",[guest,Buffer.from('synthetic'),locale]);
  const acceptedAt=new Date('2027-06-05T10:00:00Z');
  const quote=await quoteStay(runtime,{unitId:unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},acceptedAt);
  const booking=await acceptBooking(runtime,{operationKey:randomUUID(),guestId:guest,locale,quote,
    termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:quote.previewSplit.initialCents,
    syntheticPortfolioOnly:true},{testAcceptanceInstant:acceptedAt});
  const gateway=new FakeGateway();
  const ready=await dispatchSessionCreate(runtime,gateway,booking.attemptId,'worker-m12-initial',urls);
  if(ready.status!=='READY')throw new Error('No initial Session');
  gateway.pay(ready.sessionId,acceptedAt);
  expect(await reconcileInitialAttempt(runtime,gateway,booking.attemptId)).toBe('CONFIRMED');
  if(deliverConfirmation) expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),new Date(Date.now()+1000),booking.bookingId)).toBe('SENT');
  return {booking,gateway,unit,guest};
}

async function operationalNoticeFixture(event:'UNALLOCATABLE_CAPTURE'|'PAYMENT_EVIDENCE_MISMATCH') {
  const f=await fixture(),d=quoteDeadlines('2027-07-02');
  const attempt=(await requestBalanceCheckout(runtime,f.booking.bookingId))!;
  const ready=await dispatchBalanceSessionCreate(runtime,f.gateway,attempt.attemptId,'worker-m12-operations',urls);
  if(ready.status!=='READY')throw new Error('No balance Session');
  expect(await cancelUnpaidBooking(runtime,f.gateway,f.booking.bookingId,{now:d.grace,approveProposedZeroChargePolicy:true})).toBe('CANCELLED');
  // Dispatch the two cancellation notices before creating the operational event.
  const cancellations=new MemorySandboxTransport();
  for(let i=0;i<2;i++) expect(await deliverOneSandboxNotice(runtime,cancellations,d.grace,f.booking.bookingId)).toBe('SENT');
  const intent=f.gateway.pay(ready.sessionId,new Date(d.grace.getTime()+1000));
  if(event==='PAYMENT_EVIDENCE_MISMATCH') f.gateway.intents.get(intent)!.amountReceived++;
  expect(await reconcileBalanceAttempt(runtime,f.gateway,attempt.attemptId)).toBe(event==='UNALLOCATABLE_CAPTURE'?'UNALLOCATABLE':'RECONCILING');
  const notice=(await runtime.query<{id:string;booking_id:string|null;provider_incident_id:string|null;idempotency_key:string}>(`SELECT n.id,n.booking_id,n.provider_incident_id,n.idempotency_key
    FROM notification_outbox n JOIN audit_events a ON a.id=n.source_audit_event_id
    WHERE a.booking_id=$1 AND n.event_type=$2`,[f.booking.bookingId,event])).rows[0];
  expect(notice).toBeDefined();
  return {...f,notice,now:new Date(d.grace.getTime()+1000)};
}

async function domainSnapshot(bookingId:string,incidentId:string|null) {
  return (await admin.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM bookings x WHERE x.id=$1) bookings,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM payment_attempts x WHERE x.booking_id=$1) attempts,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM payment_records x WHERE x.booking_id=$1 OR x.provider_incident_id=$2) payments,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM payment_allocations x WHERE x.obligation_id IN (SELECT id FROM payment_obligations WHERE booking_id=$1)) allocations,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM refund_obligations x WHERE x.booking_id=$1 OR x.provider_incident_id=$2) refund_obligations,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM refund_attempts x WHERE x.obligation_id IN (SELECT id FROM refund_obligations WHERE booking_id=$1 OR provider_incident_id=$2)) refund_attempts,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM refund_records x WHERE x.booking_id=$1 OR x.provider_incident_id=$2) refund_records,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM inventory_claims x WHERE x.booking_id=$1) claims,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM inventory_holds x WHERE x.booking_id=$1) holds,
    (SELECT jsonb_agg(to_jsonb(x) ORDER BY x.id) FROM provider_incidents x WHERE x.id=$2) incidents`,[bookingId,incidentId])).rows[0];
}

describe('Milestone 12 schedules and governed cancellation',()=>{
  it('uses local calendar days for W and D, then 24 elapsed hours for G across both DST changes',()=>{
    const spring=quoteDeadlines('2027-04-10'),autumn=quoteDeadlines('2027-11-13');
    expect(spring.warning).toEqual(new Date('2027-03-20T13:00:00Z'));
    expect(spring.balance).toEqual(new Date('2027-03-27T13:00:00Z'));
    expect(spring.grace).toEqual(new Date('2027-03-28T13:00:00Z'));
    expect(autumn.warning).toEqual(new Date('2027-10-23T12:00:00Z'));
    expect(autumn.balance).toEqual(new Date('2027-10-30T12:00:00Z'));
    expect(autumn.grace).toEqual(new Date('2027-10-31T12:00:00Z'));
  });
  it('respects exact warning, due and overdue boundaries and equivalent deadline text',()=>{
    const d=quoteDeadlines('2027-04-10');
    const b={id:'1',guest_id:'2',unit_id:'3',locale:'en' as const,warning_at:d.warning,balance_due_at:d.balance,grace_ends_at:d.grace,accepted_at:new Date('2027-03-19T00:00:00Z')};
    expect(noticeEligibility(b,new Date(d.warning.getTime()-1),1n)).toEqual([]);
    expect(noticeEligibility(b,d.warning,1n)).toEqual(['BALANCE_WARNING']);
    expect(noticeEligibility(b,new Date(d.balance.getTime()-1),1n)).toEqual(['BALANCE_WARNING']);
    expect(noticeEligibility(b,d.balance,1n)).toEqual(['BALANCE_DUE']);
    expect(noticeEligibility(b,new Date(d.balance.getTime()+1),1n)).toEqual(['BALANCE_DUE','BALANCE_OVERDUE']);
    expect(noticeEligibility(b,d.balance,0n)).toEqual([]);
    for(const locale of ['lt','en','de'] as const) expect(noticeContent('BALANCE_WARNING',locale,d.balance,d.grace,d.warning)).toContain('Europe/Vilnius');
  });
  it('queues short notice, due and overdue once; suppresses an obsolete queued warning',async()=>{
    const {booking}=await fixture(),d=quoteDeadlines('2027-07-02');
    const warningRun=new Date(d.warning.getTime()+2*86400000);
    const first=await Promise.all([scheduleBalanceNotices(runtime,{now:warningRun,bookingId:booking.bookingId}),scheduleBalanceNotices(runtime,{now:warningRun,bookingId:booking.bookingId})]);
    expect(first.flatMap(r=>r.flatMap(x=>x.queued))).toEqual(['BALANCE_WARNING']);
    expect((await scheduleBalanceNotices(runtime,{now:new Date(d.balance.getTime()+60000),bookingId:booking.bookingId}))[0].queued).toEqual(['BALANCE_DUE','BALANCE_OVERDUE']);
    expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),new Date(d.balance.getTime()+60000),booking.bookingId)).toBe('SUPPRESSED');
    const rows=await admin.query<{event_type:string;state:string}>(`SELECT event_type,state FROM notification_outbox
      WHERE booking_id=$1 AND event_type LIKE 'BALANCE_%' ORDER BY event_type`,[booking.bookingId]);
    expect(rows.rows).toHaveLength(3);
    expect(rows.rows.find(r=>r.event_type==='BALANCE_WARNING')?.state).toBe('SUPPRESSED');
  });
  it('does not cancel without policy approval; reconciles paid balance before release',async()=>{
    const {booking,gateway}=await fixture(),d=quoteDeadlines('2027-07-02');
    expect(await cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:d.grace})).toBe('POLICY_GATE');
    const attempt=(await requestBalanceCheckout(runtime,booking.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m12-balance',urls);
    if(ready.status!=='READY')throw new Error('No balance Session');
    gateway.pay(ready.sessionId,new Date(d.grace.getTime()-1000));
    expect(await cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:d.grace,approveProposedZeroChargePolicy:true})).toBe('PAID');
    expect((await admin.query('SELECT released_at FROM inventory_claims WHERE booking_id=$1',[booking.bookingId])).rows[0].released_at).toBeNull();
  });
  it('suppresses a queued warning after verified full payment',async()=>{
    const {booking,gateway}=await fixture(),d=quoteDeadlines('2027-07-02');
    await scheduleBalanceNotices(runtime,{now:d.warning,bookingId:booking.bookingId});
    const attempt=(await requestBalanceCheckout(runtime,booking.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m12-paid-warning',urls);
    if(ready.status!=='READY')throw new Error('No balance Session');
    gateway.pay(ready.sessionId,new Date(d.warning.getTime()+1000));
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('PAID_IN_FULL');
    expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),new Date(Date.now()+1000),booking.bookingId)).toBe('SENT');
    expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),new Date(d.warning.getTime()+2000),booking.bookingId)).toBe('SUPPRESSED');
    expect(await scheduleBalanceNotices(runtime,{now:d.balance,bookingId:booking.bookingId})).toEqual([]);
  });
  it('cancels only after terminal unpaid reconciliation, releases one claim and records the captured advance liability',async()=>{
    const {booking,gateway,unit,guest}=await fixture(),d=quoteDeadlines('2027-07-02');
    const attempt=(await requestBalanceCheckout(runtime,booking.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m12-unpaid',urls);
    if(ready.status!=='READY')throw new Error('No balance Session');
    expect(await cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:new Date(d.grace.getTime()-1),approveProposedZeroChargePolicy:true})).toBe('NOT_ELIGIBLE');
    expect(await cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:d.grace,approveProposedZeroChargePolicy:true})).toBe('CANCELLED');
    expect(await cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:d.grace,approveProposedZeroChargePolicy:true})).toBe('ALREADY_CANCELLED');
    const facts=await admin.query<{status:string;released_at:Date;reason:string;amount_cents:string}>(`SELECT b.status,c.released_at,
      ro.reason,ro.amount_cents::text FROM bookings b JOIN inventory_claims c ON c.booking_id=b.id
      JOIN refund_obligations ro ON ro.booking_id=b.id WHERE b.id=$1`,[booking.bookingId]);
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0]).toMatchObject({status:'CANCELLED_NONPAYMENT',reason:'NONPAYMENT_ZERO_CHARGE',amount_cents:booking.initialCents.toString()});
    expect(facts.rows[0].released_at).toEqual(d.grace);
    const replacementQuote=await quoteStay(runtime,{unitId:unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},new Date('2027-06-05T10:00:00Z'));
    const replacement=await acceptBooking(runtime,{operationKey:randomUUID(),guestId:guest,locale:'en',quote:replacementQuote,
      termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:replacementQuote.previewSplit.initialCents,
      syntheticPortfolioOnly:true},{testAcceptanceInstant:new Date('2027-06-05T10:00:00Z')});
    expect(replacement.bookingId).not.toBe(booking.bookingId);
    expect((await admin.query("SELECT count(*)::int n FROM inventory_claims WHERE unit_id=$1 AND released_at IS NULL",[unit])).rows[0].n).toBe(1);
  });
  it('records sandbox delivery and never retries an unknown send blindly',async()=>{
    const {booking}=await fixture(),d=quoteDeadlines('2027-07-02');
    await scheduleBalanceNotices(runtime,{now:d.warning,bookingId:booking.bookingId});
    const transport=new MemorySandboxTransport();
    expect(await deliverOneSandboxNotice(runtime,transport,d.warning,booking.bookingId)).toBe('SENT');
    const notice=await admin.query<{state:string;provider_message_id:string}>(`SELECT state,provider_message_id FROM notification_outbox
      WHERE booking_id=$1 AND event_type='BALANCE_WARNING'`,[booking.bookingId]);
    expect(notice.rows[0].state).toBe('SENT');
    expect(notice.rows[0].provider_message_id).toMatch(/^sandbox:/);
    await scheduleBalanceNotices(runtime,{now:d.balance,bookingId:booking.bookingId});
    const unknown:SandboxTransport={sandbox:true,lookup:async()=>undefined,send:async()=>{throw new Error('must not send');}};
    expect(await deliverOneSandboxNotice(runtime,unknown,d.balance,booking.bookingId)).toBe('UNKNOWN');
  });
  it('backs off transient failure and alerts on permanent failure without changing the booking',async()=>{
    const {booking}=await fixture(),d=quoteDeadlines('2027-07-02');
    await scheduleBalanceNotices(runtime,{now:d.warning,bookingId:booking.bookingId});
    const transient:SandboxTransport={sandbox:true,lookup:async()=>null,send:async()=>{throw new Error('TemporaryDeliveryError');}};
    expect(await deliverOneSandboxNotice(runtime,transient,d.warning,booking.bookingId)).toBe('RETRY_WAIT');
    const retry=await admin.query<{state:string;due_at:Date}>("SELECT state,due_at FROM notification_outbox WHERE booking_id=$1 AND event_type='BALANCE_WARNING'",[booking.bookingId]);
    expect(retry.rows[0].due_at>d.warning).toBe(true);
    const permanent:SandboxTransport={sandbox:true,lookup:async()=>null,send:async()=>{const e=new Error('invalid synthetic mailbox');e.name='PermanentDeliveryError';throw e;}};
    expect(await deliverOneSandboxNotice(runtime,permanent,retry.rows[0].due_at,booking.bookingId)).toBe('FAILED');
    const facts=await admin.query<{status:string;state:string}>(`SELECT b.status,n.state FROM bookings b JOIN notification_outbox n ON n.booking_id=b.id
      WHERE b.id=$1 AND n.event_type='BALANCE_WARNING'`,[booking.bookingId]);
    expect(facts.rows[0]).toMatchObject({status:'CONFIRMED',state:'FAILED'});
    expect((await admin.query("SELECT count(*)::int n FROM notification_outbox WHERE booking_id=$1 AND event_type='DELIVERY_FAILURE'",[booking.bookingId])).rows[0].n).toBe(1);
  });
  it('blocks uncertain provider outcomes and serializes concurrent cancellation',async()=>{
    const {booking,gateway}=await fixture(),d=quoteDeadlines('2027-07-02');
    const attempt=(await requestBalanceCheckout(runtime,booking.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m12-uncertain',urls);
    if(ready.status!=='READY')throw new Error('No balance Session');
    gateway.sessions.get(ready.sessionId)!.status='complete';
    gateway.sessions.get(ready.sessionId)!.paymentStatus='unpaid';
    expect(await cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:d.grace,approveProposedZeroChargePolicy:true})).toBe('UNCERTAIN');
    gateway.sessions.get(ready.sessionId)!.status='open';
    const outcomes=await Promise.all([cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:d.grace,approveProposedZeroChargePolicy:true}),
      cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:d.grace,approveProposedZeroChargePolicy:true})]);
    expect(outcomes.sort()).toEqual(['ALREADY_CANCELLED','CANCELLED']);
    expect((await admin.query("SELECT count(*)::int n FROM inventory_claims WHERE booking_id=$1 AND released_at IS NOT NULL",[booking.bookingId])).rows[0].n).toBe(1);
  });
  it('keeps runtime privileges narrow for jobs',async()=>{
    const r=await admin.query<{notices:boolean;attempts:boolean;assessment:boolean;refund_execution:boolean}>(`SELECT
      has_table_privilege('zemaitija_app','notification_outbox','UPDATE') notices,
      has_table_privilege('zemaitija_app','notification_delivery_attempts','INSERT') attempts,
      has_table_privilege('zemaitija_app','cancellation_assessments','INSERT') assessment,
      has_table_privilege('zemaitija_app','refund_records','INSERT') refund_execution`);
    expect(r.rows[0]).toEqual({notices:true,attempts:true,assessment:true,refund_execution:true});
  });
  it('records a capture discovered after committed cancellation once through the restricted role',async()=>{
    const {booking,gateway,unit,guest}=await fixture(),d=quoteDeadlines('2027-07-02');
    const attempt=(await requestBalanceCheckout(runtime,booking.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m12-late-capture',urls);
    if(ready.status!=='READY')throw new Error('No balance Session');
    expect(await cancelUnpaidBooking(runtime,gateway,booking.bookingId,{now:d.grace,approveProposedZeroChargePolicy:true})).toBe('CANCELLED');
    const quote=await quoteStay(runtime,{unitId:unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},new Date('2027-06-05T10:00:00Z'));
    const replacement=await acceptBooking(runtime,{operationKey:randomUUID(),guestId:guest,locale:'en',quote,
      termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:quote.previewSplit.initialCents,
      syntheticPortfolioOnly:true},{testAcceptanceInstant:new Date('2027-06-05T10:00:00Z')});
    const replacementClaim=(await runtime.query('SELECT id,hold_id,version,released_at FROM inventory_claims WHERE hold_id=$1',[replacement.holdId])).rows[0];
    const successAt=new Date(d.grace.getTime()+1000);
    const intent=gateway.pay(ready.sessionId,successAt);
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('UNALLOCATABLE');
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('ALREADY_RECORDED');
    const facts=await runtime.query(`SELECT b.status,c.released_at,a.state,a.stripe_payment_intent_id,
      p.allocation_state,p.captured_cents::text,p.provider_succeeded_at,r.provider_success_at,r.result,
      ro.amount_cents::text refund_cents,i.kind,
      (SELECT count(*)::int FROM payment_allocations pa WHERE pa.obligation_id=a.obligation_id) allocations,
      (SELECT count(*)::int FROM payment_records pr WHERE pr.stripe_payment_intent_id=$2) payments,
      (SELECT count(*)::int FROM provider_incidents pi WHERE pi.stripe_payment_intent_id=$2) incidents,
      (SELECT count(*)::int FROM refund_obligations rf WHERE rf.source_payment_record_id=p.id) refunds
      FROM bookings b JOIN inventory_claims c ON c.booking_id=b.id JOIN payment_attempts a ON a.booking_id=b.id
      JOIN payment_records p ON p.stripe_payment_intent_id=a.stripe_payment_intent_id
      JOIN provider_incidents i ON i.id=p.provider_incident_id JOIN refund_obligations ro ON ro.source_payment_record_id=p.id
      JOIN reconciliation_records r ON r.id=p.reconciliation_id WHERE a.id=$1`,[attempt.attemptId,intent]);
    expect(facts.rows).toHaveLength(1);
    expect(facts.rows[0]).toMatchObject({status:'CANCELLED_NONPAYMENT',released_at:d.grace,state:'SUCCEEDED',
      stripe_payment_intent_id:intent,allocation_state:'UNALLOCATABLE',captured_cents:booking.balanceCents.toString(),
      provider_succeeded_at:successAt,provider_success_at:successAt,result:'UNALLOCATABLE',
      refund_cents:booking.balanceCents.toString(),kind:'LATE_BALANCE_CAPTURE',allocations:0,payments:1,incidents:1,refunds:1});
    expect((await runtime.query('SELECT id,hold_id,version,released_at FROM inventory_claims WHERE hold_id=$1',[replacement.holdId])).rows[0]).toEqual(replacementClaim);
  });
  it('still rejects cancellation at commit when a balance attempt lacks terminal-unpaid evidence',async()=>{
    const {booking,gateway}=await fixture(),d=quoteDeadlines('2027-07-02');
    const attempt=(await requestBalanceCheckout(runtime,booking.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m12-terminal-guard',urls);
    if(ready.status!=='READY')throw new Error('No balance Session');
    const client=await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE inventory_claims SET released_at=$2,release_reason='NONPAYMENT_RECONCILED',version=version+1 WHERE booking_id=$1",[booking.bookingId,d.grace]);
      await client.query("UPDATE bookings SET status='CANCELLED_NONPAYMENT',cancelled_at=$2,cancellation_reason='BALANCE_UNPAID_RECONCILED',version=version+1 WHERE id=$1",[booking.bookingId,d.grace]);
      await client.query("INSERT INTO cancellation_assessments(id,booking_id,state,cancelled_at,reason,cap_cents) VALUES($1,$2,'NOT_REQUIRED',$3,'NONPAYMENT',0)",[randomUUID(),booking.bookingId,d.grace]);
      await client.query(`INSERT INTO refund_obligations(id,booking_id,source_payment_record_id,reason,amount_cents,business_key,currency)
        SELECT $1,booking_id,id,'NONPAYMENT_ZERO_CHARGE',captured_cents,$3,'EUR' FROM payment_records WHERE booking_id=$2`,
        [randomUUID(),booking.bookingId,`guard-test:${booking.bookingId}`]);
      await expect(client.query('COMMIT')).rejects.toMatchObject({code:'23514',message:'nonpayment cancellation lacks terminal payment proof or full refund liability'});
    } finally {await client.query('ROLLBACK');client.release();}
    expect((await runtime.query('SELECT status FROM bookings WHERE id=$1',[booking.bookingId])).rows[0].status).toBe('CONFIRMED');
    expect((await runtime.query('SELECT released_at FROM inventory_claims WHERE booking_id=$1',[booking.bookingId])).rows[0].released_at).toBeNull();
  });
  it.each(['lt','en','de'] as const)('delivers confirmed and paid-in-full events in the accepted %s locale',async(locale)=>{
    const {booking,gateway}=await fixture(locale,false);
    const transport=new MemorySandboxTransport();
    const confirmed=(await runtime.query<{idempotency_key:string}>("SELECT idempotency_key FROM notification_outbox WHERE booking_id=$1 AND event_type='BOOKING_CONFIRMED'",[booking.bookingId])).rows[0];
    expect(await deliverOneSandboxNotice(runtime,transport,new Date(Date.now()+1000),booking.bookingId)).toBe('SENT');
    const confirmation=transport.messages.get(confirmed.idempotency_key)!.message;
    expect(confirmation.locale).toBe(locale);
    expect(confirmation.recipientKind).toBe('GUEST');
    expect(confirmation.body).toContain('Europe/Vilnius');
    expect(confirmation.body).toContain({lt:'patvirtintas',en:'confirmed',de:'bestätigt'}[locale]);
    const attempt=(await requestBalanceCheckout(runtime,booking.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m12-notification-coverage',urls);
    if(ready.status!=='READY')throw new Error('No balance Session');
    gateway.pay(ready.sessionId);
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('PAID_IN_FULL');
    const paid=(await runtime.query<{idempotency_key:string}>("SELECT idempotency_key FROM notification_outbox WHERE booking_id=$1 AND event_type='PAID_IN_FULL'",[booking.bookingId])).rows[0];
    const before=(await runtime.query("SELECT status,version FROM bookings WHERE id=$1",[booking.bookingId])).rows[0];
    expect(await deliverOneSandboxNotice(runtime,transport,new Date(Date.now()+1000),booking.bookingId)).toBe('SENT');
    const receipt=transport.messages.get(paid.idempotency_key)!.message;
    expect(receipt.locale).toBe(locale);
    expect(receipt.body).toContain({lt:'visiškai apmokėtas',en:'paid in full',de:'vollständig bezahlt'}[locale]);
    expect(receipt.body).toContain('EUR');
    expect(await deliverOneSandboxNotice(runtime,transport,new Date(Date.now()+1000),booking.bookingId)).toBeNull();
    expect(transport.messages.size).toBe(2);
    expect((await runtime.query("SELECT status,version FROM bookings WHERE id=$1",[booking.bookingId])).rows[0]).toEqual(before);
    expect((await runtime.query("SELECT count(*)::int n FROM payment_records WHERE booking_id=$1",[booking.bookingId])).rows[0].n).toBe(2);
  });
  it.each(['accepted','absent','unknown'] as const)('fences delayed delivery completion after lease recovery reports %s',async(providerState)=>{
    const {booking}=await fixture(),d=quoteDeadlines('2027-07-02');
    await scheduleBalanceNotices(runtime,{now:d.warning,bookingId:booking.bookingId});
    const notice=(await runtime.query<{id:string}>("SELECT id FROM notification_outbox WHERE booking_id=$1 AND event_type='BALANCE_WARNING'",[booking.bookingId])).rows[0];
    let startSend!:()=>void,releaseSend!:()=>void,sends=0,expired=false;
    const started=new Promise<void>(resolve=>{startSend=resolve;});
    const release=new Promise<void>(resolve=>{releaseSend=resolve;});
    const messageId=`sandbox:delayed:${randomUUID()}`;
    const transport:SandboxTransport={sandbox:true,
      lookup:async()=>!expired?null:providerState==='accepted'?{messageId}:providerState==='absent'?null:undefined,
      send:async()=>{sends++;startSend();await release;return {messageId};}};
    const workerA=deliverOneSandboxNotice(runtime,transport,d.warning,booking.bookingId);
    await started;
    try {
      expired=true;
      const recoveryAt=new Date(d.warning.getTime()+60_001);
      expect(await recoverExpiredSandboxDelivery(runtime,transport,recoveryAt,booking.bookingId)).toBe(providerState==='accepted'?'SENT':'UNKNOWN');
      const authoritative=(await runtime.query('SELECT state,provider_message_id,lease_until FROM notification_outbox WHERE id=$1',[notice.id])).rows[0];
      expect(authoritative).toMatchObject({state:providerState==='accepted'?'SENT':'FAILED',lease_until:null});
      // Drain only the operational alert; the guest notice must never be retried.
      if(providerState!=='accepted') expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),recoveryAt,booking.bookingId)).toBe('SENT');
      expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),recoveryAt,booking.bookingId)).toBeNull();
      releaseSend();
      expect(await workerA).toBe('STALE');
      expect((await runtime.query('SELECT state,provider_message_id,lease_until FROM notification_outbox WHERE id=$1',[notice.id])).rows[0]).toEqual(authoritative);
      const attempts=await runtime.query('SELECT result,provider_message_id FROM notification_delivery_attempts WHERE notification_id=$1',[notice.id]);
      expect(attempts.rows).toEqual([{result:providerState==='accepted'?'ACCEPTED':'UNKNOWN',provider_message_id:providerState==='accepted'?messageId:null}]);
      expect(sends).toBe(1);
      expect((await runtime.query("SELECT details FROM audit_events WHERE entity_id=$1 AND action='notification.stale_completion'",[notice.id])).rows)
        .toEqual([{details:{attemptId:expect.any(String),providerMessageId:messageId,outcome:'ACCEPTED'}}]);
    } finally {releaseSend();await workerA;}
  });
  it.each(['UNALLOCATABLE_CAPTURE','PAYMENT_EVIDENCE_MISMATCH'] as const)('dispatches %s once to operations without reminder suppression or domain changes',async(event)=>{
    const {booking,guest,notice,now}=await operationalNoticeFixture(event);
    if(event==='UNALLOCATABLE_CAPTURE') {
      expect(notice.booking_id).toBeNull();
      expect(notice.provider_incident_id).not.toBeNull();
    }
    const before=await domainSnapshot(booking.bookingId,notice.provider_incident_id);
    const transport=new MemorySandboxTransport();
    const send=()=>deliverOneSandboxNotice(runtime,transport,now,notice.booking_id??undefined,notice.provider_incident_id??undefined);
    expect((await Promise.all([send(),send()])).sort()).toEqual((notice.booking_id?['SENT','SENT']:['SENT',null]).sort());
    expect(await send()).toBeNull();
    expect(transport.messages.size).toBe(notice.booking_id?2:1);
    const message=transport.messages.get(notice.idempotency_key)!.message;
    expect(message).toMatchObject({key:notice.idempotency_key,recipientKind:'OPERATIONS',recipientRef:null,locale:'en'});
    expect(message.body).toContain(event==='UNALLOCATABLE_CAPTURE'?'full refund obligation':'authoritative provider evidence');
    expect(message.body).not.toContain(guest);
    expect(message.body).not.toMatch(/sk_test_|whsec_|pi_test_|cs_test_|@/);
    expect((await runtime.query('SELECT state,suppression_reason FROM notification_outbox WHERE id=$1',[notice.id])).rows[0]).toEqual({state:'SENT',suppression_reason:null});
    expect((await runtime.query('SELECT result FROM notification_delivery_attempts WHERE notification_id=$1',[notice.id])).rows).toEqual([{result:'ACCEPTED'}]);
    expect(await domainSnapshot(booking.bookingId,notice.provider_incident_id)).toEqual(before);
  });
  it('tracks incident notice retries and sends a failure alert with the same incident association',async()=>{
    const {booking,notice,now}=await operationalNoticeFixture('UNALLOCATABLE_CAPTURE');
    const before=await domainSnapshot(booking.bookingId,notice.provider_incident_id);
    const transient:SandboxTransport={sandbox:true,lookup:async()=>null,send:async()=>{throw new Error('temporary sandbox failure');}};
    expect(await deliverOneSandboxNotice(runtime,transient,now,undefined,notice.provider_incident_id!)).toBe('RETRY_WAIT');
    const retry=(await runtime.query<{due_at:Date}>('SELECT due_at FROM notification_outbox WHERE id=$1',[notice.id])).rows[0];
    expect(retry.due_at>now).toBe(true);
    const permanent:SandboxTransport={sandbox:true,lookup:async()=>null,send:async()=>{const error=new Error('invalid sandbox sink');error.name='PermanentDeliveryError';throw error;}};
    expect(await deliverOneSandboxNotice(runtime,permanent,retry.due_at,undefined,notice.provider_incident_id!)).toBe('FAILED');
    const alert=(await runtime.query("SELECT booking_id,provider_incident_id FROM notification_outbox WHERE idempotency_key=$1",[`delivery-failure:${notice.id}`])).rows[0];
    expect(alert).toEqual({booking_id:null,provider_incident_id:notice.provider_incident_id});
    const transport=new MemorySandboxTransport();
    expect(await deliverOneSandboxNotice(runtime,transport,retry.due_at,undefined,notice.provider_incident_id!)).toBe('SENT');
    expect(await deliverOneSandboxNotice(runtime,transport,retry.due_at,undefined,notice.provider_incident_id!)).toBeNull();
    expect((await runtime.query('SELECT result FROM notification_delivery_attempts WHERE notification_id=$1 ORDER BY attempt_no',[notice.id])).rows).toEqual([{result:'TRANSIENT'},{result:'PERMANENT'}]);
    expect(await domainSnapshot(booking.bookingId,notice.provider_incident_id)).toEqual(before);
  });
  it.each(['accepted','absent','unknown'] as const)('keeps incident-only expired-lease recovery safe when provider lookup is %s',async(providerState)=>{
    const {booking,notice,now}=await operationalNoticeFixture('UNALLOCATABLE_CAPTURE');
    const before=await domainSnapshot(booking.bookingId,notice.provider_incident_id);
    let startSend!:()=>void,releaseSend!:()=>void,expired=false,sends=0;
    const started=new Promise<void>(resolve=>{startSend=resolve;});
    const release=new Promise<void>(resolve=>{releaseSend=resolve;});
    const messageId=`sandbox:incident:${randomUUID()}`;
    const transport:SandboxTransport={sandbox:true,
      lookup:async()=>!expired?null:providerState==='accepted'?{messageId}:providerState==='absent'?null:undefined,
      send:async()=>{sends++;startSend();await release;return {messageId};}};
    const workerA=deliverOneSandboxNotice(runtime,transport,now,undefined,notice.provider_incident_id!);
    await started;
    try {
      expired=true;
      const recoveryAt=new Date(now.getTime()+60_001);
      expect(await recoverExpiredSandboxDelivery(runtime,transport,recoveryAt,undefined,notice.provider_incident_id!)).toBe(providerState==='accepted'?'SENT':'UNKNOWN');
      const authoritative=(await runtime.query('SELECT state,provider_message_id,lease_until FROM notification_outbox WHERE id=$1',[notice.id])).rows[0];
      if(providerState!=='accepted') {
        const alert=(await runtime.query("SELECT booking_id,provider_incident_id FROM notification_outbox WHERE idempotency_key=$1",[`delivery-failure:${notice.id}`])).rows[0];
        expect(alert).toEqual({booking_id:null,provider_incident_id:notice.provider_incident_id});
        expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),recoveryAt,undefined,notice.provider_incident_id!)).toBe('SENT');
      }
      releaseSend();
      expect(await workerA).toBe('STALE');
      expect((await runtime.query('SELECT state,provider_message_id,lease_until FROM notification_outbox WHERE id=$1',[notice.id])).rows[0]).toEqual(authoritative);
      expect(await deliverOneSandboxNotice(runtime,new MemorySandboxTransport(),recoveryAt,undefined,notice.provider_incident_id!)).toBeNull();
      expect((await runtime.query('SELECT result FROM notification_delivery_attempts WHERE notification_id=$1',[notice.id])).rows).toEqual([{result:providerState==='accepted'?'ACCEPTED':'UNKNOWN'}]);
      expect(sends).toBe(1);
      expect(await domainSnapshot(booking.bookingId,notice.provider_incident_id)).toEqual(before);
    } finally {releaseSend();await workerA;}
  });
});
