import 'server-only';
import { z } from 'zod';
import { runManifestDigest } from './stripe-acceptance-run';
import { AutomationScope, boundedAutomationFetch } from './stripe-automation-runtime';
import { SUPERVISION_POLICY } from './stripe-acceptance-supervision';
import { requireFreshAuthority, type FreshDatabase, type FreshLiveAuthority } from './stripe-acceptance-fresh-database';
import { requireReviewedFreshIntegration, type ReviewedFreshIntegration } from './stripe-acceptance-trust';
import type { DurableProviderBudget, RequestOperation } from './stripe-acceptance-durable';

const fail = (): never => { throw Error('ACCEPTANCE_INTEGRATION_HALTED'); };
/** This is placed at the SDK HTTP-client seam, so hidden retries consume their
 * own allowances. The actual network attempt + body use the accepted bounded
 * transport. No default fetch or SDK is constructed, and no automatic retry. */
export function aggregateBoundedAcceptanceFetch(deps: { fetch: typeof fetch; budget: DurableProviderBudget;
  currentScope(): AutomationScope; invocationId: string; operation: RequestOperation;
  nextRequestId(): string; revalidate(): Promise<void> }): typeof fetch {
  return async (input, init) => {
    const scope = deps.currentScope(); scope.check();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    // SDK transport uses URL/init. Reject Request objects to avoid hidden method,
    // signal, body and credential sources bypassing the checked init.
    if (input instanceof Request || url.origin !== 'https://api.stripe.com' || url.username || url.password || url.hash ||
      !['GET', 'POST'].includes(method) ||
      (['BOOTSTRAP_ACCOUNT', 'STARTUP_ACCOUNT', 'WORKER_ACCOUNT'].includes(deps.operation)
        ? method !== 'GET' || url.pathname !== '/v1/account' || url.search !== ''
        : !/^\/v1\/(checkout\/sessions(?:\/cs_test_[A-Za-z0-9]+(?:\/expire)?)?|payment_intents\/pi_[A-Za-z0-9]+)$/.test(url.pathname)) ||
      method === 'POST' && !new Headers(init?.headers).get('Idempotency-Key')) return fail();
    if (init?.signal?.aborted) return fail();
    await deps.revalidate(); scope.check();
    const requestId = deps.nextRequestId();
    const grant = await deps.budget.reserve(deps.invocationId, requestId, deps.operation, scope.signal);
    if (grant !== 'DURABLE') return fail();
    let dispatched = false, settled = false;
    let attempt: AutomationScope | undefined;
    try {
      await deps.revalidate(); scope.check();
      if (init?.signal?.aborted) return fail();
      const deadline = await deps.budget.dispatchDeadline(requestId, scope.signal);
      scope.check(); scope.providerRequest();
      attempt = new AutomationScope(Math.min(scope.deadline, deadline), scope.now, scope.signal, 1);
      const transport = boundedAutomationFetch(async (target, options) => {
        dispatched = true;
        const response = await deps.fetch(target, { ...options, redirect: 'manual', credentials: 'omit' });
        if (response.redirected || response.status >= 300 && response.status < 400 || response.url && response.url !== url.href) {
          await response.body?.cancel(); return fail();
        }
        return response;
      }, () => attempt!);
      const response = await transport(url, init);
      scope.check();
      if (await deps.budget.settle(requestId, 'KNOWN', response.headers.get('request-id')) !== 'DURABLE') return fail();
      settled = true;
      return response;
    } catch {
      if (!settled) await deps.budget.settle(requestId, dispatched ? 'UNCERTAIN' : 'NOT_STARTED', null);
      return fail();
    } finally { attempt?.close(); }
  };
}

/** Initial account read is a separate G2 protocol, before an issued run seal.
 * Reviewed expected identity is NOT a verified account. Normal execution requires
 * independent retained successful bootstrap proof and a new G3 grant. */
