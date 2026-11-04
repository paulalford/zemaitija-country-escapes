import 'server-only';
import type { ShutdownObservation } from './automation-settlement';
import type { Pool } from 'pg';
import type { StripeGateway } from './stripe-adapter';
import { authorizeStripeAutomation, stripeAutomationConfig, verifyAutomationDatabaseIdentity,
  verifyAutomationRecoveryCapabilities } from './stripe-automation-config';
import { AUTOMATION_BUDGET, type AutomationLane } from './stripe-automation';
import { AutomationScope, automationPoolOptions, boundedAutomationPool, boundedAutomationFetch,
  type AutomationPoolFactory } from './stripe-automation-runtime';
import { workCounts, type WorkCounts, type RecoveryOptions } from './payment-recovery';
import { refreshIsolatedTarget, type AttestedTarget, type DockerEvidenceReader } from './stripe-automation-target';

export type ExecutingLane=Exclude<AutomationLane,'DEFERRED_INVESTIGATION'>;
export type RecoveryProcessors=Record<ExecutingLane,(limit:number,options:RecoveryOptions)=>Promise<WorkCounts>>;
export type AutomationProvider=StripeGateway & {verifyAccount():Promise<string>};
export type AutomationVerificationDependencies={
  target?:AttestedTarget;
  docker?:DockerEvidenceReader;
  // No defaults: the HTTP foundation neither imports this module nor supplies factories.
  constructDatabase:AutomationPoolFactory;
  constructStripe:(transport:{fetch:typeof fetch})=>AutomationProvider;
  fetch:typeof fetch;
  processors:(pool:Pool,gateway:StripeGateway)=>RecoveryProcessors;
  now?:()=>number;
  observeShutdown?:(state:ShutdownObservation)=>void;
};
export type ExecutedLane=WorkCounts & {lane:ExecutingLane;state:'DONE'|'FAILED'|'DEFERRED'};
export type Sample={available:boolean;sampled:number;hasMore:boolean};
export type DeferredWork={refundEvents:Sample;refundLiabilities:Sample;investigation:Sample};
const unknownSample=():Sample=>({available:false,sampled:0,hasMore:false});
async function observeDeferred(pool:Pool):Promise<DeferredWork> {
  const summary:DeferredWork={refundEvents:unknownSample(),refundLiabilities:unknownSample(),investigation:unknownSample()};
  const statements:Record<keyof DeferredWork,string>={
    refundEvents:`SELECT id FROM stripe_webhook_events WHERE
      (event_type LIKE 'refund.%' OR event_type LIKE 'charge.%')
      AND processing_state NOT IN ('PROCESSED','IGNORED') ORDER BY received_at,id LIMIT 26`,
    refundLiabilities:`SELECT o.id FROM refund_obligations o WHERE o.amount_cents>
      COALESCE((SELECT sum(r.refunded_cents) FROM refund_records r JOIN refund_attempts a
        ON a.id=r.refund_attempt_id WHERE a.obligation_id=o.id),0) ORDER BY o.created_at,o.id LIMIT 26`,
    investigation:`SELECT id FROM (
      (SELECT id FROM stripe_webhook_events WHERE processing_state IN ('INVESTIGATE','QUARANTINED') ORDER BY received_at,id LIMIT 26)
      UNION ALL (SELECT id FROM provider_commands WHERE state='QUARANTINED' ORDER BY created_at,id LIMIT 26)
      UNION ALL (SELECT id FROM payment_attempts WHERE recovery_enabled AND recovery_failure_count>=5 ORDER BY id LIMIT 26)
    ) cases LIMIT 26`,
  };
  for(const key of Object.keys(statements) as (keyof DeferredWork)[]) {
    try {const rows=(await pool.query(statements[key])).rows;
      summary[key]={available:true,sampled:Math.min(25,rows.length),hasMore:rows.length>25};
    } catch { /* Unknown observation is separate from an empty queue. */ }
  }
  return summary;
}

/** Source-only verification core, intentionally disconnected from every route.
 * Invocations during Stage 2B-2 are permitted only with deterministic fake resources.
 * Identity/authentication and finite budgets are enforced before admitting processors. */
