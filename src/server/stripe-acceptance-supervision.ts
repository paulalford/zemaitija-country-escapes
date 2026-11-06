import 'server-only';
import { z } from 'zod';
import { canonicalRunJson, freshAcceptanceNames, requireSealedAcceptanceRun, runManifestDigest,
  type SealedAcceptanceRun } from './stripe-acceptance-run';

export const SUPERVISOR_STATES = ['DISABLED', 'PENDING_AUTHORITY', 'READY_FOR_AUTHORISED_INVOCATION',
  'LOCKED', 'RUNNING', 'CANCELLING', 'COMPLETED', 'FAILED', 'UNCERTAIN', 'HALTED'] as const;
export type SupervisorState = typeof SUPERVISOR_STATES[number];
export const SUPERVISION_POLICY = Object.freeze({ stage: '2C-3G', schedulingEnabled: false,
  operationsEnabled: false, executable: false, hostLock: '/run/lock/zec-acceptance/invocation.lock',
  serviceIdentity: 'zec-acceptance', maxInvocationMilliseconds: 60_000, maxProviderMilliseconds: 1000 } as const);
export type SupervisionDiagnostic = 'SOURCE_ONLY' | 'INVALID_MANIFEST' | 'AUTHORITY_REQUIRED' |
  'TARGET_REJECTED' | 'LOCK_CONTENDED' | 'LOCK_LOST' | 'JOURNAL_INVALID' | 'JOURNAL_UNAVAILABLE' |
  'BUDGET_EXHAUSTED' | 'DEADLINE' | 'CANCELLED' | 'HOST_SHUTDOWN' | 'PROVIDER_TIMEOUT' |
  'PROVIDER_UNCERTAIN' | 'CLEANUP_UNCERTAIN' | 'STALLED_WORKER' | 'INTERRUPTED' | 'WORKER_FAILED';
const fail = (code: SupervisionDiagnostic): never => { throw new Error(code); };
const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.uuid();
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const PROVIDER_OPERATIONS = ['STARTUP_ACCOUNT', 'WORKER_ACCOUNT', 'CHECKOUT_DISPATCH',
  'PAYMENT_STATUS_RECOVERY', 'PROVIDER_RECONCILIATION', 'OTHER_AUTHORISED'] as const;
const authority = z.object({ manifest: z.literal(true), approval: z.literal(true), reservation: z.literal(true),
  docker: z.literal(true), postgres: z.literal(true), stripeTestAccount: z.literal(true),
  journal: z.literal(true), budgetStore: z.literal(true) }).strict();
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('OPEN'), deadline: time }).strict(),
  z.object({ kind: z.literal('AUTHORITY'), verified: authority, database: z.string(),
    targetDigest: hash }).strict(),
  z.object({ kind: z.literal('LOCK'), layer: z.enum(['HOST', 'DATABASE']),
    observation: z.enum(['ACQUIRED', 'CONTENDED', 'LOST', 'RELEASED', 'UNKNOWN']) }).strict(),
  z.object({ kind: z.literal('START') }).strict(),
  z.object({ kind: z.literal('RESERVE'), requestId: id, operation: z.enum(PROVIDER_OPERATIONS) }).strict(),
  z.object({ kind: z.literal('PROVIDER_RESULT'), requestId: id,
    outcome: z.enum(['KNOWN', 'UNCERTAIN', 'CANCELLED', 'TIMEOUT', 'NOT_STARTED']) }).strict(),
  z.object({ kind: z.literal('CANCEL'), reason: z.enum(['CANCELLED', 'DEADLINE', 'HOST_SHUTDOWN', 'STALLED_WORKER']) }).strict(),
  z.object({ kind: z.literal('WORKER'), outcome: z.enum(['SUCCEEDED', 'FAILED', 'UNCERTAIN']) }).strict(),
  z.object({ kind: z.literal('CLEANUP'), outcome: z.enum(['SETTLED', 'FAILED', 'UNCERTAIN']) }).strict(),
  z.object({ kind: z.literal('FINISH'), state: z.enum(['COMPLETED', 'FAILED', 'UNCERTAIN', 'HALTED']) }).strict(),
]);
export type SupervisionEvent = z.infer<typeof eventSchema>;
const bindingSchema = z.object({ runId: id, manifestDigest: hash, sourceDigest: hash, migrationDigest: hash,
  approvalReference: z.string(), targetDigest: hash, database: z.string(), controlLockKey: z.string().regex(/^[a-f0-9]{16}$/) }).strict();
