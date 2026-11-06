import 'server-only';
import { z } from 'zod';

export const EVIDENCE_CHANNELS = ['bindings', 'database', 'provider', 'webhooks', 'supervision'] as const;
export type EvidenceChannel = typeof EVIDENCE_CHANNELS[number];
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.uuid(), label = z.string().regex(/^[A-Za-z0-9:_.-]{1,160}$/);
export const millis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cents = z.number().int().nonnegative().max(500_000), currency = z.string().length(3);
const rows = <T extends z.ZodType>(schema: T) => z.array(schema).max(4000);
export const verifierBindingSchema = z.object({ runId: id, manifestDigest: hash, sourceDigest: hash,
  migrationDigest: hash, planDigest: hash, targetDigest: hash, database: label }).strict();
export type VerifierBinding = Readonly<z.infer<typeof verifierBindingSchema>>;
const anchor = z.object({ producer: label, recordId: label, digest: hash }).strict();
export const reviewSchema = z.object({ kind: z.literal('independent-verifier-review-v1'), binding: verifierBindingSchema,
  reviewer: label, approvalReference: z.string().max(120), snapshotSetId: id,
  notBefore: millis, expiresAt: millis, asOf: millis, evidenceClass: z.enum(['SIMULATED', 'RECORDED']),
  artifactsVerified: z.literal(true), targetVerified: z.literal(true), restrictedReadersVerified: z.literal(true),
  inventory: z.object({ complete: z.literal(true), reservedResources: rows(label), foreignResources: rows(label),
    reservationId: id, exclusive: z.literal(true) }).strict(),
  anchors: z.object({ bindings: anchor, database: anchor, provider: anchor, webhooks: anchor, supervision: anchor }).strict(),
  journalCheckpoint: z.object({ sequence: z.number().int().nonnegative(), headDigest: hash,
    protectedRecordId: label }).strict(),
}).strict();
export type VerifierReview = z.infer<typeof reviewSchema>;
/** Separate read-only authority. Does not extend an execution grant or refresh
 * captured evidence. The protected archive is frozen inside the original window. */
export const retainedReviewSchema = reviewSchema.extend({
  kind: z.literal('independent-retained-verifier-review-v2'),
  frozenAt: millis,
  archiveImmutableVerified: z.literal(true),
  executionClosedVerified: z.literal(true),
}).strict();
export const envelopeSchema = z.object({ binding: verifierBindingSchema, channel: z.enum(EVIDENCE_CHANNELS),
  producer: label, recordId: label, snapshotSetId: id, observedAt: millis, asOf: millis,
  evidenceClass: z.enum(['SIMULATED', 'RECORDED']), complete: z.literal(true), settled: z.literal(true),
  data: z.unknown() }).strict();
export type EvidenceEnvelope = z.infer<typeof envelopeSchema>;

const mapping = z.object({ fixtureId: id, bookingId: id, snapshotId: id, initialObligationId: id,
  balanceObligationId: id, holdId: id, claimId: id, attemptId: id, commandId: id,
  guestId: id, unitId: id, namespace: z.string().max(160), operationKey: z.string().max(160),
  acceptedAt: millis, acceptanceAuditId: id, transactionId: label }).strict();
export const bindingsSchema = z.object({ mappings: rows(mapping) }).strict();
export type RuntimeMapping = z.infer<typeof mapping>;
const audit = z.object({ id, action: label, prior: label.nullable(), next: label, at: millis,
  transactionId: label, reason: label, service: label }).strict();
const dispatch = z.object({ at: millis, requestId: id, invocationId: id, requestDigest: hash,
  idempotencyKey: z.string().max(160), leaseValidUntil: millis, generation: z.string().regex(/^[1-9]\d{0,18}$/) }).strict();
