import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { CheckoutRequest, CheckoutSession, PaymentEvidence, StripeGateway } from '../src/server/stripe-adapter';
import { reconcileInitialAttempt, recoverInitialAttempts } from '../src/server/payment-reconciliation';
import { dispatchBalanceSessionCreate, reconcileBalanceAttempt, recoverBalanceAttempts } from '../src/server/balance-payment';
import { dispatchSessionCreate, recoverSessionCommands } from '../src/server/checkout-worker';
import { ingestStripeWebhook, processPaymentWebhookInbox } from '../src/server/stripe-webhooks';

vi.mock('pg',()=>{throw Error('Database forbidden');});
vi.mock('stripe',()=>{throw Error('Stripe forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Runtime pool forbidden');});
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-11-02T10:00:00Z'));vi.spyOn(Math,'random').mockReturnValue(0);});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
const id='00000000-0000-4000-8000-000000000001';
const urls={successUrl:'http://localhost/success',cancelUrl:'http://localhost/cancel'};
type Result={rows:object[];rowCount?:number};
function fixture(balance=false) {
  const now=()=>Date.now();
  const c={booking_id:id,guest_id:id,unit_id:id,hold_id:balance?null:id,status:balance?'CONFIRMED':'AWAITING_INITIAL_PAYMENT',
    get command_now(){return new Date(now());},locale:'en',split_basis:'ADVANCE',hold_state:'ACTIVE',claim_id:id,claim_hold_id:balance?null:id,claim_booking_id:null,
    claim_released_at:null as Date|null,attempt_id:id,attempt_state:'OPEN',expected_cents:'3000',obligation_id:id,
    session_id:'cs_test_synthetic' as string|null,checkout_url:'https://checkout.stripe.com/c/pay/synthetic',
    session_expires_at:new Date(now()+1800000),payment_intent_id:null,command_id:id,command_state:'RESOLVED',
    idempotency_key:'original-stripe-key',request_fingerprint:Buffer.alloc(32),request_params:null as CheckoutRequest|null,
    first_submitted_at:new Date(now()-60000) as Date|null,lease_generation:'9007199254740997',lease_owner:null as string|null,
    lease_expires_at:null as Date|null,next_attempt_at:null as Date|null,attempt_count:1};
  const correlation={bookingId:id,attemptId:id,commandId:id,...(balance?{}:{holdId:id})};
  const request:CheckoutRequest={correlation,amountCents:3000,expiresAt:Math.floor(now()/1000)+1740,
    ...urls,idempotencyKey:c.idempotency_key,paymentPurpose:balance?'BALANCE':'INITIAL_ADVANCE'};
  c.request_params=request;
  const session:CheckoutSession={id:'cs_test_synthetic',accountId:'acct_synthetic',url:c.checkout_url,
    created:Math.floor(now()/1000)-60,expiresAt:Math.floor(now()/1000)+1740,status:'open',paymentStatus:'unpaid',
    paymentIntentId:null,amountTotal:3000,currency:'eur',livemode:false,mode:'payment',paymentMethodTypes:['card'],
    clientReferenceId:id,metadata:correlation};
  const payment:PaymentEvidence={id:'pi_synthetic',status:'succeeded',amountReceived:3000,currency:'eur',livemode:false,
    metadata:correlation,chargeId:'ch_synthetic',chargePaid:true,chargeCaptured:true,chargeAmount:3000,chargeCurrency:'eur'};
  const ledger:unknown[][]=[],allocations:unknown[][]=[],claims:string[]=[],writes:string[]=[],observations:unknown[][]=[];
  let extra:((sql:string,args:unknown[])=>Result|undefined)|undefined;
  const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
    const intercepted=extra?.(sql,args);if(intercepted)return intercepted;
    if(sql.startsWith('SELECT attempt_id,generation'))return {rows:[{attempt_id:id,generation:'9007199254740998',failure_count:0}]};
    if(sql.includes('finish_payment_recovery'))return {rows:[{finished:true}]};
    if(sql.startsWith('SELECT state'))return {rows:[{state:c.attempt_state,stripe_session_id:c.session_id}]};
    if(sql.startsWith('SELECT stripe_session_id'))return {rows:[{stripe_session_id:c.session_id}]};
    if(sql.includes('SELECT a.booking_id,a.hold_id'))return {rows:[{...c}]};
    if(sql.includes('SELECT b.id booking_id'))return {rows:[{...c}]};
    if(sql.startsWith('SELECT id FROM payment_records'))return {rows:ledger.length?[{id:'payment'}]:[],rowCount:ledger.length};
    if(sql.startsWith('SELECT COALESCE(sum(pa.amount_cents)'))return {rows:[{allocated:allocations.length?'3000':'0'}]};
    if(sql.startsWith('SELECT balance_cents'))return {rows:[{balance_cents:'7000'}]};
    if(sql.includes(') safe FROM provider_commands'))return {rows:[{safe:c.lease_owner===args[1]&&c.lease_generation===args[2]&&
      !!c.first_submitted_at&&c.first_submitted_at.getTime()>now()-86400000+11000&&!!c.lease_expires_at&&c.lease_expires_at.getTime()>now()+11000}]};
    if(sql.startsWith('SELECT id FROM payment_attempts'))return {rows:[{id}]};
    if(sql.startsWith('SELECT hold_id'))return {rows:[{hold_id:c.hold_id}]};
    if(sql.startsWith('INSERT INTO payment_records'))ledger.push(args);
    if(sql.startsWith('INSERT INTO payment_allocations'))allocations.push(args);
    if(sql.startsWith('INSERT INTO reconciliation_records'))observations.push(args);
    if(sql.startsWith('UPDATE payment_attempts')) {
      if(sql.includes("state='SUCCEEDED'"))c.attempt_state='SUCCEEDED';
      else if(sql.includes("state='EXPIRED'"))c.attempt_state='EXPIRED';
      else if(sql.includes("state='FAILED'"))c.attempt_state='FAILED';
      else if(sql.includes("state='RECONCILING'"))c.attempt_state='RECONCILING';
      else if(sql.includes("state='OPEN'"))c.attempt_state='OPEN';
      else if(sql.includes('state=$2'))c.attempt_state=args[1] as string;
    }
    if(sql.startsWith('UPDATE provider_commands')) {
      const set=sql.split(/\bWHERE\b/)[0];
      if(set.includes("state='SUBMITTED'")) {
        c.command_state='SUBMITTED';c.request_params??=JSON.parse(args[1] as string);
        c.first_submitted_at??=new Date(now());c.lease_owner=args[2] as string;
        c.lease_generation=args[3] as string;c.lease_expires_at=new Date(now()+120000);c.attempt_count++;
      } else {
        if(set.includes("state='UNKNOWN'"))c.command_state='UNKNOWN';
        if(set.includes("state='QUARANTINED'"))c.command_state='QUARANTINED';
        if(set.includes("state='RESOLVED'"))c.command_state='RESOLVED';
        c.lease_owner=null;c.lease_expires_at=null;
        if(sql.includes('next_attempt_at=clock_timestamp()+($2'))c.next_attempt_at=new Date(now()+Number(args[1])*1000);
      }
    }
    if(sql.startsWith('UPDATE inventory_claims')) {claims.push(sql);if(sql.includes('released_at='))c.claim_released_at=new Date(now());}
    if(sql.startsWith('UPDATE bookings')&&sql.includes("status='CONFIRMED'"))c.status='CONFIRMED';
    if(sql.startsWith('UPDATE')||sql.startsWith('INSERT'))writes.push(sql);
    return {rows:[],rowCount:1};
  });
  const release=vi.fn();const pool={query,connect:async()=>({query,release})} as unknown as Pool;
  const gateway={accountId:'acct_synthetic',retrieveSession:vi.fn(async()=>({...session})),
    retrievePaymentIntent:vi.fn(async()=>({...payment})),expireSession:vi.fn(async()=>({...session,status:'expired'})),
    findSessionForPaymentIntent:vi.fn(async()=>({...session})),createSession:vi.fn(async(request:CheckoutRequest)=>{void request;return {...session};}),verifyEvent:vi.fn()} satisfies StripeGateway;
  return {pool,gateway,c,session,payment,request,ledger,allocations,claims,writes,observations,query,release,
    intercept:(fn:typeof extra)=>{extra=fn;}};
}

