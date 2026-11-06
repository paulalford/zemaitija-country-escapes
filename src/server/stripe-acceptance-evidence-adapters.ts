import 'server-only';
import { z } from 'zod';
import { canonicalRunJson, freshAcceptanceNames, requireSealedAcceptanceRun, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { acceptanceDigest, type ReviewedFreshIntegration } from './stripe-acceptance-trust';
import { requireFreshAuthority, type FreshDatabase, type FreshLiveAuthority } from './stripe-acceptance-fresh-database';
import { envelopeSchema, payloadSchemas, verifierBindingSchema, type AcceptanceEvidenceReader,
  type EvidenceChannel, type RuntimeMapping, bindingsSchema } from './stripe-acceptance-verifier-evidence';
import { requireAcceptanceFixturePlan, type AcceptanceFixturePlan } from './stripe-acceptance-fixtures';
import type { AcceptanceReadOnlyStatusAdapter } from './stripe-acceptance-status';
import type { AtomicAcceptanceAdmission, AcceptanceAdmissionReceipt } from './stripe-acceptance-forwarding';
import type { AnchoredEvidence } from './stripe-acceptance-durable';

const fail = (): never => { throw Error('ACCEPTANCE_EVIDENCE_UNAVAILABLE'); };
const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);
const ownershipSchema = z.object({ runId: z.uuid(), manifestDigest: z.string(), bookingId: z.uuid(), attemptId: z.uuid(),
  holdId: z.uuid(), commandId: z.uuid(), sessionId: z.string().nullable(), paymentIntentId: z.string().nullable(),
  commandAttemptId: z.uuid(), attemptBookingId: z.uuid(), attemptHoldId: z.uuid(),
  currentRequestDigest: z.string().regex(/^[a-f0-9]{64}$/), originalRequestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  currentKey: z.string(), originalKey: z.string(), capturedOriginalIds: z.literal(true) }).strict();
export type PersistedAcceptanceOwnership = z.infer<typeof ownershipSchema>;
const admittedSchema = z.object({ eventId: z.string(), eventType: z.string(), objectType: z.string(), objectId: z.string(),
  originalDigest: z.string().regex(/^[a-f0-9]{64}$/), incomingDigest: z.string().regex(/^[a-f0-9]{64}$/),
  disposition: z.enum(['INGESTED', 'DUPLICATE', 'INVESTIGATION']), lane: z.enum(['PAYMENT', 'NONE']),
  ownership: z.enum(['OWNED', 'UNKNOWN', 'CONFLICT', 'UNSUPPORTED', 'DIGEST_CONFLICT']) }).strict();
export type AdmissionOnlyEvidence = Readonly<Omit<AcceptanceAdmissionReceipt, 'version' | 'durable'> & {
  kind: 'ADMISSION_JOURNAL_ONLY'; processingInboxHandoff: 'NOT_IMPLEMENTED';
}>;
/** Durable admission evidence only. PAYMENT marks an eligible admission; it does
 * not enqueue the legacy inbox or process money. That transactional handoff is a
 * deliberate fail-closed deployment blocker pending approved SQL integration. */