const databaseFixture = z.object({ fixtureId: id, bookingId: id, guestId: id, unitId: id,
  retention: z.literal('SYNTHETIC'), arrival: z.iso.date(), departure: z.iso.date(), zone: z.literal('Europe/Vilnius'),
  bookingState: label, snapshotId: id, totalCents: cents, currency, initialCents: cents, balanceCents: cents,
  obligations: rows(z.object({ id, bookingId: id, kind: z.enum(['INITIAL', 'BALANCE']), amountCents: cents, currency }).strict()),
  hold: z.object({ id, bookingId: id, attemptId: id, state: label,
    terminalAt: millis.nullable(), transitionTransactionId: label.nullable() }).strict(),
  claimHistory: rows(z.object({ claimId: id, holdId: id.nullable(), bookingId: id.nullable(), originHoldId: id.nullable(),
    at: millis, transactionId: label, released: z.boolean() }).strict()),
  attempt: z.object({ id, bookingId: id, obligationId: id, holdId: id, state: label, amountCents: cents, currency,
    sessionId: label.nullable(), paymentIntentId: label.nullable() }).strict(),
  command: z.object({ id, attemptId: id, kind: z.literal('SESSION_CREATE'), logicalKey: z.string().max(180),
    originalKey: z.string().max(160), currentKey: z.string().max(160), originalRequestDigest: hash,
    currentRequestDigest: hash, persistedAt: millis, firstSubmittedAt: millis.nullable(), state: label,
    dispatches: rows(dispatch) }).strict(),
  reconciliations: rows(z.object({ id, attemptId: id, sessionId: label, paymentIntentId: label,
    amountCents: cents, currency, kind: label, result: label, at: millis, transactionId: label,
    webhookEventId: id.nullable(), recoveryId: id.nullable() }).strict()),
  payments: rows(z.object({ id, attemptId: id, bookingId: id, obligationId: id, paymentIntentId: label, chargeId: label,
    reconciliationId: id, amountCents: cents, currency, allocationState: label, transactionId: label }).strict()),
  allocations: rows(z.object({ id, paymentId: id, obligationId: id, amountCents: cents, transactionId: label }).strict()),
  audits: rows(audit),
  notices: rows(z.object({ id, bookingId: id, auditId: id, event: label, key: z.string().max(200),
    recipientId: id, locale: z.enum(['lt', 'en', 'de']), transactionId: label }).strict()),
  notificationAttempts: rows(z.object({ id, notificationId: id, logicalKey: z.string().max(200), attempt: z.number().int().positive() }).strict()),
  inbox: rows(z.object({ id, eventId: label, digest: hash, objectId: label, state: label }).strict()),
  investigations: rows(z.object({ id, eventId: label, digest: hash, reason: z.enum(['UNSUPPORTED', 'DIGEST_CONFLICT', 'UNRESOLVED']),
    durableReceiptId: label, financiallyUncertain: z.boolean() }).strict()),
  // Parsed by the independent original-transaction validator so malformed or
  // missing capture cannot hide independently established financial violations.
  originalTransactions: z.array(z.unknown()).max(16).optional(),
  unresolvedRefundLiabilities: z.number().int().nonnegative(),
}).strict();
export const databaseSchema = z.object({ role: z.literal('zec_acceptance_verifier_reader'),
  isolation: z.literal('REPEATABLE READ READ ONLY'), transactionId: label,
  fixtures: rows(databaseFixture),
  claims: rows(z.object({ id, unitId: id, arrival: z.iso.date(), departure: z.iso.date(), holdId: id.nullable(),
    bookingId: id.nullable(), originHoldId: id.nullable(), operatorBlockId: id.nullable(), released: z.boolean() }).strict()),
}).strict();
export type DatabaseEvidence = z.infer<typeof databaseSchema>;
export const providerSchema = z.object({ accountId: label, livemode: z.boolean(),
  authenticity: z.enum(['AUTHENTICATED_STRIPE_TEST_READ', 'SIMULATED_TEST_READ', 'UNVERIFIED']),
  payments: rows(z.object({ attemptId: id, bookingId: id, holdId: id, commandId: id, sessionId: label,
    paymentIntentId: label.nullable(), chargeId: label.nullable(), requestId: label, accountId: label, livemode: z.boolean(),
    ownership: z.enum(['PERSISTED_COMMAND', 'METADATA_ONLY', 'UNKNOWN']),
    outcome: z.enum(['CAPTURED', 'NONE', 'PROCESSING', 'UNCERTAIN', 'CONFLICT']),
    currency, sessionCents: cents, receivedCents: cents, chargeCents: cents,
    mode: label, methods: rows(label), sessionStatus: label, paymentStatus: label, intentStatus: label,
    chargePaid: z.boolean(), chargeCaptured: z.boolean(), createdAt: millis, expiresAt: millis }).strict()),
}).strict();
export type ProviderEvidence = z.infer<typeof providerSchema>;
// Original immutable plans and independent committed-row observations, not ACK receipts.
export const webhooksSchema = z.object({ handoffObservations: rows(z.unknown()).optional(), accountId: label, endpointId: label, livemode: z.boolean(),
  deliveries: rows(z.object({ deliveryId: id, fixtureId: id, inboxId: id.nullable(), eventId: label, type: z.string().max(120),
    objectType: label, objectId: label, createdAt: millis, receivedAt: millis, digest: hash, originalDigest: hash,
    signature: z.enum(['VERIFIED_RAW_BYTES', 'SIMULATED', 'UNVERIFIED']), signatureEvidenceRef: label.nullable(),
    ownership: z.enum(['PERSISTED_RELATIONSHIPS', 'METADATA_ONLY', 'UNKNOWN', 'DIGEST_CONFLICT', 'UNSUPPORTED']),
    disposition: z.enum(['INGESTED', 'DUPLICATE', 'INVESTIGATION']), lane: z.enum(['PAYMENT', 'NONE']),
    receiptId: label, bookingId: id, attemptId: id, commandId: id }).strict()),
}).strict();
export type WebhookEvidence = z.infer<typeof webhooksSchema>;
const journalEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('OPEN'), deadline: millis }).strict(),
  z.object({ kind: z.literal('AUTHORITY'), verified: z.object({ manifest: z.literal(true), approval: z.literal(true),
    reservation: z.literal(true), docker: z.literal(true), postgres: z.literal(true), stripeTestAccount: z.literal(true),
    journal: z.literal(true), budgetStore: z.literal(true) }).strict(), database: label, targetDigest: hash }).strict(),
  z.object({ kind: z.literal('LOCK'), layer: z.enum(['HOST', 'DATABASE']), observation: z.enum(['ACQUIRED', 'CONTENDED', 'LOST', 'RELEASED', 'UNKNOWN']) }).strict(),
  z.object({ kind: z.literal('START') }).strict(),
  z.object({ kind: z.literal('RESERVE'), requestId: id, operation: z.enum(['STARTUP_ACCOUNT', 'WORKER_ACCOUNT', 'CHECKOUT_DISPATCH', 'PAYMENT_STATUS_RECOVERY', 'PROVIDER_RECONCILIATION', 'OTHER_AUTHORISED']) }).strict(),
  z.object({ kind: z.literal('PROVIDER_RESULT'), requestId: id, outcome: z.enum(['KNOWN', 'UNCERTAIN', 'CANCELLED', 'TIMEOUT', 'NOT_STARTED']) }).strict(),
  z.object({ kind: z.literal('CANCEL'), reason: z.enum(['CANCELLED', 'DEADLINE', 'HOST_SHUTDOWN', 'STALLED_WORKER']) }).strict(),
  z.object({ kind: z.literal('WORKER'), outcome: z.enum(['SUCCEEDED', 'FAILED', 'UNCERTAIN']) }).strict(),
  z.object({ kind: z.literal('CLEANUP'), outcome: z.enum(['SETTLED', 'FAILED', 'UNCERTAIN']) }).strict(),
  z.object({ kind: z.literal('FINISH'), state: z.enum(['COMPLETED', 'FAILED', 'UNCERTAIN', 'HALTED']) }).strict(),
]);
const journalBinding = verifierBindingSchema.omit({ planDigest: true }).extend({ approvalReference: z.string().max(120),
  controlLockKey: z.string().regex(/^[a-f0-9]{16}$/) }).strict();