export async function verifyBudgetedBootstrapAccount(review: ReviewedFreshIntegration, deps: {
  fetch: typeof fetch; budget: DurableProviderBudget; scope: AutomationScope; invocationId: string;
  nextRequestId(): string; revalidate(): Promise<void>;
}) {
  requireReviewedFreshIntegration(review, deps.scope.now(), 'G2_PREFLIGHT');
  const transport = aggregateBoundedAcceptanceFetch({ ...deps, currentScope: () => deps.scope, operation: 'BOOTSTRAP_ACCOUNT' });
  const response = await transport('https://api.stripe.com/v1/account', { method: 'GET' });
  if (response.status !== 200) return fail();
  const account = z.object({ id: z.string(), object: z.literal('account') }).passthrough().parse(await response.json());
  if (account.id !== review.manifest.stripe.accountId) return fail();
  return Object.freeze({ accountId: account.id, requestId: response.headers.get('request-id'),
    operationsEnabled: false as const, evidence: 'BUDGETED_BOOTSTRAP_OBSERVATION' as const });
}

export interface HostLockPort {
  acquire(path: '/run/lock/zec-acceptance/invocation.lock', flags: Readonly<{ exclusive: true; nonblocking: true; noFollow: true }>): Promise<{
    observation: 'ACQUIRED' | 'CONTENDED' | 'UNKNOWN';
    held(): Promise<boolean>; release(): Promise<'RELEASED' | 'UNKNOWN'>;
  }>;
}
/** Host lock descriptor is held across the dedicated PostgreSQL session and work.
 * The advisory lock is session-scoped, distinct from domain leases. No reconnect,
 * reacquire, resume, scheduler or external process is implemented. */
export async function withFreshExecutionLocks<T>(review: ReviewedFreshIntegration, db: FreshDatabase, deps: {
  host: HostLockPort; now(): number; authority: FreshLiveAuthority; signal: AbortSignal;
}, operation: (continuity: { check(): Promise<void> }) => Promise<T>): Promise<T> {
  await requireFreshAuthority(review, deps.authority, deps.now, deps.signal);
  const host = await deps.host.acquire(SUPERVISION_POLICY.hostLock, { exclusive: true, nonblocking: true, noFollow: true });
  try {
    if (host.observation !== 'ACQUIRED' || !await host.held()) return fail();
    return await db.session('zec_acceptance_lock', deps.signal, async s => {
      const key = BigInt(`0x${runManifestDigest(`zec-supervisor-v1:${review.manifest.profileId}:${review.manifest.runId}`).slice(0, 16)}`);
      const signedKey = BigInt.asIntN(64, key).toString();
      const result = await s.query('SELECT pg_try_advisory_lock($1::bigint) acquired, pg_backend_pid() pid', [signedKey]);
      if (result.rows.length !== 1 || result.rows[0].acquired !== true || !Number.isInteger(result.rows[0].pid)) return fail();
      const pid = result.rows[0].pid;
      async function check() {
        await requireFreshAuthority(review, deps.authority, deps.now, deps.signal);
        const result = await s.query(`SELECT pg_backend_pid() pid, EXISTS(SELECT 1 FROM pg_locks WHERE
          locktype='advisory' AND pid=pg_backend_pid() AND granted AND objsubid=1 AND
          classid=(($1::bigint >> 32) & 4294967295)::oid AND objid=($1::bigint & 4294967295)::oid) held`, [signedKey]);
        if (!await host.held() || result.rows.length !== 1 || result.rows[0].pid !== pid || result.rows[0].held !== true) return fail();
      }
      try { await check(); const output = await operation({ check }); await check(); return output; }
      finally {
        const release = await s.query('SELECT pg_advisory_unlock($1::bigint) released', [signedKey]);
        if (release.rows.length !== 1 || release.rows[0].released !== true) return fail();
      }
    });
  } finally { if (await host.release() !== 'RELEASED') return fail(); }
}

/** Dedicated host is deliberately a non-executable source descriptor. A future
 * owner-approved launcher must implement raw headers, admission, shutdown and
 * descendant monitoring before this descriptor can become a deployed service. */
export function dedicatedAcceptanceHostContract(review: ReviewedFreshIntegration) {
  return Object.freeze({ state: 'DISABLED' as const, operationsEnabled: false as const, schedulingEnabled: false as const,
    origin: 'http://127.0.0.1:3101', webhookPath: `/api/acceptance/runs/${review.manifest.runId}/stripe/webhook`,
    database: review.manifest.target.database, missing: Object.freeze(['APPROVED_LAUNCHER', 'EXTERNAL_STOP_MONITOR',
      'RUN_SCOPED_DOMAIN_PROCESSORS', 'LIVE_CAPABILITY_ATTESTATION', 'GENUINE_INDEPENDENT_CAPTURE']) });
}