export async function runStripeAutomationVerification(env:Readonly<Record<string,string|undefined>>,
  authorization:string|null,deps:AutomationVerificationDependencies) {
  const config=stripeAutomationConfig(env,deps.target);
  authorizeStripeAutomation(authorization,config); // Before even reading a factory.
  const now=deps.now??Date.now,start=now();
  const run=new AutomationScope(start+60_000,now);
  let current=new AutomationScope(start+10_000,now,run.signal);
  let database:ReturnType<typeof boundedAutomationPool>|undefined;
  const lanes:ExecutedLane[]=[];
  let deferred:DeferredWork={refundEvents:unknownSample(),refundLiabilities:unknownSample(),investigation:unknownSample()};
  let cleanupFailed=false,guardFailed=false,processingEnabled=false;
  function admit() {
    if(now()-start>=AUTOMATION_BUDGET.admissionMilliseconds || run.remaining()<20_000 || run.signal.aborted)return false;
    current.close();current=new AutomationScope(Math.min(now()+10_000,run.deadline-10_000),now,run.signal);
    return true;
  }
  try {
    // Legacy loopback syntax remains usable by the hard-inactive HTTP foundation,
    // but can never grant resource construction or processing authority here.
    if(!config.target || !deps.docker)throw new Error('DOCKER_ATTESTATION_REQUIRED');
    await refreshIsolatedTarget(config.target,deps.docker);
    database=boundedAutomationPool(deps.constructDatabase(automationPoolOptions(config,env)),()=>current,deps.observeShutdown);
    await verifyAutomationDatabaseIdentity(database.pool,config,env);
    await verifyAutomationRecoveryCapabilities(database.pool);
    current.check();
    const provider=deps.constructStripe({fetch:boundedAutomationFetch(deps.fetch,()=>current)});
    if(await provider.verifyAccount()!==config.expectedStripeAccount)throw new Error('STRIPE_IDENTITY');
    current.check();
    const processors=deps.processors(database.pool,provider);
    for(const lane of ['PAYMENT_WEBHOOKS','CHECKOUT_COMMAND_RECOVERY','INITIAL_RECONCILIATION','BALANCE_RECONCILIATION'] as const) {
      if(!admit()){lanes.push({...workCounts(),lane,state:'DEFERRED',deferred:1});continue;}
      if(config.target) {
        await refreshIsolatedTarget(config.target,deps.docker!);
        await verifyAutomationDatabaseIdentity(database.pool,config,env);
      }
      let completedCounts:WorkCounts|undefined;
      try {
        // This records processor invocation, including empty batches and throws.
        // It is independent of the hard-inactive HTTP entrypoint's contract.
        processingEnabled=true;
        const counts=await processors[lane](AUTOMATION_BUDGET.perLane[lane],{admit});
        if(Object.values(counts).some(n=>!Number.isSafeInteger(n)||n<0)||counts.attempted>AUTOMATION_BUDGET.perLane[lane]||
          counts.processed+counts.retried>counts.attempted||counts.financialSucceeded>counts.attempted)
          throw new Error('LANE_ACCOUNTING');
        completedCounts=counts;
        current.check();
        lanes.push({...counts,lane,state:counts.failed?'FAILED':'DONE'});
      } catch {lanes.push({...(completedCounts??workCounts()),lane,state:'FAILED',failed:(completedCounts?.failed??0)+1});}
    }
    current.close();current=new AutomationScope(Math.min(now()+4000,run.deadline-5000),now,run.signal);
    deferred=await observeDeferred(database.pool);
  } catch {guardFailed=true;}
  finally {
    current.close();run.close();
    if(database)try {await database.close();} catch {cleanupFailed=true;}
  }
  const deadlineExceeded=now()>=run.deadline;
  // Never serialize config, factory failures, credentials, URLs, provider objects or raw errors.
  return {stage:'2B-2' as const,status:guardFailed?'FAILED' as const:
    deadlineExceeded||cleanupFailed||lanes.some(l=>l.state==='FAILED')?'PARTIAL' as const:'BOUNDED' as const,
    processingEnabled,deadlineExceeded,guardFailed,cleanupFailed,lanes,deferred};
}
