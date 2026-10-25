/** Explicit offline validation only. Not a smoke stage and not part of npm test. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Socket } from 'node:net';
import type { RefundRequest } from '../src/server/refund-worker';

async function validate() {
// Import safety and pure checks must not establish any provider/database connection.
const originalConnect=Socket.prototype.connect;
Socket.prototype.connect=function(){throw new Error('Offline validation attempted network access');} as typeof originalConnect;
const directoryExisted=existsSync('.local/stripe-refund-smoke');
try {
  const {parseStage,settings,stateSchema,assertRefundRequest,firstRefundSubmission,finalResult,captureHash}=await import('./stripe-refund-smoke');
  type State=import('./stripe-refund-smoke').State;
  type Snapshot=import('./stripe-refund-smoke').Snapshot;
  type FinalEvidence=import('./stripe-refund-smoke').FinalEvidence;
  let checks=0;
  const check=(run:()=>void)=>{run();checks++;};
  const env={NODE_ENV:'development' as const,DATABASE_URL:'postgresql://zemaitija_app:synthetic@127.0.0.1:5432/synthetic_dev',
    MIGRATION_DATABASE_URL:'postgresql://zemaitija_migrator:synthetic@127.0.0.1:5432/synthetic_dev',
    STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_ACCOUNT_ID:'acct_synthetic',SMOKE_EXPECTED_STRIPE_ACCOUNT_ID:'acct_synthetic',
    STRIPE_SUCCESS_URL:'http://localhost:3000/return',STRIPE_CANCEL_URL:'http://localhost:3000/cancel',
    SMOKE_REFUND_ARRIVAL_DATE:'2027-05-17',SMOKE_REFUND_DEPARTURE_DATE:'2027-05-19',SMOKE_REFUND_EXPECTED_INITIAL_CENTS:'6000'};
  for(const stage of ['preflight','start','cancel','refund','verify'])check(()=>assert.equal(parseStage([stage,'--local-sandbox-only']),stage));
  for(const args of [[],['refund'],['refund','--live'],['refund','--local-sandbox-only','--force']])check(()=>assert.throws(()=>parseStage(args)));
  check(()=>assert.equal(settings(env).expectedInitial,'6000'));
  for(const patch of [{NODE_ENV:'production'},{CI:'1'},{STRIPE_SECRET_KEY:'sk_live_synthetic'},{SMOKE_EXPECTED_STRIPE_ACCOUNT_ID:'acct_different'},
    {DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1','remote.example')},{DATABASE_URL:env.DATABASE_URL.replace('synthetic_dev','production')},
    {DATABASE_URL:env.DATABASE_URL.replace('zemaitija_app','zemaitija_migrator')},{MIGRATION_DATABASE_URL:env.MIGRATION_DATABASE_URL+'?options=unsafe'},
    {MIGRATION_DATABASE_URL:env.MIGRATION_DATABASE_URL.replace('5432','5433')},{STRIPE_SUCCESS_URL:'https://public.example/return'},
    {PGOPTIONS:'unsafe'},{SMOKE_REFUND_EXPECTED_INITIAL_CENTS:'10001'}] as Partial<NodeJS.ProcessEnv>[])check(()=>assert.throws(()=>settings({...env,...patch})));
  const ids=Array.from({length:20},()=>randomUUID());
  const s:State={version:1,runId:ids[0],guestId:ids[1],adminId:ids[2],operationKey:`refund-smoke:${ids[0]}`,preparedAt:'2026-10-25T12:00:00.000Z',
    stripeAccount:'acct_synthetic',database:{name:'synthetic_dev',address:'127.0.0.1',port:5432},protectedHash:'a'.repeat(64),unitId:ids[3],unitKey:'forest-cottage',
    arrivalDate:'2027-05-17',departureDate:'2027-05-19',initialCents:'6000',totalCents:'20000',
    accepted:{bookingId:ids[4],holdId:ids[5],attemptId:ids[6],commandId:ids[7],claimId:ids[8]},
    capture:{id:ids[9],paymentIntentId:'pi_synthetic_new',chargeId:'ch_synthetic_new',hash:'b'.repeat(64)},refundIntentAt:'2026-10-25T12:01:00.000Z',
    refund:{obligationId:ids[10],attemptId:ids[11],commandId:ids[12]}};
  check(()=>assert.equal(stateSchema.parse(s).runId,s.runId));
  check(()=>assert.equal(stateSchema.safeParse({...s,accepted:{...s.accepted,bookingId:'566264cc-b0ca-4511-9434-6a26a0dabd8c'}}).success,false));
  check(()=>assert.equal(stateSchema.safeParse({...s,operationKey:'some-other-run'}).success,false));
  const q:RefundRequest={attemptId:ids[11],commandId:ids[12],obligationId:ids[10],paymentRecordId:ids[9],paymentIntentId:s.capture!.paymentIntentId,
    chargeId:s.capture!.chargeId,amountCents:6000,captureCents:6000,idempotencyKey:`refund:${ids[11]}`};
  check(()=>assert.doesNotThrow(()=>assertRefundRequest(s,q)));
  for(const patch of [{amountCents:6001},{chargeId:'ch_another'},{paymentIntentId:'pi_another'},{idempotencyKey:'fresh-key'},{attemptId:randomUUID()}])
    check(()=>assert.throws(()=>assertRefundRequest(s,{...q,...patch})));
  check(()=>assert.equal(firstRefundSubmission({state:'REQUESTED'},{state:'PENDING',first_submitted_at:null,attempt_count:0}),true));
  for(const command of [{state:'UNKNOWN',first_submitted_at:new Date(),attempt_count:1},{state:'UNKNOWN',first_submitted_at:null,attempt_count:1},
    {state:'QUARANTINED',first_submitted_at:new Date(0),attempt_count:1},{state:'PENDING',first_submitted_at:new Date(),attempt_count:0}])
    check(()=>assert.equal(firstRefundSubmission({state:'PROCESSING'},command),false));
  const cancelledAt=new Date('2026-10-25T12:01:00Z'),captureRec=ids[13],refundRec=ids[14];
  const actions=['quote.accepted','booking.confirmed','booking.cancelled_guest','refund.requested','refund.succeeded'];
  const audits=actions.map((action,i)=>({id:ids[15+i],action,entity_id:action.startsWith('refund.')?ids[11]:ids[4],admin_user_id:action==='refund.requested'?s.adminId:null,
    guest_id:action==='booking.cancelled_guest'?s.guestId:null,amount_cents:action==='booking.cancelled_guest'?'0':'6000',
    details:action==='refund.requested'?{authorizationRef:`refund-smoke-operator:${s.runId}`}:
      action==='booking.cancelled_guest'?{authorizationRef:`refund-smoke-guest:${s.runId}`}:{}}));
  const x:Snapshot={booking:{id:ids[4],guest_id:s.guestId,unit_id:s.unitId,status:'CANCELLED_GUEST',cancelled_at:cancelledAt,
      balance_due_at:new Date('2027-05-03T12:00:00Z'),accepted_at:new Date(s.preparedAt)},
    attempts:[{id:ids[6],booking_id:ids[4],obligation_id:randomUUID(),hold_id:ids[5],state:'SUCCEEDED',expected_cents:'6000',stripe_session_id:'cs_test_synthetic',stripe_payment_intent_id:s.capture!.paymentIntentId}],
    holds:[{id:ids[5],state:'CONSUMED',payment_attempt_id:ids[6]}],
    claims:[{id:ids[8],hold_id:null,booking_id:ids[4],origin_hold_id:ids[5],released_at:cancelledAt,release_reason:'CANCELLATION_RECONCILED'}],
    captures:[{id:ids[9],attempt_id:ids[6],booking_id:ids[4],obligation_id:'',stripe_payment_intent_id:s.capture!.paymentIntentId,stripe_charge_id:s.capture!.chargeId,
      captured_cents:'6000',currency:'EUR',allocation_state:'ALLOCATED',refund_encumbered_cents:'6000',reconciliation_id:captureRec}],allocations:[],
    assessments:[{id:randomUUID(),state:'NOT_REQUIRED',reason:'GUEST_EARLY',cap_cents:'0',current_revision_no:null,cancelled_at:cancelledAt}],
    obligations:[{id:ids[10],source_payment_record_id:ids[9],amount_cents:'6000',refund_encumbered_cents:'6000',reason:'GUEST_EARLY'}],
    refundAttempts:[{id:ids[11],obligation_id:ids[10],payment_record_id:ids[9],state:'SUCCEEDED',requested_cents:'6000',stripe_refund_id:'re_synthetic'}],
    commands:[{id:ids[12],state:'RESOLVED',payment_attempt_id:null,refund_attempt_id:ids[11],kind:'REFUND_CREATE',logical_key:q.idempotencyKey,
      stripe_idempotency_key:q.idempotencyKey,first_submitted_at:new Date(s.refundIntentAt!),attempt_count:1,created_at:new Date(s.refundIntentAt!),request_params:q}],
    refunds:[{id:randomUUID(),refund_attempt_id:ids[11],payment_record_id:ids[9],stripe_refund_id:'re_synthetic',refunded_cents:'6000',currency:'EUR',reconciliation_id:refundRec}],audits,
    notices:[['BOOKING_CONFIRMED','GUEST','booking.confirmed'],['CANCELLED_GUEST','GUEST','booking.cancelled_guest'],['CANCELLED_GUEST','OPERATIONS','booking.cancelled_guest'],['REFUND_SUCCEEDED','GUEST','refund.succeeded']]
      .map(([event_type,recipient_kind,action])=>({id:randomUUID(),event_type,recipient_kind,recipient_ref:recipient_kind==='GUEST'?s.guestId:null,locale:'en',state:'QUEUED',source_audit_event_id:audits.find(a=>a.action===action)!.id})),
    incidents:0,reconciliations:[{id:captureRec,payment_attempt_id:ids[6],refund_attempt_id:null,provider_object_id:'cs_test_synthetic',provider_state:'complete',evidence_kind:'STRIPE_CURRENT',result:'VERIFIED_INITIAL',amount_cents:'6000',currency:'EUR'},
      {id:refundRec,payment_attempt_id:null,refund_attempt_id:ids[11],provider_object_id:'re_synthetic',provider_state:'succeeded',evidence_kind:'STRIPE_CURRENT',result:'REFUND_SUCCEEDED',amount_cents:'6000',currency:'EUR'}]};
  x.captures[0].obligation_id=x.attempts[0].obligation_id;
  x.allocations=[{payment_record_id:ids[9],obligation_id:x.attempts[0].obligation_id,amount_cents:'6000'}];s.capture!.hash=captureHash(x.captures[0]);
  const e:FinalEvidence={providerRefunds:[{id:'re_synthetic',accountId:s.stripeAccount,livemode:false,paymentIntentId:s.capture!.paymentIntentId,chargeId:s.capture!.chargeId,
    amount:6000,currency:'eur',status:'succeeded',metadata:{attemptId:ids[11],commandId:ids[12],obligationId:ids[10],paymentRecordId:ids[9]}}],
    signedPaymentCount:1,signedRefundCount:1,protectedUnchanged:true,position:{position:'REFUNDED_FULL',paidCents:6000n,outstandingCents:0n,refundedCents:6000n,refundDueCents:0n,additionalChargeReviewCents:0n}};
  check(()=>assert.equal(finalResult(s,x,e).outcome,'PASS'));
  check(()=>assert.equal(finalResult(s,x,{...e,signedPaymentCount:0}).outcome,'PAYMENT_CONFIRMED_WEBHOOK_MISSING'));
  check(()=>assert.equal(finalResult(s,x,{...e,signedRefundCount:0}).outcome,'REFUND_CONFIRMED_WEBHOOK_MISSING'));
  check(()=>assert.throws(()=>finalResult(s,x,{...e,protectedUnchanged:false})));
  check(()=>assert.throws(()=>finalResult(s,x,{...e,providerRefunds:[...e.providerRefunds,...e.providerRefunds]})));
  check(()=>assert.throws(()=>finalResult(s,{...x,refunds:[...x.refunds,...x.refunds]},e)));
  check(()=>assert.throws(()=>finalResult(s,{...x,notices:[]},e)));
  check(()=>assert.throws(()=>finalResult(s,{...x,claims:[{...x.claims[0],released_at:null}]},e)));
  check(()=>assert.throws(()=>finalResult(s,{...x,captures:[{...x.captures[0],captured_cents:'6001'}]},e)));
  check(()=>assert.throws(()=>finalResult(s,x,{...e,position:{...e.position!,refundDueCents:1n}})));
  check(()=>assert.throws(()=>finalResult(s,{...x,reconciliations:x.reconciliations.filter(r=>r.id!==refundRec)},e)));
  check(()=>assert.equal(finalResult(s,{...x,refundAttempts:[{...x.refundAttempts[0],state:'PROCESSING'}],refunds:[]},
    {...e,providerRefunds:[{...e.providerRefunds[0],status:'pending'}]}).outcome,'PENDING_REFUND'));
  check(()=>assert.equal(finalResult(s,{...x,commands:[{...x.commands[0],state:'QUARANTINED'}]},e).outcome,'QUARANTINED'));
  assert.equal(existsSync('.local/stripe-refund-smoke'),directoryExisted,'Validation must not create local smoke state');
  console.log(`PASS: ${checks} offline safety/evidence checks; no smoke stage, database connection or provider call executed.`);
}finally{Socket.prototype.connect=originalConnect;}

}
validate().catch(()=>{console.error("FAIL: offline refund smoke validation");process.exitCode=1;});
