import 'server-only';
import { z } from 'zod';
import { canonicalRunJson, type SealedAcceptanceRun } from './stripe-acceptance-run';
import { FINANCIAL_EFFECTS, financialCaptureSchema, financialEvidenceBinding, financialEvidenceDigest,
  transactionIdentitySchema, type OriginalFinancialCapture } from './stripe-acceptance-financial-evidence';

const id = z.uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);

/** FUTURE seam inside recordSuccess's existing withInitialLock callback, after
 * actual IDs/rows are known and BEFORE its COMMIT. Never creates a transaction,
 * calls the engine, commits, or reads a later set of rows as proof of atomicity.
 * stageCapture must INSERT on THAT SAME original connection. No default adapter. */
export interface OriginalFinancialTransactionPort {
  kind: 'original-domain-transaction-capture-v1';
  identity(): Promise<unknown>;
  stageCapture(capture: OriginalFinancialCapture): Promise<unknown>;
}
export async function stageOriginalFinancialCapture(run: SealedAcceptanceRun, raw: unknown, tx: OriginalFinancialTransactionPort) {
  const capture = financialCaptureSchema.parse(JSON.parse(canonicalRunJson(raw))), binding = financialEvidenceBinding(run);
  if (tx.kind !== 'original-domain-transaction-capture-v1' || !same(capture.binding, binding) ||
    capture.collectorSourceDigest !== binding.sourceDigest || capture.origin !== 'ORIGINAL_DOMAIN_TRANSACTION') throw Error('ORIGINAL_CAPTURE_REJECTED');
  const identity = transactionIdentitySchema.parse(await tx.identity());
  if (!same(identity, capture.transaction) || capture.effects.length !== 8 || FINANCIAL_EFFECTS.some((kind, i) =>
    capture.effects[i].kind !== kind || capture.effects[i].ordinal !== i + 1 || capture.effects[i].transactionId !== identity.transactionId))
    throw Error('ORIGINAL_CAPTURE_REJECTED');
  const digest = financialEvidenceDigest(capture);
  const staged = z.object({ kind: z.literal('STAGED_IN_ORIGINAL_TRANSACTION'), captureId: id, captureDigest: hash,
    transaction: transactionIdentitySchema }).strict().parse(await tx.stageCapture(capture));
  if (staged.captureId !== capture.captureId || staged.captureDigest !== digest || !same(staged.transaction, identity) ||
    !same(transactionIdentitySchema.parse(await tx.identity()), identity)) throw Error('ORIGINAL_CAPTURE_REJECTED');
  return Object.freeze({ state: 'STAGED' as const, captureId: capture.captureId, captureDigest: digest,
    transaction: Object.freeze(identity), commitVerified: false as const, operationsEnabled: false as const });
}