describe('authoritative reconciliation exercised without external clients',()=>{
  it.each([false,true].flatMap(balance=>['throw','stale'].map(failure=>({balance,failure}))))(
    'keeps committed money idempotent through $failure metadata completion (balance=$balance)',async({balance,failure})=>{
    const f=fixture(balance);f.session.paymentStatus='paid';f.session.status='complete';f.session.paymentIntentId=f.payment.id;
    const recover=balance?recoverBalanceAttempts:recoverInitialAttempts;
    f.intercept(sql=>{
      if(sql.includes('finish_payment_recovery')) {
        if(failure==='throw')throw Error('metadata completion unknown');
        return {rows:[{finished:false}]};
      }
    });
    const first=await recover(f.pool,f.gateway,1,{random:()=>0});
    expect(first).toMatchObject({attempted:1,processed:0,financialSucceeded:1,failed:1,deferred:1,retried:0});
    expect(first.items[0]).toMatchObject({observation:'SUCCESS',result:balance?'PAID_IN_FULL':'CONFIRMED',scheduleCommitted:false});
    expect(f.c.attempt_state).toBe('SUCCEEDED');
    const writes=f.writes.length,reads=f.gateway.retrieveSession.mock.calls.length;
    // A later valid claim after lease expiry/takeover only retires the metadata.
    vi.setSystemTime(Date.now()+120001);f.intercept(undefined);
    const replay=await recover(f.pool,f.gateway,1,{random:()=>0});
    expect(replay).toMatchObject({processed:1,financialSucceeded:1,failed:0,retried:0});
    expect(replay.items[0]).toMatchObject({observation:'SUCCESS',scheduleCommitted:true});
    expect(f.writes).toHaveLength(writes);expect(f.gateway.retrieveSession).toHaveBeenCalledTimes(reads);
    // Even a direct authoritative replay deduplicates the original capture.
    expect(await (balance?reconcileBalanceAttempt:reconcileInitialAttempt)(f.pool,f.gateway,id)).toBe('ALREADY_RECORDED');
    expect(f.ledger).toHaveLength(1);expect(f.allocations).toHaveLength(1);
    expect(f.claims).toHaveLength(balance?0:1);
    await (balance?dispatchBalanceSessionCreate:dispatchSessionCreate)(f.pool,f.gateway,id,'worker_replay',urls);
    expect(f.gateway.createSession).not.toHaveBeenCalled();
    expect(f.c.idempotency_key).toBe('original-stripe-key');expect(f.c.request_params).toEqual(f.request);
  });
  it.each([false,true])('verifies capture and allocates once (balance=%s)',async balance=>{
    const f=fixture(balance);f.session.paymentStatus='paid';f.session.status='complete';f.session.paymentIntentId=f.payment.id;
    const reconcile=balance?reconcileBalanceAttempt:reconcileInitialAttempt;
    expect(await reconcile(f.pool,f.gateway,id)).toBe(balance?'PAID_IN_FULL':'CONFIRMED');
    expect(await reconcile(f.pool,f.gateway,id)).toBe('ALREADY_RECORDED');
    expect(f.ledger).toHaveLength(1);expect(f.allocations).toHaveLength(1);
    expect(f.claims).toHaveLength(balance?0:1);expect(f.c.attempt_state).toBe('SUCCEEDED');
    expect(f.gateway.retrieveSession).toHaveBeenCalledTimes(2);
  });
  it.each([false,true])('rejects wrong capture evidence and keeps inventory (balance=%s)',async balance=>{
    const f=fixture(balance);f.session.paymentStatus='paid';f.session.paymentIntentId=f.payment.id;f.payment.chargeAmount=1;
    expect(await (balance?reconcileBalanceAttempt:reconcileInitialAttempt)(f.pool,f.gateway,id)).toBe('RECONCILING');
    expect(f.ledger).toEqual([]);expect(f.claims).toEqual([]);
  });
  it.each([false,true])('reports caught provider errors separately from uncertainty (balance=%s)',async balance=>{
    const f=fixture(balance);f.gateway.retrieveSession.mockRejectedValue(Error('network unavailable'));
    const batch=await (balance?recoverBalanceAttempts:recoverInitialAttempts)(f.pool,f.gateway,1,{random:()=>0});
    expect(batch.items[0].observation).toBe('PROVIDER_ERROR');expect(batch.retried).toBe(1);
    expect(f.claims).toEqual([]);expect(f.ledger).toEqual([]);
    f.gateway.retrieveSession.mockResolvedValue({...f.session,status:'complete',paymentStatus:'unpaid'});
    const uncertain=await (balance?recoverBalanceAttempts:recoverInitialAttempts)(f.pool,f.gateway,1,{random:()=>0});
    expect(uncertain.items[0].observation).toBe('UNCERTAIN');expect(f.claims).toEqual([]);
  });
  it('balance terminal-unpaid recovery never releases confirmed accommodation',async()=>{
    const f=fixture(true);f.session.status='expired';
    expect(await reconcileBalanceAttempt(f.pool,f.gateway,id)).toBe('EXPIRED');
    expect(f.c.status).toBe('CONFIRMED');expect(f.claims).toEqual([]);
  });
  it('initial terminal-unpaid release requires retrieved provider evidence',async()=>{
    const f=fixture();f.session.status='expired';
    expect(await reconcileInitialAttempt(f.pool,f.gateway,id)).toBe('RELEASED');
    expect(f.claims).toHaveLength(1);expect(f.observations.some(p=>p.includes('TERMINAL_UNPAID'))).toBe(true);
  });
  it.each([false,true])('records late capture as money owed without restoring inventory (balance=%s)',async balance=>{
    const f=fixture(balance);f.c.status=balance?'CANCELLED_GUEST':'EXPIRED';f.c.claim_released_at=new Date(Date.now()-1000);
    f.session.status='complete';f.session.paymentStatus='paid';f.session.paymentIntentId=f.payment.id;
    expect(await (balance?reconcileBalanceAttempt:reconcileInitialAttempt)(f.pool,f.gateway,id)).toBe('UNALLOCATABLE');
    expect(f.ledger).toHaveLength(1);expect(f.allocations).toHaveLength(0);expect(f.claims).toHaveLength(0);
    expect(f.writes.some(sql=>sql.startsWith('INSERT INTO refund_obligations'))).toBe(true);
    expect(f.c.status).toBe(balance?'CANCELLED_GUEST':'EXPIRED');
  });
});