export type SupervisionBinding = Readonly<z.infer<typeof bindingSchema>>;
export function supervisionBinding(run: SealedAcceptanceRun): SupervisionBinding {
  requireSealedAcceptanceRun(run);
  if (run.target.database !== freshAcceptanceNames(run.runId).database) return fail('TARGET_REJECTED');
  return Object.freeze({ runId: run.runId, manifestDigest: runManifestDigest(canonicalRunJson(run)),
    sourceDigest: run.sourceDigest, migrationDigest: run.migrationDigest, approvalReference: run.approvalReference,
    targetDigest: runManifestDigest(canonicalRunJson(run.target)), database: run.target.database,
    controlLockKey: runManifestDigest(`zec-supervisor-v1:${run.profileId}:${run.runId}`).slice(0, 16) });
}

/** FUTURE trusted adapters. Never constructed or called by this source model.
 * A session lock is NOT a recovery lease or resource reservation. */
export interface FutureExclusiveLocks {
  acquireHost(): Promise<{ observation: 'ACQUIRED' | 'CONTENDED' | 'UNKNOWN';
    check(): Promise<'HELD' | 'LOST' | 'UNKNOWN'>; release(): Promise<'RELEASED' | 'UNKNOWN'> }>;
  acquireDatabase(binding: SupervisionBinding): Promise<{ observation: 'ACQUIRED' | 'CONTENDED' | 'UNKNOWN';
    check(): Promise<'HELD' | 'LOST' | 'UNKNOWN'>; release(): Promise<'RELEASED' | 'UNKNOWN'> }>;
}
const entrySchema = z.object({ sequence: z.number().int().positive(), previousDigest: hash, digest: hash,
  binding: bindingSchema, invocationId: id, at: time, event: eventSchema }).strict();
export type SupervisionEntry = z.infer<typeof entrySchema>;
const snapshotSchema = z.object({ complete: z.literal(true), durable: z.literal(true),
  sequence: z.number().int().nonnegative(), headDigest: hash, entries: z.array(entrySchema).max(20_000) }).strict();
export type DurableSupervisionSnapshot = z.infer<typeof snapshotSchema>;
/** One linearizable store owns BOTH journal and budget. Acknowledgement requires
 * durable commit plus a protected independent head checkpoint (anti-truncation).
 * CAS losers dispatch nothing; ambiguous acknowledgement blocks ALL dispatch.
 * Unknown reads/writes must durably fence the run until independent reconciliation,
 * including across adapter/process restarts. Real implementations need separate
 * approval. No default adapter exists. */
export interface DurableSupervisionStore {
  read(binding: SupervisionBinding): Promise<unknown>;
  compareAndAppend(binding: SupervisionBinding, expected: Readonly<{ sequence: number; headDigest: string }>,
    entry: SupervisionEntry): Promise<'DURABLE' | 'CONFLICT' | 'UNKNOWN'>;
}
/** Future transport seam only: must surround every underlying HTTP attempt,
 * including SDK retries and both account checks, beneath boundedAutomationFetch.
 * No fetch, gateway, callback, worker or real request is accepted here. */
export interface FutureAggregateProviderGate {
  reserveBeforeDispatch(binding: SupervisionBinding, invocationId: string, requestId: string,
    operation: typeof PROVIDER_OPERATIONS[number], signal: AbortSignal): Promise<'DURABLE' | 'DENIED' | 'UNKNOWN'>;
  recordAfterDispatch(requestId: string, outcome: 'KNOWN' | 'UNCERTAIN' | 'CANCELLED' | 'TIMEOUT' | 'NOT_STARTED'): Promise<'DURABLE' | 'UNKNOWN'>;
}
export const EMPTY_JOURNAL_DIGEST = '0'.repeat(64);
export function supervisionEntry(binding: SupervisionBinding, invocationId: string, at: number,
  event: SupervisionEvent, previous: Readonly<{ sequence: number; headDigest: string }>): SupervisionEntry {
  const core = { sequence: previous.sequence + 1, previousDigest: previous.headDigest,
    binding, invocationId, at, event };
  return entrySchema.parse({ ...core, digest: runManifestDigest(canonicalRunJson(core)) });
}
type Invocation = { id: string; state: SupervisorState; deadline: number; started: boolean;
  host: boolean; database: boolean; worker: 'SUCCEEDED' | 'FAILED' | 'UNCERTAIN' | null;
  cleanup: boolean; cancelled: boolean; uncertain: boolean; requests: number; finished: boolean };
