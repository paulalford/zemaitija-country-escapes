import 'server-only';
import { z } from 'zod';
import { canonicalRunJson, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { requireAcceptanceFixturePlan, type AcceptanceFixturePlan } from './stripe-acceptance-fixtures';
import { requireReviewedFreshIntegration, type ReviewedFreshIntegration } from './stripe-acceptance-trust';
import { financialEvidenceBinding, financialEvidenceBindingSchema, financialEvidenceDigest } from './stripe-acceptance-financial-evidence';
import { payloadSchemas } from './stripe-acceptance-verifier-evidence';
import { collectorReviewSchema, collectAcceptanceEvidence } from './stripe-acceptance-collectors';
import { inspectFreshRunnerBinding, runnerReviewSchema } from './stripe-acceptance-fresh-runner';
import { capturePacketSchema, capturePinSchema, detachedCapture, isCaptureReader, readPinnedCapture,
  requireIndependentCaptureReaders, type IndependentCaptureReader } from './stripe-acceptance-capture-provenance';
import { inspectSupervisionSimulation, supervisionBinding, SUPERVISION_POLICY } from './stripe-acceptance-supervision';
import { inspectAcceptanceShutdown, shutdownTimelineSchema } from './stripe-acceptance-shutdown';

const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), label = z.string().regex(/^[A-Za-z0-9:_.-]{1,160}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const MONITOR_SOURCES = Object.freeze(['SERVICE', 'PROCESS', 'LOCK_HISTORY'] as const);
export const monitorReviewSchema = z.object({ kind: z.literal('independent-acceptance-monitor-review-v1'),
  binding: financialEvidenceBindingSchema, planDigest: hash, reviewer: label, evidenceClass: z.enum(['SIMULATED', 'RECORDED']),
  runnerReviewDigest: hash, collectorReviewDigest: hash, notBefore: time, expiresAt: time,
  pins: z.object({ SERVICE: capturePinSchema, PROCESS: capturePinSchema, LOCK_HISTORY: capturePinSchema }).strict() }).strict();
export type MonitorReview = z.infer<typeof monitorReviewSchema>;
export const monitoredServiceSchema = z.object({ identity: label, uid: z.number().int().nonnegative(), group: label, gid: z.number().int().nonnegative(), privileged: z.boolean(),
  credentialMode: z.enum(['TEST_ONLY', 'LIVE', 'UNKNOWN']), serviceEnabled: z.boolean(), timerEnabled: z.boolean(),
  cleanup: z.enum(['SETTLED', 'PENDING', 'UNCERTAIN']), resources: z.enum(['KNOWN', 'UNCERTAIN']) }).strict();
export const lockHistorySchema = z.object({ invocationId: z.uuid().nullable(), observations: z.array(z.object({
  layer: z.enum(['HOST', 'DATABASE']), observation: z.enum(['ACQUIRED', 'RENEWED', 'RELEASED', 'CONTENDED', 'LOST', 'UNKNOWN']),
  at: time, ownerId: label, lockKey: z.string().max(160), backendPid: z.number().int().positive().nullable(),
  sessionId: label.nullable(), validUntil: time.nullable() }).strict()).max(256) }).strict();
export type LockHistory = z.infer<typeof lockHistorySchema>;
export const MONITOR_DIAGNOSTICS = ['SOURCE_ONLY_DISABLED', 'MONITOR_EVIDENCE_MISSING', 'MONITOR_EVIDENCE_INVALID',
  'MONITOR_PROVENANCE_CONFLICT', 'AUTHORITY_INVALID', 'AUTHORITY_EXPIRED', 'RUNNER_EVIDENCE_REJECTED', 'RUNNER_EVIDENCE_PENDING',
  'COLLECTORS_INCOMPLETE', 'VERIFIER_REJECTED', 'SERVICE_IDENTITY_REJECTED', 'LIVE_CREDENTIALS_REJECTED', 'SERVICE_ACTIVATION_REJECTED',
  'RESOURCE_UNCERTAIN', 'CLEANUP_UNCERTAIN', 'LOCK_EVIDENCE_INVALID', 'LOCK_CONTENDED', 'LOCK_LOST', 'LOCK_MISSING',
  'JOURNAL_INVALID', 'JOURNAL_INTERRUPTED', 'BUDGET_SOURCE_CONFLICT', 'JOURNAL_SOURCE_CONFLICT', 'BUDGET_UNVERIFIED', 'BUDGET_EXHAUSTED', 'BUDGET_UNCERTAIN', 'PROCESS_UNCERTAIN',
  'MISSED_DEADLINE', 'HARD_TERMINATION_OVERDUE', 'WEBHOOK_BACKLOG', 'UNRESOLVED_INVESTIGATIONS', 'CANCELLED'] as const;
export type MonitorDiagnostic = typeof MONITOR_DIAGNOSTICS[number];
const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);