export function restrictedAcceptanceAdmission(review: ReviewedFreshIntegration, ledger: AnchoredEvidence, deps: {
  now(): number; authority: FreshLiveAuthority;
  ownership(objectType: string, objectId: string): Promise<unknown>;
}): AtomicAcceptanceAdmission & {
  recordEvidence: (input: Parameters<AtomicAcceptanceAdmission['commit']>[0], signal: AbortSignal) => Promise<AdmissionOnlyEvidence>;
} {
  return {
    async commit(): Promise<never> { throw Error('ATOMIC_INBOX_HANDOFF_REQUIRED'); },
    async recordEvidence(input, signal): Promise<AdmissionOnlyEvidence> {
    await requireFreshAuthority(review, deps.authority, deps.now, signal);
    const m = review.manifest;
    if (input.runId !== m.runId || input.manifestDigest !== review.approval.manifestDigest || input.database !== m.target.database ||
      input.event.accountId !== m.stripe.accountId || input.event.livemode || !/^evt_[A-Za-z0-9]+$/.test(input.event.id) ||
      !/^[a-f0-9]{64}$/.test(input.payloadDigest)) return fail();
    const supported = input.event.objectType === 'checkout.session' && ['checkout.session.completed', 'checkout.session.expired'].includes(input.event.type) ||
      input.event.objectType === 'payment_intent' && ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'].includes(input.event.type);
    if (supported !== input.supportedPayment) return fail();
    const s = await ledger.read(), history = s.entries.map(e => admittedSchema.parse(e.data));
    const original = history.find(e => e.eventId === input.event.id);
    let ownership: AcceptanceAdmissionReceipt['ownership'] = supported ? 'UNKNOWN' : 'UNSUPPORTED';
    if (supported) {
      const raw = await deps.ownership(input.event.objectType, input.event.objectId);
      if (raw !== null) {
        const o = ownershipSchema.parse(raw), object = input.event.objectType === 'checkout.session' ? o.sessionId : o.paymentIntentId;
        ownership = o.runId === m.runId && o.manifestDigest === review.approval.manifestDigest && object === input.event.objectId &&
          o.commandAttemptId === o.attemptId && o.attemptBookingId === o.bookingId && o.attemptHoldId === o.holdId &&
          o.originalRequestDigest === o.currentRequestDigest && o.originalKey === `session-create:${o.attemptId}` &&
          o.currentKey === o.originalKey ? 'OWNED' : 'CONFLICT';
      }
    }
    if (original && original.originalDigest !== input.payloadDigest) ownership = 'DIGEST_CONFLICT';
    else if (original && (original.eventType !== input.event.type || original.objectType !== input.event.objectType ||
      original.objectId !== input.event.objectId || original.ownership !== ownership)) ownership = 'CONFLICT';
    const disposition = ownership === 'OWNED' ? original ? 'DUPLICATE' : 'INGESTED' : 'INVESTIGATION';
    const lane = ownership === 'OWNED' ? 'PAYMENT' : 'NONE';
    const data = admittedSchema.parse({ eventId: input.event.id, eventType: input.event.type, objectType: input.event.objectType,
      objectId: input.event.objectId, originalDigest: original?.originalDigest ?? input.payloadDigest, incomingDigest: input.payloadDigest,
      disposition, lane, ownership });
    await requireFreshAuthority(review, deps.authority, deps.now, signal);
    if (await ledger.append(s, deps.now(), data) !== 'DURABLE') return fail();
    return Object.freeze({ kind: 'ADMISSION_JOURNAL_ONLY', processingInboxHandoff: 'NOT_IMPLEMENTED',
      runId: m.runId, manifestDigest: input.manifestDigest, payloadDigest: input.payloadDigest,
      originalPayloadDigest: data.originalDigest, eventId: data.eventId, eventType: data.eventType, objectType: data.objectType,
      disposition, lane, ownership });
  } };
}

/** An independently controlled captured snapshot store is required. These fixed
 * SELECT adapters cannot construct snapshots or upgrade incomplete capture. Each
 * producer uses a distinct store/role-controlled capture path; no status-to-verifier
 * conversion is allowed. Archive authenticity is established by the review anchors. */
export function restrictedVerifierReader(run: SealedAcceptanceRun, db: FreshDatabase, channel: EvidenceChannel,
  signal: AbortSignal): AcceptanceEvidenceReader {
  requireSealedAcceptanceRun(run);
  if (db.binding.runId !== run.runId || db.binding.manifestDigest !== acceptanceDigest(run) || db.binding.database !== run.target.database) return fail();
  return { kind: 'acceptance-verifier-read-only-v1', async read(raw) {
    const b = verifierBindingSchema.parse(raw);
    if (b.runId !== run.runId || b.manifestDigest !== acceptanceDigest(run) || b.sourceDigest !== run.sourceDigest ||
      b.migrationDigest !== run.migrationDigest || b.database !== freshAcceptanceNames(run.runId).database ||
      b.targetDigest !== acceptanceDigest(run.target)) return fail();
    return db.session('zec_acceptance_verifier_reader', signal, async s => {
      await s.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const r = await s.query(`SELECT envelope FROM zec_acceptance.verifier_snapshots
          WHERE run_id=$1 AND manifest_digest=$2 AND plan_digest=$3 AND channel=$4`, [b.runId, b.manifestDigest, b.planDigest, channel]);
        if (r.rows.length !== 1) return fail();
        const e = envelopeSchema.parse(r.rows[0].envelope);
        if (!same(e.binding, b) || e.channel !== channel) return fail();
        payloadSchemas[channel].parse(e.data);
        return e;
      } finally { await s.query('ROLLBACK'); }
    });
  } };
}
export function restrictedStatusReader(run: SealedAcceptanceRun, plan: AcceptanceFixturePlan, db: FreshDatabase,
  signal: AbortSignal): AcceptanceReadOnlyStatusAdapter {
  requireAcceptanceFixturePlan(run, plan);
  if (db.binding.runId !== run.runId || db.binding.manifestDigest !== acceptanceDigest(run) || db.binding.database !== run.target.database) return fail();
  return { kind: 'acceptance-status-read-only-v1', async read(b) {
    if (b.runId !== run.runId || b.manifestDigest !== acceptanceDigest(run) || b.planDigest !== plan.planDigest ||
      b.database !== run.target.database || !plan.fixtures.some(f => f.fixtureId === b.fixtureId)) return fail();
    return db.session('zec_acceptance_status_reader', signal, async s => {
      await s.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        const r = await s.query(`SELECT snapshot FROM zec_acceptance.status_snapshots
          WHERE run_id=$1 AND manifest_digest=$2 AND plan_digest=$3 AND fixture_id=$4`, [b.runId, b.manifestDigest, b.planDigest, b.fixtureId]);
        if (r.rows.length !== 1) return fail();
        return JSON.parse(canonicalRunJson(r.rows[0].snapshot)) as unknown;
      } finally { await s.query('ROLLBACK'); }
    });
  } };
}

