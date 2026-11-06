import { describe, expect, it } from 'vitest';
import { assessmentAmounts, cancellationSettlement, type MitigationEvidence } from '../src/server/cancellation-assessment';

const evidence = (charge: bigint, loss = 12000n, avoided = 0n, recovered = 0n): MitigationEvidence => ({
  operationKey: 'synthetic-assessment', expectedRevision: 0, chargeCents: charge,
  documentedLossCents: loss, avoidedCostsCents: avoided,
  replacements: recovered ? [{ bookingId: 'synthetic-rebooking', arrivalDate: '2027-07-02', departureDate: '2027-07-05', recoveredCents: recovered, provenance: 'synthetic' }] : [],
  evidenceRef: 'synthetic', provenance: 'synthetic', legalConstraints: 'review-required', rationale: 'synthetic',
});
describe('M19 supportable cancellation settlement, no automatic forfeiture', () => {
  it.each([[12000n, 0n, 12000n], [12000n, 5000n, 7000n], [40000n, 8000n, 32000n], [12000n, 12000n, 0n]])
  ('settles paid %s and assessed %s with refund %s', (paid, charge, refundDue) => {
    expect(cancellationSettlement(paid, charge)).toEqual({ refundDue, additionalChargeReview: 0n });
  });
  it('separates a remaining charge review from any collection command', () => {
    expect(cancellationSettlement(1000n, 2000n)).toEqual({ refundDue: 0n, additionalChargeReview: 1000n });
  });
  it('allows a zero charge and accounts for saved costs and rebooking once', () => {
    expect(assessmentAmounts(40000n, evidence(0n, 12000n, 5000n, 7000n))).toEqual({ net: 0n, cap: 12000n, recovered: 7000n });
    expect(assessmentAmounts(40000n, evidence(2000n, 12000n, 3000n, 7000n))).toEqual({ net: 2000n, cap: 12000n, recovered: 7000n });
    expect(cancellationSettlement(12000n, 12000n).refundDue).toBe(0n);
    expect(cancellationSettlement(12000n, 2000n).refundDue).toBe(10000n);
  });
  it.each([evidence(12001n), evidence(5001n, 12000n, 7000n), evidence(0n, 40001n), evidence(-1n), evidence(0n, -1n), evidence(0n, 12000n, -1n), evidence(0n, 12000n, 0n, -1n), evidence(0n, 9223372036854775808n)])
  ('rejects unsupported charges or invalid cents %#', e => expect(() => assessmentAmounts(40000n, e)).toThrow());
  it('rejects negative settlement values', () => {
    expect(() => cancellationSettlement(-1n, 0n)).toThrow();
    expect(() => cancellationSettlement(0n, -1n)).toThrow();
  });
});