/** Observations only. RENEWED denotes another continuity observation on the SAME
 * owner/session/key; it may not extend the original lifetime or approval. */
export function inspectAcceptanceLockHistory(run: SealedAcceptanceRun, raw: unknown, now: number) {
  let state: 'HELD' | 'RELEASED' | 'HALTED' | 'UNKNOWN' = 'UNKNOWN';
  const diagnostics = new Set<MonitorDiagnostic>();
  let invocationId: string | null = null;
  const owned = new Map<string, LockHistory['observations'][number]>(), seen = new Set<string>();
  try {
    const p = lockHistorySchema.parse(raw), binding = supervisionBinding(run); invocationId = p.invocationId;
    if (!Number.isSafeInteger(now) || now < Date.parse(run.notBefore) || !p.invocationId || !p.observations.length) throw Error();
    let previous = 0;
    for (const o of p.observations) {
      if (state === 'HALTED' || o.at < previous || o.at > now || o.at < Date.parse(run.notBefore) ||
        o.lockKey !== (o.layer === 'HOST' ? SUPERVISION_POLICY.hostLock : binding.controlLockKey)) throw Error();
      previous = o.at;
      if (['CONTENDED', 'LOST', 'UNKNOWN'].includes(o.observation)) {
        state = 'HALTED'; diagnostics.add(o.observation === 'CONTENDED' ? 'LOCK_CONTENDED' : 'LOCK_LOST'); continue;
      }
      if (o.observation === 'ACQUIRED') {
        if (seen.has(o.layer) || o.layer === 'DATABASE' && !owned.has('HOST') || o.validUntil === null ||
          o.validUntil <= o.at || o.validUntil > Math.min(o.at + SUPERVISION_POLICY.maxInvocationMilliseconds, Date.parse(run.expiresAt)) ||
          (o.layer === 'HOST' ? o.backendPid !== null || o.sessionId !== null : !o.backendPid || !o.sessionId)) throw Error();
        owned.set(o.layer, o); seen.add(o.layer);
      } else {
        const first = owned.get(o.layer);
        if (!first || first.ownerId !== o.ownerId || first.backendPid !== o.backendPid || first.sessionId !== o.sessionId) throw Error();
        if (o.observation === 'RENEWED') {
          if (o.validUntil === null || o.at >= first.validUntil! || o.validUntil !== first.validUntil! || o.validUntil <= o.at) throw Error();
        } else {
          if (o.validUntil !== null || o.at >= first.validUntil! || o.layer === 'HOST' && owned.has('DATABASE')) throw Error();
          owned.delete(o.layer);
        }
      }
    }
    if (state !== 'HALTED') {
      if ([...owned.values()].some(o => now >= o.validUntil!)) { state = 'HALTED'; diagnostics.add('LOCK_LOST'); }
      else if (owned.size === 2) state = 'HELD';
      else if (owned.size === 0 && seen.size === 2) state = 'RELEASED';
      else { state = 'HALTED'; diagnostics.add('LOCK_MISSING'); }
    }
  } catch { state = 'UNKNOWN'; diagnostics.add('LOCK_EVIDENCE_INVALID'); }
  return Object.freeze({ state, invocationId, hostHeld: owned.has('HOST'), databaseHeld: owned.has('DATABASE'),
    diagnostics: Object.freeze([...diagnostics].sort()), operationsEnabled: false as const });
}