type Request = { invocationId: string; outcome: string | null };
type Projection = { state: SupervisorState; diagnostic: SupervisionDiagnostic; used: number; settled: number;
  invocations: Map<string, Invocation>; requests: Map<string, Request>; current: Invocation | undefined };
const terminal = (s: SupervisorState) => ['COMPLETED', 'FAILED', 'UNCERTAIN', 'HALTED'].includes(s);
function replay(run: SealedAcceptanceRun, raw: unknown): Projection {
  const binding = supervisionBinding(run), snapshot = snapshotSchema.parse(raw);
  const p: Projection = { state: 'DISABLED', diagnostic: 'SOURCE_ONLY', used: 0, settled: 0,
    invocations: new Map(), requests: new Map(), current: undefined };
  let digest = EMPTY_JOURNAL_DIGEST, sequence = 0, lastAt = 0;
  for (const entry of snapshot.entries) {
    const { digest: observed, ...core } = entry;
    if (entry.sequence !== ++sequence || entry.previousDigest !== digest || entry.at < lastAt ||
      canonicalRunJson(entry.binding) !== canonicalRunJson(binding) ||
      observed !== runManifestDigest(canonicalRunJson(core))) return fail('JOURNAL_INVALID');
    digest = observed; lastAt = entry.at;
    const e = entry.event;
    if (e.kind === 'OPEN') {
      if (p.invocations.has(entry.invocationId) || p.current && (!p.current.finished || p.current.uncertain ||
        p.current.state === 'HALTED') || p.invocations.size >= run.budgets.invocations) return fail('JOURNAL_INVALID');
      if (entry.at < Date.parse(run.notBefore) || entry.at >= Date.parse(run.expiresAt) ||
        e.deadline <= entry.at || e.deadline > Math.min(entry.at + SUPERVISION_POLICY.maxInvocationMilliseconds,
          Date.parse(run.expiresAt))) return fail('DEADLINE');
      p.current = { id: entry.invocationId, state: 'PENDING_AUTHORITY', deadline: e.deadline, started: false,
        host: false, database: false, worker: null, cleanup: false, cancelled: false, uncertain: false, requests: 0, finished: false };
      p.invocations.set(entry.invocationId, p.current);
    } else {
      const i = p.current;
      if (!i || i.id !== entry.invocationId || i.finished) return fail('JOURNAL_INVALID');
      const admission = e.kind === 'AUTHORITY' || e.kind === 'START' || e.kind === 'RESERVE' ||
        e.kind === 'LOCK' && e.observation === 'ACQUIRED';
      if (admission && (entry.at >= i.deadline || entry.at >= Date.parse(run.expiresAt))) return fail('DEADLINE');
      if (e.kind === 'AUTHORITY') {
        if (i.state !== 'PENDING_AUTHORITY' || e.database !== binding.database || e.targetDigest !== binding.targetDigest)
          return fail('TARGET_REJECTED');
        i.state = 'READY_FOR_AUTHORISED_INVOCATION';
      } else if (e.kind === 'LOCK') {
        const key = e.layer === 'HOST' ? 'host' : 'database';
        if (e.observation === 'ACQUIRED') {
          if (i.state !== 'READY_FOR_AUTHORISED_INVOCATION' || i[key] || e.layer === 'DATABASE' && !i.host)
            return fail('JOURNAL_INVALID');
          i[key] = true; if (i.host && i.database) i.state = 'LOCKED';
        } else if (e.observation === 'RELEASED') {
          if (!i[key] || !i.cleanup) return fail('JOURNAL_INVALID');
          i[key] = false;
        } else {
          if (e.observation === 'CONTENDED' && (i.started || i[key])) return fail('JOURNAL_INVALID');
          i.state = 'HALTED'; i.uncertain ||= i.started;
          p.diagnostic = e.observation === 'CONTENDED' ? 'LOCK_CONTENDED' : 'LOCK_LOST';
        }
      } else if (e.kind === 'START') {
        if (i.state !== 'LOCKED' || !i.host || !i.database || i.started || i.cleanup) return fail('AUTHORITY_REQUIRED');
        i.started = true; i.state = 'RUNNING';
      } else if (e.kind === 'RESERVE') {
        // Startup verification is permitted after BOTH locks, before worker START.
        if (!['LOCKED', 'RUNNING'].includes(i.state) || !i.host || !i.database || i.worker || i.cleanup ||
          p.requests.has(e.requestId)) return fail('JOURNAL_INVALID');
        if (p.used >= run.budgets.providerRequests || i.requests >= run.budgets.providerPerInvocation)
          return fail('BUDGET_EXHAUSTED');
        p.requests.set(e.requestId, { invocationId: i.id, outcome: null }); p.used++; i.requests++;
      } else if (e.kind === 'PROVIDER_RESULT') {
        const request = p.requests.get(e.requestId);
        if (!request || request.invocationId !== i.id || request.outcome !== null) return fail('JOURNAL_INVALID');
        request.outcome = e.outcome; p.settled++;
        // Even NOT_STARTED retains its reservation; cancellation never refunds quota.
        if (['UNCERTAIN', 'CANCELLED', 'TIMEOUT'].includes(e.outcome)) {
          i.uncertain = true; i.state = 'CANCELLING';
          p.diagnostic = e.outcome === 'TIMEOUT' ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNCERTAIN';
        }
      } else if (e.kind === 'CANCEL') {
        if (terminal(i.state)) return fail('JOURNAL_INVALID');
        if (e.reason === 'DEADLINE' && entry.at < i.deadline) return fail('JOURNAL_INVALID');
        i.cancelled = true; i.state = 'CANCELLING'; p.diagnostic = e.reason;
      } else if (e.kind === 'WORKER') {
        if (!i.started || i.worker || !['RUNNING', 'CANCELLING', 'HALTED'].includes(i.state)) return fail('JOURNAL_INVALID');
        i.worker = e.outcome; i.uncertain ||= e.outcome === 'UNCERTAIN';
        if (e.outcome === 'FAILED') p.diagnostic = 'WORKER_FAILED';
      } else if (e.kind === 'CLEANUP') {
        if (i.cleanup || i.started && !i.worker && !['CANCELLING', 'HALTED'].includes(i.state)) return fail('JOURNAL_INVALID');
        i.cleanup = e.outcome === 'SETTLED';
        if (!i.cleanup) { i.uncertain = true; i.state = 'UNCERTAIN'; p.diagnostic = 'CLEANUP_UNCERTAIN'; }
      } else if (e.kind === 'FINISH') {
        const pending = [...p.requests.values()].some(r => r.invocationId === i.id && r.outcome === null);
        const unsafe = i.uncertain || pending || !i.cleanup || i.host || i.database || i.started && !i.worker;
        if (e.state === 'COMPLETED' && (unsafe || i.worker !== 'SUCCEEDED' || i.cancelled ||
          i.state === 'HALTED' || entry.at >= i.deadline || entry.at >= Date.parse(run.expiresAt))) return fail('JOURNAL_INVALID');
        if (e.state === 'FAILED' && (unsafe || !i.cancelled && i.worker !== 'FAILED' || i.state === 'HALTED'))
          return fail('JOURNAL_INVALID');
        if (e.state === 'HALTED' && (unsafe || i.state !== 'HALTED')) return fail('JOURNAL_INVALID');
        i.uncertain ||= unsafe || e.state === 'UNCERTAIN'; i.state = e.state; i.finished = true;
      }
    }
    p.state = p.current!.state;
  }
  if (snapshot.sequence !== sequence || snapshot.headDigest !== digest) return fail('JOURNAL_INVALID');
  return p;
}
export type SupervisionReport = Readonly<{ state: 'DISABLED'; schedulingEnabled: false; operationsEnabled: false;
  simulatedState: SupervisorState; diagnostic: SupervisionDiagnostic; providerAllowancesUsed: number;
  providerResultsRecorded: number; workerObservation: 'DEFINITELY_NOT_STARTED' | 'STARTED_KNOWN_RESULT' | 'STARTED_UNCERTAIN_RESULT' }>;