describe('original Session command and scheduling fences',()=>{
  it.each([false,true])('persists backoff and replays the exact request after unknown creation (balance=%s)',async balance=>{
    const f=fixture(balance);f.c.command_state='UNKNOWN';f.c.attempt_state='RECONCILING';f.c.session_id=null;
    const first=f.c.first_submitted_at;f.gateway.createSession.mockRejectedValue(Error('response unknown'));
    const dispatch=balance?dispatchBalanceSessionCreate:dispatchSessionCreate;
    expect(await dispatch(f.pool,f.gateway,id,'worker_a',urls)).toMatchObject({status:'PENDING',retryScheduled:true});
    expect(f.c.command_state).toBe('UNKNOWN');expect(f.c.next_attempt_at?.getTime()).toBe(Date.now()+60000);
    expect(f.gateway.createSession.mock.calls[0][0]).toEqual(f.request);
    await dispatch(f.pool,f.gateway,id,'worker_b',urls);expect(f.gateway.createSession).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now()+60001);
    await dispatch(f.pool,f.gateway,id,'worker_b',{successUrl:'http://localhost/changed',cancelUrl:'http://localhost/changed'});
    expect(f.gateway.createSession).toHaveBeenCalledTimes(2);
    expect(f.gateway.createSession.mock.calls[1][0]).toEqual(f.request);
    expect(f.c.first_submitted_at).toBe(first);expect(f.c.lease_generation).toBe('9007199254740999');
    expect(f.claims).toEqual([]);expect(f.ledger).toEqual([]);
  });
  it.each([false,true])('quarantines unsafe or missing first submission chronology (balance=%s)',async balance=>{
    for(const age of [86400000,null,86400000-5000]) {
      const f=fixture(balance);f.c.command_state='UNKNOWN';f.c.attempt_state='RECONCILING';f.c.session_id=null;
      f.c.first_submitted_at=age===null?null:new Date(Date.now()-age);
      expect(await (balance?dispatchBalanceSessionCreate:dispatchSessionCreate)(f.pool,f.gateway,id,'worker_a',urls))
        .toMatchObject({status:'QUARANTINED'});
      expect(f.gateway.createSession).not.toHaveBeenCalled();expect(f.c.command_state).toBe('QUARANTINED');
      expect(f.claims).toEqual([]);
    }
  });
  it.each([false,true])('ignores a stale completion after command takeover (balance=%s)',async balance=>{
    const f=fixture(balance);f.c.command_state='UNKNOWN';f.c.session_id=null;
    f.gateway.createSession.mockImplementation(async()=>{
      f.c.lease_generation=String(BigInt(f.c.lease_generation)+1n);f.c.lease_owner='worker_b';return {...f.session};
    });
    expect(await (balance?dispatchBalanceSessionCreate:dispatchSessionCreate)(f.pool,f.gateway,id,'worker_a',urls)).toMatchObject({status:'PENDING'});
    expect(f.c.command_state).toBe('SUBMITTED');expect(f.c.lease_owner).toBe('worker_b');expect(f.ledger).toEqual([]);
  });
  it.each([false,true])('quarantines missing persisted request and respects database due time under clock skew (balance=%s)',async balance=>{
    const dispatch=balance?dispatchBalanceSessionCreate:dispatchSessionCreate;
    const missing=fixture(balance);missing.c.command_state='UNKNOWN';missing.c.session_id=null;missing.c.request_params=null;
    expect(await dispatch(missing.pool,missing.gateway,id,'worker_a',urls)).toMatchObject({status:'QUARANTINED'});
    expect(missing.gateway.createSession).not.toHaveBeenCalled();
    const f=fixture(balance),databaseTime=Date.now();f.c.command_state='UNKNOWN';f.c.session_id=null;
    f.c.next_attempt_at=new Date(databaseTime+60000);
    Object.defineProperty(f.c,'command_now',{get:()=>new Date(databaseTime)});
    vi.setSystemTime(databaseTime+600000);
    expect(await dispatch(f.pool,f.gateway,id,'worker_a',urls)).toMatchObject({status:'PENDING'});
    expect(f.gateway.createSession).not.toHaveBeenCalled();
  });
  it('isolates a command exception and selects only due enrolled commands',async()=>{
    const f=fixture();f.c.command_state='UNKNOWN';f.c.session_id=null;f.gateway.createSession.mockRejectedValue(Error('unknown'));
    f.intercept((sql,args)=>{
      if(sql.includes('ORDER BY COALESCE(pc.next_attempt_at'))return {rows:[
        {id:'bad-command',payment_attempt_id:'bad-attempt',hold_id:id},{id,payment_attempt_id:id,hold_id:id}]};
      if(sql.includes('SELECT b.id booking_id')&&args[0]==='bad-attempt')return {rows:[]};
      if(sql.startsWith('UPDATE provider_commands')&&args[0]==='bad-command')return {rows:[],rowCount:1};
    });
    const batch=await recoverSessionCommands(f.pool,f.gateway,'worker_a',urls,2,{random:()=>0});
    expect(batch.attempted).toBe(2);expect(batch.failed).toBe(1);expect(batch.retried).toBe(2);
    expect(f.gateway.createSession).toHaveBeenCalledOnce();
    const selection=f.query.mock.calls[0][0];expect(selection).toContain('a.recovery_enabled');
    expect(selection).toContain('pc.next_attempt_at<=clock_timestamp()');
  });
});

