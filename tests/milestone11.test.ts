import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planned, seed } from '../scripts/seed-reference.mjs';
import { quoteStay } from '../src/server/quote';
import { splitPayment, quoteDeadlines } from '../src/server/quote-math';
import { acceptBooking } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { reconcileInitialAttempt } from '../src/server/payment-reconciliation';
import { requestBalanceCheckout, dispatchBalanceSessionCreate, reconcileBalanceAttempt, sweepBalanceAttempts } from '../src/server/balance-payment';
import { paymentPosition } from '../src/server/payment-position';
import { ingestStripeWebhook, processWebhookInbox } from '../src/server/stripe-webhooks';
import type { CheckoutRequest, CheckoutSession, PaymentEvidence, StripeGateway } from '../src/server/stripe-adapter';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url=new URL(process.env.MIGRATION_DATABASE_URL??'');
if (!['localhost','127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_dev')) throw new Error('Local dev DB required');
process.env.ALLOW_DEV_REFERENCE_SEED='1';
const admin=new Pool({connectionString:url.toString(),max:8});
const runtime=new Pool({connectionString:process.env.DATABASE_URL,max:8});
const urls={successUrl:'http://localhost:3000/return',cancelUrl:'http://localhost:3000/cancel'};
beforeAll(async()=>{
  const guard=await admin.query(`SELECT 1 FROM pg_trigger WHERE tgrelid='payment_attempts'::regclass
    AND tgname='scheduled_attempt_identity' AND tgenabled='O'`);
  if (!guard.rowCount) throw new Error('Apply the existing 0021 migration before running Milestone 11 tests');
  await seed(url.toString());
});
afterAll(async()=>{await runtime.end();await admin.end();});

class FakeGateway implements StripeGateway {
  readonly accountId='acct_test_fixture';
  sessions=new Map<string,CheckoutSession>(); intents=new Map<string,PaymentEvidence>();
  requests=new Map<string,CheckoutRequest>(); createCalls=0; loseResponse=false;
  async createSession(request:CheckoutRequest) {
    this.createCalls++;
    const id=`cs_test_${randomUUID()}`,c=request.correlation;
    const s:CheckoutSession={id,accountId:this.accountId,url:`https://checkout.stripe.test/${id}`,
      created:request.expiresAt-1800,expiresAt:request.expiresAt,status:'open',paymentStatus:'unpaid',
      paymentIntentId:null,amountTotal:request.amountCents,currency:'eur',livemode:false,mode:'payment',
      paymentMethodTypes:['card'],clientReferenceId:c.bookingId,metadata:{...c}};
    this.sessions.set(id,s);this.requests.set(id,request);
    if (this.loseResponse) throw new Error('response lost');
    return s;
  }
  async retrieveSession(id:string) { const s=this.sessions.get(id);if (!s) throw new Error('missing Session');return s; }
  async findSessionForPaymentIntent(id:string) {return [...this.sessions.values()].find(s=>s.paymentIntentId===id)??null;}
  async retrievePaymentIntent(id:string) {const p=this.intents.get(id);if (!p) throw new Error('missing intent');return p;}
  async expireSession(id:string) {const s=await this.retrieveSession(id);s.status='expired';return s;}
  verifyEvent(raw:Buffer) {const e=JSON.parse(raw.toString()) as {id:string;type:string;objectType:string;objectId:string};
    return {...e,created:Math.floor(Date.now()/1000),livemode:false,accountId:this.accountId};}
  pay(sessionId:string,amountOverride?:number) {
    const s=this.sessions.get(sessionId)!,request=this.requests.get(sessionId)!,id=`pi_test_${randomUUID()}`;
    s.status='complete';s.paymentStatus='paid';s.paymentIntentId=id;
    this.intents.set(id,{id,status:'succeeded',amountReceived:amountOverride??request.amountCents,currency:'eur',
      livemode:false,metadata:{...request.correlation},chargeId:`ch_test_${randomUUID()}`,chargePaid:true,
      chargeCaptured:true,chargeAmount:amountOverride??request.amountCents,chargeCurrency:'eur',
      chargeCreated:Math.floor(Date.now()/1000)});
    return id;
  }
}

