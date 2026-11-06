import 'server-only';
import { z } from 'zod';
import { canonicalRunJson } from './stripe-acceptance-run';
import { acceptanceDigest, requireReviewedFreshIntegration, type ReviewedFreshIntegration } from './stripe-acceptance-trust';
import { requireFreshAuthority, type FreshLiveAuthority } from './stripe-acceptance-fresh-database';
import { inspectSupervisionSimulation, supervisionBinding, type DurableSupervisionStore,
  type SupervisionEntry } from './stripe-acceptance-supervision';
import type { SealedAcceptanceRun } from './stripe-acceptance-run';

const hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const fail = (): never => { throw Error('DURABLE_EVIDENCE_UNCERTAIN'); };
export interface AtomicEvidenceCell {
  read(): Promise<unknown>;
  compareAndSwap(revision: number, image: unknown): Promise<'DURABLE' | 'CONFLICT' | 'UNKNOWN'>;
  fence(): Promise<void>;
}
export interface ProtectedHeadPort {
  read(): Promise<{ revision: number; digest: string; fenced: boolean }>;
  compareAndSwap(previous: Readonly<{ revision: number; digest: string }>, next: Readonly<{ revision: number; digest: string }>): Promise<'DURABLE' | 'CONFLICT' | 'UNKNOWN'>;
  fence(): Promise<void>;
}
const fact = z.object({ sequence: z.number().int().positive(), previous: hash, digest: hash,
  runId: z.uuid(), manifestDigest: hash, at: time, data: z.unknown() }).strict();
const imageSchema = z.object({ revision: z.number().int().nonnegative(), image: z.object({
  entries: z.array(fact).max(20000) }).strict(), fenced: z.literal(false) }).strict();
export type AnchoredFact = z.infer<typeof fact>;
/** Journal acknowledgements require two independent durable stores. A gap between
 * DB CAS and head CAS is intentionally unavailable, never repaired automatically.
 * UNKNOWN fences BOTH stores; a restarted adapter cannot clear either fence. */
export function anchoredEvidence(review: ReviewedFreshIntegration, cell: AtomicEvidenceCell, head: ProtectedHeadPort) {
  let locallyFenced = false;
  async function fence() {
    locallyFenced = true;
    const results = await Promise.allSettled([cell.fence(), head.fence()]);
    if (results.some(r => r.status === 'rejected')) return fail();
  }
  async function read() {
    try {
      if (locallyFenced) return fail();
      const state = imageSchema.parse(await cell.read()), anchor = await head.read();
      let previous = '0'.repeat(64), at = 0;
      for (const [index, entry] of state.image.entries.entries()) {
        const { digest, ...core } = entry;
        if (entry.sequence !== index + 1 || entry.previous !== previous || entry.runId !== review.manifest.runId ||
          entry.manifestDigest !== review.approval.manifestDigest || entry.at < at || acceptanceDigest(core) !== digest) return fail();
        previous = digest; at = entry.at;
      }
      if (state.revision !== state.image.entries.length || anchor.fenced || anchor.revision !== state.revision || anchor.digest !== previous) return fail();
      return { revision: state.revision, digest: previous, entries: state.image.entries };
    } catch { await fence(); return fail(); }
  }
  return { read, fence, async append(expected: Awaited<ReturnType<typeof read>>, at: number, data: unknown) {
    try {
      const current = await read();
      if (current.revision !== expected.revision || current.digest !== expected.digest) return 'CONFLICT' as const;
      const core = { sequence: current.revision + 1, previous: current.digest, runId: review.manifest.runId,
        manifestDigest: review.approval.manifestDigest, at, data: JSON.parse(canonicalRunJson(data)) as unknown };
      const entry = fact.parse({ ...core, digest: acceptanceDigest(core) });
      if (at < (current.entries.at(-1)?.at ?? 0)) return fail();
      const ack = await cell.compareAndSwap(current.revision, { entries: [...current.entries, entry] });
      if (ack === 'CONFLICT') return 'CONFLICT' as const;
      if (ack !== 'DURABLE' || await head.compareAndSwap({ revision: current.revision, digest: current.digest },
        { revision: entry.sequence, digest: entry.digest }) !== 'DURABLE') {
        await fence(); return 'UNKNOWN' as const;
      }
      return 'DURABLE' as const;
    } catch { await fence(); return 'UNKNOWN' as const; }
  } };
}
export type AnchoredEvidence = ReturnType<typeof anchoredEvidence>;

