import 'server-only';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { addCalendarDays, quoteDeadlines, splitPayment } from './quote-math';
import { FRESH_ACCEPTANCE_PROFILE, canonicalRunJson, requireSealedAcceptanceRun, runManifestDigest,
  type SealedAcceptanceRun } from './stripe-acceptance-run';

export const ACCEPTANCE_SCENARIOS=['SIGNED_WEBHOOK','DUPLICATE_DELIVERY','MISSING_WEBHOOK','DELAYED_COMMAND','INVESTIGATION'] as const;
const scenario=z.enum(ACCEPTANCE_SCENARIOS),hash=z.string().regex(/^[a-f0-9]{64}$/),instant=z.string().datetime({precision:3});
const requestSchema=z.object({scenarios:z.array(scenario).min(1).max(5).refine(v=>new Set(v).size===v.length),
  baseArrivalDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),nightlyCents:z.number().int().positive().max(100000)}).strict();
export type AcceptanceFixtureRequest=z.input<typeof requestSchema>;
export interface FixturePlanningAuthority {
  /** Independently reviewed source-plan approval only, never write permission. */
  verify(binding:Readonly<{runId:string;manifestDigest:string;requestDigest:string;operation:'prepare-booking'}>):Promise<unknown>;
}
const approvalSchema=z.object({status:z.literal('SOURCE_PLAN_VERIFIED'),runId:z.uuid(),manifestDigest:hash,requestDigest:hash,
  notBefore:instant,expiresAt:instant,maxFixtures:z.number().int().min(1).max(5),
  maxTotalCents:z.number().int().positive().max(500000),maxInitialCents:z.number().int().positive().max(500000),
  inventoryComplete:z.literal(true),previousNamespaces:z.array(z.string()).max(4096),previousGuestIds:z.array(z.uuid()).max(4096)}).strict();
