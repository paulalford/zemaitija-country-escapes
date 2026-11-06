import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createAcceptanceWebhookIngestion, type AcceptanceAdmissionReceipt, type AcceptanceIngestionDependencies,
  type AtomicAcceptanceAdmission } from './stripe-acceptance-forwarding';
import { canonicalRunJson, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { financialEvidenceBinding, financialEvidenceDigest, transactionIdentitySchema,
  type FinancialEvidenceBinding, type OriginalTransactionIdentity } from './stripe-acceptance-financial-evidence';
import type { VerifiedEvent } from './stripe-adapter';

import { atomicHandoffPlanSchema, witnessSchema, originalSchema, ownerSchema, eventSchema, signatureProofSchema, type AtomicHandoffPlan, type AtomicHandoffOwnership,
  type OriginalHandoffDisposition } from './stripe-acceptance-handoff-evidence';
export { atomicHandoffPlanSchema, type AtomicHandoffPlan, type AtomicHandoffOwnership,
  type OriginalHandoffDisposition } from './stripe-acceptance-handoff-evidence';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), label = z.string().regex(/^[A-Za-z0-9:_.-]{1,160}$/);

export interface AcceptanceEndpointSignatureVerifier {
  /** Trusted existing-gateway verifier bound to the dedicated endpoint secret.
   * It must verify these exact bytes and signature, not parse/reserialize them.
   * No SDK, key, credential or default verifier is constructed by this module. */
  verify(raw: Buffer, signature: string, expected: Readonly<{ accountId: string; endpointId: string }>): unknown;
}
/** One transaction, one event-ID lock. Read ownership on this same session under
 * the established unit/booking/attempt/command lock ordering; recheck before stage.
 * stage must insert admission + delivery AND existing stripe_webhook_events row,
 * or approved investigation, together. Never calls a payment processor. */
export interface AtomicHandoffTransaction {
  identity: OriginalTransactionIdentity;
  lockEventAndRead(eventId: string): Promise<unknown>;
  readPersistedOwnership(objectType: string, objectId: string): Promise<unknown>;
  stage(plan: AtomicHandoffPlan): Promise<unknown>;
  commit(): Promise<unknown>;
  rollback(): Promise<'REJECTED' | 'UNKNOWN'>;
  close(): Promise<'SETTLED' | 'UNKNOWN'>;
}
export interface AtomicHandoffDriver {
  writerId: string;
  begin(binding: FinancialEvidenceBinding, signal: AbortSignal): Promise<AtomicHandoffTransaction>;
  fence(binding: FinancialEvidenceBinding): Promise<void>;
}
export interface IndependentHandoffCommitReader {
  readerId: string;
  /** Distinct protected read-only connection AFTER acknowledged commit. Read actual
   * immutable admission/delivery/transaction columns AND the required inbox/incident.
   * No write, fallback, missing-row repair or financial processing is authorised. */
  observe(binding: FinancialEvidenceBinding, deliveryId: string, signal: AbortSignal): Promise<unknown>;
}

const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);
const fail = (): never => { throw Error('ATOMIC_HANDOFF_UNCERTAIN'); };
function paymentEvent(event: VerifiedEvent) {
  return event.objectType === 'checkout.session' && ['checkout.session.completed', 'checkout.session.expired'].includes(event.type) ||
    event.objectType === 'payment_intent' && ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'].includes(event.type);
}
function owns(owner: AtomicHandoffOwnership, binding: FinancialEvidenceBinding, event: VerifiedEvent) {
  return owner.sessionId !== null && same(owner.binding, binding) && owner.commandAttemptId === owner.attemptId && owner.attemptBookingId === owner.bookingId &&
    owner.attemptObligationId === owner.obligationId && owner.attemptHoldId === owner.holdId &&
    owner.originalRequestDigest === owner.currentRequestDigest && owner.originalKey === `session-create:${owner.attemptId}` &&
    owner.currentKey === owner.originalKey && (event.objectType === 'checkout.session' ? owner.sessionId : owner.paymentIntentId) === event.objectId;
}
function sameOwnershipHistory(original: AtomicHandoffOwnership | null, current: AtomicHandoffOwnership | null) {
  if (!original || !current) return original === current;
  const { paymentIntentId: originalPI, ...first } = original;
  const { paymentIntentId: currentPI, ...last } = current;
  // The original Session/command never changes; a previously unbound PI can be
  // durably attached later by the governed engine. Do not rewrite the original.
  return same(first, last) && (originalPI === null || originalPI === currentPI);
}

