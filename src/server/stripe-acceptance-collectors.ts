import 'server-only';
import { z } from 'zod';
import { canonicalRunJson, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { requireAcceptanceFixturePlan, type AcceptanceFixturePlan } from './stripe-acceptance-fixtures';
import { financialEvidenceBinding, financialEvidenceDigest, financialTransactionEvidenceSchema, type OriginalTransactionIdentity } from './stripe-acceptance-financial-evidence';
import { witnessSchema } from './stripe-acceptance-handoff-evidence';
import { EVIDENCE_CHANNELS, envelopeSchema, payloadSchemas, reviewSchema, type EvidenceChannel,
  type AcceptanceEvidenceReaders } from './stripe-acceptance-verifier-evidence';
import { verifyAcceptanceEvidence, type AcceptanceVerdict } from './stripe-acceptance-verifier';
import { CaptureFailure, capturePinSchema, detachedCapture, isCaptureReader, readPinnedCapture,
  requireIndependentCaptureReaders, type CaptureDiagnostic, type CapturePacket, type IndependentCaptureReader } from './stripe-acceptance-capture-provenance';

export const CAPTURE_SOURCES = Object.freeze({ bindings: 'ORIGINAL_BOOKING_CAPTURE', database: 'POSTGRES_ORIGINAL_FINANCIAL_ROWS',
  provider: 'STRIPE_TEST_OBSERVATION', webhooks: 'POSTGRES_ATOMIC_HANDOFF_ROWS', supervision: 'PROTECTED_SUPERVISION_HISTORY' } as const);
export const collectorReviewSchema = z.object({ kind: z.literal('independent-capture-review-v1'), review: reviewSchema,
  pins: z.object({ bindings: capturePinSchema, database: capturePinSchema, provider: capturePinSchema,
    webhooks: capturePinSchema, supervision: capturePinSchema }).strict() }).strict();
export type CollectorReview = z.infer<typeof collectorReviewSchema>;
export type CaptureSubject = Readonly<{ key: string; value: unknown; original: boolean;
  transactionId: string | null; commitEvidenceRef: string | null; transaction: OriginalTransactionIdentity | null }>;
/** Read-only coverage projection. Describes rows that MUST already be captured;
 * never supplies provenance, IDs, transaction witnesses or provider events. */
export function captureSubjects(channel: EvidenceChannel, raw: unknown): readonly CaptureSubject[] {
  const subjects: CaptureSubject[] = [];
  const item = (key: string, value: unknown, original = false, transactionId: string | null = null, commitEvidenceRef: string | null = null, transaction: OriginalTransactionIdentity | null = null) =>
    subjects.push({ key, value, original, transactionId, commitEvidenceRef, transaction });
  if (channel === 'bindings') for (const m of payloadSchemas.bindings.parse(raw).mappings) item(`binding:${m.fixtureId}`, m, true, m.transactionId);
  if (channel === 'database') {
    const d = payloadSchemas.database.parse(raw);
    for (const f of d.fixtures) {
      item(`fixture:${f.fixtureId}`, f);
      for (const [i, raw] of (f.originalTransactions ?? []).entries()) {
        const e = financialTransactionEvidenceSchema.safeParse(raw);
        item(`financial:${f.fixtureId}:${i}`, raw, true, e.success ? e.data.capture.transaction.transactionId : null,
          e.success ? e.data.settlement.evidenceRef : null, e.success ? e.data.capture.transaction : null);
      }
    }
    for (const c of d.claims) item(`claim:${c.id}`, c);
  }
  if (channel === 'provider') for (const p of payloadSchemas.provider.parse(raw).payments) item(`provider:${p.attemptId}`, p);
  if (channel === 'webhooks') {
    const h = payloadSchemas.webhooks.parse(raw);
    for (const d of h.deliveries) item(`delivery:${d.deliveryId}`, d);
    for (const [i, raw] of (h.handoffObservations ?? []).entries()) {
      const w = witnessSchema.safeParse(raw);
      item(`handoff:${i}`, raw, true, w.success ? w.data.transaction.transactionId : null, w.success ? w.data.evidenceRef : null, w.success ? w.data.transaction : null);
    }
  }
  if (channel === 'supervision') {
    const s = payloadSchemas.supervision.parse(raw);
    item('journal:head', s.journal);
    for (const e of s.journal.entries) item(`journal:${e.sequence}`, e);
    for (const e of s.executions) item(`execution:${e.invocationId}`, e);
    for (const r of s.requests) item(`request:${r.requestId}`, r);
    for (const r of s.recovery) item(`recovery:${r.id}`, r);
  }
  return subjects;
}
const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);
const ranks: Record<AcceptanceVerdict, number> = { PASS: 0, INCOMPLETE: 1, INVESTIGATION_REQUIRED: 2, FAIL: 3 };
/** Detached snapshots ONLY. Always calls the existing verifier; never repairs or
 * relabels evidence. Collection issues cannot hide independent financial FAILs.
 * Authenticity of supplied read capabilities/pins remains an external trust gate. */
