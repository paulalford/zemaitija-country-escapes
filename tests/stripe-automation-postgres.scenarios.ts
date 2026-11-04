import { commitAcknowledgement } from '../scripts/lib/stripe-automation-transactions';
/** Executable PostgreSQL definitions. Not a Vitest suite; import is inert.
 * Only the separately gated application host entry invokes these cases. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { ingestStripeWebhook, processPaymentWebhookInbox } from '../src/server/stripe-webhooks';
import { quoteStay } from '../src/server/quote';
import { acceptBooking, type AcceptanceResult } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { reconcileInitialAttempt } from '../src/server/payment-reconciliation';
import { recoverPaymentAttempts } from '../src/server/payment-recovery';
import type { ApplicationTestContext } from './helpers/stripe-automation-app';
import type { SqlSession } from '../scripts/lib/stripe-automation-connection';

async function rejectsCode(work:()=>Promise<unknown>,code:string) {
  await assert.rejects(work,(e:unknown)=>typeof e==='object' && e!==null && 'code' in e && e.code===code);
}
async function rollback(h:ApplicationTestContext,work:(s:SqlSession)=>Promise<void>) {
  const s=await h.connect();try {await s.query('BEGIN');await work(s);}finally {try {await s.query('ROLLBACK');}finally {s.release(true);}}
}
async function create(h:ApplicationTestContext,day:number) {
  const date=`2035-01-${String(day).padStart(2,'0')}`;
  const q=await quoteStay(h.pool,{unitId:h.fixtures.unit,arrivalDate:date,
    departureDate:`2035-01-${String(day+1).padStart(2,'0')}`,guestCount:1});
  const input={operationKey:`${h.fixtures.key}:${day}`,guestId:h.fixtures.guest,locale:'en' as const,quote:q,
    termsVersion:'SYNTHETIC_TEST_TERMS_V1' as const,acceptedTerms:true as const,
    acknowledgedInitialCents:q.previewSplit.initialCents,syntheticPortfolioOnly:true as const};
  const results=await Promise.all([acceptBooking(h.pool,input),acceptBooking(h.pool,input)]);
  assert.equal(results[0].attemptId,results[1].attemptId);
  assert.equal(results.filter(r=>r.replayed).length,1);
  return results[0];
}
async function waitDue(h:ApplicationTestContext,ids:string[]) {
  const deadline=Date.now()+35000;
  while((await h.query('SELECT count(*)::int n FROM payment_attempts WHERE id=ANY($1::uuid[]) AND recovery_next_attempt_at>clock_timestamp()',[ids])).rows[0]?.n!==0) {
    assert.ok(Date.now()<deadline,'due-time wait exceeded; preserve fixtures');await delay(100);
  }
}
const claim=(s:Pick<SqlSession,'query'>,worker:string)=>s.query('SELECT attempt_id,generation::text FROM public.claim_payment_recovery($1,$2,1)',['INITIAL',worker]);
const finish=(s:Pick<SqlSession,'query'>,id:unknown,worker:string,generation:unknown)=>s.query(
  "SELECT public.finish_payment_recovery($1,$2,$3,'POLL',60) finished",[id,worker,generation]);

export async function runPostgresAcceptance(h:ApplicationTestContext) {
  const completed:string[]=[];
  const check=async(name:string,work:()=>Promise<void>)=>{await work();completed.push(name);};
  let a:AcceptanceResult,b:AcceptanceResult;
  await check('schema-extensions-ownership-deferred-trigger-and-app-privileges',async()=>{
    assert.equal((await h.query("SELECT count(*)::int n FROM pg_extension WHERE extname='btree_gist'")).rows[0].n,1);
    const trigger=(await h.query("SELECT tgdeferrable,tginitdeferred FROM pg_trigger WHERE tgname='new_payment_recovery_enrollment' AND tgrelid='public.payment_attempts'::regclass")).rows[0];
    assert.deepEqual(trigger,{tgdeferrable:true,tginitdeferred:true});
    assert.equal((await h.query("SELECT count(*)::int n FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','S') AND pg_get_userbyid(c.relowner)<>'zemaitija_migrator'")).rows[0].n,0);
    await rollback(h,s=>rejectsCode(()=>s.query('UPDATE payment_attempts SET recovery_lease_generation=0 WHERE id=$1',[h.fixtures.historyAttempt]),'42501'));
    await rollback(h,s=>rejectsCode(()=>s.query('SET ROLE zemaitija_migrator'),'42501'));
  });
  await check('atomic-domain-enrollment-and-concurrent-acceptance-idempotency',async()=>{
    a=await create(h,2);b=await create(h,4);
    const rows=(await h.query('SELECT recovery_enabled,recovery_lease_generation::text FROM payment_attempts WHERE id=ANY($1::uuid[])',[[a.attemptId,b.attemptId]])).rows;
    assert.equal(rows.length,2);assert.ok(rows.every(r=>r.recovery_enabled===true && r.recovery_lease_generation==='0'));
  });
  await check('future-due-time-exclusion-with-older-rows-locked',async()=>{
    const future=await create(h,6),owner=await h.connect();
    try {await owner.query('BEGIN');
      await owner.query('SELECT id FROM payment_attempts WHERE id=ANY($1::uuid[]) FOR UPDATE',[[a.attemptId,b.attemptId]]);
      assert.equal((await owner.query('SELECT recovery_next_attempt_at>clock_timestamp() future FROM payment_attempts WHERE id=$1',[future.attemptId])).rows[0].future,true);
      assert.equal((await claim(h,'worker_future')).rows.length,0);
    } finally {await owner.query('ROLLBACK');owner.release(true);}
  });
  await check('invalid-lease-token-rejected-by-postgres-capability',async()=>{
    await rollback(h,s=>rejectsCode(()=>finish(s,a.attemptId,'worker_invalid','0'),'22023'));
  });
  await check('postgres-statement-timeout-and-transaction-rollback',async()=>{
    await rollback(h,async s=>{await s.query("SET LOCAL statement_timeout='20ms'");await rejectsCode(()=>s.query('SELECT pg_sleep(1)'),'57014');});
    await rollback(h,async s=>{await s.query("UPDATE bookings SET version=version+1 WHERE id=$1",[a.bookingId]);});
    assert.equal((await h.query('SELECT version FROM bookings WHERE id=$1',[a.bookingId])).rows[0].version,1);
  });
  await check('postgres-lock-timeout-on-independent-sessions',async()=>{
    const owner=await h.connect();try {await owner.query('BEGIN');await owner.query('SELECT id FROM payment_attempts WHERE id=$1 FOR UPDATE',[a.attemptId]);
      await rollback(h,async s=>{await s.query("SET LOCAL lock_timeout='20ms'");await rejectsCode(()=>s.query('SELECT id FROM payment_attempts WHERE id=$1 FOR UPDATE',[a.attemptId]),'55P03');});
    } finally {await owner.query('ROLLBACK');owner.release(true);}
  });
  await check('deferred-enrollment-failure-at-commit-rolls-back-all-writes',async()=>{
    const s=await h.connect(),id=randomUUID();
    try {await s.query('BEGIN');
      await s.query("UPDATE payment_attempts SET state='EXPIRED' WHERE id=$1",[h.fixtures.historyAttempt]);
      await s.query(`INSERT INTO payment_attempts(id,booking_id,obligation_id,state,expected_cents,currency,version,recovery_enabled,recovery_next_attempt_at)
        VALUES($1,$2,$3,'CREATING',10000,'EUR',1,true,clock_timestamp())`,[id,h.fixtures.historyBooking,h.fixtures.historyObligation]);
      await rejectsCode(()=>s.query('COMMIT'),'23514');
    } finally {await s.query('ROLLBACK');s.release(true);}
    assert.equal((await h.query('SELECT count(*)::int n FROM payment_attempts WHERE id=$1',[id])).rows[0].n,0);
    assert.equal((await h.query('SELECT state FROM payment_attempts WHERE id=$1',[h.fixtures.historyAttempt])).rows[0].state,'CREATING');
  });
  await check('connection-cancellation-awaits-server-query-settlement',async()=>{
    const s=await h.connect();
    try {const pid=(await s.query('SELECT pg_backend_pid() pid')).rows[0].pid;
      await s.query("SET statement_timeout='5s'");
      const pending=s.query('SELECT pg_sleep(4)').then(()=>null,e=>e as {code:string});
      const deadline=Date.now()+1000;
      while((await h.query('SELECT query FROM pg_stat_activity WHERE pid=$1',[pid])).rows[0]?.query!=='SELECT pg_sleep(4)') {
        assert.ok(Date.now()<deadline,'cancellation synchronization failed');await delay(10);
      }
      assert.equal((await h.query('SELECT pg_cancel_backend($1) cancelled',[pid])).rows[0].cancelled,true);
      assert.equal((await pending)?.code,'57014');
    } finally {s.release(true);}
  });
  await check('due-time-selection-independent-claimers-skip-locked-and-token-fencing',async()=>{
    await waitDue(h,[a.attemptId,b.attemptId]);
    const first=await h.connect(),second=await h.connect();
    try {await first.query('BEGIN');await second.query('BEGIN');
      const x=(await claim(first,'worker_first')).rows[0];const y=(await claim(second,'worker_second')).rows[0];
      assert.ok(x && y);assert.notEqual(x.attempt_id,y.attempt_id);
      assert.equal(x.attempt_id,a.attemptId);assert.equal(y.attempt_id,b.attemptId);
      assert.equal((await finish(first,x.attempt_id,'worker_wrong',x.generation)).rows[0].finished,false);
      assert.equal((await finish(first,x.attempt_id,'worker_first',String(BigInt(x.generation as string)+1n))).rows[0].finished,false);
      assert.equal((await finish(first,x.attempt_id,'worker_first',x.generation)).rows[0].finished,true);
      assert.equal((await finish(second,y.attempt_id,'worker_second',y.generation)).rows[0].finished,true);
    } finally {await first.query('ROLLBACK');await second.query('ROLLBACK');first.release(true);second.release(true);}
  });
  await check('committed-lease-worker-interruption-stale-recovery-expired-token-and-fairness',async()=>{
    const lost=(await claim(h,'worker_interrupted')).rows[0];assert.ok(lost);
    // Drop the claiming connection (query helper releases it). Lease is durable,
    // so unrelated due work must still progress without waiting for expiry.
    const other=(await claim(h,'worker_progress')).rows[0];assert.ok(other);assert.notEqual(other.attempt_id,lost.attempt_id);
    assert.equal((await finish(h,other.attempt_id,'worker_progress',other.generation)).rows[0].finished,true);
    // Real database time only; never use a migrator callback to age a lease.
    const deadline=Date.now()+125000;
    while((await h.query('SELECT recovery_lease_until>clock_timestamp() active FROM payment_attempts WHERE id=$1',[lost.attempt_id])).rows[0].active===true) {
      assert.ok(Date.now()<deadline,'lease wait exceeded; preserve');await delay(250);
    }
    assert.equal((await finish(h,lost.attempt_id,'worker_interrupted',lost.generation)).rows[0].finished,false);
    const replacement=(await claim(h,'worker_replacement')).rows[0];assert.equal(replacement.attempt_id,lost.attempt_id);
    assert.ok(BigInt(replacement.generation as string)>BigInt(lost.generation as string));
    assert.equal((await finish(h,lost.attempt_id,'worker_interrupted',lost.generation)).rows[0].finished,false);
    assert.equal((await finish(h,replacement.attempt_id,'worker_replacement',replacement.generation)).rows[0].finished,true);
  });
  await check('financial-concurrent-reconciliation-idempotency-and-rollback',async()=>{
    const identity={bookingId:a.bookingId,holdId:a.holdId,attemptId:a.attemptId,commandId:a.commandId};
    const sessionId=`cs_test_${a.attemptId}`,intentId=`pi_${a.attemptId}`,chargeId=`ch_${a.attemptId}`;
    const now=Math.floor(Date.now()/1000);
    h.stripe.session(sessionId,{id:sessionId,accountId:'acct_synthetic',url:'https://synthetic.invalid/checkout',
      created:now,expiresAt:now+1800,status:'complete',paymentStatus:'paid',paymentIntentId:intentId,
      amountTotal:Number(a.initialCents),currency:'eur',livemode:false,mode:'payment',paymentMethodTypes:['card'],clientReferenceId:a.bookingId,metadata:identity});
    const paidSession=await h.stripe.gateway.retrieveSession(sessionId);
    h.stripe.session(`session-create:${a.attemptId}`,{...paidSession,status:'open',paymentStatus:'unpaid',paymentIntentId:null});
    assert.equal((await dispatchSessionCreate(h.pool,h.stripe.gateway,a.attemptId,'worker_financial',
      {successUrl:'http://localhost/synthetic-success',cancelUrl:'http://localhost/synthetic-cancel'})).status,'READY');
    h.stripe.payment(intentId,{id:intentId,status:'succeeded',amountReceived:Number(a.initialCents),currency:'eur',livemode:false,
      metadata:identity,chargeId,chargePaid:true,chargeCaptured:true,chargeAmount:Number(a.initialCents),chargeCurrency:'eur',chargeCreated:now});
    // Domain failure injection rolls back real financial writes; no provider capture API exists in this fake.
    await assert.rejects(()=>reconcileInitialAttempt(h.pool,h.stripe.gateway,a.attemptId,{sessionLocator:sessionId,testFailAfter:'PAYMENT_RECORD'}));
    assert.equal((await h.query('SELECT count(*)::int n FROM payment_records WHERE attempt_id=$1',[a.attemptId])).rows[0].n,0);
    await Promise.all([reconcileInitialAttempt(h.pool,h.stripe.gateway,a.attemptId,{sessionLocator:sessionId}),
      reconcileInitialAttempt(h.pool,h.stripe.gateway,a.attemptId,{sessionLocator:sessionId})]);
    assert.equal((await h.query('SELECT count(*)::int n FROM payment_records WHERE attempt_id=$1',[a.attemptId])).rows[0].n,1);
    assert.equal((await h.query('SELECT count(*)::int n FROM payment_allocations WHERE obligation_id=(SELECT obligation_id FROM payment_attempts WHERE id=$1)',[a.attemptId])).rows[0].n,1);
    assert.equal(h.stripe.count('createSession'),1);assert.ok(h.stripe.count('retrieveSession')>=3);
    await rollback(h,s=>rejectsCode(()=>s.query(`INSERT INTO payment_records SELECT $1,attempt_id,booking_id,obligation_id,provider_incident_id,
      stripe_payment_intent_id,stripe_charge_id,captured_cents,currency,provider_succeeded_at,verified_at,allocation_state,
      refund_encumbered_cents,reconciliation_id,created_at FROM payment_records WHERE attempt_id=$2`,[randomUUID(),a.attemptId]),'23505'));
  });
  await check('financial-success-preserved-after-metadata-error',async()=>{
    // Use actual PostgreSQL for financial observation; inject only the metadata reply loss.
    const pool=new Proxy(h.pool,{get(target,key){if(key!=='query')return Reflect.get(target,key);
      return async(sql:string,args?:unknown[])=>{if(sql.includes('finish_payment_recovery'))throw Error('synthetic lost metadata acknowledgement');return h.query(sql,args);};}});
    // a's schedule is still due after its original claim transaction rolled back;
    // move it due by waiting for the 60s POLL deadline, without privileged SQL.
    await delay(61000);
    const result=await recoverPaymentAttempts(pool,h.stripe.gateway,'INITIAL',async()=>{throw Error('paid attempts must bypass provider');},3,{workerId:'worker_metadata',random:()=>0});
    assert.equal(result.financialSucceeded,1);assert.ok(result.deferred>=1);assert.equal(result.processed,0);
    assert.equal((await h.query('SELECT state FROM payment_attempts WHERE id=$1',[a.attemptId])).rows[0].state,'SUCCEEDED');
  });
  await check('lost-commit-acknowledgement-remains-uncertain-until-independent-observation',async()=>{
    const s=await h.connect();
    try {await s.query('BEGIN');await s.query('UPDATE bookings SET version=version+1 WHERE id=$1',[b.bookingId]);
      // Simulate loss of the reply after the real PostgreSQL commit. No retry.
      const outcome=await commitAcknowledgement({query:async sql=>{await s.query(sql);throw Error('synthetic acknowledgement loss');}});
      assert.equal(outcome,'UNCERTAIN');
    } finally {s.release(true);}
    assert.equal((await h.query('SELECT version FROM bookings WHERE id=$1',[b.bookingId])).rows[0].version,2);
  });
  await check('unrelated-historical-webhook-excluded-from-payment-processing',async()=>{
    const eventId=`evt_${h.fixtures.historyAttempt}`;
    h.stripe.event('synthetic-history-signature',{id:eventId,type:'refund.updated',objectType:'refund',objectId:`re_${h.fixtures.historyAttempt}`,
      created:1,livemode:false,accountId:'acct_synthetic'});
    const event=await ingestStripeWebhook(h.pool,h.stripe.gateway,Buffer.from('synthetic-history'),'synthetic-history-signature');
    const before=(await h.query('SELECT * FROM stripe_webhook_events WHERE id=$1',[event.eventId])).rows;
    const calls=h.stripe.calls.length;
    const result=await processPaymentWebhookInbox(h.pool,h.stripe.gateway,1,{workerId:'worker_history',random:()=>0});
    assert.equal(result.attempted,0);assert.equal(h.stripe.calls.length,calls);
    assert.deepEqual((await h.query('SELECT * FROM stripe_webhook_events WHERE id=$1',[event.eventId])).rows,before);
  });
  await check('historical-unenrolled-records-remain-unchanged',async()=>{
    const row=(await h.query('SELECT recovery_enabled,recovery_lease_generation::text,recovery_next_attempt_at FROM payment_attempts WHERE id=$1',[h.fixtures.historyAttempt])).rows[0];
    assert.deepEqual(row,{recovery_enabled:false,recovery_lease_generation:'0',recovery_next_attempt_at:null});
    await rollback(h,s=>rejectsCode(()=>s.query('UPDATE payment_attempts SET recovery_enabled=true WHERE id=$1',[h.fixtures.historyAttempt]),'42501'));
  });
  return {completed,providerCalls:[...h.stripe.calls]};
}