type InboxRow={id:string;event_type:string;object_type:string;object_id:string;state:string;attempts:number;
  owner:string|null;until:number;next:number;deliveries:number};
function inbox(f:ReturnType<typeof fixture>,events:InboxRow[]) {
  const allowed=(e:InboxRow,sql:string,args:unknown[])=>{
    expect(sql).toContain("object_type='checkout.session'");expect(sql).toContain("object_type='payment_intent'");
    const types=(e.object_type==='checkout.session'?args[0]:e.object_type==='payment_intent'?args[1]:[]) as string[];
    return types.includes(e.event_type);
  };
  f.intercept((sql,args)=>{
    if(sql.startsWith('INSERT INTO stripe_webhook_events')) {
      const existing=events.find(e=>e.id===args[1]);if(existing){existing.deliveries++;return {rows:[{id:existing.id,inserted:false}]};}
      events.push({id:args[1] as string,event_type:args[2] as string,object_type:args[3] as string,object_id:args[4] as string,
        state:args[7] as string,attempts:0,owner:null,until:0,next:0,deliveries:1});
      return {rows:[{id:args[1],inserted:true}]};
    }
    if(sql.includes('WITH stale AS MATERIALIZED')) {
      expect(sql).toContain('LIMIT 2 FOR UPDATE SKIP LOCKED');
      const selected=events.filter(e=>allowed(e,sql,args)&&e.state==='PROCESSING'&&e.until<=Date.now()&&e.attempts>=5).slice(0,2);
      for(const e of selected){e.state='INVESTIGATE';e.owner=null;e.until=0;}return {rows:[],rowCount:selected.length};
    }
    if(sql.startsWith('WITH due AS')) {
      const e=events.find(e=>allowed(e,sql,args)&&e.attempts<5&&
        ((['PENDING','RETRY'].includes(e.state)&&e.next<=Date.now())||(e.state==='PROCESSING'&&e.until<=Date.now())));
      if(!e)return {rows:[]};
      e.state='PROCESSING';e.owner=args[3] as string;e.until=Date.now()+120000;e.attempts++;
      return {rows:[{id:e.id,object_type:e.object_type,object_id:e.object_id,processing_attempts:e.attempts}]};
    }
    if(sql.startsWith('WITH owned AS MATERIALIZED')) {
      const e=events.find(e=>e.id===args[0]);
      if(!e||e.owner!==args[1]||e.attempts!==args[2]||e.state!=='PROCESSING'||e.until<=Date.now())return {rows:[],rowCount:0};
      e.state=args[3] as string;e.owner=null;e.until=0;e.next=e.state==='RETRY'?Date.now()+Number(args[4])*1000:0;
      return {rows:[],rowCount:1};
    }
  });
}
function event(name:string,type='checkout.session.completed',object='checkout.session'):InboxRow {
  return {id:name,event_type:type,object_type:object,object_id:'cs_test_synthetic',state:'PENDING',attempts:0,
    owner:null,until:0,next:0,deliveries:1};
}
describe('bounded payment-only durable inbox',()=>{
  it('deduplicates delivery and processes out-of-order events through current objects once',async()=>{
    const f=fixture();const events:InboxRow[]=[];inbox(f,events);
    f.gateway.verifyEvent.mockReturnValue({id:'evt_paid',type:'checkout.session.completed',objectType:'checkout.session',
      objectId:'cs_test_synthetic',created:Math.floor(Date.now()/1000),livemode:false,accountId:f.gateway.accountId});
    expect((await ingestStripeWebhook(f.pool,f.gateway,Buffer.from('{}'),'synthetic-signature')).duplicate).toBe(false);
    expect((await ingestStripeWebhook(f.pool,f.gateway,Buffer.from('{}'),'synthetic-signature')).duplicate).toBe(true);
    events.push(event('evt_expired','checkout.session.expired'));
    f.session.status='complete';f.session.paymentStatus='paid';f.session.paymentIntentId=f.payment.id;
    const result=await processPaymentWebhookInbox(f.pool,f.gateway,2,{random:()=>0});
    expect(result.processed).toBe(2);expect(events[0].deliveries).toBe(2);
    expect(f.ledger).toHaveLength(1);expect(f.allocations).toHaveLength(1);
    expect(f.gateway.retrieveSession).toHaveBeenCalledTimes(2);expect(f.claims).toHaveLength(1);
  });
  it('excludes refunds, charges, wrong pairs and investigation states before housekeeping and claims',async()=>{
    const f=fixture();const excluded=[event('refund','refund.updated','refund'),event('charge','charge.refunded','charge'),
      event('wrong-pair','checkout.session.completed','charge'),event('async','checkout.session.async_payment_succeeded'),
      Object.assign(event('investigate'),{state:'INVESTIGATE'}),Object.assign(event('quarantined'),{state:'QUARANTINED'})];
    excluded[0].state='PROCESSING';excluded[0].attempts=8;const before=structuredClone(excluded);
    const stale=Array.from({length:4},(_,i)=>Object.assign(event(`stale-${i}`),{state:'PROCESSING',attempts:5}));
    inbox(f,[...excluded,...stale,event('payment')]);
    const result=await processPaymentWebhookInbox(f.pool,f.gateway,1,{random:()=>0});
    expect(result.housekept).toBe(2);expect(result.attempted).toBe(1);expect(excluded).toEqual(before);
    expect(stale.filter(e=>e.state==='INVESTIGATE')).toHaveLength(2);
  });
  it('advances retrieval failures, enforces retry cap and refuses stale completion',async()=>{
    const f=fixture();const events=[event('retry')];inbox(f,events);f.gateway.retrieveSession.mockRejectedValue(Error('unknown'));
    const first=await processPaymentWebhookInbox(f.pool,f.gateway,2,{random:()=>0});
    expect(first.retried).toBe(1);expect(first.processed).toBe(0);expect(events[0].next).toBe(Date.now()+30000);
    events[0].attempts=4;vi.setSystemTime(Date.now()+30000);
    const last=await processPaymentWebhookInbox(f.pool,f.gateway,1,{random:()=>0});
    expect(last.investigationRequired).toBe(1);expect(events[0].state).toBe('INVESTIGATE');
    events[0].state='RETRY';events[0].attempts=0;events[0].next=0;
    f.gateway.retrieveSession.mockImplementation(async()=>{events[0].owner='takeover-worker';events[0].attempts++;return {...f.session};});
    const stale=await processPaymentWebhookInbox(f.pool,f.gateway,1,{random:()=>0});
    expect(stale.processed).toBe(0);expect(stale.deferred).toBe(1);expect(events[0].owner).toBe('takeover-worker');
  });
});