/** The writer must call the existing quoteStay/acceptBooking and capture ORIGINAL
 * IDs and commit evidence at their transaction boundary. No arbitrary financial
 * INSERT interface, predetermined domain IDs or direct paid transition exists. */
export interface ApprovedFixtureWriter {
  acceptExistingAndCapture(input: Readonly<{ runId: string; manifestDigest: string; planDigest: string;
    fixture: AcceptanceFixturePlan['fixtures'][number] }>, signal: AbortSignal): Promise<{
      mapping: RuntimeMapping; commitEvidenceRef: string; quotedInitialCents: number; quotedTotalCents: number;
    }>;
}
export async function acceptApprovedSyntheticFixture(run: SealedAcceptanceRun, plan: AcceptanceFixturePlan, fixtureId: string, deps: {
  writer: ApprovedFixtureWriter; grant(): Promise<unknown>; now(): number; signal: AbortSignal;
}) {
  requireAcceptanceFixturePlan(run, plan);
  const f = plan.fixtures.find(f => f.fixtureId === fixtureId);
  if (!f || deps.signal.aborted) return fail();
  const grant = z.object({ runId: z.uuid(), manifestDigest: z.string(), planDigest: z.string(), fixtureId: z.uuid(),
    operation: z.literal('prepare-booking'), scope: z.literal('G3_EXECUTION'), monetaryApprovalVerified: z.literal(true),
    targetVerified: z.literal(true), reservationVerified: z.literal(true), captureActive: z.literal(true),
    notBefore: z.number().int(), expiresAt: z.number().int() }).strict().parse(await deps.grant());
  const now = deps.now();
  if (grant.runId !== run.runId || grant.manifestDigest !== acceptanceDigest(run) || grant.planDigest !== plan.planDigest ||
    grant.fixtureId !== fixtureId || now < grant.notBefore || now >= grant.expiresAt ||
    grant.notBefore < Date.parse(run.notBefore) || grant.expiresAt > Date.parse(run.expiresAt) || deps.signal.aborted) return fail();
  const result = await deps.writer.acceptExistingAndCapture({ runId: run.runId, manifestDigest: grant.manifestDigest,
    planDigest: plan.planDigest, fixture: f }, deps.signal);
  const mapping = bindingsSchema.parse({ mappings: [result.mapping] }).mappings[0];
  if (!/^[A-Za-z0-9:_.-]{1,160}$/.test(result.commitEvidenceRef) || mapping.fixtureId !== fixtureId ||
    mapping.namespace !== f.namespace || mapping.operationKey !== f.operationKey || mapping.guestId !== f.guest.id || mapping.unitId !== f.stay.unitId ||
    result.quotedInitialCents !== f.expected.initialCents || result.quotedTotalCents !== f.expected.totalCents ||
    mapping.acceptedAt < now || mapping.acceptedAt >= grant.expiresAt || deps.now() >= grant.expiresAt || deps.signal.aborted ||
    new Set([mapping.bookingId, mapping.holdId, mapping.claimId, mapping.attemptId, mapping.commandId,
      mapping.snapshotId, mapping.initialObligationId, mapping.balanceObligationId]).size !== 8) return fail();
  // Missing/uncertain capture is not retried: domain commit may already exist.
  return Object.freeze({ mapping: Object.freeze(mapping), commitEvidenceRef: result.commitEvidenceRef, operationsEnabled: false as const });
}
