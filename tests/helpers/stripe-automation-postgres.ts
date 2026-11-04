/** Future integration foundation only. No Vitest hooks, pool construction or env loading. */
import type { CheckoutSession, PaymentEvidence, StripeGateway, VerifiedEvent } from '../../src/server/stripe-adapter';

export const POSTGRES_ACCEPTANCE_CASES=Object.freeze([
  'atomic-enrollment','deferred-enrollment','app-permissions','lease-fencing','concurrent-claims',
  'retry-fairness','financial-idempotency','transaction-rollback','stale-lease-recovery',
  'statement-lock-timeouts','connection-cancellation','historical-record-preservation','worker-target-enforcement',
] as const);

/** An in-memory gateway with no transport, SDK, real key or caller-supplied implementation. */
export function fakeIntegrationStripe() {
  const sessions=new Map<string,CheckoutSession>(),payments=new Map<string,PaymentEvidence>();
  const events=new Map<string,VerifiedEvent>(),calls:string[]=[];
  let failure=false;
  const observe=(name:string)=>{calls.push(name);if(failure){failure=false;throw new Error('SYNTHETIC_PROVIDER_FAILURE');}};
  const gateway:StripeGateway & {verifyAccount():Promise<string>}={
    accountId:'acct_synthetic',verifyAccount:async()=>{observe('verifyAccount');return 'acct_synthetic';},
    retrieveSession:async id=>{observe('retrieveSession');const v=sessions.get(id);if(!v)throw new Error('SYNTHETIC_SESSION_MISSING');return structuredClone(v);},
    retrievePaymentIntent:async id=>{observe('retrievePaymentIntent');const v=payments.get(id);if(!v)throw new Error('SYNTHETIC_PAYMENT_MISSING');return structuredClone(v);},
    findSessionForPaymentIntent:async id=>{observe('findSessionForPaymentIntent');return structuredClone([...sessions.values()].find(s=>s.paymentIntentId===id)??null);},
    createSession:async request=>{observe('createSession');const v=sessions.get(request.idempotencyKey);if(!v)throw new Error('SYNTHETIC_CREATE_RESPONSE_MISSING');return structuredClone(v);},
    expireSession:async id=>{observe('expireSession');const v=sessions.get(id);if(!v)throw new Error('SYNTHETIC_SESSION_MISSING');return {...structuredClone(v),status:'expired'};},
    verifyEvent:(_raw,signature)=>{observe('verifyEvent');const v=events.get(signature);if(!v)throw new Error('SYNTHETIC_EVENT_MISSING');return structuredClone(v);},
  };
  return {gateway,calls,count:(method:string)=>calls.filter(call=>call===method).length,failNext:()=>{failure=true;},
    session:(key:string,value:CheckoutSession)=>{if(value.accountId!=='acct_synthetic'||value.livemode)throw new Error('SYNTHETIC_ONLY');sessions.set(key,structuredClone(value));},
    payment:(key:string,value:PaymentEvidence)=>{if(value.livemode)throw new Error('SYNTHETIC_ONLY');payments.set(key,structuredClone(value));},
    event:(signature:string,value:VerifiedEvent)=>{if(value.livemode||value.accountId!=='acct_synthetic')throw new Error('SYNTHETIC_ONLY');events.set(signature,structuredClone(value));}};
}
/** Retired unsafe same-process API. Never inspect env/deps or invoke callbacks.
 * Kept as a rejecting compatibility entry so stale callers cannot regain privileges. */
export async function withIsolatedPostgres(..._rejected: unknown[]):Promise<never> {
  void _rejected;
  throw new Error('SEPARATE_FIXTURE_PROCESS_REQUIRED');
}

/** Pure assertion helpers for future real-session scenarios, not substitutes for them. */
export function assertLeaseFenced(changedRows:number){if(changedRows!==0)throw new Error('STALE_LEASE_CHANGED_ROWS');}
export function assertFairProgress(before:readonly string[],after:readonly string[]){
  if(!before.length || !after.some(id=>!before.includes(id)))throw new Error('NO_FAIR_PROGRESS');
}
export function assertSettlementOnce(counts:{captures:number;allocations:number;notices:number}) {
  if(Object.values(counts).some(n=>n!==1))throw new Error('FINANCIAL_IDEMPOTENCY_FAILED');
}
export function assertPreserved(before:unknown,after:unknown){if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('HISTORICAL_RECORD_CHANGED');}
