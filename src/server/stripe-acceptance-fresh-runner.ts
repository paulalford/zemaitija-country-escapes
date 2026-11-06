import 'server-only';
import { z } from 'zod';
import pinned from '../../scripts/stripe-automation-migration-manifest.json';
import { canonicalRunJson, freshAcceptanceNames, requireSealedAcceptanceRun, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { requireReviewedFreshIntegration, type ReviewedFreshIntegration } from './stripe-acceptance-trust';
import { financialEvidenceBinding, financialEvidenceBindingSchema, financialEvidenceDigest } from './stripe-acceptance-financial-evidence';
import { supervisionBinding, SUPERVISION_POLICY } from './stripe-acceptance-supervision';
import { CaptureFailure, capturePinSchema, detachedCapture, isCaptureReader, readPinnedCapture,
  requireIndependentCaptureReaders, type CapturePacket, type IndependentCaptureReader } from './stripe-acceptance-capture-provenance';

/** Ordering descriptor, never a runner API. No construction callback is accepted.
 * The existing legacy runner/config/target guards remain untouched and unusable
 * for this fresh profile until a separately approved runner seam/launcher exists. */
export const FRESH_RUNNER_SEQUENCE = Object.freeze(['STATIC_INTEGRITY', 'APPROVAL', 'RESERVATION', 'DOCKER', 'POSTGRES',
  'JOURNAL', 'BUDGET', 'HOST_LOCK', 'DATABASE_LOCK', 'STRIPE', 'DEPENDENCIES'] as const);
export const RUNNER_OBSERVATIONS = Object.freeze(FRESH_RUNNER_SEQUENCE.slice(1)) as readonly Exclude<typeof FRESH_RUNNER_SEQUENCE[number], 'STATIC_INTEGRITY'>[];
export type RunnerObservation = typeof RUNNER_OBSERVATIONS[number];
const label = z.string().regex(/^[A-Za-z0-9:_.-]{1,160}$/), hash = z.string().regex(/^[a-f0-9]{64}$/);
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const pinsSchema = z.object({ APPROVAL: capturePinSchema, RESERVATION: capturePinSchema, DOCKER: capturePinSchema,
  POSTGRES: capturePinSchema, STRIPE: capturePinSchema, JOURNAL: capturePinSchema, BUDGET: capturePinSchema,
  HOST_LOCK: capturePinSchema, DATABASE_LOCK: capturePinSchema, DEPENDENCIES: capturePinSchema }).strict();
export const runnerReviewSchema = z.object({ kind: z.literal('independent-fresh-runner-review-v1'), binding: financialEvidenceBindingSchema,
  reviewer: label, approvalReference: label, evidenceClass: z.enum(['SIMULATED', 'RECORDED']),
  notBefore: time, expiresAt: time, pins: pinsSchema }).strict();
export type RunnerReview = z.infer<typeof runnerReviewSchema>;
const requestSchema = z.object({ mode: z.literal('source-only'), profileId: z.literal('stage-2c-fresh-pg17-v1'), runId: z.uuid() }).strict();
const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);
const rejected = (): never => { throw new CaptureFailure('CAPTURE_CONFLICT', 'INVESTIGATION_REQUIRED'); };
export const FRESH_RUNNER_DEPENDENCIES = Object.freeze({
  runner: 'runStripeAutomationVerification', processors: 'automationRecoveryProcessors',
  lanes: Object.freeze(['PAYMENT_WEBHOOKS', 'CHECKOUT_COMMAND_RECOVERY', 'INITIAL_RECONCILIATION', 'BALANCE_RECONCILIATION']),
  paymentInbox: 'processPaymentWebhookInbox', checkout: 'recoverSessionCommands', initial: 'recoverInitialAttempts', balance: 'recoverBalanceAttempts',
  poolTransport: 'boundedAutomationPool', providerTransport: 'aggregateBoundedAcceptanceFetch/boundedAutomationFetch',
  scope: 'AutomationScope', idempotency: 'ORIGINAL_PERSISTED_COMMAND_KEY_AND_REQUEST',
  cancellation: 'ABORT_AND_OBSERVED_SETTLEMENT', uncertain: 'FENCE_NO_RETRY_NO_RESUME',
  maxInvocationMilliseconds: 60000, maxProviderMilliseconds: 1000, responseBytes: 1048576,
} as const);
const requestBudgetSchema = z.object({ id: z.uuid(), invocationId: z.uuid(), operation: z.enum(['BOOTSTRAP_ACCOUNT', 'STARTUP_ACCOUNT', 'WORKER_ACCOUNT',
  'CHECKOUT_DISPATCH', 'PAYMENT_STATUS_RECOVERY', 'PROVIDER_RECONCILIATION']), reservedAt: time, dispatchedAt: time.nullable(),
  settledAt: time.nullable(), outcome: z.enum(['KNOWN', 'NOT_STARTED', 'UNCERTAIN', 'PENDING', 'TIMEOUT', 'CANCELLED']),
  providerRequestId: label.nullable(), authorityScope: z.enum(['G2_PREFLIGHT', 'G3_EXECUTION']), authorityEvidenceRef: label, reservationEvidenceRef: label }).strict();