/** Bridges the accepted v1 journal WITHOUT calling its simulation append API with
 * a real store. Independent head anchors outer facts; inner v1 hashes are retained. */
export function durableSupervisionStore(run: SealedAcceptanceRun, ledger: AnchoredEvidence): DurableSupervisionStore {
  const binding = supervisionBinding(run);
  async function snapshot() {
    const s = await ledger.read(), entries = s.entries.map(f => f.data as SupervisionEntry);
    const image = { complete: true as const, durable: true as const, sequence: entries.length,
      headDigest: entries.at(-1)?.digest ?? '0'.repeat(64), entries };
    if (entries.length && inspectSupervisionSimulation(run, image, entries.at(-1)!.at).diagnostic === 'JOURNAL_INVALID') {
      await ledger.fence(); return fail();
    }
    return { s, image };
  }
  return {
    async read(b) {
      if (canonicalRunJson(b) !== canonicalRunJson(binding)) return fail();
      return (await snapshot()).image;
    },
    async compareAndAppend(b, expected, entry) {
      if (canonicalRunJson(b) !== canonicalRunJson(binding)) return 'UNKNOWN';
      const { s, image } = await snapshot();
      if (image.sequence !== expected.sequence || image.headDigest !== expected.headDigest) return 'CONFLICT';
      const next = { ...image, sequence: entry.sequence, headDigest: entry.digest, entries: [...image.entries, entry] };
      if (inspectSupervisionSimulation(run, next, entry.at).diagnostic === 'JOURNAL_INVALID') return 'UNKNOWN';
      return ledger.append(s, entry.at, entry);
    },
  };
}

export const REQUEST_OPERATIONS = ['BOOTSTRAP_ACCOUNT', 'STARTUP_ACCOUNT', 'WORKER_ACCOUNT', 'CHECKOUT_DISPATCH',
  'PAYMENT_STATUS_RECOVERY', 'PROVIDER_RECONCILIATION', 'OTHER_AUTHORISED'] as const;
const requestFact = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('RESERVE'), requestId: z.uuid(), invocationId: z.uuid(), operation: z.enum(REQUEST_OPERATIONS), deadline: time }).strict(),
  z.object({ kind: z.literal('DISPATCH_INTENT'), requestId: z.uuid() }).strict(),
  z.object({ kind: z.literal('RESULT'), requestId: z.uuid(), outcome: z.enum(['KNOWN', 'UNCERTAIN', 'TIMEOUT', 'CANCELLED', 'NOT_STARTED']),
    providerRequestId: z.string().max(160).nullable() }).strict(),
]);
export type RequestOperation = typeof REQUEST_OPERATIONS[number];
/** One ledger for bootstrap AND all invocations/restarts. Every attempted request
 * consumes a non-refundable allowance, even NOT_STARTED. Interrupted reservations
 * forbid further dispatch until independent reconciliation; no reset API exists. */
