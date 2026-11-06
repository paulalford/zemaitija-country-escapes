import { describe, expect, it, vi } from 'vitest';
import { verifyAcceptanceEvidence, verifyRetainedAcceptanceEvidence } from '../src/server/stripe-acceptance-verifier';
import { financialEvidenceDigest, type FinancialTransactionEvidence } from '../src/server/stripe-acceptance-financial-evidence';
import { verifierFixture, readOnly } from './helpers/stripe-verifier-fixture';

vi.mock('pg', () => { throw Error('Live database forbidden'); });
vi.mock('stripe', () => { throw Error('Live provider forbidden'); });
vi.mock('../src/db/client', () => { throw Error('Shared pool forbidden'); });

describe('F01 chronological statements and atomic provenance', () => {
  it('accepts real statement ordering with distinct timestamps in the SAME transaction', async () => {
    const f = await verifierFixture();
    for (const d of f.database.fixtures.slice(0, 4)) {
      const rec = d.reconciliations[0], audit = d.audits[1];
      d.claimHistory[1].at = rec.at + 1; d.hold.terminalAt = rec.at + 2; audit.at = rec.at + 3;
      const e = d.originalTransactions![0] as FinancialTransactionEvidence;
      e.capture.effects.find(e => e.kind === 'HOLD_CONSUMED')!.at = d.hold.terminalAt;
      e.capture.effects.find(e => e.kind === 'CONFIRMATION_AUDIT')!.at = audit.at;
      e.captureDigest = financialEvidenceDigest(e.capture); e.settlement.captureDigest = e.captureDigest;
    }
    f.supervision.recovery[0].at += 5;
    f.reanchor(); expect((await f.verify()).verdict).toBe('PASS');
  });
  it.each(['hold-before-observation', 'confirmation-before-hold', 'transfer-before-observation', 'transfer-after-hold',
    'confirmation-after-capture', 'different-transaction', 'missing-transaction'])('rejects %s', async kind => {
    const f = await verifierFixture(), d = f.database.fixtures[0], rec = d.reconciliations[0];
    if (kind === 'hold-before-observation') d.hold.terminalAt = rec.at - 1;
    if (kind === 'confirmation-before-hold') d.audits[1].at--;
    if (kind === 'transfer-before-observation') d.claimHistory[1].at--;
    if (kind === 'transfer-after-hold') d.claimHistory[1].at++;
    if (kind === 'confirmation-after-capture') d.audits[1].at = f.review.asOf + 1;
    if (kind === 'different-transaction') rec.transactionId = 'different';
    if (kind === 'missing-transaction') rec.transactionId = '';
    f.reanchor(); expect((await f.verify()).verdict).not.toBe('PASS');
  });
});

describe('F04 separate retrospective read authority', () => {
  async function retained() {
    const f = await verifierFixture(), frozenAt = f.now();
    f.advance(3600000);
    const review = { ...f.review, kind: 'independent-retained-verifier-review-v2', frozenAt,
      archiveImmutableVerified: true, executionClosedVerified: true, notBefore: f.now(), expiresAt: f.now() + 60000 };
    const readers = { ...f.readers, authority: readOnly(async () => structuredClone(review)) };
    return { f, review, readers, verify: () => verifyRetainedAcceptanceEvidence(f.run, f.plan, { now: f.now, readers }) };
  }
  it('verifies frozen evidence later without changing original timestamps or execution expiry', async () => {
    const { f, readers, verify } = await retained(), expiry = f.run.expiresAt;
    expect((await verify()).verdict).toBe('PASS');
    expect(f.run.expiresAt).toBe(expiry);
    expect((await verifyAcceptanceEvidence(f.run, f.plan, { now: f.now, readers })).verdict).toBe('INCOMPLETE');
  });
  it('v1 review cannot invoke archive verification', async () => {
    const f = await verifierFixture();
    expect((await verifyRetainedAcceptanceEvidence(f.run, f.plan, { now: f.now, readers: f.readers })).verdict).toBe('INCOMPLETE');
  });
  it.each(['expired-grant', 'future-freeze', 'post-window-freeze', 'stale-capture', 'mutable-archive', 'execution-open', 'changed-envelope'])('rejects %s', async kind => {
    const { f, review, verify } = await retained();
    if (kind === 'expired-grant') review.expiresAt = f.now();
    if (kind === 'future-freeze') review.frozenAt = f.now() + 1;
    if (kind === 'post-window-freeze') review.frozenAt = Date.parse(f.run.expiresAt) + 1;
    if (kind === 'stale-capture') review.frozenAt += 30001;
    if (kind === 'mutable-archive') review.archiveImmutableVerified = false;
    if (kind === 'execution-open') review.executionClosedVerified = false;
    if (kind === 'changed-envelope') f.envelopes.database.observedAt++;
    expect((await verify()).verdict).not.toBe('PASS');
  });
  it('cannot reconstruct an issued plan or seal with archive authority', async () => {
    const { f, readers } = await retained();
    expect((await verifyRetainedAcceptanceEvidence({ ...f.run }, f.plan, { now: f.now, readers })).verdict).toBe('INCOMPLETE');
  });
});