type RunnerReads = Pick<Parameters<typeof inspectFreshRunnerBinding>[3], 'authority' | 'sources'>;
type CollectorReads = Pick<Parameters<typeof collectAcceptanceEvidence>[2], 'authority' | 'sources'>;
export type AcceptanceMonitorReaders = Readonly<{ runner: RunnerReads; collectors: CollectorReads;
  authority?: IndependentCaptureReader; sources: Partial<Record<typeof MONITOR_SOURCES[number], IndependentCaptureReader>>;
  now(): number; signal: AbortSignal }>;
/** Cache detached copies of the EXACT reads used by accepted inspectors. Check
 * original capability identities BEFORE wrapping, so observing cannot hide aliasing. */
function observedReaders<K extends string>(authority: IndependentCaptureReader | undefined, sources: Partial<Record<K, IndependentCaptureReader>>) {
  const cache: { authority?: unknown; sources: Partial<Record<K, unknown>> } = { sources: {} };
  const all = [authority, ...Object.values(sources)] as (IndependentCaptureReader | undefined)[];
  const present = all.filter((r): r is IndependentCaptureReader => !!r);
  if (present.some(r => !isCaptureReader(r)) || new Set(present).size !== present.length || new Set(present.map(r => r.read)).size !== present.length)
    return { authority, sources, cache };
  const wrap = (r: IndependentCaptureReader, save: (raw: unknown) => void): IndependentCaptureReader => ({
    kind: 'acceptance-capture-read-only-v1', async read(binding) {
      let raw: unknown;
      try { raw = detachedCapture(await r.read(binding)); } catch { throw Error('SOURCE_UNAVAILABLE'); }
      save(raw); return raw;
    },
  });
  return { authority: authority && wrap(authority, raw => { cache.authority = raw; }), cache,
    sources: Object.fromEntries(Object.entries(sources).map(([k, r]) => [k, wrap(r as IndependentCaptureReader, raw => { cache.sources[k as K] = raw; })])) as Partial<Record<K, IndependentCaptureReader>> };
}

/** Read-only monitor. No store writers, renewal, cancellation dispatch, provider,
 * worker or execution callbacks are accepted. Disabled results cannot grant work. */
