import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { StripeGateway } from './stripe-adapter';

export type RecoveryObservation = 'PROVIDER_ERROR' | 'UNCERTAIN' | 'NO_LOCATOR' |
  'OPEN' | 'TERMINAL_UNPAID' | 'SUCCESS';
export type WorkCounts = {
  attempted: number; processed: number; deferred: number; retried: number;
  failed: number; investigationRequired: number;
  // Observed committed SUCCEEDED attempts, independent of metadata completion.
  // This is not a count of newly captured payments or financial writes.
  financialSucceeded: number;
};
export const workCounts = (): WorkCounts => ({ attempted: 0, processed: 0, deferred: 0,
  retried: 0, failed: 0, investigationRequired: 0, financialSucceeded: 0 });
export type RecoveryOptions = {
  workerId?: string; random?: () => number; admit?: () => boolean;
};
export type RecoveryItem<T> = { attemptId: string; observation: RecoveryObservation;
  result?: T; scheduleCommitted: boolean };
export type RecoveryBatch<T> = WorkCounts & { items: RecoveryItem<T>[] };
export function batchLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) throw new RangeError('Invalid batch size');
}
export function recoveryPolicy(observation: RecoveryObservation, failures: number, random = Math.random) {
  if (!Number.isSafeInteger(failures) || failures < 0) throw new RangeError('Invalid failure count');
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw new RangeError('Invalid jitter');
  const retry = ['PROVIDER_ERROR', 'UNCERTAIN', 'NO_LOCATOR'].includes(observation);
  const investigationRequired = retry && failures >= 4;
  const base = observation === 'TERMINAL_UNPAID' || investigationRequired ? 21600 :
    observation === 'OPEN' ? 60 : Math.min(3600, 30 * 2 ** Math.min(failures, 7));
  const jitter = base === 21600 ? 3600 : observation === 'OPEN' ? 15 : base / 4;
  return { outcome: observation === 'SUCCESS' ? 'COMPLETE' as const : retry ? 'RETRY' as const : 'POLL' as const,
    delay: observation === 'SUCCESS' ? null : Math.min(base === 21600 ? 25200 : 3600,
      base + Math.floor(sample * (Math.floor(jitter) + 1))), investigationRequired };
}
/** Observes caught provider failures without changing domain return values or verification. */
export function observeProvider(gateway: StripeGateway, failed: () => void): StripeGateway {
  return new Proxy(gateway, { get(target, key) {
    const value = Reflect.get(target, key);
    if (typeof value !== 'function' || key === 'verifyEvent') return typeof value === 'function' ? value.bind(target) : value;
    return async (...args: unknown[]) => {
      try { return await value.apply(target, args); }
      catch (error) { failed(); throw error; }
    };
  } });
}
export function domainObservation(result: string): RecoveryObservation {
  if (['CONFIRMED', 'PAID_IN_FULL', 'ALREADY_RECORDED', 'UNALLOCATABLE'].includes(result)) return 'SUCCESS';
  if (['RELEASED', 'EXPIRED', 'FAILED'].includes(result)) return 'TERMINAL_UNPAID';
  return result === 'OPEN' ? 'OPEN' : 'UNCERTAIN';
}

/** Claim and finish use the reviewed metadata-only SQL capabilities; never hold a
 * claim transaction open while entering a financial reconciliation transaction. */
export async function recoverPaymentAttempts<T extends string>(pool: Pool, gateway: StripeGateway,
  lane: 'INITIAL' | 'BALANCE', reconcile: (pool: Pool, gateway: StripeGateway, id: string,
    options?:{paymentIntentLocator?:string}) => Promise<T>,
  limit = 10, options: RecoveryOptions = {}): Promise<RecoveryBatch<T>> {
  batchLimit(limit);
  const worker = options.workerId ?? randomUUID();
  if (!/^[A-Za-z0-9:_-]{8,100}$/.test(worker)) throw new Error('Invalid worker identity');
  const batch: RecoveryBatch<T> = { ...workCounts(), items: [] };
  for (let i = 0; i < limit; i++) {
    if (options.admit && !options.admit()) { batch.deferred++; break; }
    let claim:{ attempt_id: string; generation: string; failure_count: number }|undefined;
    try {claim = (await pool.query<{ attempt_id: string; generation: string; failure_count: number }>(
      'SELECT attempt_id,generation::text,failure_count FROM public.claim_payment_recovery($1,$2,1)', [lane, worker])).rows[0];}
    catch {batch.failed++;batch.deferred++;break;}
    if (!claim) break;
    const generation = BigInt(claim.generation);
    if (generation < 1n) throw new Error('Invalid recovery generation');
    batch.attempted++;
    let observation: RecoveryObservation = 'UNCERTAIN', result: T | undefined, providerError = false;
    let domainFailed = false;
    try {
      const current = (await pool.query<{ state: string; stripe_session_id: string | null;stripe_payment_intent_id:string|null }>(
        'SELECT state,stripe_session_id,stripe_payment_intent_id FROM payment_attempts WHERE id=$1 AND recovery_enabled', [claim.attempt_id])).rows[0];
      if (current?.state === 'SUCCEEDED') observation = 'SUCCESS';
      else if (!current?.stripe_session_id && !current?.stripe_payment_intent_id) observation = 'NO_LOCATOR';
      else {
        result = await reconcile(pool, observeProvider(gateway, () => { providerError = true; }), claim.attempt_id,
          {paymentIntentLocator:current.stripe_session_id?undefined:current.stripe_payment_intent_id??undefined});
        observation = providerError ? 'PROVIDER_ERROR' : domainObservation(result);
        if(observation==='SUCCESS') {
          // Some legacy domain no-ops return ALREADY_RECORDED without changing this
          // attempt. Never retire its schedule unless its own state is committed.
          const state=(await pool.query<{state:string}>(
            'SELECT state FROM payment_attempts WHERE id=$1 AND recovery_enabled',[claim.attempt_id])).rows[0]?.state;
          if(state!=='SUCCEEDED')observation='UNCERTAIN';
        }
      }
    } catch { domainFailed = true; observation = providerError ? 'PROVIDER_ERROR' : 'UNCERTAIN'; }
    const policy = recoveryPolicy(observation, claim.failure_count, options.random);
    if (observation === 'SUCCESS') batch.financialSucceeded++;
    if (domainFailed) batch.failed++;
    if (policy.investigationRequired || result === 'UNALLOCATABLE') batch.investigationRequired++;
    let committed = false;
    try {
      committed = (await pool.query<{ finished: boolean }>(
        'SELECT public.finish_payment_recovery($1,$2,$3,$4,$5) finished',
        [claim.attempt_id, worker, generation.toString(), policy.outcome, policy.delay])).rows[0]?.finished === true;
      if (!committed) batch.failed++; // Stale/expired fence is unfinished metadata work.
    } catch { batch.failed++; }
    batch.items.push({ attemptId: claim.attempt_id, observation, result, scheduleCommitted: committed });
    if (!committed) { batch.deferred++; continue; }
    if (policy.outcome === 'RETRY') batch.retried++;
    else batch.processed++;
  }
  return batch;
}