/** Recovery reads verified durable history; it never resumes a worker. Incomplete
 * history always needs independent reconciliation, including an unspent allowance. */
export function inspectSupervisionSimulation(run: SealedAcceptanceRun, raw: unknown, now: number): SupervisionReport {
  let state: SupervisorState = 'HALTED', diagnostic: SupervisionDiagnostic = 'JOURNAL_INVALID', used = 0, settled = 0;
  let worker: SupervisionReport['workerObservation'] = 'STARTED_UNCERTAIN_RESULT';
  try {
    try { supervisionBinding(run); } catch { return Object.freeze({ state: 'DISABLED', schedulingEnabled: false,
      operationsEnabled: false, simulatedState: 'HALTED', diagnostic: 'INVALID_MANIFEST', providerAllowancesUsed: 0,
      providerResultsRecorded: 0, workerObservation: 'STARTED_UNCERTAIN_RESULT' }); }
    const p = replay(run, raw); used = p.used; settled = p.settled; state = p.state; diagnostic = p.diagnostic;
    const i = p.current;
    worker = !i?.started ? 'DEFINITELY_NOT_STARTED' : i.worker && i.worker !== 'UNCERTAIN'
      ? 'STARTED_KNOWN_RESULT' : 'STARTED_UNCERTAIN_RESULT';
    if (!Number.isSafeInteger(now) || now < (snapshotSchema.parse(raw).entries.at(-1)?.at ?? 0)) return fail('JOURNAL_INVALID');
    if (i && !i.finished) { state = 'UNCERTAIN'; diagnostic = now >= i.deadline ? 'DEADLINE' : 'INTERRUPTED'; }
  } catch { state = 'HALTED'; diagnostic = 'JOURNAL_INVALID'; worker = 'STARTED_UNCERTAIN_RESULT'; }
  return Object.freeze({ state: 'DISABLED', schedulingEnabled: false, operationsEnabled: false,
    simulatedState: state, diagnostic, providerAllowancesUsed: used, providerResultsRecorded: settled, workerObservation: worker });
}