async function fixture(full=false,pool:Pool=admin) {
  const unit=randomUUID(),schedule=randomUUID(),guest=randomUUID();
  await admin.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES($1,$2,2,true,1)',[unit,`m11-${unit}`]);
  await admin.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state) VALUES($1,$2,1,'DRAFT')",[schedule,unit]);
  const rates=await admin.query<{start_date:string;end_date:string;day_class:string;nightly_cents:string}>(
    'SELECT start_date::text,end_date::text,day_class,nightly_cents::text FROM seasonal_rates WHERE rate_schedule_version_id=$1',[planned()[0].scheduleId]);
  for (const rate of rates.rows) await admin.query(`INSERT INTO seasonal_rates(id,rate_schedule_version_id,start_date,end_date,day_class,nightly_cents,currency)
    VALUES($1,$2,$3,$4,$5,$6,'EUR')`,[randomUUID(),schedule,rate.start_date,rate.end_date,rate.day_class,rate.nightly_cents]);
  await admin.query("UPDATE rate_schedule_versions SET state='ACTIVE',activated_at=clock_timestamp() WHERE id=$1",[schedule]);
  await admin.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,$2,'en','SYNTHETIC')",[guest,Buffer.from('synthetic')]);
  const before=new Date('2027-06-18T11:59:59Z'),at=new Date('2027-06-18T12:00:00Z');
  const quote=await quoteStay(pool,{unitId:unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},before);
  const accepted=await acceptBooking(pool,{operationKey:randomUUID(),guestId:guest,locale:'en',quote,
    termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,
    acknowledgedInitialCents:full?quote.totalCents:quote.previewSplit.initialCents,syntheticPortfolioOnly:true},
    {testAcceptanceInstant:full?at:before});
  const gateway=new FakeGateway();
  const ready=await dispatchSessionCreate(pool,gateway,accepted.attemptId,'worker-m11-initial',urls);
  if (ready.status!=='READY') throw new Error('Initial Session not ready');
  gateway.pay(ready.sessionId);
  expect(await reconcileInitialAttempt(pool,gateway,accepted.attemptId)).toBe('CONFIRMED');
  return {accepted,gateway,guest,unit};
}

