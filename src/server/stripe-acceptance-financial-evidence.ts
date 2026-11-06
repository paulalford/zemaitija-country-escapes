import 'server-only';
import { z } from 'zod';
import { canonicalRunJson, freshAcceptanceNames, requireSealedAcceptanceRun, runManifestDigest,
  type SealedAcceptanceRun } from './stripe-acceptance-run';

const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.uuid();
const label = z.string().regex(/^[A-Za-z0-9:_.-]{1,160}$/);
const millis = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const xid = z.string().regex(/^[1-9]\d{0,19}$/).refine(v => BigInt(v) <= 18446744073709551615n);
export const financialEvidenceBindingSchema = z.object({ runId: id, manifestDigest: hash, sourceDigest: hash,
  migrationDigest: hash, targetDigest: hash, database: z.string().regex(/^zec_acceptance_[a-f0-9]{32}$/) }).strict();
export type FinancialEvidenceBinding = z.infer<typeof financialEvidenceBindingSchema>;
export const transactionIdentitySchema = z.object({ mechanism: z.literal('POSTGRES_XID8'), xid8: xid,
  backendPid: z.number().int().positive(), transactionId: label }).strict()
  .refine(v => v.transactionId === `pg-xid8:${v.xid8}`);
export type OriginalTransactionIdentity = z.infer<typeof transactionIdentitySchema>;
export const FINANCIAL_EFFECTS = ['RECONCILIATION', 'PAYMENT_RECORD', 'ALLOCATION', 'CLAIM_TRANSFER',
  'HOLD_CONSUMED', 'BOOKING_CONFIRMED', 'CONFIRMATION_AUDIT', 'CONFIRMATION_NOTICE'] as const;
export const financialCaptureSchema = z.object({ kind: z.literal('original-financial-capture-v1'),
  captureId: id, binding: financialEvidenceBindingSchema, fixtureId: id,
  origin: z.enum(['ORIGINAL_DOMAIN_TRANSACTION', 'RETROSPECTIVE_RECONSTRUCTION']),
  transaction: transactionIdentitySchema, collectorId: label, collectorSourceDigest: hash,
  bookingId: id, obligationId: id, commandId: id, attemptId: id, holdId: id, claimId: id,
  sessionId: z.string().regex(/^cs_test_[A-Za-z0-9]+$/), paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/),
  chargeId: z.string().regex(/^ch_[A-Za-z0-9]+$/), accountId: z.string().regex(/^acct_[A-Za-z0-9]+$/),
  currency: z.literal('EUR'), amountCents: z.number().int().positive().max(500000),
  reconciliationResult: z.literal('VERIFIED_INITIAL'),
  effects: z.array(z.object({ kind: z.enum(FINANCIAL_EFFECTS), ordinal: z.number().int().positive(), rowId: id,
    transactionId: label, at: millis.nullable() }).strict()).max(8),
}).strict();
export type OriginalFinancialCapture = z.infer<typeof financialCaptureSchema>;
export const financialTransactionEvidenceSchema = z.object({ capture: financialCaptureSchema,
  captureDigest: hash, outcome: z.enum(['COMMITTED', 'REJECTED', 'UNCERTAIN']),
  settlement: z.object({ mechanism: z.literal('INDEPENDENT_TRANSACTION_OBSERVATION'),
    transaction: transactionIdentitySchema, binding: financialEvidenceBindingSchema,
    observerId: label, evidenceRef: label, captureId: id, captureDigest: hash,
    observedAt: millis, outcome: z.enum(['COMMITTED', 'REJECTED', 'UNCERTAIN']),
    visibility: z.enum(['CAPTURE_ROW_VISIBLE', 'ROLLBACK_ACKNOWLEDGED', 'UNKNOWN']),
  }).strict(),
}).strict();
export type FinancialTransactionEvidence = z.infer<typeof financialTransactionEvidenceSchema>;
export const financialEvidenceDigest = (v: unknown) => runManifestDigest(canonicalRunJson(v));
const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);
export function financialEvidenceBinding(run: SealedAcceptanceRun): FinancialEvidenceBinding {
  requireSealedAcceptanceRun(run);
  if (run.target.database !== freshAcceptanceNames(run.runId).database) throw Error('FINANCIAL_CAPTURE_TARGET_REJECTED');
  return Object.freeze({ runId: run.runId, manifestDigest: financialEvidenceDigest(run), sourceDigest: run.sourceDigest,
    migrationDigest: run.migrationDigest, targetDigest: financialEvidenceDigest(run.target), database: run.target.database });
}
export type FinancialCaptureIssue = Readonly<{ verdict: 'INCOMPLETE' | 'INVESTIGATION_REQUIRED' | 'FAIL';
  code: 'ORIGINAL_TRANSACTION_MISSING' | 'ORIGINAL_TRANSACTION_CONFLICT' | 'FINANCIAL_TRANSACTION_UNCERTAIN' |
    'FINANCIAL_TRANSACTION_REJECTED' | 'ORIGINAL_CAPTURE_INCOMPLETE' }>;