function completeOriginal(o: OriginalHandoffDisposition, binding: FinancialEvidenceBinding) {
  if (!same(o.binding, binding)) return false;
  if (o.disposition === 'INVESTIGATION') return o.inbox === null && o.investigationId !== null;
  const inbox = o.inbox;
  return !!o.ownership && owns(o.ownership, binding, o.event) && paymentEvent(o.event) && inbox !== null &&
    o.investigationId === null && inbox.stripeEventId === o.event.id && inbox.payloadDigest === o.payloadDigest &&
    inbox.objectId === o.event.objectId && inbox.objectType === o.event.objectType && inbox.eventType === o.event.type &&
    inbox.providerCreated === o.event.created;
}

/** Source-only composition of the accepted raw-byte/authentication boundary and a
 * stronger atomic adapter. No listener, SDK, database, timer or worker is started
 * by construction. Its injected capabilities remain an external trust boundary. */
export function createAtomicAcceptanceWebhookIngestion(run: SealedAcceptanceRun, deps: {
  now(): number; authority: AcceptanceIngestionDependencies['authority']; credentials: AcceptanceIngestionDependencies['credentials'];
  signatureVerifier: AcceptanceEndpointSignatureVerifier; driver: AtomicHandoffDriver; commitReader: IndependentHandoffCommitReader;
  nextId(): string; evidenceClass: 'SIMULATED' | 'RECORDED';
}) {
  const binding = financialEvidenceBinding(run);
  if (!label.safeParse(deps.driver.writerId).success || !label.safeParse(deps.commitReader.readerId).success ||
    deps.driver.writerId === deps.commitReader.readerId) throw Error('INDEPENDENT_HANDOFF_READER_REQUIRED');
  return async (input: Parameters<ReturnType<typeof createAcceptanceWebhookIngestion>>[0]) => {
    // Per-delivery closure: no global event/digest cache, cross-request signature
    // capability, reusable paid flag or in-process durable-receipt issuer.
    let verified: { event: VerifiedEvent; proof: z.infer<typeof signatureProofSchema> } | undefined;
    const admission: AtomicAcceptanceAdmission = { async commit(raw, signal) {
      let tx: AtomicHandoffTransaction | undefined, attemptedBegin = false, attemptedCommit = false;
      const current = () => {
        const now = deps.now();
        if (!Number.isSafeInteger(now) || now < Date.parse(run.notBefore) || now >= Date.parse(run.expiresAt) || signal.aborted) return fail();
        return now;
      };
      try {
        current();
        if (!verified || raw.runId !== binding.runId || raw.manifestDigest !== binding.manifestDigest || raw.database !== binding.database ||
          raw.payloadDigest !== verified.proof.payloadDigest || !same(raw.event, verified.event) || raw.supportedPayment !== paymentEvent(raw.event)) return fail();
        attemptedBegin = true;
        tx = await deps.driver.begin(binding, signal); current();
        const transaction = transactionIdentitySchema.parse(tx.identity);
        const prior = await tx.lockEventAndRead(raw.event.id);
        const original = prior === null ? null : originalSchema.parse(prior);
        if (original && (original.event.id !== raw.event.id || original.event.accountId !== run.stripe.accountId || !completeOriginal(original, binding))) return fail();
        const ownedRaw = paymentEvent(raw.event) ? await tx.readPersistedOwnership(raw.event.objectType, raw.event.objectId) : null;
        const owner = ownedRaw === null ? null : ownerSchema.parse(ownedRaw);
        let reason: AtomicHandoffPlan['reason'] = !paymentEvent(raw.event) ? 'UNSUPPORTED' : owner === null ? 'UNKNOWN_OWNERSHIP' :
          owns(owner, binding, raw.event) ? 'OWNED' : 'OWNERSHIP_CONFLICT';
        if (original && original.payloadDigest !== raw.payloadDigest) reason = 'DIGEST_CONFLICT';
        else if (original && (!same(original.event, raw.event) || original.disposition === 'INVESTIGATION' ||
          !sameOwnershipHistory(original.ownership, owner))) reason = 'OWNERSHIP_CONFLICT';
        const result = reason === 'OWNED' ? original ? 'DUPLICATE' : 'INGESTED' : 'INVESTIGATION';
        const inbox = !original && result === 'INGESTED' ? { id: id.parse(deps.nextId()), stripeEventId: raw.event.id,
          eventType: raw.event.type, objectType: raw.event.objectType, objectId: raw.event.objectId, payloadDigest: raw.payloadDigest,
          providerCreated: raw.event.created, processingState: 'PENDING' as const } : null;
        const investigationId = result === 'INVESTIGATION' ? id.parse(deps.nextId()) : null;
        const plan = atomicHandoffPlanSchema.parse({ kind: 'atomic-payment-inbox-handoff-v1', binding, transaction,
          deliveryId: deps.nextId(), event: raw.event, incomingDigest: raw.payloadDigest, signature: verified.proof,
          original: original ?? { id: deps.nextId(), binding, transaction, event: raw.event, payloadDigest: raw.payloadDigest,
            ownership: reason === 'OWNED' ? owner : null, disposition: inbox ? 'PAYMENT' : 'INVESTIGATION', inbox, investigationId },
          ownershipObservation: owner, originalAction: original ? 'PRESERVE' : 'INSERT', inboxAction: inbox ? 'INSERT_PENDING' : original?.inbox ? 'PRESERVE' : 'NONE',
          investigationId, reason, result });
        if (!completeOriginal(plan.original, binding)) return fail();
        current();
        // Existing 3E authority revalidated for this exact run immediately before
        // the transaction's single staging/commit attempt. No caller approval JSON.
        const grant = await deps.authority.verify({ runId: run.runId, manifestDigest: binding.manifestDigest,
          forwardingProfile: 'fresh-loopback-webhook-v1', operation: 'ingest-payment-webhook' }, signal);
        const g = z.object({ status: z.literal('VERIFIED'), runId: id, manifestDigest: hash, forwardingProfile: z.literal('fresh-loopback-webhook-v1'),
          operation: z.literal('ingest-payment-webhook'), notBefore: z.string().datetime(), expiresAt: z.string().datetime(),
          reservationVerified: z.literal(true), targetVerified: z.literal(true), accountVerified: z.literal(true), durableAdmissionVerified: z.literal(true) }).strict().parse(grant);
        if (g.runId !== binding.runId || g.manifestDigest !== binding.manifestDigest || current() < Date.parse(g.notBefore) ||
          current() >= Date.parse(g.expiresAt) || Date.parse(g.notBefore) < Date.parse(run.notBefore) || Date.parse(g.expiresAt) > Date.parse(run.expiresAt)) return fail();
        const digest = financialEvidenceDigest(plan);
        const staged = z.object({ kind: z.literal('ATOMIC_DISPOSITION_STAGED'), transaction: transactionIdentitySchema,
          plan: atomicHandoffPlanSchema, planDigest: hash }).strict().parse(await tx.stage(plan));
        if (!same(staged.plan, plan) || !same(staged.transaction, transaction) || staged.planDigest !== digest) return fail();
        if (current() >= Date.parse(g.expiresAt)) return fail();
        attemptedCommit = true;
        const ack = z.object({ outcome: z.enum(['COMMITTED', 'REJECTED', 'UNCERTAIN']), transaction: transactionIdentitySchema }).strict().parse(await tx.commit());
        if (ack.outcome !== 'COMMITTED' || !same(ack.transaction, transaction)) return fail();
        current();
        const witness = witnessSchema.parse(await deps.commitReader.observe(binding, plan.deliveryId, signal));
        if (witness.readerId !== deps.commitReader.readerId || witness.readerId === deps.driver.writerId ||
          !same(witness.binding, binding) || !same(witness.transaction, transaction) || !same(witness.plan, plan) || witness.planDigest !== digest ||
          !completeOriginal(witness.plan.original, binding)) return fail();
        const requiredInbox = plan.original.inbox;
        if ((requiredInbox === null) !== (witness.inbox === null) || witness.investigationId !== plan.investigationId) return fail();
        if (requiredInbox && witness.inbox) {
          const { processingState: expectedState, ...expectedInbox } = requiredInbox;
          const { processingState: actualState, ...actualInbox } = witness.inbox;
          void [expectedState, actualState]; // Processing is mutable; its immutable identity/digest is not.
          if (!same(expectedInbox, actualInbox)) return fail();
        }
        current();
        const ownership: AcceptanceAdmissionReceipt['ownership'] = reason === 'OWNED' ? 'OWNED' : reason === 'DIGEST_CONFLICT' ? 'DIGEST_CONFLICT' :
          reason === 'UNSUPPORTED' ? 'UNSUPPORTED' : reason === 'UNKNOWN_OWNERSHIP' ? 'UNKNOWN' : 'CONFLICT';
        return Object.freeze({ version: 1, durable: true, runId: binding.runId, manifestDigest: binding.manifestDigest,
          payloadDigest: raw.payloadDigest, originalPayloadDigest: plan.original.payloadDigest, eventId: raw.event.id,
          eventType: raw.event.type, objectType: raw.event.objectType, disposition: result,
          lane: result === 'INVESTIGATION' ? 'NONE' : 'PAYMENT', ownership } satisfies AcceptanceAdmissionReceipt);
      } catch {
        if (tx && !attemptedCommit) {
          try { await tx.rollback(); } catch { /* rollback outcome remains unverified */ }
        }
        if (attemptedBegin) await deps.driver.fence(binding);
        return fail(); // No success acknowledgement and no retry after uncertainty.
      } finally {
        if (tx) {
          let settled = false;
          try { settled = await tx.close() === 'SETTLED'; } catch { /* unknown cleanup */ }
          if (!settled) { await deps.driver.fence(binding); fail(); }
        }
      }
    } };
    const ingest = createAcceptanceWebhookIngestion(run, { now: deps.now, authority: deps.authority, credentials: deps.credentials,
      admission, verifyEvent(raw, signature) {
        const digest = financialEvidenceDigestBytes(raw);
        const result = z.object({ event: eventSchema, signature: signatureProofSchema }).strict().parse(deps.signatureVerifier.verify(
          Buffer.from(raw), signature, { accountId: run.stripe.accountId, endpointId: run.stripe.webhookEndpointId }));
        if (result.event.accountId !== run.stripe.accountId || result.signature.accountId !== run.stripe.accountId ||
          result.signature.endpointId !== run.stripe.webhookEndpointId || result.signature.payloadDigest !== digest ||
          deps.evidenceClass === 'RECORDED' && result.signature.kind !== 'VERIFIED_RAW_BYTES') throw Error('ENDPOINT_SIGNATURE_REJECTED');
        verified = { event: result.event, proof: result.signature };
        return result.event;
      } });
    const result = await ingest(input);
    return Object.freeze({ ...result, evidenceClass: deps.evidenceClass, operationsEnabled: false as const });
  };
}
// Hash raw bytes directly, never canonicalise or parse a signed webhook body.
const financialEvidenceDigestBytes = (raw: Uint8Array) => createHash('sha256').update(raw).digest('hex');
