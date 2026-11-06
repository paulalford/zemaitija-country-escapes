import 'server-only';
import { z } from 'zod';
import { canonicalRunJson, runManifestDigest, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { acceptanceManifestBinding, requireAcceptanceFixturePlan, type AcceptanceFixturePlan } from './stripe-acceptance-fixtures';

const uuid=z.uuid(),instant=z.string().datetime({precision:3}),hash=z.string().regex(/^[a-f0-9]{64}$/);
const cents=z.number().int().nonnegative().max(500000),count=z.number().int().nonnegative().max(100000);
const nullableTime=instant.nullable();
const bookingState=z.enum(['AWAITING_INITIAL_PAYMENT','CONFIRMED','EXPIRED','CANCELLED_GUEST','CANCELLED_NONPAYMENT','CANCELLED_PROVIDER','COMPLETED']);
const holdState=z.enum(['CREATING','ACTIVE','RECONCILING','CONSUMED','RELEASED']);
const attemptState=z.enum(['CREATING','OPEN','RECONCILING','SUCCEEDED','FAILED','EXPIRED']);
const commandState=z.enum(['PENDING','SUBMITTED','UNKNOWN','QUARANTINED','RESOLVED']);
const ids=z.object({bookingId:uuid,holdId:uuid,attemptId:uuid,commandId:uuid,snapshotId:uuid,obligationId:uuid,claimId:uuid}).strict();
const snapshotSchema=z.object({runId:uuid,manifestDigest:hash,planDigest:hash,fixtureId:uuid,namespace:z.string(),
  database:z.string(),role:z.literal('zec_acceptance_status_reader'),readOnly:z.literal(true),
  isolation:z.literal('REPEATABLE READ'),complete:z.literal(true),settled:z.literal(true),observedAt:instant,transactionId:z.string().regex(/^\d{1,24}$/),
  binding:ids,guestId:uuid,unitId:uuid,operationKey:z.string(),currency:z.literal('EUR'),
  booking:z.object({id:uuid,guestId:uuid,unitId:uuid,state:bookingState}).strict(),
  hold:z.object({id:uuid,bookingId:uuid,attemptId:uuid,state:holdState}).strict(),
  obligation:z.object({id:uuid,bookingId:uuid,kind:z.literal('INITIAL'),amountCents:cents}).strict(),
  price:z.object({id:uuid,bookingId:uuid,totalCents:cents,initialCents:cents,balanceCents:cents}).strict(),
  attempt:z.object({id:uuid,bookingId:uuid,obligationId:uuid,holdId:uuid,state:attemptState,expectedCents:cents,
    sessionId:z.string().regex(/^cs_test_[A-Za-z0-9]+$/).nullable(),checkoutUrl:z.string().max(2048).nullable(),
    sessionCreatedAt:nullableTime,sessionExpiresAt:nullableTime,recoveryEnabled:z.literal(true),recoveryNextAt:nullableTime,
    recoveryLeaseUntil:nullableTime,recoveryFailures:count}).strict(),
  command:z.object({id:uuid,attemptId:uuid,kind:z.literal('SESSION_CREATE'),state:commandState,logicalKey:z.string(),
    idempotencyKey:z.string(),requestPersisted:z.boolean(),firstSubmittedAt:nullableTime,leaseOwner:z.string().regex(/^[A-Za-z0-9:_-]{8,100}$/).nullable(),
    leaseUntil:nullableTime,leaseGeneration:z.string().regex(/^(0|[1-9]\d{0,18})$/)
      .refine(s=>BigInt(s)<=9223372036854775807n),attemptCount:count}).strict(),
  claim:z.object({id:uuid,unitId:uuid,holdId:uuid.nullable(),bookingId:uuid.nullable(),originHoldId:uuid.nullable(),
    releasedAt:nullableTime,activeClaimCount:count}).strict(),
  payments:z.array(z.object({id:uuid,attemptId:uuid,bookingId:uuid,obligationId:uuid,amountCents:cents,
    paymentIntentId:z.string().regex(/^pi_[A-Za-z0-9]+$/),chargeId:z.string().regex(/^ch_[A-Za-z0-9]+$/),
    reconciliationId:uuid,allocationState:z.literal('ALLOCATED')}).strict()).max(2),
  allocations:z.array(z.object({id:uuid,paymentId:uuid,obligationId:uuid,amountCents:cents}).strict()).max(2),
  provider:z.object({observation:z.enum(['NONE','PROCESSING','VERIFIED_CAPTURE','TERMINAL_UNPAID','NEVER_SUBMITTED']),
    source:z.enum(['NONE','SIGNED_WEBHOOK_AND_RECONCILIATION','RECOVERY_RECONCILIATION']),accountId:z.string(),livemode:z.literal(false),
    paymentIntentId:z.string().nullable(),chargeId:z.string().nullable(),sessionId:z.string().nullable(),amountCents:cents,
    reconciliationId:uuid.nullable(),verifiedAt:nullableTime,webhookEventId:uuid.nullable(),recoveryInvocationId:uuid.nullable()}).strict(),
  confirmations:z.array(z.object({id:uuid,bookingId:uuid,action:z.literal('booking.confirmed')}).strict()).max(2),
  notices:z.array(z.object({id:uuid,bookingId:uuid,auditId:uuid,event:z.literal('BOOKING_CONFIRMED'),key:z.string()}).strict()).max(2),
  events:z.object({verifiedPaymentEvents:count,duplicateDeliveries:count,outOfOrderObserved:z.boolean(),conflictingDigests:count}).strict(),
  investigationCount:count,unresolvedRefundLiabilities:count,delayedCommandObserved:z.boolean(),
}).strict();
export type AcceptanceStatusSnapshot=z.input<typeof snapshotSchema>;
export interface AcceptanceReadOnlyStatusAdapter {
  readonly kind:'acceptance-status-read-only-v1';
  /** Fixed read model only; no SQL text, callback, write handle or pool is accepted.
   * Future adapter must enforce a restricted read-only DB role and consistent view. */
  read(binding:Readonly<{runId:string;manifestDigest:string;planDigest:string;fixtureId:string;database:string}>):Promise<unknown>;
}
export interface AcceptanceStatusAuthority {
  verify(binding:Readonly<{runId:string;manifestDigest:string;planDigest:string;fixtureId:string;operation:'verify-read-only'}>):Promise<unknown>;
}
const grantSchema=z.object({status:z.literal('READ_ONLY_VERIFIED'),runId:uuid,manifestDigest:hash,planDigest:hash,fixtureId:uuid,
  operation:z.literal('verify-read-only'),targetVerified:z.literal(true),reservationVerified:z.literal(true),
  notBefore:instant,expiresAt:instant}).strict();
export type AcceptanceProgress='COMMAND_PENDING'|'COMMAND_PROCESSING'|'CHECKOUT_READY'|'PAYMENT_PENDING'|'PAYMENT_CONFIRMED'|
  'RECOVERY_PENDING'|'INVESTIGATION_REQUIRED'|'TERMINAL'|'TIMED_OUT'|'UNKNOWN';
type Diagnostic='STATUS_OBSERVED'|'UNAUTHORIZED'|'INVALID_TARGET_OR_PLAN'|'QUERY_ADAPTER_UNAVAILABLE'|'QUERY_UNAVAILABLE'|
  'FOREIGN_RECORD'|'INCOMPLETE_OR_STALE'|'CONTRADICTORY_EVIDENCE';
export type AcceptanceStatusResult=Readonly<{status:'OBSERVED'|'UNAVAILABLE'|'REJECTED';progress:AcceptanceProgress;diagnostic:Diagnostic;
  payment:Readonly<{state:string;captureVerified:boolean}>;inventoryHold:Readonly<{state:string}>;
  booking:Readonly<{state:string;confirmationVerified:boolean}>;
  provenance?:Readonly<{runId:string;manifestDigest:string;planDigest:string;fixtureId:string;observedAt:string;transactionId:string;snapshotDigest:string}>;
  checkout?:Readonly<{sessionId:string;url:string}>;scenarioEvidenceComplete?:boolean}>;
const unknown=(status:'UNAVAILABLE'|'REJECTED',diagnostic:Diagnostic):AcceptanceStatusResult=>Object.freeze({status,progress:'UNKNOWN',diagnostic,
  payment:Object.freeze({state:'UNKNOWN',captureVerified:false}),inventoryHold:Object.freeze({state:'UNKNOWN'}),
  booking:Object.freeze({state:'UNKNOWN',confirmationVerified:false})});
function checkoutUrl(value:string) {
  const u=new URL(value);
  if(u.protocol!=='https:'||u.hostname!=='checkout.stripe.com'||u.port||u.username||u.password)throw Error('UNSAFE_URL');
  return u.href;
}

/** Read only. No acceptance, dispatch, reconciliation, provider or writer imports. */
export async function inspectAcceptanceStatus(run:SealedAcceptanceRun,plan:AcceptanceFixturePlan,fixtureId:string,
  deps:{now:()=>number;authority:AcceptanceStatusAuthority;query?:AcceptanceReadOnlyStatusAdapter}):Promise<AcceptanceStatusResult> {
  let diagnostic:Diagnostic='INVALID_TARGET_OR_PLAN';
  try {
    requireAcceptanceFixturePlan(run,plan);const binding=acceptanceManifestBinding(run),fixture=plan.fixtures.find(f=>f.fixtureId===fixtureId);
    if(!fixture||!run.operations.includes('verify-read-only'))return unknown('REJECTED',diagnostic);
    diagnostic='UNAUTHORIZED';
    const grant=grantSchema.parse(await deps.authority.verify({...binding,planDigest:plan.planDigest,fixtureId,operation:'verify-read-only'}));
    const checkTime=()=>{
      const n=deps.now();if(!Number.isSafeInteger(n)||n<Date.parse(run.notBefore)||n>=Date.parse(run.expiresAt)||
        n<Date.parse(grant.notBefore)||n>=Date.parse(grant.expiresAt)||Date.parse(grant.notBefore)<Date.parse(run.notBefore)||
        Date.parse(grant.expiresAt)>Date.parse(run.expiresAt))throw Error('EXPIRED');return n;
    };
    checkTime();
    if(grant.runId!==run.runId||grant.manifestDigest!==binding.manifestDigest||grant.planDigest!==plan.planDigest||grant.fixtureId!==fixtureId)
      return unknown('REJECTED',diagnostic);
    diagnostic='QUERY_ADAPTER_UNAVAILABLE';
    const adapter=deps.query;
    if(!adapter||adapter.kind!=='acceptance-status-read-only-v1'||typeof adapter.read!=='function'||
      Reflect.ownKeys(adapter).some(k=>k!=='kind'&&k!=='read')||Object.getPrototypeOf(adapter)!==Object.prototype)
      return unknown('UNAVAILABLE',diagnostic);
    diagnostic='QUERY_UNAVAILABLE';
    const raw=await adapter.read(Object.freeze({...binding,planDigest:plan.planDigest,fixtureId}));
    diagnostic='UNAUTHORIZED';const now=checkTime();
    diagnostic='INCOMPLETE_OR_STALE';const s=snapshotSchema.parse(raw);
    if(now<Date.parse(s.observedAt)||now-Date.parse(s.observedAt)>30000)return unknown('UNAVAILABLE',diagnostic);
    diagnostic='FOREIGN_RECORD';
    if(s.runId!==run.runId||s.manifestDigest!==binding.manifestDigest||s.planDigest!==plan.planDigest||s.fixtureId!==fixtureId||
      s.namespace!==fixture.namespace||s.database!==run.target.database||s.guestId!==fixture.guest.id||s.unitId!==fixture.stay.unitId||
      s.operationKey!==fixture.operationKey)return unknown('REJECTED',diagnostic);
    diagnostic='CONTRADICTORY_EVIDENCE';
    const b=s.binding,a=s.attempt,c=s.command,h=s.hold,claim=s.claim,p=s.payments[0],allocation=s.allocations[0],provider=s.provider;
    if(s.booking.id!==b.bookingId||s.booking.guestId!==s.guestId||s.booking.unitId!==s.unitId||h.id!==b.holdId||h.bookingId!==b.bookingId||
      h.attemptId!==b.attemptId||s.obligation.id!==b.obligationId||s.obligation.bookingId!==b.bookingId||s.price.id!==b.snapshotId||
      s.price.bookingId!==b.bookingId||a.id!==b.attemptId||a.bookingId!==b.bookingId||a.obligationId!==b.obligationId||a.holdId!==b.holdId||
      c.id!==b.commandId||c.attemptId!==b.attemptId||claim.id!==b.claimId||claim.unitId!==s.unitId||
      c.idempotencyKey!==`session-create:${b.attemptId}`||c.logicalKey!==fixture.expected.logicalKey||
      s.price.totalCents!==fixture.expected.totalCents||s.price.initialCents!==fixture.expected.initialCents||
      s.price.balanceCents!==fixture.expected.balanceCents||a.expectedCents!==s.obligation.amountCents||a.expectedCents!==s.price.initialCents||
      (c.leaseOwner===null)!==(c.leaseUntil===null)||c.leaseOwner!==null&&BigInt(c.leaseGeneration)===0n||
      c.firstSubmittedAt!==null&&Date.parse(c.firstSubmittedAt)>Date.parse(s.observedAt)||
      s.payments.length>1||s.allocations.length>1||s.confirmations.length>1||s.notices.length>1||
      provider.accountId!==run.stripe.accountId)return unknown('UNAVAILABLE',diagnostic);
    if(p&&(p.attemptId!==b.attemptId||p.bookingId!==b.bookingId||p.obligationId!==b.obligationId||p.amountCents!==a.expectedCents)||
      allocation&&(!p||allocation.paymentId!==p.id||allocation.obligationId!==b.obligationId||allocation.amountCents!==a.expectedCents)||
      s.confirmations.some(x=>x.bookingId!==b.bookingId)||s.notices.some(x=>x.bookingId!==b.bookingId||
        x.key!==`booking-confirmed:${b.bookingId}`||x.auditId!==s.confirmations[0]?.id))return unknown('UNAVAILABLE',diagnostic);
    const transferred=claim.holdId===null&&claim.bookingId===b.bookingId&&claim.originHoldId===b.holdId&&
      claim.releasedAt===null&&claim.activeClaimCount===1;
    const holding=claim.holdId===b.holdId&&claim.bookingId===null&&claim.originHoldId===null&&claim.releasedAt===null&&claim.activeClaimCount===1;
    const released=claim.releasedAt!==null&&claim.activeClaimCount===0&&
      (claim.holdId===b.holdId&&claim.bookingId===null&&claim.originHoldId===null||
        claim.holdId===null&&claim.bookingId===b.bookingId&&claim.originHoldId===b.holdId);
    if(!holding&&!transferred&&!released)return unknown('UNAVAILABLE',diagnostic);
    const pathway=provider.source==='SIGNED_WEBHOOK_AND_RECONCILIATION'&&provider.webhookEventId!==null&&s.events.verifiedPaymentEvents>0||
      provider.source==='RECOVERY_RECONCILIATION'&&provider.recoveryInvocationId!==null;
    const capture=!!p&&!!allocation&&provider.observation==='VERIFIED_CAPTURE'&&pathway&&
      provider.paymentIntentId===p.paymentIntentId&&provider.chargeId===p.chargeId&&provider.amountCents===p.amountCents&&
      provider.reconciliationId===p.reconciliationId&&provider.sessionId===a.sessionId&&a.sessionId!==null&&
      provider.verifiedAt!==null&&Date.parse(provider.verifiedAt)<=Date.parse(s.observedAt);
    const confirmed=s.booking.state==='CONFIRMED'&&a.state==='SUCCEEDED'&&c.state==='RESOLVED'&&c.requestPersisted&&
      c.firstSubmittedAt!==null&&h.state==='CONSUMED'&&
      capture&&transferred&&s.confirmations.length===1&&s.notices.length===1;
    const unsafeSubmission=c.state!=='RESOLVED'&&c.firstSubmittedAt!==null&&now-Date.parse(c.firstSubmittedAt)>=86400000-11000;
    const investigation=c.state==='QUARANTINED'||unsafeSubmission||a.recoveryFailures>=5||s.investigationCount>0||
      s.unresolvedRefundLiabilities>0||s.events.conflictingDigests>0;
    if((s.booking.state==='CONFIRMED'||h.state==='CONSUMED')&&!confirmed||
      !investigation&&(provider.observation==='VERIFIED_CAPTURE'||a.state==='SUCCEEDED'||s.payments.length>0||s.allocations.length>0||s.confirmations.length>0||s.notices.length>0)&&!confirmed)
      return unknown('UNAVAILABLE',diagnostic);
    let progress:AcceptanceProgress;
    if(investigation)progress='INVESTIGATION_REQUIRED';
    else if(confirmed)progress='PAYMENT_CONFIRMED';
    else if(s.booking.state==='EXPIRED'||a.state==='EXPIRED'||a.state==='FAILED') {
      const neverSubmitted=provider.observation==='NEVER_SUBMITTED'&&provider.source==='NONE'&&provider.paymentIntentId===null&&
        provider.chargeId===null&&a.sessionId===null&&c.firstSubmittedAt===null&&!c.requestPersisted&&c.attemptCount===0&&BigInt(c.leaseGeneration)===0n;
      const terminalUnpaid=provider.observation==='TERMINAL_UNPAID'&&pathway&&provider.reconciliationId!==null&&
        provider.verifiedAt!==null&&Date.parse(provider.verifiedAt)<=Date.parse(s.observedAt);
      if(s.booking.state!=='EXPIRED'||h.state!=='RELEASED'||claim.releasedAt===null||claim.activeClaimCount!==0||
        !['EXPIRED','FAILED'].includes(a.state)||(!neverSubmitted&&!terminalUnpaid)||
        c.state!=='RESOLVED'||s.payments.length!==0)return unknown('UNAVAILABLE',diagnostic);
      progress='TERMINAL';
    } else {
      if(s.booking.state!=='AWAITING_INITIAL_PAYMENT'||!['CREATING','ACTIVE','RECONCILING'].includes(h.state)||
        claim.holdId!==b.holdId||claim.bookingId!==null||claim.releasedAt!==null||claim.activeClaimCount!==1)
        return unknown('UNAVAILABLE',diagnostic);
      const leased=c.leaseUntil!==null&&Date.parse(c.leaseUntil)>now;
      if(c.state==='PENDING')progress=leased?'COMMAND_PROCESSING':'COMMAND_PENDING';
      else if(c.state==='SUBMITTED'&&leased)progress='COMMAND_PROCESSING';
      else if(c.state==='UNKNOWN'||c.state==='SUBMITTED')progress='RECOVERY_PENDING';
      else if(provider.observation==='PROCESSING')progress='PAYMENT_PENDING';
      else if(a.state==='RECONCILING')progress='RECOVERY_PENDING';
      else if(a.sessionExpiresAt!==null&&Date.parse(a.sessionExpiresAt)<=now)progress='TIMED_OUT';
      else if(a.state==='OPEN'&&a.sessionId&&a.checkoutUrl&&a.sessionExpiresAt)progress='CHECKOUT_READY';
      else if(a.sessionId)progress='PAYMENT_PENDING';
      else return unknown('UNAVAILABLE',diagnostic);
    }
    if((c.state==='SUBMITTED'||c.state==='UNKNOWN'||a.sessionId!==null)&&(!c.requestPersisted||c.firstSubmittedAt===null))
      progress='INVESTIGATION_REQUIRED';
    if(a.sessionId!==null&&(a.sessionCreatedAt===null||a.sessionExpiresAt===null||
      Date.parse(a.sessionCreatedAt)>Date.parse(s.observedAt)||Date.parse(a.sessionExpiresAt)<=Date.parse(a.sessionCreatedAt)))
      return unknown('UNAVAILABLE',diagnostic);
    const success=confirmed&&!investigation;let scenarioEvidenceComplete=success;
    if(fixture.name==='DUPLICATE_DELIVERY')scenarioEvidenceComplete=success&&s.events.duplicateDeliveries>0&&s.events.outOfOrderObserved;
    if(fixture.name==='MISSING_WEBHOOK')scenarioEvidenceComplete=success&&provider.source==='RECOVERY_RECONCILIATION';
    if(fixture.name==='DELAYED_COMMAND')scenarioEvidenceComplete=success&&s.delayedCommandObserved;
    if(fixture.name==='SIGNED_WEBHOOK')scenarioEvidenceComplete=success&&provider.source==='SIGNED_WEBHOOK_AND_RECONCILIATION';
    if(fixture.name==='INVESTIGATION')scenarioEvidenceComplete=progress==='INVESTIGATION_REQUIRED'&&s.investigationCount>0;
    return Object.freeze({status:'OBSERVED',progress,diagnostic:'STATUS_OBSERVED',
      payment:Object.freeze({state:a.state,captureVerified:capture}),inventoryHold:Object.freeze({state:h.state}),
      booking:Object.freeze({state:s.booking.state,confirmationVerified:confirmed}),scenarioEvidenceComplete,
      provenance:Object.freeze({runId:run.runId,manifestDigest:binding.manifestDigest,planDigest:plan.planDigest,fixtureId,
        observedAt:s.observedAt,transactionId:s.transactionId,snapshotDigest:runManifestDigest(canonicalRunJson(s))}),
      ...(progress==='CHECKOUT_READY'?{checkout:Object.freeze({sessionId:a.sessionId!,url:checkoutUrl(a.checkoutUrl!)})}:{})});
  } catch {return unknown(diagnostic==='UNAUTHORIZED'||diagnostic==='INVALID_TARGET_OR_PLAN'?'REJECTED':'UNAVAILABLE',diagnostic);}
}
