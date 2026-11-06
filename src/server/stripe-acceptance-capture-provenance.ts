import 'server-only';
import { z } from 'zod';
import { canonicalRunJson } from './stripe-acceptance-run';
import { financialEvidenceBindingSchema, financialEvidenceDigest, transactionIdentitySchema,
  type FinancialEvidenceBinding } from './stripe-acceptance-financial-evidence';

const label = z.string().regex(/^[A-Za-z0-9:_.-]{1,160}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/), time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const CAPTURE_DIAGNOSTICS = ['SOURCE_UNAVAILABLE', 'CAPTURE_INVALID', 'CAPTURE_MISSING', 'CAPTURE_STALE',
  'CAPTURE_CONFLICT', 'SOURCE_NOT_INDEPENDENT', 'CAPTURE_PARTIAL', 'CAPTURE_UNCERTAIN', 'ORIGINAL_PROVENANCE_MISSING',
  'ITEM_COVERAGE_CONFLICT', 'CANCELLED'] as const;
export type CaptureDiagnostic = typeof CAPTURE_DIAGNOSTICS[number];
export class CaptureFailure extends Error {
  constructor(readonly code: CaptureDiagnostic, readonly verdict: 'INCOMPLETE' | 'INVESTIGATION_REQUIRED' = 'INCOMPLETE') { super(code); }
}
export const capturePinSchema = z.object({ sourceSystem: label, readerId: label, recordId: label, digest: hash }).strict();
export type CapturePin = z.infer<typeof capturePinSchema>;
/** Run, source, reader and collection-window provenance is inherited from the
 * enclosing immutable packet. Each item additionally identifies its actual row,
 * original native transaction where applicable and independent commit record.
 * Null transaction means unavailable/not applicable, never an invented XID. */
export const captureItemSchema = z.object({ key: label, digest: hash, capturedAt: time,
  origin: z.enum(['ORIGINAL_TRANSACTION', 'INDEPENDENT_OBSERVATION', 'RETROSPECTIVE_RECONSTRUCTION']),
  transaction: transactionIdentitySchema.nullable(), commitEvidenceRef: label.nullable(),
  completeness: z.enum(['COMPLETE', 'PARTIAL']), uncertainty: z.enum(['SETTLED', 'UNCERTAIN', 'UNAVAILABLE']),
  diagnostics: z.array(z.enum(CAPTURE_DIAGNOSTICS)).max(16) }).strict();
export type CaptureItem = z.infer<typeof captureItemSchema>;
export const capturePacketSchema = z.object({ kind: z.literal('independent-acceptance-capture-v1'),
  binding: financialEvidenceBindingSchema, sourceSystem: label, readerId: label, recordId: label,
  evidenceClass: z.enum(['SIMULATED', 'RECORDED']), windowStart: time, windowEnd: time, capturedAt: time,
  completeness: z.enum(['COMPLETE', 'PARTIAL']), uncertainty: z.enum(['SETTLED', 'UNCERTAIN', 'UNAVAILABLE']),
  diagnostics: z.array(z.enum(CAPTURE_DIAGNOSTICS)).max(16), items: z.array(captureItemSchema).max(24000), data: z.unknown() }).strict();
export type CapturePacket = z.infer<typeof capturePacketSchema>;
/** Supplied ONLY by separately reviewed independent controller construction.
 * No default IO, credentials, URLs, SQL, writes, provider or filesystem capability.
 * This structural check cannot sandbox a malicious injected implementation. */
export interface IndependentCaptureReader {
  readonly kind: 'acceptance-capture-read-only-v1';
  read(binding: FinancialEvidenceBinding): Promise<unknown>;
}
export function isCaptureReader(value: IndependentCaptureReader | undefined): value is IndependentCaptureReader {
  return !!value && Object.getPrototypeOf(value) === Object.prototype && value.kind === 'acceptance-capture-read-only-v1' &&
    Reflect.ownKeys(value).length === 2 && typeof value.read === 'function';
}
export function requireIndependentCaptureReaders(readers: readonly IndependentCaptureReader[], pins: readonly CapturePin[], reviewer: string) {
  if (readers.some(r => !isCaptureReader(r)) || new Set(readers).size !== readers.length ||
    new Set(readers.map(r => r.read)).size !== readers.length ||
    new Set([reviewer, ...pins.map(p => p.readerId)]).size !== pins.length + 1 ||
    new Set(pins.map(p => p.recordId)).size !== pins.length)
    throw new CaptureFailure('SOURCE_NOT_INDEPENDENT');
}
export function detachedCapture(value: unknown): unknown {
  const encoded = canonicalRunJson(value);
  if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) throw new CaptureFailure('CAPTURE_INVALID');
  return JSON.parse(encoded) as unknown;
}
export async function readPinnedCapture(reader: IndependentCaptureReader | undefined, pin: CapturePin,
  binding: FinancialEvidenceBinding, sourceSystem: string, evidenceClass: CapturePacket['evidenceClass'],
  window: Readonly<{ notBefore: number; expiresAt: number }>, now: () => number, signal: AbortSignal): Promise<CapturePacket> {
  if (!isCaptureReader(reader)) throw new CaptureFailure('SOURCE_UNAVAILABLE');
  const check = () => {
    const n = now();
    if (signal.aborted) throw new CaptureFailure('CANCELLED');
    if (!Number.isSafeInteger(n) || n < window.notBefore || n >= window.expiresAt) throw new CaptureFailure('CAPTURE_STALE');
    return n;
  };
  check();
  let raw: unknown;
  try { raw = detachedCapture(await reader.read(binding)); } catch { throw new CaptureFailure('SOURCE_UNAVAILABLE'); }
  const n = check(), parsed = capturePacketSchema.safeParse(raw);
  if (!parsed.success) throw new CaptureFailure('CAPTURE_INVALID');
  const p = parsed.data;
  if (canonicalRunJson(p.binding) !== canonicalRunJson(binding) || p.sourceSystem !== sourceSystem || pin.sourceSystem !== sourceSystem ||
    p.readerId !== pin.readerId || p.recordId !== pin.recordId || financialEvidenceDigest(p) !== pin.digest || p.evidenceClass !== evidenceClass)
    throw new CaptureFailure('CAPTURE_CONFLICT', 'INVESTIGATION_REQUIRED');
  if (p.windowStart < window.notBefore || p.windowEnd > window.expiresAt || p.windowStart > p.capturedAt ||
    p.capturedAt >= p.windowEnd || n < p.capturedAt || n - p.capturedAt > 30000 || n >= p.windowEnd ||
    p.items.some(i => i.capturedAt < p.windowStart || i.capturedAt > p.capturedAt)) throw new CaptureFailure('CAPTURE_STALE');
  return p;
}