export async function inspectAcceptanceMonitoring(run: SealedAcceptanceRun, plan: AcceptanceFixturePlan,
  review: ReviewedFreshIntegration, deps: AcceptanceMonitorReaders) {
  let displayRun: SealedAcceptanceRun | null = null;
  try { financialEvidenceBinding(run); displayRun = run; } catch { /* Never expose fields from an unissued object. */ }
  const diagnostics = new Set<MonitorDiagnostic>(['SOURCE_ONLY_DISABLED']);
  let halted = false;
  const flag = (code: MonitorDiagnostic, halt = false) => { diagnostics.add(code); halted ||= halt; };
  const r = observedReaders(deps.runner.authority, deps.runner.sources), c = observedReaders(deps.collectors.authority, deps.collectors.sources);
  const runner = await inspectFreshRunnerBinding(run, review, { mode: 'source-only', profileId: displayRun?.profileId ?? 'invalid', runId: displayRun?.runId ?? 'invalid' }, { ...r, now: deps.now, signal: deps.signal });
  const collection = await collectAcceptanceEvidence(run, plan, { ...c, now: deps.now, signal: deps.signal });
  let service: z.infer<typeof monitoredServiceSchema> | null = null;
  let process = inspectAcceptanceShutdown(run, undefined, deps.now()), locks = inspectAcceptanceLockHistory(run, undefined, deps.now());
  let authorityValid = false;
  let budgetRequests: unknown[] = [];
  let budget: Readonly<{ verified: boolean; used: number | null; remaining: number | null; bootstrap: number | null; uncertain: number | null; perInvocationRemaining: Readonly<Record<string, number>> | null }> =
    { verified: false, used: null, remaining: null, bootstrap: null, uncertain: null, perInvocationRemaining: null };
  let journal: Readonly<{ verified: boolean; sequence: number | null; headDigest: string | null; checkpointId: string | null; state: string }> =
    { verified: false, sequence: null, headDigest: null, checkpointId: null, state: 'UNKNOWN' };
  let backlog: Readonly<{ paymentInbox: number | null; investigations: number | null; expectedSafetyInvestigations: number | null }> =
    { paymentInbox: null, investigations: null, expectedSafetyInvestigations: null };
  try {
    requireAcceptanceFixturePlan(run, plan); requireReviewedFreshIntegration(review, deps.now());
    const binding = financialEvidenceBinding(run);
    if (!same(review.manifest, run)) throw Error();
    if (!isCaptureReader(deps.authority)) { flag('MONITOR_EVIDENCE_MISSING'); throw Error(); }
    const a = monitorReviewSchema.parse(detachedCapture(await deps.authority.read(binding)));
    if (!same(a.binding, binding) || a.planDigest !== plan.planDigest || a.evidenceClass !== runner.evidenceClass || a.evidenceClass !== collection.verification.evidenceClass || a.notBefore < review.approval.notBefore || a.expiresAt > review.approval.expiresAt ||
      a.runnerReviewDigest !== financialEvidenceDigest(r.cache.authority) || a.collectorReviewDigest !== financialEvidenceDigest(c.cache.authority)) {
      flag('MONITOR_PROVENANCE_CONFLICT', true); throw Error();
    }
    requireIndependentCaptureReaders([deps.authority, ...MONITOR_SOURCES.map(k => deps.sources[k]).filter((v): v is IndependentCaptureReader => !!v)],
      MONITOR_SOURCES.map(k => a.pins[k]), a.reviewer);
    const packets: Partial<Record<typeof MONITOR_SOURCES[number], unknown>> = {};
    for (const k of MONITOR_SOURCES) {
      const p = await readPinnedCapture(deps.sources[k], a.pins[k], binding, `ACCEPTANCE_MONITOR_${k}`, a.evidenceClass, a, deps.now, deps.signal);
      if (p.completeness !== 'COMPLETE' || p.uncertainty !== 'SETTLED' || p.diagnostics.length || p.items.length !== 1 ||
        p.items[0].key !== k || p.items[0].digest !== financialEvidenceDigest(p.data) ||
        p.items[0].completeness !== 'COMPLETE' || p.items[0].uncertainty !== 'SETTLED' || p.items[0].diagnostics.length) throw Error();
      packets[k] = p.data;
      if (k === 'PROCESS' && shutdownTimelineSchema.parse(p.data).observations.some(o => o.at > p.capturedAt)) throw Error();
    }
    service = monitoredServiceSchema.parse(packets.SERVICE);
    process = inspectAcceptanceShutdown(run, shutdownTimelineSchema.parse(packets.PROCESS), deps.now());
    locks = inspectAcceptanceLockHistory(run, packets.LOCK_HISTORY, deps.now());
    if (service.identity !== SUPERVISION_POLICY.serviceIdentity || service.uid === 0 ||
      service.group !== SUPERVISION_POLICY.serviceIdentity || service.gid === 0 || service.privileged) flag('SERVICE_IDENTITY_REJECTED', true);
    if (service.credentialMode !== 'TEST_ONLY') flag('LIVE_CREDENTIALS_REJECTED', true);
    if (service.serviceEnabled || service.timerEnabled) flag('SERVICE_ACTIVATION_REJECTED', true);
    if (service.cleanup === 'UNCERTAIN') flag('CLEANUP_UNCERTAIN', true);
    if (service.resources === 'UNCERTAIN') flag('RESOURCE_UNCERTAIN', true);
    authorityValid = deps.now() >= a.notBefore && deps.now() < a.expiresAt && !deps.signal.aborted;
    if (!authorityValid) flag('AUTHORITY_EXPIRED', true);
    // Projection only; accepted B validation decides budget integrity. No second
    // reservation/replay engine or quota refund is introduced by monitoring.
    const b = capturePacketSchema.safeParse(r.cache.sources.BUDGET);
    const root = runnerReviewSchema.safeParse(r.cache.authority);
    if (b.success && root.success && financialEvidenceDigest(b.data) === root.data.pins.BUDGET.digest) {
      const view = z.object({ requests: z.array(z.object({ invocationId: z.string(), operation: z.string(), outcome: z.string() }).passthrough()) }).passthrough().parse(b.data.data);
      budgetRequests = view.requests;
      const verified = runner.checked.includes('BUDGET');
      const counts = new Map<string, number>();
      for (const request of view.requests) if (request.operation !== 'BOOTSTRAP_ACCOUNT') counts.set(request.invocationId, (counts.get(request.invocationId) ?? 0) + 1);
      budget = { perInvocationRemaining: verified ? Object.freeze(Object.fromEntries([...counts].map(([id, n]) => [id, Math.max(0, run.budgets.providerPerInvocation - n)]))) : null,
        verified, used: view.requests.length, remaining: verified ? Math.max(0, run.budgets.providerRequests - view.requests.length) : null,
        bootstrap: view.requests.filter(q => q.operation === 'BOOTSTRAP_ACCOUNT').length,
        uncertain: view.requests.filter(q => !['KNOWN', 'NOT_STARTED'].includes(q.outcome)).length };
      if (!verified) flag('BUDGET_UNVERIFIED', true);
      if (budget.remaining === 0 || locks.invocationId !== null && budget.perInvocationRemaining?.[locks.invocationId] === 0) flag('BUDGET_EXHAUSTED', true);
      if (budget.uncertain) flag('BUDGET_UNCERTAIN', true);
    } else flag('BUDGET_UNVERIFIED', true);
    const captured = (key: keyof typeof c.cache.sources) => {
      const p = capturePacketSchema.safeParse(c.cache.sources[key]);
      return p.success && collection.captures[key] === financialEvidenceDigest(p.data) ? p.data : null;
    };
    const s = captured('supervision'), db = captured('database');
    const ca = collectorReviewSchema.safeParse(c.cache.authority);
    if (s && ca.success) {
      const facts = payloadSchemas.supervision.parse((s.data as { data: unknown }).data), replay = inspectSupervisionSimulation(run, facts.journal, deps.now());
      const checkpoint = ca.data.review.journalCheckpoint;
      const verified = replay.diagnostic !== 'JOURNAL_INVALID' && facts.journal.sequence === checkpoint.sequence && facts.journal.headDigest === checkpoint.headDigest;
      journal = { verified, sequence: facts.journal.sequence, headDigest: facts.journal.headDigest, checkpointId: checkpoint.protectedRecordId, state: replay.simulatedState };
      const runnerJournal = capturePacketSchema.safeParse(r.cache.sources.JOURNAL);
      if (!runnerJournal.success || !root.success || financialEvidenceDigest(runnerJournal.data) !== root.data.pins.JOURNAL.digest ||
        !same({ sequence: (runnerJournal.data.data as { sequence: number }).sequence, headDigest: (runnerJournal.data.data as { headDigest: string }).headDigest },
          { sequence: facts.journal.sequence, headDigest: facts.journal.headDigest })) flag('JOURNAL_SOURCE_CONFLICT', true);
      for (const receipt of facts.requests) {
        const original = budgetRequests.find(r => (r as { id: string }).id === receipt.requestId);
        const parsed = z.object({ invocationId: z.string(), operation: z.string(), outcome: z.string(), dispatchedAt: time.nullable(), settledAt: time.nullable(), providerRequestId: z.string().nullable() }).passthrough().safeParse(original);
        if (!parsed.success || !same({ invocationId: parsed.data.invocationId, operation: parsed.data.operation, outcome: parsed.data.outcome,
          dispatchedAt: parsed.data.dispatchedAt, settledAt: parsed.data.settledAt, providerRequestId: parsed.data.providerRequestId },
          { invocationId: receipt.invocationId, operation: receipt.operation, outcome: receipt.outcome,
            dispatchedAt: receipt.dispatchedAt, settledAt: receipt.settledAt, providerRequestId: receipt.providerRequestId })) flag('BUDGET_SOURCE_CONFLICT', true);
      }
      if (!verified) flag('JOURNAL_INVALID', true);
      if (['UNCERTAIN', 'HALTED'].includes(replay.simulatedState)) flag('JOURNAL_INTERRUPTED', true);
    } else flag('JOURNAL_INVALID', true);
    if (db) {
      const data = payloadSchemas.database.parse((db.data as { data: unknown }).data);
      const expected = new Set(collection.verification.scenarios.filter(s => s.expectedInvestigationSafe).map(s => plan.fixtures.find(f => f.name === s.scenario)!.fixtureId));
      backlog = { paymentInbox: data.fixtures.flatMap(f => f.inbox).filter(i => !['PROCESSED', 'IGNORED'].includes(i.state)).length,
        investigations: data.fixtures.filter(f => !expected.has(f.fixtureId)).flatMap(f => f.investigations).length,
        expectedSafetyInvestigations: data.fixtures.filter(f => expected.has(f.fixtureId)).flatMap(f => f.investigations).length };
      if (backlog.paymentInbox) flag('WEBHOOK_BACKLOG');
      if (backlog.investigations) flag('UNRESOLVED_INVESTIGATIONS', true);
    }
    if (process.invocationId !== null && process.invocationId !== locks.invocationId) flag('LOCK_EVIDENCE_INVALID', true);
    if (process.state !== 'NOT_STARTED' && locks.state !== 'HELD' && !(process.state === 'SETTLED' && locks.state === 'RELEASED')) flag('LOCK_LOST', true);
    if (locks.state === 'RELEASED') {
      const processFacts = shutdownTimelineSchema.parse(packets.PROCESS), history = lockHistorySchema.parse(packets.LOCK_HISTORY);
      const cleanupAt = processFacts.observations.find(o => o.kind === 'CLEANUP_OBSERVED' && o.outcome === 'SETTLED')?.at;
      if (process.state !== 'SETTLED' || cleanupAt === undefined || history.observations.some(o => o.observation === 'RELEASED' && o.at < cleanupAt)) flag('LOCK_EVIDENCE_INVALID', true);
    }
    requireReviewedFreshIntegration(review, deps.now());
    for (const raw of [...Object.values(r.cache.sources), ...Object.values(c.cache.sources)]) {
      const packet = capturePacketSchema.safeParse(raw);
      if (packet.success && (deps.now() >= packet.data.windowEnd || deps.now() - packet.data.capturedAt > 30000)) {
        authorityValid = false; flag('MONITOR_EVIDENCE_INVALID', true);
      }
    }
    if (deps.now() >= a.expiresAt || deps.signal.aborted) { authorityValid = false; flag('AUTHORITY_EXPIRED', true); }
  } catch { flag('MONITOR_EVIDENCE_INVALID', true); }
  if (runner.status === 'REJECTED') flag('RUNNER_EVIDENCE_REJECTED', true);
  else if (runner.checked.length < runner.constructionSequence.length) flag('RUNNER_EVIDENCE_PENDING');
  if (collection.verdict !== 'PASS') flag('COLLECTORS_INCOMPLETE');
  if (['FAIL', 'INVESTIGATION_REQUIRED'].includes(collection.verdict)) flag('VERIFIER_REJECTED', true);
  for (const d of locks.diagnostics) flag(d, true);
  if (['UNKNOWN', 'HALTED'].includes(process.state)) flag('PROCESS_UNCERTAIN', true);
  if (process.diagnostics.includes('DEADLINE_MISSED')) flag('MISSED_DEADLINE', true);
  if (process.diagnostics.includes('HARD_TERMINATION_DUE')) flag('HARD_TERMINATION_OVERDUE', true);
  if (process.diagnostics.includes('CLEANUP_UNCERTAIN')) flag('CLEANUP_UNCERTAIN', true);
  if (process.diagnostics.includes('STORAGE_UNCERTAIN')) flag('RESOURCE_UNCERTAIN', true);
  if (deps.signal.aborted) flag('CANCELLED', true);
  return Object.freeze({ stage: '2C-REMEDIATION-C' as const, readiness: 'NOT_READY' as const, operationsEnabled: false as const,
    schedulingEnabled: false as const, safetyState: halted ? 'HALTED' as const : 'DISABLED' as const,
    runId: displayRun?.runId ?? null, sourceDigest: displayRun?.sourceDigest ?? null, authorityValid, artifactIntegrity: runner.checked.includes('STATIC_INTEGRITY'),
    resources: displayRun?.target ?? null, service: service && Object.freeze(service), journal: Object.freeze(journal), providerBudget: Object.freeze(budget),
    locks, process, backlog: Object.freeze(backlog), runner, collection,
    finalVerifierReady: !halted && authorityValid && collection.verdict === 'PASS' && collection.verification.evidenceClass === 'RECORDED',
    diagnostics: Object.freeze([...diagnostics].sort()) });
}