const budgetEntrySchema = z.object({ sequence: z.number().int().positive(), previous: hash, digest: hash, runId: z.uuid(), manifestDigest: hash, at: time, data: z.unknown() }).strict();
const budgetSchema = z.object({ protectedHeadId: label, headDigest: hash, independentHeadDigest: hash, sequence: z.number().int().nonnegative(),
  ledgerEntries: z.array(budgetEntrySchema).max(5400), bootstrapIncludedInTotal: z.literal(true),
  requests: z.array(requestBudgetSchema).max(1800), fenced: z.literal(false) }).strict();
const stripeSchema = z.object({ identity: z.unknown(), bootstrapRequestId: z.uuid(), startupRequestId: z.uuid() }).strict();
const journalSchema = z.object({ sequence: z.number().int().nonnegative(), headDigest: hash, protectedHeadId: label,
  independentHeadDigest: hash, interrupted: z.literal(false), fenced: z.literal(false) }).strict();
const locksSchema = z.object({ invocationId: z.uuid(), observation: z.literal('HELD'), continuousSince: time,
  validUntil: time, lockKey: z.union([label, z.literal(SUPERVISION_POLICY.hostLock)]), backendPid: z.number().int().positive().nullable(), sessionId: label.nullable() }).strict();

/** Inspect separately supplied immutable attestations. This method cannot acquire
 * locks, reserve quota, connect or construct a processor, even with RECORDED proof.
 * Claims from fake readers stay SIMULATED. All successful paths remain pending. */
