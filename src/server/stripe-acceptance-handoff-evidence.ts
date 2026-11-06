// Pure read-only evidence shapes shared with the unmounted atomic handoff.
import { z } from 'zod';
import { financialEvidenceBindingSchema, transactionIdentitySchema } from './stripe-acceptance-financial-evidence';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/), label = z.string().regex(/^[A-Za-z0-9:_.-]{1,160}$/);
export const eventSchema = z.object({ id: z.string().regex(/^evt_[A-Za-z0-9]+$/), type: z.string().min(1).max(100),
  objectId: z.string().min(1).max(255), objectType: z.string().min(1).max(100), created: z.number().int().nonnegative(),
  accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/), livemode: z.literal(false) }).strict();
export const signatureProofSchema = z.object({ kind: z.enum(['VERIFIED_RAW_BYTES', 'SIMULATED_RAW_BYTES']),
  accountId: z.string(), endpointId: z.string(), payloadDigest: hash, evidenceRef: label }).strict();
export const ownerSchema = z.object({ binding: financialEvidenceBindingSchema, fixtureId: id,
  bookingId: id, obligationId: id, commandId: id, attemptId: id, holdId: id,
  commandAttemptId: id, attemptBookingId: id, attemptObligationId: id, attemptHoldId: id,
  sessionId: z.string().regex(/^cs_test_[A-Za-z0-9]+$/).nullable(), paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/).nullable(),
  originalRequestDigest: hash, currentRequestDigest: hash, originalKey: label, currentKey: label,
}).strict();
export type AtomicHandoffOwnership = z.infer<typeof ownerSchema>;
const inboxSchema = z.object({ id, stripeEventId: z.string(), eventType: z.string(), objectType: z.string(), objectId: z.string(),
  payloadDigest: hash, providerCreated: z.number().int().nonnegative(),
  processingState: z.enum(['PENDING', 'PROCESSING', 'PROCESSED', 'RETRY', 'INVESTIGATE']),
}).strict();
export const originalSchema = z.object({ id, binding: financialEvidenceBindingSchema, transaction: transactionIdentitySchema,
  event: eventSchema, payloadDigest: hash, ownership: ownerSchema.nullable(),
  disposition: z.enum(['PAYMENT', 'INVESTIGATION']), inbox: inboxSchema.nullable(), investigationId: id.nullable() }).strict();
export type OriginalHandoffDisposition = z.infer<typeof originalSchema>;
export const atomicHandoffPlanSchema = z.object({ kind: z.literal('atomic-payment-inbox-handoff-v1'),
  binding: financialEvidenceBindingSchema, transaction: transactionIdentitySchema, deliveryId: id,
  event: eventSchema, incomingDigest: hash, signature: signatureProofSchema,
  original: originalSchema, ownershipObservation: ownerSchema.nullable(), originalAction: z.enum(['INSERT', 'PRESERVE']),
  inboxAction: z.enum(['INSERT_PENDING', 'PRESERVE', 'NONE']),
  investigationId: id.nullable(), reason: z.enum(['OWNED', 'UNKNOWN_OWNERSHIP', 'OWNERSHIP_CONFLICT', 'UNSUPPORTED', 'DIGEST_CONFLICT']),
  result: z.enum(['INGESTED', 'DUPLICATE', 'INVESTIGATION']),
}).strict();
export type AtomicHandoffPlan = z.infer<typeof atomicHandoffPlanSchema>;
export const witnessSchema = z.object({ kind: z.literal('INDEPENDENT_COMMITTED_HANDOFF'), readerId: label,
  evidenceRef: label, binding: financialEvidenceBindingSchema, transaction: transactionIdentitySchema,
  plan: atomicHandoffPlanSchema, planDigest: hash, outcome: z.literal('COMMITTED'),
  inbox: inboxSchema.nullable(), investigationId: id.nullable() }).strict();
export type HandoffCommitObservation = z.infer<typeof witnessSchema>;
