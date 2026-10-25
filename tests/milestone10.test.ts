import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import Stripe from 'stripe';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planned, seed } from '../scripts/seed-reference.mjs';
import { quoteStay } from '../src/server/quote';
import { acceptBooking } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { withInitialLock } from '../src/server/payment-locks';
import { reconcileInitialAttempt } from '../src/server/payment-reconciliation';
import { ingestStripeWebhook, processWebhookInbox, WebhookInputError } from '../src/server/stripe-webhooks';
import { StripeSdkGateway, type CheckoutRequest, type CheckoutSession, type PaymentEvidence, type StripeGateway } from '../src/server/stripe-adapter';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url=new URL(process.env.MIGRATION_DATABASE_URL??'');
if (!['localhost','127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_dev')) throw new Error('Local dev DB required');
process.env.ALLOW_DEV_REFERENCE_SEED='1';
const pool=new Pool({connectionString:url.toString(),max:12});
const beforeD=new Date('2027-06-18T11:59:59Z');
const atD=new Date('2027-06-18T12:00:00Z');
const urls={successUrl:'http://localhost:3000/return',cancelUrl:'http://localhost:3000/cancel'};
beforeAll(async()=>seed(url.toString()));
afterAll(async()=>pool.end());

async function fixture(full=false) {
  const unit=randomUUID(),schedule=randomUUID(),guest=randomUUID();
  await pool.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES($1,$2,2,true,1)',[unit,`m10-${unit}`]);
  await pool.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state) VALUES($1,$2,1,'DRAFT')",[schedule,unit]);
  const rates=await pool.query<{start_date:string;end_date:string;day_class:string;nightly_cents:string}>(
    'SELECT start_date::text,end_date::text,day_class,nightly_cents::text FROM seasonal_rates WHERE rate_schedule_version_id=$1',[planned()[0].scheduleId]);
  for (const rate of rates.rows) await pool.query(`INSERT INTO seasonal_rates(id,rate_schedule_version_id,start_date,end_date,day_class,nightly_cents,currency)
    VALUES($1,$2,$3,$4,$5,$6,'EUR')`,[randomUUID(),schedule,rate.start_date,rate.end_date,rate.day_class,rate.nightly_cents]);
  await pool.query("UPDATE rate_schedule_versions SET state='ACTIVE',activated_at=clock_timestamp() WHERE id=$1",[schedule]);
  await pool.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,$2,'en','SYNTHETIC')",[guest,Buffer.from('synthetic')]);
  const quote=await quoteStay(pool,{unitId:unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},beforeD);
  const accepted=await acceptBooking(pool,{operationKey:randomUUID(),guestId:guest,locale:'en',quote,
    termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,
    acknowledgedInitialCents:full?quote.totalCents:quote.previewSplit.initialCents,syntheticPortfolioOnly:true},
    {testAcceptanceInstant:full?atD:beforeD});
  return {unit,guest,accepted};
}

class FakeGateway implements StripeGateway {
  readonly accountId='acct_test_fixture';
  request:CheckoutRequest|null=null;
  session:CheckoutSession|null=null;
  intent:PaymentEvidence|null=null;
  failCreate=false;
  createCalls=0;
  async createSession(request:CheckoutRequest) {
    this.createCalls++;
    this.request=request;
    if (this.failCreate) throw new Error('lost provider response');
    const c=request.correlation;
    this.session={id:`cs_test_${randomUUID()}`,accountId:this.accountId,url:`https://checkout.stripe.test/${randomUUID()}`,
      created:request.expiresAt-1800,expiresAt:request.expiresAt,status:'open',paymentStatus:'unpaid',
      paymentIntentId:null,amountTotal:request.amountCents,currency:'eur',livemode:false,mode:'payment',
      paymentMethodTypes:['card'],clientReferenceId:c.bookingId,metadata:{...c}};
    return this.session;
  }
  async retrieveSession() { if (!this.session) throw new Error('no Session'); return this.session; }
  async findSessionForPaymentIntent(id:string) {
    return this.session?.paymentIntentId===id ? this.session : null;
  }
  async retrievePaymentIntent() { if (!this.intent) throw new Error('no intent'); return this.intent; }
  async expireSession() { if (!this.session) throw new Error('no Session'); this.session={...this.session,status:'expired'}; return this.session; }
  verifyEvent(raw:Buffer) {
    const event=JSON.parse(raw.toString()) as {id:string;type:string;created:number;objectType:string;objectId:string};
    return {id:event.id,type:event.type,created:event.created,objectType:event.objectType,objectId:event.objectId,
      livemode:false,accountId:this.accountId};
  }
  pay() {
    if (!this.session || !this.request) throw new Error('no checkout');
    const id=`pi_test_${randomUUID()}`;
    this.session={...this.session,status:'complete',paymentStatus:'paid',paymentIntentId:id};
    this.intent={id,status:'succeeded',amountReceived:this.request.amountCents,currency:'eur',livemode:false,
      metadata:{...this.request.correlation},chargeId:`ch_test_${randomUUID()}`,chargePaid:true,
      chargeCaptured:true,chargeAmount:this.request.amountCents,chargeCurrency:'eur'};
  }
}