export async function inspectFreshRunnerBinding(run: SealedAcceptanceRun, review: ReviewedFreshIntegration | undefined,
  request: unknown, deps: { authority?: IndependentCaptureReader; sources: Partial<Record<RunnerObservation, IndependentCaptureReader>>;
    now(): number; signal: AbortSignal }) {
  let diagnostic = 'INVALID_STATIC_CONTRACT', evidenceClass: 'SIMULATED' | 'RECORDED' | 'UNVERIFIED' = 'UNVERIFIED';
  const checked: string[] = [];
  const finish = (status: 'REJECTED' | 'PENDING_EXTERNAL_AUTHORITY', code: string) => Object.freeze({ stage: '2C-REMEDIATION-B1' as const,
    status, diagnostic: code, evidenceClass, readiness: 'NOT_READY' as const, ready: false as const,
    operationsEnabled: false as const, processorConstructionEnabled: false as const, schedulingEnabled: false as const,
    checked: Object.freeze([...checked]), constructionSequence: FRESH_RUNNER_SEQUENCE });
  try {
    const cfg = requestSchema.parse(request);
    requireSealedAcceptanceRun(run);
    if (cfg.runId !== run.runId || cfg.profileId !== run.profileId || !same(freshAcceptanceNames(run.runId), Object.fromEntries(
      Object.keys(freshAcceptanceNames(run.runId)).map(k => [k, run.target[k as keyof typeof run.target]])))) return finish('REJECTED', 'TARGET_REJECTED');
    if (!review) return finish('PENDING_EXTERNAL_AUTHORITY', 'HOST_AUTHORITY_REQUIRED');
    requireReviewedFreshIntegration(review, deps.now());
    if (!same(review.manifest, run)) return finish('REJECTED', 'FOREIGN_RUN');
    checked.push('STATIC_INTEGRITY'); diagnostic = 'HOST_AUTHORITY_REQUIRED';
    if (!isCaptureReader(deps.authority)) return finish('PENDING_EXTERNAL_AUTHORITY', diagnostic);
    if (deps.signal.aborted) return finish('REJECTED', 'CANCELLED');
    const binding = financialEvidenceBinding(run);
    let rawAuthority: unknown;
    try { rawAuthority = await deps.authority.read(binding); } catch { throw new CaptureFailure('SOURCE_UNAVAILABLE'); }
    const authority = runnerReviewSchema.parse(detachedCapture(rawAuthority));
    evidenceClass = authority.evidenceClass;
    if (!same(authority.binding, binding) || authority.approvalReference !== run.approvalReference ||
      authority.notBefore < review.approval.notBefore || authority.expiresAt > review.approval.expiresAt || authority.expiresAt <= authority.notBefore) return rejected();
    if (evidenceClass === 'RECORDED' && review.approval.scope !== 'G3_EXECUTION') return finish('PENDING_EXTERNAL_AUTHORITY', 'G3_AUTHORITY_REQUIRED');
    requireIndependentCaptureReaders([deps.authority, ...RUNNER_OBSERVATIONS.map(k => deps.sources[k]).filter((r): r is IndependentCaptureReader => !!r)],
      RUNNER_OBSERVATIONS.map(k => authority.pins[k]), authority.reviewer);
    const packets: Partial<Record<RunnerObservation, CapturePacket>> = {};
    // Complete the authority chain BEFORE assessing dependency binding. Never
    // return a live capability and never call any construction function.
    for (const kind of RUNNER_OBSERVATIONS) {
      diagnostic = `${kind}_REQUIRED`;
      const p = await readPinnedCapture(deps.sources[kind], authority.pins[kind], binding, `FRESH_RUNNER_${kind}`,
        evidenceClass, authority, deps.now, deps.signal);
      requireReviewedFreshIntegration(review, deps.now());
      if (p.completeness !== 'COMPLETE' || p.uncertainty !== 'SETTLED' || p.diagnostics.length || !p.items.length ||
        p.items.some(i => i.completeness !== 'COMPLETE' || i.uncertainty !== 'SETTLED' || i.diagnostics.length))
        return finish('PENDING_EXTERNAL_AUTHORITY', `${kind}_UNSETTLED`);
      if (p.items.length !== 1 || p.items[0].key !== kind || p.items[0].digest !== financialEvidenceDigest(p.data)) return rejected();
      const t = run.target, data = p.data;
      if (kind === 'APPROVAL' && !same(data, { scope: 'G3_EXECUTION', approvalReference: run.approvalReference,
        hostAuthority: 'INDEPENDENT_PROTECTED_CONTROLLER', revoked: false })) return rejected();
      if (kind === 'RESERVATION') {
        const r = z.object({ reservationId: z.uuid(), revision: z.number().int().positive(), resources: z.array(label).length(8),
          commitEvidenceRef: label, exclusive: z.literal(true), state: z.literal('RESERVED') }).strict().parse(data);
        if (!same(r.resources, [t.project, t.container, t.network, t.volume, t.database, t.containerId, t.networkId, t.volumeIdentity])) return rejected();
      }
      if (kind === 'DOCKER' && !same(data, { ...t, running: true, privileged: false, addedCapabilities: 0, internal: true,
        driver: 'bridge', soleNetwork: true, soleContainer: true, dedicatedVolume: true, unexpectedMounts: false, publishedPorts: 0, independentCredentials: true })) return rejected();
      if (kind === 'POSTGRES' && !same(data, { database_name: t.database, role_name: t.role, session_role: t.role, database_owner: t.owner,
        server_address: t.address, server_port: 5432, server_version: 170006, in_recovery: false, superuser: false, create_database: false,
        create_role: false, replication: false, bypass_rls: false, has_memberships: false, database_create: false, schema_create: false,
        recoveryMetadataUpdate: false, publicRecoveryExecute: false, recoveryDefinerOwner: t.owner, recoverySearchPath: 'pg_catalog, public',
        recoveryGuardsValid: true, inventoryExclusionValid: true, financialConstraintsValid: true, readerMutationPrivileges: false,
        migrationDigest: run.migrationDigest, ledger: pinned.entries.map(e => ({ hash: e.sha256, createdAt: e.when })) })) return rejected();
      if (kind === 'STRIPE') {
        const s = stripeSchema.parse(data), budget = budgetSchema.parse(packets.BUDGET!.data), lock = locksSchema.parse(packets.DATABASE_LOCK!.data);
        if (!same(s.identity, { ...run.stripe, livemode: false }) ||
          !budget.requests.some(r => r.id === s.bootstrapRequestId && r.operation === 'BOOTSTRAP_ACCOUNT' && r.outcome === 'KNOWN') ||
          !budget.requests.some(r => r.id === s.startupRequestId && r.operation === 'STARTUP_ACCOUNT' && r.outcome === 'KNOWN' &&
            r.invocationId === lock.invocationId && r.reservedAt >= lock.continuousSince)) return rejected();
      }
      if (kind === 'JOURNAL') { const j = journalSchema.parse(data); if (j.headDigest !== j.independentHeadDigest) return rejected(); }
      if (kind === 'BUDGET') {
        const b = budgetSchema.parse(data), counts = new Map<string, number>();
        let previous = '0'.repeat(64), lastAt = 0;
        const expectedFacts = new Map<string, unknown[]>(), deadlines = new Map<string, number>();
        for (const r of b.requests) expectedFacts.set(r.id, [
          { kind: 'RESERVE', requestId: r.id, invocationId: r.invocationId, operation: r.operation },
          ...(r.dispatchedAt === null ? [] : [{ kind: 'DISPATCH_INTENT', requestId: r.id }]),
          { kind: 'RESULT', requestId: r.id, outcome: r.outcome, providerRequestId: r.providerRequestId },
        ]);
        for (const [i, entry] of b.ledgerEntries.entries()) {
          const { digest, ...core } = entry;
          const fact = z.object({ kind: z.enum(['RESERVE', 'DISPATCH_INTENT', 'RESULT']), requestId: z.uuid() }).passthrough().parse(entry.data);
          const r = b.requests.find(r => r.id === fact.requestId), queue = expectedFacts.get(fact.requestId);
          if (!r || !queue?.length || entry.runId !== run.runId || entry.manifestDigest !== binding.manifestDigest ||
            entry.sequence !== i + 1 || entry.previous !== previous || financialEvidenceDigest(core) !== digest || entry.at < lastAt) return rejected();
          const expected = queue.shift();
          if (fact.kind === 'RESERVE') {
            const deadline = z.number().int().parse(fact.deadline);
            if (deadline <= entry.at || deadline > Math.min(entry.at + 1000, authority.expiresAt) ||
              !same(fact, { ...(expected as object), deadline }) || r.reservationEvidenceRef !== digest || r.reservedAt !== entry.at) return rejected();
            deadlines.set(r.id, deadline);
          } else if (!same(fact, expected) || entry.at !== (fact.kind === 'DISPATCH_INTENT' ? r.dispatchedAt : r.settledAt) ||
            (fact.kind === 'DISPATCH_INTENT' || r.outcome === 'KNOWN') && entry.at >= (deadlines.get(r.id) ?? -1)) return rejected();
          previous = digest; lastAt = entry.at;
        }
        if ([...expectedFacts.values()].some(q => q.length) || b.sequence !== b.ledgerEntries.length ||
          b.headDigest !== previous || b.independentHeadDigest !== previous ||
          new Set(b.requests.map(r => r.id)).size !== b.requests.length || b.requests.length > run.budgets.providerRequests ||
          b.requests.filter(r => r.operation === 'BOOTSTRAP_ACCOUNT').length !== 1) return rejected();
        for (const r of b.requests) {
          if (r.authorityScope !== (r.operation === 'BOOTSTRAP_ACCOUNT' ? 'G2_PREFLIGHT' : 'G3_EXECUTION') ||
            r.reservedAt < Date.parse(run.notBefore) || r.reservedAt > deps.now() ||
            r.dispatchedAt !== null && r.dispatchedAt < r.reservedAt || r.settledAt === null || r.settledAt > deps.now() ||
            r.settledAt < r.reservedAt || !['KNOWN', 'NOT_STARTED'].includes(r.outcome) ||
            r.outcome === 'KNOWN' && (r.dispatchedAt === null || !r.providerRequestId || r.settledAt < r.dispatchedAt || r.settledAt - r.reservedAt >= 1000) ||
            r.outcome === 'NOT_STARTED' && (r.dispatchedAt !== null || r.providerRequestId !== null)) return rejected();
          if (r.operation !== 'BOOTSTRAP_ACCOUNT') counts.set(r.invocationId, (counts.get(r.invocationId) ?? 0) + 1);
        }
        if (counts.size > run.budgets.invocations || [...counts.values()].some(n => n > run.budgets.providerPerInvocation)) return rejected();
      }
      if (kind === 'HOST_LOCK' || kind === 'DATABASE_LOCK') {
        const lock = locksSchema.parse(data);
        if (lock.continuousSince > deps.now() || lock.continuousSince < Date.parse(run.notBefore) || lock.validUntil <= deps.now() ||
          lock.validUntil > authority.expiresAt || lock.validUntil - lock.continuousSince > SUPERVISION_POLICY.maxInvocationMilliseconds ||
          lock.lockKey !== (kind === 'HOST_LOCK' ? SUPERVISION_POLICY.hostLock : supervisionBinding(run).controlLockKey) ||
          (kind === 'HOST_LOCK' ? lock.backendPid !== null || lock.sessionId !== null : lock.backendPid === null || !lock.sessionId)) return rejected();
        if (kind === 'DATABASE_LOCK') {
          const host = locksSchema.parse(packets.HOST_LOCK!.data);
          if (host.invocationId !== lock.invocationId || host.continuousSince > lock.continuousSince) return rejected();
        }
      }
      if (kind === 'DEPENDENCIES' && !same(data, { sourceDigest: run.sourceDigest, targetDigest: binding.targetDigest, database: t.database,
        host: t.address, port: 5432, role: t.role, max: 1, pipeline: false, connectionTimeoutMillis: 1000,
        statement_timeout: 1000, lock_timeout: 500, idle_in_transaction_session_timeout: 1000, transaction_timeout: 10000,
        sharedPoolFallback: false, contracts: FRESH_RUNNER_DEPENDENCIES })) return rejected();
      packets[kind] = p; checked.push(kind);
    }
    // Recheck every observation at the end; later reads cannot extend authority or
    // resurrect expired locks/cancellation. No timers or external monitor installed.
    const end = deps.now(); requireReviewedFreshIntegration(review, end);
    if (deps.signal.aborted || end < authority.notBefore || end >= authority.expiresAt ||
      Object.values(packets).some(p => end >= p.windowEnd || end - p.capturedAt > 30000) ||
      end >= locksSchema.parse(packets.HOST_LOCK!.data).validUntil || end >= locksSchema.parse(packets.DATABASE_LOCK!.data).validUntil)
      return finish('REJECTED', 'AUTHORITY_OR_LOCK_EXPIRED');
    return finish('PENDING_EXTERNAL_AUTHORITY', 'TRUSTED_LAUNCHER_AND_REVIEWED_RUNNER_SEAM_REQUIRED');
  } catch (error) {
    return finish(error instanceof CaptureFailure && error.verdict === 'INCOMPLETE' ? 'PENDING_EXTERNAL_AUTHORITY' : 'REJECTED',
      error instanceof CaptureFailure ? error.code : diagnostic);
  }
}