export const supervisionSchema = z.object({
  journal: z.object({ complete: z.literal(true), durable: z.literal(true), sequence: z.number().int().nonnegative(), headDigest: hash,
    entries: z.array(z.object({ sequence: z.number().int().positive(), previousDigest: hash, digest: hash,
      binding: journalBinding, invocationId: id, at: millis, event: journalEvent }).strict()).max(20_000) }).strict(),
  executions: rows(z.object({ invocationId: id, origin: z.enum(['SCHEDULED', 'MANUAL']), launchRecordId: label,
    owner: label, hostLockPath: z.string().max(160), controlLockKey: z.string().regex(/^[a-f0-9]{16}$/),
    hostAcquiredAt: millis, databaseAcquiredAt: millis, databaseReleasedAt: millis.nullable(), hostReleasedAt: millis.nullable(),
    lockContinuity: z.enum(['VERIFIED', 'LOST', 'UNKNOWN']), cleanup: z.enum(['SETTLED', 'FAILED', 'UNKNOWN']) }).strict()),
  requests: rows(z.object({ requestId: id, invocationId: id, operation: journalEvent.options[4].shape.operation,
    dispatchedAt: millis.nullable(), settledAt: millis, outcome: z.enum(['KNOWN', 'UNCERTAIN', 'CANCELLED', 'TIMEOUT', 'NOT_STARTED']),
    providerRequestId: label.nullable(), attemptId: id.nullable(), commandId: id.nullable() }).strict()),
  recovery: rows(z.object({ id, invocationId: id, attemptId: id, reconciliationId: id, at: millis,
    lane: z.literal('INITIAL_RECONCILIATION'), generation: z.string().regex(/^[1-9]\d{0,18}$/),
    leaseOwner: label, leaseUntil: millis, finishAccepted: z.boolean() }).strict()),
}).strict();
export type SupervisionEvidence = z.infer<typeof supervisionSchema>;
export const payloadSchemas = { bindings: bindingsSchema, database: databaseSchema, provider: providerSchema,
  webhooks: webhooksSchema, supervision: supervisionSchema } as const;

/** Trusted capabilities supplied ONLY by a separately reviewed verifier launcher.
 * Each must be a plain object exposing exactly kind/read. No SQL or network handle.
 * Restrictive roles, protected provenance and independent producers remain external
 * trust requirements; a JS interface cannot sandbox a malicious supplied function. */
export interface AcceptanceEvidenceReader {
  readonly kind: 'acceptance-verifier-read-only-v1';
  read(binding: VerifierBinding): Promise<unknown>;
}
export type AcceptanceEvidenceReaders = Readonly<{ authority: AcceptanceEvidenceReader } &
  Partial<Record<EvidenceChannel, AcceptanceEvidenceReader>>>;