type DeepReadonly<T>=T extends object?{readonly [K in keyof T]:DeepReadonly<T[K]>}:T;
function freeze<T>(value:T):DeepReadonly<T> {
  if(value && typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}
  return value as DeepReadonly<T>;
}
function syntheticId(run:string,anchor:string,label:string) {
  const bytes=createHash('sha256').update(`zec-fixture-v1:${run}:${anchor}:${label}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=bytes.toString('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
export function acceptanceManifestBinding(run:SealedAcceptanceRun) {
  requireSealedAcceptanceRun(run);
  if(run.profileId!==FRESH_ACCEPTANCE_PROFILE.id)throw Error('FIXTURE_CONTRACT_REJECTED');
  return Object.freeze({runId:run.runId,manifestDigest:runManifestDigest(canonicalRunJson(run)),database:run.target.database});
}
function buildPlan(run:SealedAcceptanceRun,request:z.infer<typeof requestSchema>) {
  const binding=acceptanceManifestBinding(run),namespace=run.fixtures.namespace;
  const fixtures=ACCEPTANCE_SCENARIOS.filter(s=>request.scenarios.includes(s)).map(name=>{
    const index=ACCEPTANCE_SCENARIOS.indexOf(name),arrivalDate=addCalendarDays(request.baseArrivalDate,index*2),
      departureDate=addCalendarDays(arrivalDate,1),deadlines=quoteDeadlines(arrivalDate);
    if(deadlines.balance.getTime()<=Date.parse(run.expiresAt))throw Error('PLANNED_DEADLINE_UNSAFE');
    const split=splitPayment(BigInt(request.nightlyCents),new Date(run.notBefore),deadlines.balance);
    if(split.initialCents<=0n)throw Error('ZERO_INITIAL_OBLIGATION');
    const fixtureId=syntheticId(run.runId,run.fixtures.bookingOperationId,name);
    const guestId=name==='SIGNED_WEBHOOK'?run.fixtures.guestId:syntheticId(run.runId,run.fixtures.guestId,`${name}:guest`);
    const operationKey=`stage2c2:${run.runId}:${run.fixtures.bookingOperationId}:${name}`;
    const slots=Object.fromEntries(['booking','snapshot','initialObligation','balanceObligation','hold','originalClaim','attempt','command']
      .map(role=>[role,`${namespace}:${name}:${role}`]));
    const workerItems=name==='DUPLICATE_DELIVERY'||name==='DELAYED_COMMAND'?4:3;
    return {name,fixtureId,namespace:`${namespace}:${name}`,guest:{id:guestId,retentionState:'SYNTHETIC' as const,locale:'en' as const},
      stay:{unitId:run.fixtures.unitId,arrivalDate,departureDate,guestCount:1},operationKey,slots,
      expected:{currency:'EUR' as const,mode:'test' as const,totalCents:request.nightlyCents,initialCents:Number(split.initialCents),
        balanceCents:Number(split.balanceCents),splitBasis:split.basis,booking:'AWAITING_INITIAL_PAYMENT',hold:'CREATING',attempt:'CREATING',
        command:'PENDING',commandKind:'SESSION_CREATE',logicalKey:`session-create:${operationKey}`,
        providerKeyRule:'session-create:ACTUAL_ATTEMPT_ID',recoveryEnabled:true,
        relationships:['booking.guest=planned-guest','booking.unit=planned-unit','hold.booking=booking','hold.attempt=attempt',
          'attempt.booking=booking','attempt.obligation=initial-obligation','attempt.hold=hold','command.attempt=attempt',
          'claim.hold=hold','initial-obligation.booking=booking','balance-obligation.booking=booking','snapshot.booking=booking'],
        invariants:['one-original-claim','one-capture-and-allocation','one-booking-confirmation-audit','one-BOOKING_CONFIRMED-key',
          'no-expiry-only-release','unchanged-original-provider-key','no-return-page-authority'],
        evidence:name==='MISSING_WEBHOOK'?'RECOVERY_RECONCILIATION':name==='INVESTIGATION'?'DURABLE_INVESTIGATION':
          name==='DUPLICATE_DELIVERY'?'DUPLICATE_AND_OUT_OF_ORDER_NO_EXTRA_EFFECT':name==='DELAYED_COMMAND'?'DELAYED_ORIGINAL_COMMAND':'SIGNED_WEBHOOK_AND_RECONCILIATION'},
      quota:{invocations:1,workerItems,providerRequests:workerItems*12},
      proposedWrites:{syntheticGuestInserts:1,domainBookingInserts:10,holdAttemptLinkUpdates:1,
        execution:'SEPARATELY_AUTHORISED_WRITER_AND_ACCEPT_BOOKING_ONLY' as const}};
  });
  return {version:1 as const,...binding,namespace,sourceDigest:run.sourceDigest,migrationDigest:run.migrationDigest,
    writesEnabled:false as const,currency:'EUR' as const,mode:'test' as const,
    referenceIntent:{unitId:run.fixtures.unitId,capacity:1,syntheticOnly:true,
      scheduleId:syntheticId(run.runId,run.fixtures.unitId,'schedule'),
      weekdayRateId:syntheticId(run.runId,run.fixtures.unitId,'weekday'),weekendRateId:syntheticId(run.runId,run.fixtures.unitId,'weekend'),
      nightlyCents:request.nightlyCents,referenceInserts:4},fixtures,
    totals:{fixtures:fixtures.length,totalCents:fixtures.reduce((n,f)=>n+f.expected.totalCents,0),
      initialCents:fixtures.reduce((n,f)=>n+f.expected.initialCents,0),invocations:fixtures.length,
      workerItems:fixtures.reduce((n,f)=>n+f.quota.workerItems,0),providerRequests:fixtures.reduce((n,f)=>n+f.quota.providerRequests,0)},
    futureFlow:['fresh-host-authority-and-identity','separately-approved-reference-and-guest-writer','quoteStay',
      'acceptBooking','bind-actual-domain-ids-and-original-key','separately-approved-runStripeAutomationVerification',
      'read-only-status','existing-webhook-and-recovery-reconciliation']};
}
export type AcceptanceFixturePlan=DeepReadonly<ReturnType<typeof buildPlan> & {planDigest:string}>;
const issuedPlans=new WeakSet<object>();
export function requireAcceptanceFixturePlan(run:SealedAcceptanceRun,plan:AcceptanceFixturePlan) {
  const binding=acceptanceManifestBinding(run);
  if(!issuedPlans.has(plan)||plan.runId!==binding.runId||plan.manifestDigest!==binding.manifestDigest||plan.database!==binding.database)
    throw Error('FIXTURE_CONTRACT_REJECTED');
}
export type FixturePlanResult=Readonly<{status:'PLANNED';plan:AcceptanceFixturePlan}|
  {status:'REJECTED';diagnostic:'INVALID_PLAN'|'UNAUTHORIZED'|'BUDGET_EXCEEDED'|'NAMESPACE_REUSED'}>;

/** Produces data only. No writer, acceptance callback, runner or SQL interface. */
export async function planAcceptanceFixtures(run:SealedAcceptanceRun,input:unknown,
  deps:{now:()=>number;authority:FixturePlanningAuthority}):Promise<FixturePlanResult> {
  let code:'INVALID_PLAN'|'UNAUTHORIZED'|'BUDGET_EXCEEDED'|'NAMESPACE_REUSED'='INVALID_PLAN';
  try {
    const binding=acceptanceManifestBinding(run),request=requestSchema.parse(input);
    if(!run.operations.includes('prepare-booking'))throw Error('NOT_APPROVED');
    if(request.baseArrivalDate<addCalendarDays(run.notBefore.slice(0,10),30)||
      request.baseArrivalDate>addCalendarDays(run.notBefore.slice(0,10),365))throw Error('DATE_REJECTED');
    const core=buildPlan(run,request),requestDigest=runManifestDigest(canonicalRunJson(request));
    code='UNAUTHORIZED';
    const approval=approvalSchema.parse(await deps.authority.verify({...binding,requestDigest,operation:'prepare-booking'}));
    const now=deps.now();
    if(!Number.isSafeInteger(now)||now<Date.parse(run.notBefore)||now>=Date.parse(run.expiresAt)||
      approval.runId!==run.runId||approval.manifestDigest!==binding.manifestDigest||approval.requestDigest!==requestDigest||
      now<Date.parse(approval.notBefore)||now>=Date.parse(approval.expiresAt)||
      Date.parse(approval.notBefore)<Date.parse(run.notBefore)||Date.parse(approval.expiresAt)>Date.parse(run.expiresAt))throw Error('NO_AUTHORITY');
    code='NAMESPACE_REUSED';
    if(approval.previousNamespaces.some(n=>n===core.namespace||n.startsWith(`${core.namespace}:`))||
      core.fixtures.some(f=>approval.previousGuestIds.includes(f.guest.id)))throw Error('REUSED');
    code='BUDGET_EXCEEDED';
    const t=core.totals,b=run.budgets;
    if(t.fixtures>approval.maxFixtures||t.totalCents>approval.maxTotalCents||t.initialCents>approval.maxInitialCents||
      t.invocations>b.invocations||t.workerItems>b.items||t.providerRequests>b.providerRequests)throw Error('OVER_BUDGET');
    const plan=freeze({...core,planDigest:runManifestDigest(canonicalRunJson(core))});issuedPlans.add(plan);
    return Object.freeze({status:'PLANNED',plan});
  } catch {return Object.freeze({status:'REJECTED',diagnostic:code});}
}