/** Pure read-only proof validation. XID8 identifies the original transaction in
 * this exact fresh cluster; it is NOT a commit timestamp or WAL commit position.
 * Independent authority must anchor this entire evidence in its database envelope. */
export function inspectOriginalFinancialEvidence(raw: unknown, binding: FinancialEvidenceBinding, asOf: number): readonly FinancialCaptureIssue[] {
  if (raw === undefined) return [{ verdict: 'INCOMPLETE', code: 'ORIGINAL_TRANSACTION_MISSING' }];
  const parsed = financialTransactionEvidenceSchema.safeParse(raw);
  if (!parsed.success) return [{ verdict: 'INCOMPLETE', code: 'ORIGINAL_CAPTURE_INCOMPLETE' }];
  const e = parsed.data, c = e.capture, s = e.settlement, issues: FinancialCaptureIssue[] = [];
  if (!same(c.binding, binding) || !same(s.binding, binding) || c.collectorSourceDigest !== binding.sourceDigest ||
    financialEvidenceDigest(c) !== e.captureDigest || s.captureDigest !== e.captureDigest || s.captureId !== c.captureId ||
    !same(c.transaction, s.transaction) || s.observerId === c.collectorId || s.outcome !== e.outcome || s.observedAt > asOf)
    issues.push({ verdict: 'INVESTIGATION_REQUIRED', code: 'ORIGINAL_TRANSACTION_CONFLICT' });
  if (c.origin !== 'ORIGINAL_DOMAIN_TRANSACTION') issues.push({ verdict: 'INCOMPLETE', code: 'ORIGINAL_TRANSACTION_MISSING' });
  if (e.outcome === 'UNCERTAIN' || s.visibility === 'UNKNOWN') issues.push({ verdict: 'INVESTIGATION_REQUIRED', code: 'FINANCIAL_TRANSACTION_UNCERTAIN' });
  if (e.outcome === 'REJECTED') issues.push({ verdict: 'FAIL', code: 'FINANCIAL_TRANSACTION_REJECTED' });
  if (e.outcome === 'COMMITTED' && s.visibility !== 'CAPTURE_ROW_VISIBLE') issues.push({ verdict: 'INCOMPLETE', code: 'ORIGINAL_TRANSACTION_MISSING' });
  const effects = c.effects;
  if (effects.length !== FINANCIAL_EFFECTS.length || FINANCIAL_EFFECTS.some((kind, i) =>
    effects[i]?.kind !== kind || effects[i]?.ordinal !== i + 1)) issues.push({ verdict: 'INCOMPLETE', code: 'ORIGINAL_CAPTURE_INCOMPLETE' });
  if (effects.some(e => e.transactionId !== c.transaction.transactionId)) issues.push({ verdict: 'INVESTIGATION_REQUIRED', code: 'ORIGINAL_TRANSACTION_CONFLICT' });
  const times = effects.filter(e => e.at !== null).map(e => e.at!);
  if (times.some(at => at > s.observedAt)) issues.push({ verdict: 'INVESTIGATION_REQUIRED', code: 'ORIGINAL_TRANSACTION_CONFLICT' });
  if (times.some((at, i) => at > asOf || i > 0 && at < times[i - 1])) issues.push({ verdict: 'FAIL', code: 'ORIGINAL_TRANSACTION_CONFLICT' });
  return issues;
}