export function durableProviderBudget(review: ReviewedFreshIntegration, ledger: AnchoredEvidence,
  deps: { now: () => number; authority: FreshLiveAuthority; locksHeld(): Promise<boolean> }) {
  async function replay() {
    const state = await ledger.read(), requests = new Map<string, { invocationId: string; operation: RequestOperation;
      at: number; deadline: number; dispatchIntentAt: number | null; outcome: string | null }>();
    const counts = new Map<string, number>(); let bootstrap = 0;
    try {
      for (const entry of state.entries) {
        const e = requestFact.parse(entry.data);
        if (e.kind === 'RESERVE') {
          if (requests.has(e.requestId) || e.deadline <= entry.at || e.deadline > Math.min(entry.at + 1000, review.approval.expiresAt)) return fail();
          if (e.operation === 'BOOTSTRAP_ACCOUNT') bootstrap++;
          else counts.set(e.invocationId, (counts.get(e.invocationId) ?? 0) + 1);
          requests.set(e.requestId, { invocationId: e.invocationId, operation: e.operation, at: entry.at, deadline: e.deadline, dispatchIntentAt: null, outcome: null });
        } else if (e.kind === 'DISPATCH_INTENT') {
          const r = requests.get(e.requestId);
          if (!r || r.outcome !== null || r.dispatchIntentAt !== null || entry.at >= r.deadline) return fail();
          r.dispatchIntentAt = entry.at;
        } else {
          const r = requests.get(e.requestId);
          if (!r || r.outcome !== null || entry.at < r.at || e.outcome === 'KNOWN' && (entry.at >= r.deadline || r.dispatchIntentAt === null)) return fail();
          r.outcome = e.outcome;
        }
      }
      if (bootstrap > 1 || requests.size > review.manifest.budgets.providerRequests || counts.size > review.manifest.budgets.invocations ||
        [...counts.values()].some(n => n > review.manifest.budgets.providerPerInvocation)) return fail();
      return { state, requests, counts, bootstrap };
    } catch { await ledger.fence(); return fail(); }
  }
  return {
    async reserve(invocationId: string, requestId: string, operation: RequestOperation, signal: AbortSignal) {
      try {
        requireReviewedFreshIntegration(review, deps.now());
        await requireFreshAuthority(review, deps.authority, deps.now, signal);
        if (!await deps.locksHeld()) return 'DENIED' as const;
        const p = await replay(), now = deps.now();
        const permitted = operation === 'BOOTSTRAP_ACCOUNT' ||
          operation === 'CHECKOUT_DISPATCH' && review.manifest.operations.includes('dispatch-checkout') ||
          ['PAYMENT_STATUS_RECOVERY', 'PROVIDER_RECONCILIATION'].includes(operation) && review.manifest.operations.includes('reconcile-payment') ||
          ['STARTUP_ACCOUNT', 'WORKER_ACCOUNT'].includes(operation) && review.manifest.operations.some(op =>
            op === 'dispatch-checkout' || op === 'reconcile-payment');
        if (!permitted) return 'DENIED' as const;
        if (p.requests.has(requestId) || [...p.requests.values()].some(r => r.outcome === null || !['KNOWN', 'NOT_STARTED'].includes(r.outcome)) ||
          p.requests.size >= review.manifest.budgets.providerRequests ||
          operation === 'BOOTSTRAP_ACCOUNT' && (review.approval.scope !== 'G2_PREFLIGHT' || p.bootstrap !== 0) ||
          operation !== 'BOOTSTRAP_ACCOUNT' && (review.approval.scope !== 'G3_EXECUTION' ||
            (p.counts.get(invocationId) ?? 0) >= review.manifest.budgets.providerPerInvocation ||
            !p.counts.has(invocationId) && p.counts.size >= review.manifest.budgets.invocations)) return 'DENIED' as const;
        const event = requestFact.parse({ kind: 'RESERVE', invocationId, requestId, operation, deadline: Math.min(now + 1000, review.approval.expiresAt) });
        await requireFreshAuthority(review, deps.authority, deps.now, signal);
        if (!await deps.locksHeld()) return 'DENIED' as const;
        const ack = await ledger.append(p.state, now, event);
        return ack === 'DURABLE' ? 'DURABLE' as const : ack === 'CONFLICT' ? 'DENIED' as const : 'UNKNOWN' as const;
      } catch { await ledger.fence(); return 'UNKNOWN' as const; }
    },
    async dispatchDeadline(requestId: string, signal: AbortSignal): Promise<number> {
      await requireFreshAuthority(review, deps.authority, deps.now, signal);
      const p = await replay(), r = p.requests.get(requestId);
      if (!r || r.outcome !== null || r.dispatchIntentAt !== null || deps.now() >= r.deadline || !await deps.locksHeld()) return fail();
      if (await ledger.append(p.state, deps.now(), { kind: 'DISPATCH_INTENT', requestId }) !== 'DURABLE') return fail();
      await requireFreshAuthority(review, deps.authority, deps.now, signal);
      if (deps.now() >= r.deadline || !await deps.locksHeld()) return fail();
      return r.deadline;
    },
    async settle(requestId: string, outcome: 'KNOWN' | 'UNCERTAIN' | 'TIMEOUT' | 'CANCELLED' | 'NOT_STARTED', providerRequestId: string | null) {
      try {
        const p = await replay(), r = p.requests.get(requestId);
        if (!r || r.outcome !== null || outcome === 'KNOWN' && (r.dispatchIntentAt === null || deps.now() >= r.deadline)) return fail();
        const e = requestFact.parse({ kind: 'RESULT', requestId, outcome, providerRequestId });
        const ack = await ledger.append(p.state, deps.now(), e);
        if (ack !== 'DURABLE') { await ledger.fence(); return 'UNKNOWN' as const; }
        return 'DURABLE' as const;
      } catch { await ledger.fence(); return 'UNKNOWN' as const; }
    },
    inspect: replay,
  };
}
export type DurableProviderBudget = ReturnType<typeof durableProviderBudget>;