export async function collectAcceptanceEvidence(run: SealedAcceptanceRun, plan: AcceptanceFixturePlan, deps: {
  authority?: IndependentCaptureReader; sources: Partial<Record<EvidenceChannel, IndependentCaptureReader>>;
  now(): number; signal: AbortSignal;
}) {
  const issues: { code: CaptureDiagnostic; verdict: 'INCOMPLETE' | 'INVESTIGATION_REQUIRED' }[] = [];
  const snapshots: Partial<Record<EvidenceChannel, unknown>> = {}, captured: Partial<Record<EvidenceChannel, CapturePacket>> = {};
  let authority: CollectorReview | undefined;
  try {
    requireAcceptanceFixturePlan(run, plan);
    const binding = financialEvidenceBinding(run);
    if (!isCaptureReader(deps.authority)) throw new CaptureFailure('SOURCE_UNAVAILABLE');
    if (deps.signal.aborted) throw new CaptureFailure('CANCELLED');
    let rawAuthority: unknown;
    try { rawAuthority = await deps.authority.read(binding); } catch { throw new CaptureFailure('SOURCE_UNAVAILABLE'); }
    authority = collectorReviewSchema.parse(detachedCapture(rawAuthority));
    const review = authority.review;
    if (!same(review.binding, { ...binding, planDigest: plan.planDigest }) || review.approvalReference !== run.approvalReference)
      throw new CaptureFailure('CAPTURE_CONFLICT', 'INVESTIGATION_REQUIRED');
    const readers = [deps.authority, ...EVIDENCE_CHANNELS.map(c => deps.sources[c]).filter((r): r is IndependentCaptureReader => !!r)];
    requireIndependentCaptureReaders(readers, EVIDENCE_CHANNELS.map(c => authority!.pins[c]), review.reviewer);
    for (const channel of EVIDENCE_CHANNELS) {
      try {
        const packet = await readPinnedCapture(deps.sources[channel], authority.pins[channel], binding, CAPTURE_SOURCES[channel],
          review.evidenceClass, review, deps.now, deps.signal);
        const envelope = envelopeSchema.parse(packet.data), anchor = review.anchors[channel];
        if (!same(envelope.binding, review.binding) || envelope.channel !== channel || envelope.producer !== packet.readerId ||
          envelope.producer !== anchor.producer || envelope.recordId !== anchor.recordId || financialEvidenceDigest(envelope) !== anchor.digest)
          throw new CaptureFailure('CAPTURE_CONFLICT', 'INVESTIGATION_REQUIRED');
        // Preserve this independently anchored envelope even if its item coverage
        // is incomplete: a duplicate allocation still outranks missing provenance.
        snapshots[channel] = envelope; captured[channel] = packet;
        const subjects = captureSubjects(channel, envelope.data), keys = packet.items.map(i => i.key);
        if (new Set(keys).size !== keys.length || subjects.length !== packet.items.length || subjects.some(s => !keys.includes(s.key)))
          throw new CaptureFailure('ITEM_COVERAGE_CONFLICT');
        for (const subject of subjects) {
          const item = packet.items.find(i => i.key === subject.key)!;
          if (item.digest !== financialEvidenceDigest(subject.value) || subject.transactionId !== null && item.transaction?.transactionId !== subject.transactionId ||
            subject.commitEvidenceRef !== null && item.commitEvidenceRef !== subject.commitEvidenceRef ||
            subject.transaction !== null && !same(item.transaction, subject.transaction))
            throw new CaptureFailure('CAPTURE_CONFLICT', 'INVESTIGATION_REQUIRED');
          if (subject.original && (item.origin !== 'ORIGINAL_TRANSACTION' || !item.transaction || !item.commitEvidenceRef))
            throw new CaptureFailure('ORIGINAL_PROVENANCE_MISSING');
          if (item.completeness !== 'COMPLETE' || item.diagnostics.length) issues.push({ code: 'CAPTURE_PARTIAL', verdict: 'INCOMPLETE' });
          if (item.uncertainty !== 'SETTLED') issues.push({ code: 'CAPTURE_UNCERTAIN', verdict: 'INVESTIGATION_REQUIRED' });
        }
        if (packet.completeness !== 'COMPLETE' || packet.diagnostics.length) issues.push({ code: 'CAPTURE_PARTIAL', verdict: 'INCOMPLETE' });
        if (packet.uncertainty !== 'SETTLED') issues.push({ code: 'CAPTURE_UNCERTAIN', verdict: 'INVESTIGATION_REQUIRED' });
      } catch (error) {
        issues.push(error instanceof CaptureFailure ? { code: error.code, verdict: error.verdict } : { code: 'CAPTURE_INVALID', verdict: 'INCOMPLETE' });
      }
    }
  } catch (error) {
    issues.push(error instanceof CaptureFailure ? { code: error.code, verdict: error.verdict } : { code: 'CAPTURE_INVALID', verdict: 'INCOMPLETE' });
  }
  const read = (value: unknown) => ({ kind: 'acceptance-verifier-read-only-v1' as const, read: async () => detachedCapture(value) });
  const readers = { authority: read(authority?.review), ...Object.fromEntries(EVIDENCE_CHANNELS.filter(c => snapshots[c]).map(c => [c, read(snapshots[c])])) } as AcceptanceEvidenceReaders;
  const verification = await verifyAcceptanceEvidence(run, plan, { now: deps.now, readers });
  const verdict = issues.reduce<AcceptanceVerdict>((v, i) => ranks[i.verdict] > ranks[v] ? i.verdict : v, verification.verdict);
  return Object.freeze({ stage: '2C-REMEDIATION-B' as const, readiness: 'NOT_READY' as const, operationsEnabled: false as const,
    verdict, diagnostics: Object.freeze([...new Set(issues.map(i => i.code))].sort()), verification,
    captures: Object.freeze(Object.fromEntries(Object.entries(captured).map(([c, p]) => [c, financialEvidenceDigest(p)]))) });
}