describe('Milestone 11 advance and balance',()=>{
  it('conserves cents and fixes the split at the Vilnius cutoff across DST',()=>{
    for (const total of [1n,2n,5n,10001n,40000n,9_223_372_036_854_775_807n]) {
      const s=splitPayment(total,new Date('2027-03-27T12:59:59Z'),new Date('2027-03-27T13:00:00Z'));
      expect(s.initialCents+s.balanceCents).toBe(total);
      expect(s.initialCents).toBe((total*30n+50n)/100n);
    }
    expect(splitPayment(10001n,new Date('2027-03-27T13:00:00Z'),new Date('2027-03-27T13:00:00Z')))
      .toMatchObject({basis:'FULL',initialCents:10001n,balanceCents:0n});
    expect(quoteDeadlines('2027-04-10')).toMatchObject({balance:new Date('2027-03-27T13:00:00Z'),grace:new Date('2027-03-28T13:00:00Z')});
    expect(quoteDeadlines('2027-11-13')).toMatchObject({balance:new Date('2027-10-30T12:00:00Z'),grace:new Date('2027-10-31T12:00:00Z')});
  });

  it('collects a balance once through the restricted role, preserving one booking claim',async()=>{
    const {accepted,gateway}=await fixture(false,runtime);
    expect([...gateway.requests.values()][0].paymentPurpose).toBe('INITIAL_ADVANCE');
    expect((await paymentPosition(runtime,accepted.bookingId))?.position).toBe('BALANCE_DUE');
    const [a,b]=await Promise.all([requestBalanceCheckout(runtime,accepted.bookingId),requestBalanceCheckout(runtime,accepted.bookingId)]);
    expect(a).toEqual(b);
    const [first,second]=await Promise.all([
      dispatchBalanceSessionCreate(runtime,gateway,a!.attemptId,'worker-m11-a',urls),
      dispatchBalanceSessionCreate(runtime,gateway,a!.attemptId,'worker-m11-b',urls)]);
    expect([first.status,second.status]).toContain('READY');
    expect(gateway.createCalls).toBe(2);
    const ready=first.status==='READY'?first:second as Extract<typeof second,{status:'READY'}>;
    expect(gateway.requests.get(ready.sessionId)?.amountCents).toBe(Number(accepted.balanceCents));
    expect(gateway.requests.get(ready.sessionId)?.paymentPurpose).toBe('BALANCE');
    expect(gateway.requests.get(ready.sessionId)?.correlation.holdId).toBeUndefined();
    gateway.pay(ready.sessionId);
    expect(await reconcileBalanceAttempt(runtime,gateway,a!.attemptId)).toBe('PAID_IN_FULL');
    expect(await reconcileBalanceAttempt(runtime,gateway,a!.attemptId)).toBe('ALREADY_RECORDED');
    expect(await requestBalanceCheckout(runtime,accepted.bookingId)).toBeNull();
    expect((await paymentPosition(runtime,accepted.bookingId))?.position).toBe('PAID_IN_FULL');
    expect((await admin.query("SELECT provider_succeeded_at IS NOT NULL stamped FROM payment_records WHERE obligation_id=(SELECT id FROM payment_obligations WHERE booking_id=$1 AND kind='BALANCE')",[accepted.bookingId])).rows[0].stamped).toBe(true);
    const counts=await admin.query<{payments:string;allocations:string;claims:string}>(`SELECT
      (SELECT count(*)::text FROM payment_records WHERE booking_id=$1) payments,
      (SELECT count(*)::text FROM payment_allocations pa JOIN payment_obligations o ON o.id=pa.obligation_id WHERE o.booking_id=$1) allocations,
      (SELECT count(*)::text FROM inventory_claims WHERE booking_id=$1 AND released_at IS NULL) claims`,[accepted.bookingId]);
    expect(counts.rows[0]).toMatchObject({payments:'2',allocations:'2',claims:'1'});
  });

  it('does not offer a balance Checkout after a full initial payment',async()=>{
    const {accepted,gateway}=await fixture(true,runtime);
    expect([...gateway.requests.values()][0].paymentPurpose).toBe('INITIAL_FULL');
    expect(accepted.balanceCents).toBe(0n);
    expect(await requestBalanceCheckout(runtime,accepted.bookingId)).toBeNull();
    expect((await paymentPosition(runtime,accepted.bookingId))?.position).toBe('PAID_IN_FULL');
    expect((await admin.query("SELECT count(*)::int n FROM notification_outbox WHERE booking_id=$1 AND event_type='PAID_IN_FULL'",[accepted.bookingId])).rows[0].n).toBe(1);
  });

  it('accepts a provider-verified balance during the 24-hour grace interval',async()=>{
    const {accepted,gateway}=await fixture(false,runtime);
    const deadline=quoteDeadlines('2027-07-02');
    const duringGrace=new Date(deadline.balance.getTime()+60_000);
    expect(duringGrace.getTime()).toBeLessThan(deadline.grace.getTime());
    expect((await paymentPosition(runtime,accepted.bookingId,duringGrace))?.position).toBe('OVERDUE');
    const attempt=(await requestBalanceCheckout(runtime,accepted.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m11-grace',urls);
    if (ready.status!=='READY') throw new Error('Balance Session not ready');
    const intent=gateway.pay(ready.sessionId);
    gateway.intents.get(intent)!.chargeCreated=Math.floor(duringGrace.getTime()/1000);
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('PAID_IN_FULL');
    const evidence=await admin.query<{provider_succeeded_at:Date}>(
      "SELECT provider_succeeded_at FROM payment_records WHERE obligation_id=(SELECT id FROM payment_obligations WHERE booking_id=$1 AND kind='BALANCE')",[accepted.bookingId]);
    expect(evidence.rows[0].provider_succeeded_at).toEqual(new Date(Math.floor(duringGrace.getTime()/1000)*1000));
    expect((await paymentPosition(runtime,accepted.bookingId,duringGrace))?.position).toBe('PAID_IN_FULL');
  });

  it('quarantines wrong amount, then accepts verified evidence without duplicate allocation',async()=>{
    const {accepted,gateway}=await fixture(false,runtime);
    const attempt=(await requestBalanceCheckout(runtime,accepted.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m11-balance',urls);
    if (ready.status!=='READY') throw new Error('Balance Session not ready');
    const intent=gateway.pay(ready.sessionId,Number(accepted.balanceCents)+1);
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('RECONCILING');
    expect((await admin.query('SELECT state FROM payment_attempts WHERE id=$1',[attempt.attemptId])).rows[0].state).toBe('RECONCILING');
    expect((await admin.query("SELECT count(*)::int n FROM notification_outbox WHERE booking_id=$1 AND event_type='PAYMENT_EVIDENCE_MISMATCH'",[accepted.bookingId])).rows[0].n).toBe(1);
    expect((await paymentPosition(runtime,accepted.bookingId))?.position).toBe('BALANCE_DUE');
    gateway.intents.get(intent)!.amountReceived=Number(accepted.balanceCents);
    gateway.intents.get(intent)!.chargeAmount=Number(accepted.balanceCents);
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('PAID_IN_FULL');
    const event=Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type:'payment_intent.succeeded',objectType:'payment_intent',objectId:intent}));
    const ingested=await ingestStripeWebhook(runtime,gateway,event,'synthetic-signature');
    await ingestStripeWebhook(runtime,gateway,event,'synthetic-signature');
    expect(await processWebhookInbox(runtime,gateway,1,ingested.eventId)).toBe(1);
    expect((await admin.query('SELECT count(*)::int n FROM payment_records WHERE obligation_id=(SELECT id FROM payment_obligations WHERE booking_id=$1 AND kind=\'BALANCE\')',[accepted.bookingId])).rows[0].n).toBe(1);
  });

  it('keeps an uncertain command and expires terminal unpaid balance without releasing inventory',async()=>{
    const {accepted,gateway}=await fixture(false,runtime);
    const attempt=(await requestBalanceCheckout(runtime,accepted.bookingId))!;
    gateway.loseResponse=true;
    expect(await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m11-lost',urls)).toEqual({status:'PENDING'});
    const calls=gateway.createCalls;
    expect(await sweepBalanceAttempts(runtime,gateway,1,accepted.bookingId)).toEqual([]);
    expect(gateway.createCalls).toBe(calls);
    expect(await requestBalanceCheckout(runtime,accepted.bookingId)).toEqual(attempt);
    gateway.loseResponse=false;
    const session=[...gateway.sessions.values()].at(-1)!;
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId,{sessionLocator:session.id})).toBe('OPEN');
    session.status='expired';
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('EXPIRED');
    expect((await admin.query('SELECT count(*)::int n FROM inventory_claims WHERE booking_id=$1 AND released_at IS NULL',[accepted.bookingId])).rows[0].n).toBe(1);
    const due=quoteDeadlines('2027-07-02').balance;
    expect((await paymentPosition(runtime,accepted.bookingId,due))?.position).toBe('BALANCE_DUE');
    expect((await paymentPosition(runtime,accepted.bookingId,new Date(due.getTime()+1)))?.position).toBe('OVERDUE');
    expect((await paymentPosition(runtime,accepted.bookingId,quoteDeadlines('2027-07-02').grace))?.position).toBe('OVERDUE');
    expect(await requestBalanceCheckout(runtime,accepted.bookingId)).toMatchObject({attemptId:expect.any(String)});
  });

  it('quarantines a late capture after a replacement balance attempt paid',async()=>{
    const {accepted,gateway}=await fixture(false,runtime);
    const first=(await requestBalanceCheckout(runtime,accepted.bookingId))!;
    const firstReady=await dispatchBalanceSessionCreate(runtime,gateway,first.attemptId,'worker-m11-first',urls);
    if (firstReady.status!=='READY') throw new Error('First Session not ready');
    gateway.sessions.get(firstReady.sessionId)!.status='expired';
    expect(await reconcileBalanceAttempt(runtime,gateway,first.attemptId)).toBe('EXPIRED');
    const second=(await requestBalanceCheckout(runtime,accepted.bookingId))!;
    expect(second.attemptId).not.toBe(first.attemptId);
    const secondReady=await dispatchBalanceSessionCreate(runtime,gateway,second.attemptId,'worker-m11-second',urls);
    if (secondReady.status!=='READY') throw new Error('Second Session not ready');
    gateway.pay(secondReady.sessionId);
    expect(await reconcileBalanceAttempt(runtime,gateway,second.attemptId)).toBe('PAID_IN_FULL');
    gateway.pay(firstReady.sessionId);
    expect(await reconcileBalanceAttempt(runtime,gateway,first.attemptId)).toBe('UNALLOCATABLE');
    expect(await reconcileBalanceAttempt(runtime,gateway,first.attemptId)).toBe('ALREADY_RECORDED');
    const result=await admin.query<{allocated:string;unallocatable:string;refunds:string;claims:string}>(`SELECT
      (SELECT count(*)::text FROM payment_records WHERE booking_id=$1 AND obligation_id=(SELECT id FROM payment_obligations WHERE booking_id=$1 AND kind='BALANCE')) allocated,
      (SELECT count(*)::text FROM payment_records p JOIN provider_incidents i ON i.id=p.provider_incident_id WHERE i.stripe_session_id=$2) unallocatable,
      (SELECT count(*)::text FROM refund_obligations r JOIN provider_incidents i ON i.id=r.provider_incident_id WHERE i.stripe_session_id=$2) refunds,
      (SELECT count(*)::text FROM inventory_claims WHERE booking_id=$1 AND released_at IS NULL) claims`,[accepted.bookingId,firstReady.sessionId]);
    expect(result.rows[0]).toMatchObject({allocated:'1',unallocatable:'1',refunds:'1',claims:'1'});
  });

  it('closes a provider-terminal failed balance attempt without touching the booking claim',async()=>{
    const {accepted,gateway}=await fixture(false,runtime);
    const attempt=(await requestBalanceCheckout(runtime,accepted.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m11-failed',urls);
    if (ready.status!=='READY') throw new Error('Balance Session not ready');
    const session=gateway.sessions.get(ready.sessionId)!;
    const intentId=`pi_test_${randomUUID()}`;
    session.status='complete';session.paymentStatus='unpaid';session.paymentIntentId=intentId;
    gateway.intents.set(intentId,{id:intentId,status:'canceled',amountReceived:0,currency:'eur',livemode:false,
      metadata:{...gateway.requests.get(ready.sessionId)!.correlation},chargeId:null,chargePaid:false,
      chargeCaptured:false,chargeAmount:null,chargeCurrency:null});
    expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('FAILED');
    expect((await admin.query('SELECT state FROM payment_attempts WHERE id=$1',[attempt.attemptId])).rows[0].state).toBe('FAILED');
    expect((await admin.query('SELECT count(*)::int n FROM inventory_claims WHERE booking_id=$1 AND released_at IS NULL',[accepted.bookingId])).rows[0].n).toBe(1);
    expect(await requestBalanceCheckout(runtime,accepted.bookingId)).toMatchObject({attemptId:expect.any(String)});
  });

  it('rejects a balance attempt with a second hold under the restricted role',async()=>{
    const {accepted}=await fixture(false,runtime);
    const obligations=await runtime.query<{id:string;amount_cents:string}>(
      "SELECT id,amount_cents::text FROM payment_obligations WHERE booking_id=$1 AND kind='BALANCE'",[accepted.bookingId]);
    expect(await runtime.query<{allowed:boolean}>(
      "SELECT has_table_privilege(current_user,'payment_obligations','UPDATE') allowed")).toMatchObject({rows:[{allowed:false}]});
    await expect(runtime.query(`INSERT INTO payment_attempts(id,booking_id,obligation_id,hold_id,state,expected_cents,currency,version)
      VALUES($1,$2,$3,$4,'CREATING',$5,'EUR',1)`,
      [randomUUID(),accepted.bookingId,obligations.rows[0].id,accepted.holdId,obligations.rows[0].amount_cents]))
      .rejects.toMatchObject({code:'23514'});
  });

  it.each(['OPEN','RECONCILING'] as const)('discovers a paid %s balance through the sweep without webhook delivery',async(state)=>{
    const {accepted,gateway}=await fixture(false,runtime);
    const attempt=(await requestBalanceCheckout(runtime,accepted.bookingId))!;
    const ready=await dispatchBalanceSessionCreate(runtime,gateway,attempt.attemptId,'worker-m11-sweep',urls);
    if (ready.status!=='READY') throw new Error('Balance Session not ready');
    if (state==='RECONCILING') {
      gateway.sessions.get(ready.sessionId)!.status='complete';
      expect(await reconcileBalanceAttempt(runtime,gateway,attempt.attemptId)).toBe('RECONCILING');
    }
    gateway.pay(ready.sessionId);
    const calls=gateway.createCalls;
    const outcomes=await Promise.all([
      sweepBalanceAttempts(runtime,gateway,1,accepted.bookingId),
      sweepBalanceAttempts(runtime,gateway,1,accepted.bookingId),
    ]);
    expect(outcomes.flat()).toContain('PAID_IN_FULL');
    expect(outcomes.every(result=>result.length<=1)).toBe(true);
    expect(gateway.createCalls).toBe(calls);
    expect(await sweepBalanceAttempts(runtime,gateway,1,accepted.bookingId)).toEqual([]);
    expect((await paymentPosition(runtime,accepted.bookingId))?.position).toBe('PAID_IN_FULL');
    expect((await runtime.query('SELECT count(*)::int n FROM stripe_webhook_events WHERE object_id=$1',[ready.sessionId])).rows[0].n).toBe(0);
    expect((await runtime.query('SELECT count(*)::int n FROM payment_records WHERE attempt_id=$1',[attempt.attemptId])).rows[0].n).toBe(1);
    for (const limit of [0,-1,26,1.5])
      await expect(sweepBalanceAttempts(runtime,gateway,limit,accepted.bookingId)).rejects.toThrow('Invalid batch size');
  });

  it('enforces active balance and Session-command uniqueness across restricted-role transactions',async()=>{
    const {accepted}=await fixture(false,runtime);
    const obligation=(await runtime.query<{id:string;amount_cents:string}>(
      "SELECT id,amount_cents::text FROM payment_obligations WHERE booking_id=$1 AND kind='BALANCE'",[accepted.bookingId])).rows[0];
    const protection=await runtime.query(`SELECT current_user role,i.indisunique,i.indisvalid,
      pg_get_expr(i.indpred,i.indrelid) predicate FROM pg_index i
      WHERE i.indexrelid='payment_attempts_one_usable'::regclass`);
    expect(protection.rows[0]).toMatchObject({role:'zemaitija_app',indisunique:true,indisvalid:true});
    for (const state of ['CREATING','OPEN','RECONCILING']) expect(protection.rows[0].predicate).toContain(state);
    const a=await runtime.connect(),b=await runtime.connect();
    const attemptId=randomUUID(),commandId=randomUUID();
    const insert=`INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version)
      VALUES($1,$2,$3,'CREATING',$4,'EUR',1)`;
    const command=`INSERT INTO provider_commands(id,kind,payment_attempt_id,logical_key,stripe_idempotency_key,request_fingerprint,state)
      VALUES($1,'SESSION_CREATE',$2,$3,$4,$5,'PENDING')`;
    let pending:Promise<unknown>|undefined;
    try {
      for (const client of [a,b]) {
        await client.query('BEGIN');
        await client.query("SET LOCAL lock_timeout='5s'");
        await client.query("SET LOCAL statement_timeout='8s'");
      }
      const pid=(await b.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await a.query(insert,[attemptId,accepted.bookingId,obligation.id,obligation.amount_cents]);
      await a.query(command,[commandId,attemptId,`m11-unique:${commandId}`,`m11-unique:${commandId}`,Buffer.alloc(32,1)]);
      // Deliberately bypass requestBalanceCheckout and its booking lock.
      pending=b.query(insert,[randomUUID(),accepted.bookingId,obligation.id,obligation.amount_cents])
        .then(()=>null,(error:unknown)=>error);
      let blocked=false;
      for (let i=0;i<80;i++) {
        const state=await runtime.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1',[pid]);
        if (state.rows[0]?.wait_event_type==='Lock') { blocked=true; break; }
        await new Promise(resolve=>setTimeout(resolve,25));
      }
      expect(blocked).toBe(true);
      await a.query('COMMIT');
      expect(await pending).toMatchObject({code:'23505',constraint:'payment_attempts_one_usable'});
      await b.query('ROLLBACK');
      await expect(runtime.query(command,[randomUUID(),attemptId,`m11-other:${randomUUID()}`,
        `m11-other:${randomUUID()}`,Buffer.alloc(32,2)]))
        .rejects.toMatchObject({code:'23505',constraint:'provider_commands_one_session_create_per_attempt'});
    } finally {
      await a.query('ROLLBACK').catch(()=>{});
      await pending;
      await b.query('ROLLBACK').catch(()=>{});
      a.release();b.release();
    }
  });

  it('rejects a partial scheduled attempt and a partial accepted-balance allocation at commit',async()=>{
    const {accepted}=await fixture(false,runtime);
    const obligation=(await runtime.query<{id:string;amount_cents:string}>(
      "SELECT id,amount_cents::text FROM payment_obligations WHERE booking_id=$1 AND kind='BALANCE'",[accepted.bookingId])).rows[0];
    const partial=(BigInt(obligation.amount_cents)-1n).toString();
    await expect(runtime.query(`INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version)
      VALUES($1,$2,$3,'CREATING',$4,'EUR',1)`,[randomUUID(),accepted.bookingId,obligation.id,partial]))
      .rejects.toMatchObject({code:'23514',message:'accepted attempt does not match scheduled obligation'});
    const attempt=(await requestBalanceCheckout(runtime,accepted.bookingId))!;
    const client=await runtime.connect();
    const paymentId=randomUUID(),reconciliationId=randomUUID(),intentId=`pi_test_${randomUUID()}`;
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE',[accepted.bookingId]);
      await client.query(`INSERT INTO reconciliation_records(id,payment_attempt_id,checked_at,provider_state,evidence_kind,result)
        VALUES($1,$2,clock_timestamp(),'succeeded','SYNTHETIC_TEST','VERIFIED')`,[reconciliationId,attempt.attemptId]);
      await client.query(`INSERT INTO payment_records(id,attempt_id,booking_id,obligation_id,stripe_payment_intent_id,
        captured_cents,currency,verified_at,allocation_state,reconciliation_id)
        VALUES($1,$2,$3,$4,$5,$6,'EUR',clock_timestamp(),'ALLOCATED',$7)`,
        [paymentId,attempt.attemptId,accepted.bookingId,obligation.id,intentId,obligation.amount_cents,reconciliationId]);
      await client.query('INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES($1,$2,$3,$4)',
        [randomUUID(),paymentId,obligation.id,partial]);
      await client.query("UPDATE payment_attempts SET state='RECONCILING',version=version+1 WHERE id=$1",[attempt.attemptId]);
      await client.query("UPDATE payment_attempts SET state='SUCCEEDED',stripe_payment_intent_id=$2,version=version+1 WHERE id=$1",[attempt.attemptId,intentId]);
      await expect(client.query('COMMIT'))
        .rejects.toMatchObject({code:'23514',message:'accepted initial credit and allocation mismatch'});
    } finally { await client.query('ROLLBACK').catch(()=>{});client.release(); }
    expect((await runtime.query('SELECT count(*)::int n FROM payment_allocations WHERE obligation_id=$1',[obligation.id])).rows[0].n).toBe(0);
    expect(await requestBalanceCheckout(runtime,accepted.bookingId)).toEqual(attempt);
  });
});