/** SOURCE SIMULATION ONLY. Appends data; cannot dispatch requests, run workers,
 * acquire locks, schedule timers, enable scheduling or grant operational authority.
 * Tests inject a fake durable adapter. Never wire to operational adapters here. */
const unavailableStores = new WeakSet<DurableSupervisionStore>();
export async function appendSupervisionSimulation(run: SealedAcceptanceRun, store: DurableSupervisionStore,
  invocationId: string, at: number, event: SupervisionEvent): Promise<Readonly<{ status: 'RECORDED' | 'BLOCKED';
    diagnostic: SupervisionDiagnostic; simulatedState?: SupervisorState }>> {
  let diagnostic: SupervisionDiagnostic = 'INVALID_MANIFEST';
  try {
    const binding = supervisionBinding(run); diagnostic = 'JOURNAL_UNAVAILABLE';
    if (unavailableStores.has(store)) return { status: 'BLOCKED', diagnostic };
    const raw = await store.read(binding); diagnostic = 'JOURNAL_INVALID';
    const snapshot = snapshotSchema.parse(raw);
    const entry = supervisionEntry(binding, invocationId, at, event, snapshot);
    const candidate = { ...snapshot, sequence: entry.sequence, headDigest: entry.digest, entries: [...snapshot.entries, entry] };
    let p: Projection;
    try { p = replay(run, candidate); } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (['DEADLINE', 'BUDGET_EXHAUSTED', 'TARGET_REJECTED', 'AUTHORITY_REQUIRED'].includes(code))
        diagnostic = code as SupervisionDiagnostic;
      throw error;
    }
    diagnostic = 'JOURNAL_UNAVAILABLE';
    const ack = await store.compareAndAppend(binding, snapshot, entry);
    if (ack !== 'DURABLE') {
      if (ack !== 'CONFLICT') unavailableStores.add(store);
      return { status: 'BLOCKED', diagnostic };
    }
    return Object.freeze({ status: 'RECORDED', diagnostic: p.diagnostic, simulatedState: p.state });
  } catch {
    if (diagnostic === 'JOURNAL_UNAVAILABLE') unavailableStores.add(store);
    return Object.freeze({ status: 'BLOCKED', diagnostic });
  }
}