async function lostResponse(paid=true) {
  const accepted=(await fixture()).accepted,provider=new FakeGateway();
  const create=provider.createSession.bind(provider);
  provider.createSession=async request=>{
    await create(request);
    if (paid) provider.pay();
    throw new Error('create response lost after provider success');
  };
  expect(await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-lost',urls)).toEqual({status:'PENDING'});
  expect((await pool.query('SELECT stripe_session_id FROM payment_attempts WHERE id=$1',[accepted.attemptId])).rows[0].stripe_session_id).toBeNull();
  return {accepted,provider};
}

async function signedEvent(type:string,objectType:string,objectId:string) {
  const config={STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic_fixture',
    STRIPE_ACCOUNT_ID:'acct_test_fixture',STRIPE_SUCCESS_URL:urls.successUrl,STRIPE_CANCEL_URL:urls.cancelUrl};
  const raw=Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type,created:Math.floor(Date.now()/1000),
    livemode:false,data:{object:{object:objectType,id:objectId}}}));
  const signature=Stripe.webhooks.generateTestHeaderString({payload:raw.toString(),secret:config.STRIPE_WEBHOOK_SECRET});
  return (await ingestStripeWebhook(pool,new StripeSdkGateway(config),raw,signature)).eventId;
}

describe('Milestone 10 Stripe test-mode initial payment',()=>{
  it('locks an accepted initial attempt as the restricted role without obligation UPDATE or a provider call',async()=>{
    const {accepted}=await fixture();
    const runtime=new Pool({connectionString:process.env.DATABASE_URL,max:2});
    try {
      const grants=await runtime.query(`SELECT current_user role,
        has_table_privilege(current_user,'payment_obligations','UPDATE') table_update,
        has_any_column_privilege(current_user,'payment_obligations','UPDATE') column_update`);
      expect(grants.rows[0]).toMatchObject({role:'zemaitija_app',table_update:false,column_update:false});
      let entered!:()=>void, release!:()=>void;
      const inside=new Promise<void>(resolve=>{entered=resolve;});
      const gate=new Promise<void>(resolve=>{release=resolve;});
      const operation=withInitialLock(runtime,accepted.attemptId,async (_client,context)=>{
        entered();
        await gate;
        return context;
      });
      await inside;
      try {
        await expect(runtime.query('SELECT id FROM bookings WHERE id=$1 FOR UPDATE NOWAIT',[accepted.bookingId]))
          .rejects.toMatchObject({code:'55P03'});
      } finally { release(); }
      const context=await operation;
      expect(context).toMatchObject({bookingId:accepted.bookingId,attemptId:accepted.attemptId,
        obligationId:expect.any(String),commandState:'PENDING'});
      const command=await runtime.query('SELECT first_submitted_at,request_params,attempt_count FROM provider_commands WHERE id=$1',[accepted.commandId]);
      expect(command.rows[0]).toMatchObject({first_submitted_at:null,request_params:null,attempt_count:0});
    } finally { await runtime.end(); }
  });
  it('allocates as the restricted role while retaining parent locks and budget rejection',async()=>{
    const {unit,guest}=await fixture();
    const runtime=new Pool({connectionString:process.env.DATABASE_URL,max:1});
    const client=await runtime.connect();
    try {
      await client.query('BEGIN');
      const bookingId=randomUUID(),obligationId=randomUUID();
      await client.query(`INSERT INTO bookings(id,guest_id,unit_id,arrival_date,departure_date,guest_count,status,version,
        accepted_at,check_in_local_time,property_zone,scheduled_arrival_at,warning_at,balance_due_at,grace_ends_at)
        VALUES($1,$2,$3,'2028-01-10','2028-01-11',1,'AWAITING_INITIAL_PAYMENT',1,clock_timestamp(),'15:00',
        'Europe/Vilnius',clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp())`,[bookingId,guest,unit]);
      await client.query("INSERT INTO payment_obligations(id,booking_id,kind,amount_cents,due_at,currency) VALUES($1,$2,'INITIAL',100,clock_timestamp(),'EUR')",[obligationId,bookingId]);
      const records:string[]=[];
      for(let i=0;i<2;i++) {
        const attemptId=randomUUID(),reconciliationId=randomUUID(),recordId=randomUUID();
        await client.query("INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version) VALUES($1,$2,$3,'SUCCEEDED',100,'EUR',1)",[attemptId,bookingId,obligationId]);
        await client.query("INSERT INTO reconciliation_records(id,payment_attempt_id,checked_at,provider_state,evidence_kind,result) VALUES($1,$2,clock_timestamp(),'succeeded','SYNTHETIC_TEST','VERIFIED')",[reconciliationId,attemptId]);
        await client.query(`INSERT INTO payment_records(id,attempt_id,booking_id,obligation_id,stripe_payment_intent_id,
          captured_cents,currency,verified_at,allocation_state,reconciliation_id)
          VALUES($1,$2,$3,$4,$5,100,'EUR',clock_timestamp(),'ALLOCATED',$6)`,
          [recordId,attemptId,bookingId,obligationId,`pi_test_${recordId}`,reconciliationId]);
        records.push(recordId);
      }
      await client.query('INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES($1,$2,$3,60)',[randomUUID(),records[0],obligationId]);
      await client.query('SET CONSTRAINTS payment_allocations_budget IMMEDIATE');
      await client.query('SAVEPOINT over_budget');
      await expect(client.query('INSERT INTO payment_allocations(id,payment_record_id,obligation_id,amount_cents) VALUES($1,$2,$3,50)',[randomUUID(),records[1],obligationId]))
        .rejects.toMatchObject({code:'23514'});
      await client.query('ROLLBACK TO SAVEPOINT over_budget');
      const allocations=await client.query<{count:number}>('SELECT count(*)::int count FROM payment_allocations WHERE obligation_id=$1',[obligationId]);
      expect(allocations.rows[0].count).toBe(1);
    } finally { await client.query('ROLLBACK').catch(()=>{}); client.release(); await runtime.end(); }
  });
  it('confirms a synthetic initial capture through the restricted role without Stripe',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    const runtime=new Pool({connectionString:process.env.DATABASE_URL,max:3});
    try {
      expect((await dispatchSessionCreate(runtime,provider,accepted.attemptId,'worker-m10-runtime',urls)).status).toBe('READY');
      provider.pay();
      expect(await reconcileInitialAttempt(runtime,provider,accepted.attemptId)).toBe('CONFIRMED');
      expect(await reconcileInitialAttempt(runtime,provider,accepted.attemptId)).toBe('ALREADY_RECORDED');
      const state=await runtime.query(`SELECT b.status booking_state,h.state hold_state,c.booking_id claim_owner,
        (SELECT count(*)::int FROM payment_records p WHERE p.attempt_id=a.id) payments,
        (SELECT count(*)::int FROM payment_allocations x WHERE x.obligation_id=a.obligation_id) allocations
        FROM bookings b JOIN inventory_holds h ON h.booking_id=b.id
        JOIN payment_attempts a ON a.id=h.payment_attempt_id
        JOIN inventory_claims c ON c.origin_hold_id=h.id WHERE b.id=$1`,[accepted.bookingId]);
      expect(state.rows[0]).toMatchObject({booking_state:'CONFIRMED',hold_state:'CONSUMED',
        claim_owner:accepted.bookingId,payments:1,allocations:1});
    } finally { await runtime.end(); }
  });
  it('persists card-only exact request and confirms one advance credit under concurrent replay',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    const dispatched=await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-01',urls);
    expect(dispatched.status).toBe('READY');
    expect(provider.request).toMatchObject({amountCents:Number(accepted.initialCents),correlation:{bookingId:accepted.bookingId,holdId:accepted.holdId,attemptId:accepted.attemptId}});
    expect(provider.session!.expiresAt-provider.session!.created).toBe(1800);
    expect(provider.request!.expiresAt-Math.floor(Date.now()/1000)).toBeGreaterThanOrEqual(1790);
    const again=await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-02',urls);
    expect(again).toEqual(dispatched);
    expect(provider.createCalls).toBe(1);
    provider.pay();
    const results=await Promise.all([reconcileInitialAttempt(pool,provider,accepted.attemptId),reconcileInitialAttempt(pool,provider,accepted.attemptId)]);
    expect(results.sort()).toEqual(['ALREADY_RECORDED','CONFIRMED']);
    const facts=await pool.query(`SELECT b.status,h.state hold_state,a.state attempt_state,
      c.booking_id claim_booking,c.origin_hold_id,c.hold_id claim_hold,
      (SELECT count(*)::int FROM payment_records WHERE attempt_id=a.id) records,
      (SELECT count(*)::int FROM payment_allocations WHERE obligation_id=a.obligation_id) allocations,
      (SELECT amount_cents::text FROM payment_obligations WHERE booking_id=b.id AND kind='BALANCE') balance,
      (SELECT count(*)::int FROM notification_outbox WHERE booking_id=b.id) notices
      FROM bookings b JOIN inventory_holds h ON h.booking_id=b.id JOIN payment_attempts a ON a.id=h.payment_attempt_id
      JOIN inventory_claims c ON c.origin_hold_id=h.id WHERE b.id=$1`,[accepted.bookingId]);
    expect(facts.rows[0]).toMatchObject({status:'CONFIRMED',hold_state:'CONSUMED',attempt_state:'SUCCEEDED',
      claim_booking:accepted.bookingId,origin_hold_id:accepted.holdId,claim_hold:null,
      records:1,allocations:1,balance:accepted.balanceCents.toString(),notices:1});
  });
  it('marks a full-initial booking paid without a balance amount',async()=>{
    const {accepted}=await fixture(true),provider=new FakeGateway();
    await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-full',urls);
    provider.pay();
    expect(await reconcileInitialAttempt(pool,provider,accepted.attemptId)).toBe('CONFIRMED');
    expect(accepted.balanceCents).toBe(0n);
  });
  it('retains a Session ID when Checkout completes before the create response is committed',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    const create=provider.createSession.bind(provider);
    provider.createSession=async request=>{await create(request);provider.pay();return provider.session!;};
    expect(await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-fast',urls)).toEqual({status:'PENDING'});
    const state=await pool.query('SELECT state,stripe_session_id FROM payment_attempts WHERE id=$1',[accepted.attemptId]);
    expect(state.rows[0]).toMatchObject({state:'RECONCILING',stripe_session_id:provider.session!.id});
    expect(await reconcileInitialAttempt(pool,provider,accepted.attemptId)).toBe('CONFIRMED');
  });
  it('rejects direct claim transfer without a verified allocated payment',async()=>{
    const {accepted}=await fixture();
    await expect(pool.query(`UPDATE inventory_claims SET hold_id=NULL,booking_id=$1,origin_hold_id=$2
      WHERE hold_id=$2`,[accepted.bookingId,accepted.holdId])).rejects.toMatchObject({code:'23514'});
    expect((await pool.query('SELECT hold_id,released_at FROM inventory_claims WHERE hold_id=$1',[accepted.holdId])).rows[0])
      .toMatchObject({hold_id:accepted.holdId,released_at:null});
  });
  it('rejects a direct succeeded attempt without payment evidence and keeps runtime grants narrow',async()=>{
    const {accepted}=await fixture();
    await expect(pool.query("UPDATE payment_attempts SET state='SUCCEEDED' WHERE id=$1",[accepted.attemptId]))
      .rejects.toMatchObject({code:'23514'});
    const runtime=new Pool({connectionString:process.env.DATABASE_URL,max:1});
    try {
      const grants=await runtime.query(`SELECT current_user role,
        has_table_privilege(current_user,'payment_records','INSERT') record_insert,
        has_table_privilege(current_user,'payment_records','UPDATE') record_update,
        has_table_privilege(current_user,'inventory_claims','DELETE') claim_delete,
        has_table_privilege(current_user,'stripe_webhook_events','INSERT,UPDATE') inbox_write`);
      expect(grants.rows[0]).toMatchObject({role:'zemaitija_app',record_insert:true,
        record_update:false,claim_delete:false,inbox_write:true});
    } finally { await runtime.end(); }
  });
  it('does not release an expired Session with uncertain payment evidence',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-uncertain',urls);
    provider.session={...provider.session!,status:'expired',paymentStatus:'unpaid',paymentIntentId:`pi_test_${randomUUID()}`};
    provider.intent={id:provider.session.paymentIntentId!,status:'processing',amountReceived:0,currency:'eur',livemode:false,
      metadata:{...provider.request!.correlation},chargeId:null,chargePaid:false,chargeCaptured:false,chargeAmount:null,chargeCurrency:null};
    expect(await reconcileInitialAttempt(pool,provider,accepted.attemptId)).toBe('RECONCILING');
    expect((await pool.query('SELECT released_at FROM inventory_claims WHERE hold_id=$1',[accepted.holdId])).rows[0].released_at).toBeNull();
  });
  it('rolls back interrupted reconciliation and retries exactly once',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-retry',urls);
    provider.pay();
    await expect(reconcileInitialAttempt(pool,provider,accepted.attemptId,{testFailAfter:'PAYMENT_RECORD'})).rejects.toThrow('test reconciliation interruption');
    expect((await pool.query('SELECT count(*)::int n FROM payment_records WHERE stripe_payment_intent_id=$1',[provider.intent!.id])).rows[0].n).toBe(0);
    expect(await reconcileInitialAttempt(pool,provider,accepted.attemptId)).toBe('CONFIRMED');
  });
  it('keeps an unknown create blocking and quarantines an aged submission',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    provider.failCreate=true;
    expect(await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-unknown',urls)).toEqual({status:'PENDING'});
    expect((await pool.query('SELECT state FROM inventory_holds WHERE id=$1',[accepted.holdId])).rows[0].state).toBe('RECONCILING');
    expect((await pool.query('SELECT released_at FROM inventory_claims WHERE hold_id=$1',[accepted.holdId])).rows[0].released_at).toBeNull();
    const another=await fixture(),aged=new FakeGateway();
    await pool.query(`UPDATE provider_commands SET state='UNKNOWN',request_params='{}'::jsonb,
      first_submitted_at='2020-01-01',lease_generation=1,attempt_count=1 WHERE id=$1`,[another.accepted.commandId]);
    expect(await dispatchSessionCreate(pool,aged,another.accepted.attemptId,'worker-m10-aged',urls)).toEqual({status:'QUARANTINED'});
    expect(aged.createCalls).toBe(0);
  });
  it('fences a stale worker response after its command lease changes',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    let release!:()=>void;
    const waiting=new Promise<void>(resolve=>{release=resolve;});
    let submitted!:()=>void;
    const sent=new Promise<void>(resolve=>{submitted=resolve;});
    const create=provider.createSession.bind(provider);
    provider.createSession=async request=>{submitted();await waiting;return create(request);};
    const dispatch=dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-stale',urls);
    await sent;
    await pool.query(`UPDATE provider_commands SET lease_generation=lease_generation+1,
      lease_owner='worker-m10-new',lease_expires_at=clock_timestamp()+interval '2 minutes' WHERE id=$1`,[accepted.commandId]);
    release();
    expect(await dispatch).toEqual({status:'PENDING'});
    expect((await pool.query('SELECT stripe_session_id FROM payment_attempts WHERE id=$1',[accepted.attemptId])).rows[0].stripe_session_id).toBeNull();
    expect((await pool.query('SELECT released_at FROM inventory_claims WHERE hold_id=$1',[accepted.holdId])).rows[0].released_at).toBeNull();
  });
  it('recovers open unpaid, releases terminal unpaid, then records a late capture as refund liability',async()=>{
    const {accepted,unit,guest}=await fixture(),provider=new FakeGateway();
    await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-expire',urls);
    const client=await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("UPDATE payment_attempts SET state='RECONCILING' WHERE id=$1",[accepted.attemptId]);
      await client.query("UPDATE inventory_holds SET state='RECONCILING' WHERE id=$1",[accepted.holdId]);
      await client.query('COMMIT');
    } finally { await client.query('ROLLBACK').catch(()=>{}); client.release(); }
    expect(await reconcileInitialAttempt(pool,provider,accepted.attemptId)).toBe('OPEN');
    provider.session={...provider.session!,status:'expired'};
    expect(await reconcileInitialAttempt(pool,provider,accepted.attemptId)).toBe('RELEASED');
    const quote=await quoteStay(pool,{unitId:unit,arrivalDate:'2027-07-02',departureDate:'2027-07-05',guestCount:2},beforeD);
    const competitor=await acceptBooking(pool,{operationKey:randomUUID(),guestId:guest,locale:'en',quote,
      termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:quote.previewSplit.initialCents,
      syntheticPortfolioOnly:true},{testAcceptanceInstant:beforeD});
    provider.pay();
    expect(await reconcileInitialAttempt(pool,provider,accepted.attemptId)).toBe('UNALLOCATABLE');
    const facts=await pool.query(`SELECT
      (SELECT status FROM bookings WHERE id=$1) original_status,
      (SELECT count(*)::int FROM inventory_claims WHERE hold_id=$2 AND released_at IS NULL) competitor_claims,
      (SELECT count(*)::int FROM payment_records WHERE stripe_payment_intent_id=$3 AND allocation_state='UNALLOCATABLE') unallocatable,
      (SELECT count(*)::int FROM refund_obligations WHERE business_key=$4) refunds`,
      [accepted.bookingId,competitor.holdId,provider.intent!.id,`unallocatable:${provider.intent!.id}`]);
    expect(facts.rows[0]).toMatchObject({original_status:'EXPIRED',competitor_claims:1,unallocatable:1,refunds:1});
    expect(await reconcileInitialAttempt(pool,provider,accepted.attemptId)).toBe('ALREADY_RECORDED');
  });
  it('verifies signed metadata, rejects tampering and deduplicates event IDs',async()=>{
    const cfg={STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic_fixture',
      STRIPE_ACCOUNT_ID:'acct_test_fixture',STRIPE_SUCCESS_URL:urls.successUrl,STRIPE_CANCEL_URL:urls.cancelUrl};
    const gateway=new StripeSdkGateway(cfg),id=`evt_${randomUUID()}`;
    const raw=Buffer.from(JSON.stringify({id,type:'checkout.session.completed',created:Math.floor(Date.now()/1000),
      livemode:false,data:{object:{object:'checkout.session',id:`cs_test_${randomUUID()}`}}}));
    const signature=Stripe.webhooks.generateTestHeaderString({payload:raw.toString(),secret:cfg.STRIPE_WEBHOOK_SECRET});
    expect((await ingestStripeWebhook(pool,gateway,raw,signature)).duplicate).toBe(false);
    expect((await ingestStripeWebhook(pool,gateway,raw,signature)).duplicate).toBe(true);
    await expect(ingestStripeWebhook(pool,gateway,Buffer.from(raw.toString().replace('completed','expired')),signature)).rejects.toBeInstanceOf(WebhookInputError);
    const stale=Stripe.webhooks.generateTestHeaderString({payload:raw.toString(),secret:cfg.STRIPE_WEBHOOK_SECRET,
      timestamp:Math.floor(Date.now()/1000)-1000});
    await expect(ingestStripeWebhook(pool,gateway,raw,stale)).rejects.toBeInstanceOf(WebhookInputError);
    const live=Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type:'checkout.session.completed',created:Math.floor(Date.now()/1000),
      livemode:true,data:{object:{object:'checkout.session',id:`cs_live_${randomUUID()}`}}}));
    const liveSignature=Stripe.webhooks.generateTestHeaderString({payload:live.toString(),secret:cfg.STRIPE_WEBHOOK_SECRET});
    await expect(ingestStripeWebhook(pool,gateway,live,liveSignature)).rejects.toBeInstanceOf(WebhookInputError);
    const wrongAccount=Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type:'checkout.session.completed',
      created:Math.floor(Date.now()/1000),livemode:false,account:'acct_other_fixture',
      data:{object:{object:'checkout.session',id:`cs_test_${randomUUID()}`}}}));
    const accountSignature=Stripe.webhooks.generateTestHeaderString({payload:wrongAccount.toString(),secret:cfg.STRIPE_WEBHOOK_SECRET});
    await expect(ingestStripeWebhook(pool,gateway,wrongAccount,accountSignature)).rejects.toBeInstanceOf(WebhookInputError);
    const asyncEvent=Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,
      type:'checkout.session.async_payment_succeeded',created:Math.floor(Date.now()/1000),livemode:false,
      data:{object:{object:'checkout.session',id:`cs_test_${randomUUID()}`}}}));
    const asyncSignature=Stripe.webhooks.generateTestHeaderString({payload:asyncEvent.toString(),secret:cfg.STRIPE_WEBHOOK_SECRET});
    const quarantined=await ingestStripeWebhook(pool,gateway,asyncEvent,asyncSignature);
    expect((await pool.query('SELECT processing_state FROM stripe_webhook_events WHERE id=$1',[quarantined.eventId])).rows[0].processing_state)
      .toBe('QUARANTINED');
  });
  it('processes out-of-order PaymentIntent and Session events by current provider state',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-webhook',urls);
    provider.pay();
    const now=Math.floor(Date.now()/1000);
    const eventIds:string[]=[];
    for (const [type,objectType,objectId] of [
      ['payment_intent.succeeded','payment_intent',provider.intent!.id],
      ['checkout.session.completed','checkout.session',provider.session!.id],
    ]) eventIds.push((await ingestStripeWebhook(pool,provider,Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,type,created:now,objectType,objectId})),'fixture-signature')).eventId);
    expect(await processWebhookInbox(pool,provider,10,eventIds[0]) + await processWebhookInbox(pool,provider,10,eventIds[1])).toBe(2);
    expect((await pool.query('SELECT count(*)::int n FROM payment_records WHERE booking_id=$1',[accepted.bookingId])).rows[0].n).toBe(1);
  });
  it('does not confirm from a completed webhook without succeeded current PaymentIntent evidence',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-no-intent',urls);
    provider.session={...provider.session!,status:'complete',paymentStatus:'paid'};
    const ingested=await ingestStripeWebhook(pool,provider,Buffer.from(JSON.stringify({id:`evt_${randomUUID()}`,
      type:'checkout.session.completed',created:Math.floor(Date.now()/1000),objectType:'checkout.session',objectId:provider.session.id})),'fixture-signature');
    await processWebhookInbox(pool,provider,25,ingested.eventId);
    expect((await pool.query('SELECT status FROM bookings WHERE id=$1',[accepted.bookingId])).rows[0].status).toBe('AWAITING_INITIAL_PAYMENT');
    expect((await pool.query('SELECT released_at FROM inventory_claims WHERE hold_id=$1',[accepted.holdId])).rows[0].released_at).toBeNull();
  });
  it('recovers a lost create response through a signed Session event exactly once',async()=>{
    const {accepted,provider}=await lostResponse();
    const eventId=await signedEvent('checkout.session.completed','checkout.session',provider.session!.id);
    expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(1);
    expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(0);
    const rows=await pool.query(`SELECT a.stripe_session_id,b.status,h.state hold_state,c.booking_id claim_booking,
      c.origin_hold_id,c.hold_id claim_hold,
      (SELECT count(*)::int FROM payment_records WHERE attempt_id=a.id) records,
      (SELECT count(*)::int FROM payment_allocations pa JOIN payment_records p ON p.id=pa.payment_record_id
        WHERE p.attempt_id=a.id) allocations
      FROM payment_attempts a JOIN bookings b ON b.id=a.booking_id
      JOIN inventory_holds h ON h.id=a.hold_id JOIN inventory_claims c ON c.origin_hold_id=h.id
      WHERE a.id=$1`,[accepted.attemptId]);
    expect(rows.rows[0]).toMatchObject({stripe_session_id:provider.session!.id,status:'CONFIRMED',
      hold_state:'CONSUMED',claim_booking:accepted.bookingId,origin_hold_id:accepted.holdId,
      claim_hold:null,records:1,allocations:1});
    expect(provider.createCalls).toBe(1);
  });
  it('recovers a lost Session ID from a PaymentIntent event using the Session lookup',async()=>{
    const {accepted,provider}=await lostResponse();
    const eventId=await signedEvent('payment_intent.succeeded','payment_intent',provider.intent!.id);
    expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(1);
    expect((await pool.query('SELECT stripe_session_id,state FROM payment_attempts WHERE id=$1',[accepted.attemptId])).rows[0])
      .toMatchObject({stripe_session_id:provider.session!.id,state:'SUCCEEDED'});
    expect((await pool.query('SELECT count(*)::int n FROM payment_records WHERE attempt_id=$1',[accepted.attemptId])).rows[0].n).toBe(1);
  });
  it('fences a delayed original response after webhook recovery',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    let release!:()=>void,created!:()=>void;
    const wait=new Promise<void>(resolve=>{release=resolve;});
    const ready=new Promise<void>(resolve=>{created=resolve;});
    const create=provider.createSession.bind(provider);
    provider.createSession=async request=>{await create(request);provider.pay();created();await wait;return provider.session!;};
    const dispatch=dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-concurrent',urls);
    await ready;
    const eventId=await signedEvent('checkout.session.completed','checkout.session',provider.session!.id);
    expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(1);
    release();
    expect(await dispatch).toEqual({status:'PENDING'});
    expect((await pool.query('SELECT count(*)::int n FROM payment_records WHERE attempt_id=$1',[accepted.attemptId])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT count(*)::int n FROM inventory_claims WHERE origin_hold_id=$1',[accepted.holdId])).rows[0].n).toBe(1);
  });
  it('does not attach one recovered Session to another accepted attempt',async()=>{
    const first=await lostResponse(),second=(await fixture()).accepted;
    const eventId=await signedEvent('checkout.session.completed','checkout.session',first.provider.session!.id);
    expect(await processWebhookInbox(pool,first.provider,1,eventId)).toBe(1);
    expect(await reconcileInitialAttempt(pool,first.provider,second.attemptId,{sessionLocator:first.provider.session!.id}))
      .toBe('RECONCILING');
    await expect(pool.query('UPDATE payment_attempts SET stripe_session_id=$1 WHERE id=$2',
      [first.provider.session!.id,second.attemptId])).rejects.toMatchObject({code:'23505'});
    expect((await pool.query('SELECT stripe_session_id FROM payment_attempts WHERE id=$1',[second.attemptId])).rows[0].stripe_session_id).toBeNull();
  });
  it('rejects wrong account, amount and correlation before binding a recovered Session',async()=>{
    for (const defect of ['ACCOUNT','AMOUNT','CORRELATION']) {
      const {accepted,provider}=await lostResponse();
      if (defect==='ACCOUNT') provider.session={...provider.session!,accountId:'acct_wrong'};
      if (defect==='AMOUNT') provider.session={...provider.session!,amountTotal:provider.session!.amountTotal!+1};
      if (defect==='CORRELATION') provider.session={...provider.session!,metadata:{...provider.session!.metadata,holdId:randomUUID()}};
      const eventId=await signedEvent('checkout.session.completed','checkout.session',provider.session!.id);
      expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(0);
      const state=await pool.query('SELECT stripe_session_id FROM payment_attempts WHERE id=$1',[accepted.attemptId]);
      expect(state.rows[0].stripe_session_id).toBeNull();
      expect((await pool.query('SELECT released_at FROM inventory_claims WHERE hold_id=$1',[accepted.holdId])).rows[0].released_at).toBeNull();
    }
  });
  it('keeps a missing or inconclusive provider outcome blocking without another create',async()=>{
    const missing=await lostResponse();
    missing.provider.findSessionForPaymentIntent=async()=>null;
    const missingEvent=await signedEvent('payment_intent.succeeded','payment_intent',missing.provider.intent!.id);
    expect(await processWebhookInbox(pool,missing.provider,1,missingEvent)).toBe(0);
    expect(missing.provider.createCalls).toBe(1);
    expect((await pool.query('SELECT released_at FROM inventory_claims WHERE hold_id=$1',[missing.accepted.holdId])).rows[0].released_at).toBeNull();
    const inconclusive=await lostResponse(false);
    inconclusive.provider.session={...inconclusive.provider.session!,status:'complete',paymentStatus:'unpaid'};
    const eventId=await signedEvent('checkout.session.completed','checkout.session',inconclusive.provider.session.id);
    expect(await processWebhookInbox(pool,inconclusive.provider,1,eventId)).toBe(0);
    expect((await pool.query('SELECT stripe_session_id FROM payment_attempts WHERE id=$1',[inconclusive.accepted.attemptId])).rows[0].stripe_session_id)
      .toBe(inconclusive.provider.session.id);
    expect((await pool.query('SELECT released_at FROM inventory_claims WHERE hold_id=$1',[inconclusive.accepted.holdId])).rows[0].released_at).toBeNull();
  });
  it('recovers after the 24-hour replay boundary without creating another Session',async()=>{
    const {accepted,provider}=await lostResponse();
    const clock=Date.now;
    try {
      Date.now=()=>clock()+25*60*60*1000;
      expect(await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-aged-lost',urls)).toEqual({status:'QUARANTINED'});
    } finally { Date.now=clock; }
    const eventId=await signedEvent('checkout.session.completed','checkout.session',provider.session!.id);
    expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(1);
    expect(provider.createCalls).toBe(1);
  });
  it('backs off failed inbox items and retains exhausted items for investigation',async()=>{
    const provider=new FakeGateway(),eventId=await signedEvent('checkout.session.completed','checkout.session',`cs_test_${randomUUID()}`);
    expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(0);
    let row=(await pool.query('SELECT processing_state,processing_attempts,next_attempt_at,last_error_code FROM stripe_webhook_events WHERE id=$1',[eventId])).rows[0];
    expect(row).toMatchObject({processing_state:'RETRY',processing_attempts:1,last_error_code:'PROVIDER_OR_DATABASE_ERROR'});
    expect(row.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
    expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(0);
    expect((await pool.query('SELECT processing_attempts FROM stripe_webhook_events WHERE id=$1',[eventId])).rows[0].processing_attempts).toBe(1);
    for (let n=2;n<=5;n++) {
      await pool.query("UPDATE stripe_webhook_events SET next_attempt_at=clock_timestamp()-interval '1 second' WHERE id=$1",[eventId]);
      expect(await processWebhookInbox(pool,provider,1,eventId)).toBe(0);
    }
    row=(await pool.query('SELECT processing_state,processing_attempts,last_error_code FROM stripe_webhook_events WHERE id=$1',[eventId])).rows[0];
    expect(row).toMatchObject({processing_state:'INVESTIGATE',processing_attempts:5,last_error_code:'PROVIDER_OR_DATABASE_ERROR'});
  });
  it('claims a webhook once across concurrent inbox workers',async()=>{
    const {accepted}=await fixture(),provider=new FakeGateway();
    await dispatchSessionCreate(pool,provider,accepted.attemptId,'worker-m10-inbox-race',urls);
    provider.pay();
    const eventId=await signedEvent('checkout.session.completed','checkout.session',provider.session!.id);
    let release!:()=>void,entered!:()=>void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const pending=new Promise<void>(resolve=>{entered=resolve;});
    const retrieve=provider.retrieveSession.bind(provider);
    provider.retrieveSession=async()=>{entered();await gate;return retrieve();};
    const first=processWebhookInbox(pool,provider,1,eventId);
    await pending;
    const second=await processWebhookInbox(pool,provider,1,eventId);
    release();
    expect(second).toBe(0);
    expect(await first).toBe(1);
    expect((await pool.query('SELECT processing_state,processing_attempts FROM stripe_webhook_events WHERE id=$1',[eventId])).rows[0])
      .toMatchObject({processing_state:'PROCESSED',processing_attempts:1});
  });
});
