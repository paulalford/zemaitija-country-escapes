import { witnessSchema } from '../src/server/stripe-acceptance-handoff-evidence';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAtomicAcceptanceWebhookIngestion } from '../src/server/stripe-acceptance-atomic-handoff';
import { financialEvidenceBinding, financialEvidenceDigest, inspectOriginalFinancialEvidence,
  type FinancialTransactionEvidence } from '../src/server/stripe-acceptance-financial-evidence';
import { stageOriginalFinancialCapture, type OriginalFinancialTransactionPort } from '../src/server/stripe-acceptance-financial-capture';
import { remediationHandoffFixture } from './helpers/stripe-acceptance-remediation-fixture';
import { verifierFixture, syntheticId } from './helpers/stripe-verifier-fixture';

vi.mock('pg', () => { throw Error('Live database forbidden'); });
vi.mock('stripe', () => { throw Error('Real provider SDK forbidden'); });
vi.mock('../src/db/client', () => { throw Error('Shared database forbidden'); });
vi.mock('../src/server/payment-reconciliation', () => { throw Error('Financial engine invocation forbidden'); });
vi.mock('../src/server/stripe-webhooks', () => { throw Error('Inbox worker invocation forbidden'); });
vi.mock('node:child_process', () => { throw Error('Infrastructure forbidden'); });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2035-01-01T00:01:00.000Z'));
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network forbidden'); }));
});
afterEach(() => {
  expect(vi.getTimerCount()).toBe(0); expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('atomic admission and existing payment-inbox handoff', () => {
  it.each(['PAYMENT', 'INVESTIGATION'] as const)('the independent verifier reads the exact atomic %s witness shape', async outcome => {
    const f = remediationHandoffFixture();
    if (outcome === 'INVESTIGATION') { f.event.type = 'customer.created'; f.event.objectType = 'customer'; f.event.objectId = 'cus_synthetic'; f.ownership(null); }
    await f.ingest();
    const plan = [...f.committedPlans.values()][0];
    const witness = witnessSchema.parse(await f.commitReader.observe(f.binding, plan.deliveryId));
    expect(witness.plan.original.disposition).toBe(outcome);
    expect(witness.inbox === null).toBe(outcome === 'INVESTIGATION');
    expect(witness.investigationId !== null).toBe(outcome === 'INVESTIGATION');
  });
  it('verifies exact raw bytes/account/endpoint and acknowledges only after commit + independent inbox observation', async () => {
    const f = remediationHandoffFixture(), result = await f.ingest();
    expect(result).toMatchObject({ status: 200, receipt: { disposition: 'INGESTED', lane: 'PAYMENT' } });
    expect(f.deps.signatureVerifier.verify).toHaveBeenCalledWith(f.raw, f.input().signature,
      { accountId: f.run.stripe.accountId, endpointId: f.run.stripe.webhookEndpointId });
    expect(f.trace).toEqual(['locked', 'staged', 'commit', 'applied', 'observe', 'closed']);
    expect(f.inboxes.size).toBe(1); expect(f.original()?.ownership).toMatchObject({ bookingId: f.owner.bookingId,
      obligationId: f.owner.obligationId, commandId: f.owner.commandId, attemptId: f.owner.attemptId,
      holdId: f.owner.holdId, sessionId: f.owner.sessionId, paymentIntentId: f.owner.paymentIntentId });
  });
  it('identical duplicates preserve inbox ID, digest and mutable processing state', async () => {
    const f = remediationHandoffFixture(); await f.ingest();
    const original = structuredClone(f.original()), inbox = [...f.inboxes.values()][0]; inbox.processingState = 'PROCESSED';
    expect(await f.ingest()).toMatchObject({ status: 200, receipt: { disposition: 'DUPLICATE' } });
    expect(f.inboxes.size).toBe(1); expect([...f.inboxes.values()][0].processingState).toBe('PROCESSED');
    expect(f.original()).toEqual(original); expect(f.committedPlans.size).toBe(2);
  });
  it('later governed PI binding preserves the identical original Session delivery and records the new relationship', async () => {
    const f = remediationHandoffFixture(); f.owner.paymentIntentId = null;
    expect((await f.ingest()).status).toBe(200);
    f.owner.paymentIntentId = 'pi_synthetic';
    expect(await f.ingest()).toMatchObject({ status: 200, receipt: { disposition: 'DUPLICATE' } });
    expect(f.original()!.ownership!.paymentIntentId).toBeNull();
    expect([...f.committedPlans.values()].at(-1)!.ownershipObservation!.paymentIntentId).toBe('pi_synthetic');
  });
  it.each(['valid', 'missing-session', 'wrong-intent'])('uses persisted Session and PI relationships for intent events: %s', async kind => {
    const f = remediationHandoffFixture(); f.event.type = 'payment_intent.succeeded'; f.event.objectType = 'payment_intent'; f.event.objectId = 'pi_synthetic';
    if (kind === 'missing-session') f.owner.sessionId = null;
    if (kind === 'wrong-intent') f.owner.paymentIntentId = 'pi_other';
    expect(await f.ingest()).toMatchObject({ status: 200, receipt: { disposition: kind === 'valid' ? 'INGESTED' : 'INVESTIGATION',
      lane: kind === 'valid' ? 'PAYMENT' : 'NONE' } });
  });
  it('a conflicting event digest is investigated, never updates original/inbox financial identity', async () => {
    const f = remediationHandoffFixture(); await f.ingest(); const original = structuredClone(f.original());
    const changed = Buffer.from('conflicting bytes'); f.proof.payloadDigest = createHash('sha256').update(changed).digest('hex');
    const handler = createAtomicAcceptanceWebhookIngestion(f.run, f.deps);
    expect(await handler({ ...f.input(), raw: changed })).toMatchObject({ status: 200,
      receipt: { disposition: 'INVESTIGATION', ownership: 'DIGEST_CONFLICT', lane: 'NONE', originalPayloadDigest: original!.payloadDigest } });
    expect(f.original()).toEqual(original); expect(f.inboxes.size).toBe(1); expect(f.incidents.size).toBe(1);
  });
  it.each(['unknown-booking', 'unknown-payment', 'foreign-run', 'source-mismatch', 'booking-mismatch', 'command-mismatch', 'obligation-mismatch',
    'changed-request', 'changed-key', 'unbound-session', 'unsupported'])('keeps %s out of payment processing', async kind => {
    const f = remediationHandoffFixture();
    if (kind.startsWith('unknown-')) f.ownership(null);
    if (kind === 'foreign-run') f.owner.binding = { ...f.binding, runId: syntheticId(9900) };
    if (kind === 'source-mismatch') f.owner.binding = { ...f.binding, sourceDigest: 'f'.repeat(64) };
    if (kind === 'booking-mismatch') f.owner.attemptBookingId = syntheticId(9900);
    if (kind === 'command-mismatch') f.owner.commandAttemptId = syntheticId(9900);
    if (kind === 'obligation-mismatch') f.owner.attemptObligationId = syntheticId(9900);
    if (kind === 'changed-request') f.owner.currentRequestDigest = 'f'.repeat(64);
    if (kind === 'changed-key') f.owner.currentKey = 'changed';
    if (kind === 'unbound-session') f.owner.sessionId = null;
    if (kind === 'unsupported') { f.event.type = 'refund.created'; f.event.objectType = 'refund'; }
    expect(await f.ingest()).toMatchObject({ status: 200, receipt: { disposition: 'INVESTIGATION', lane: 'NONE' } });
    expect(f.inboxes.size).toBe(0); expect(f.incidents.size).toBe(1);
  });
  it.each(['account', 'endpoint', 'digest', 'unverified-for-recorded', 'signature-failure'])('rejects %s before opening a transaction', async kind => {
    const f = remediationHandoffFixture();
    if (kind === 'account') f.proof.accountId = 'acct_other';
    if (kind === 'endpoint') f.proof.endpointId = 'we_other';
    if (kind === 'digest') f.proof.payloadDigest = 'f'.repeat(64);
    if (kind === 'unverified-for-recorded') f.deps.evidenceClass = 'RECORDED';
    if (kind === 'signature-failure') f.deps.signatureVerifier.verify.mockImplementation(() => { throw Error('private-secret'); });
    const result = await f.ingest(); expect(result.status).toBe(400); expect(result.receipt).toBeUndefined();
    expect(f.driver.begin).not.toHaveBeenCalled(); expect(JSON.stringify(result)).not.toContain('private-secret');
  });
  it.each(['BEFORE_COMMIT', 'AFTER_COMMIT', 'MISSING_INBOX', 'CLOSE'] as const)('never acknowledges %s or retries the transaction', async failure => {
    const f = remediationHandoffFixture(); f.failure(failure);
    expect(await f.ingest()).toMatchObject({ status: 503, diagnostic: 'DELIVERY_UNCERTAIN' });
    expect(f.trace.filter(e => e === 'commit')).toHaveLength(1); expect(f.fenced()).toBe(true);
    expect(f.trace).not.toContain('rollback');
    if (failure === 'AFTER_COMMIT') { expect(f.inboxes.size).toBe(1); expect(f.commitReader.observe).not.toHaveBeenCalled(); }
  });
  it('no approved investigation row means no acknowledgement', async () => {
    const f = remediationHandoffFixture(); f.ownership(null); f.failure('MISSING_INCIDENT');
    expect((await f.ingest()).status).toBe(503); expect(f.fenced()).toBe(true);
  });
  it('a durable flag or a writer echo is insufficient proof of committed handoff', async () => {
    const f = remediationHandoffFixture(); f.commitReader.observe.mockResolvedValue({ durable: true } as never);
    expect((await f.ingest()).status).toBe(503); expect(f.fenced()).toBe(true);
    const g = remediationHandoffFixture(); g.commitReader.readerId = g.driver.writerId;
    expect(() => createAtomicAcceptanceWebhookIngestion(g.run, g.deps)).toThrow('INDEPENDENT_HANDOFF_READER_REQUIRED');
  });
  it.each(['foreign-run', 'wrong-source', 'wrong-transaction', 'wrong-reader', 'wrong-digest', 'changed-inbox'])('does not acknowledge a conflicting independent witness: %s', async kind => {
    const f = remediationHandoffFixture(), originalObserve = f.commitReader.observe.getMockImplementation()!;
    f.commitReader.observe.mockImplementation(async (binding, deliveryId) => {
      const witness = await originalObserve(binding, deliveryId);
      if (kind === 'foreign-run') witness.binding = { ...witness.binding, runId: syntheticId(9900) };
      if (kind === 'wrong-source') witness.binding = { ...witness.binding, sourceDigest: 'f'.repeat(64) };
      if (kind === 'wrong-transaction') witness.transaction = { ...witness.transaction, xid8: '999', transactionId: 'pg-xid8:999' };
      if (kind === 'wrong-reader') witness.readerId = 'another-reader';
      if (kind === 'wrong-digest') witness.planDigest = 'f'.repeat(64);
      if (kind === 'changed-inbox') witness.inbox!.payloadDigest = 'f'.repeat(64);
      return witness;
    });
    expect(await f.ingest()).toMatchObject({ status: 503, diagnostic: 'DELIVERY_UNCERTAIN', operationsEnabled: false, evidenceClass: 'SIMULATED' });
    expect(f.fenced()).toBe(true); expect(f.inboxes.size).toBe(1); // Retain the committed original; no rollback claim.
  });
  it('pending commit cannot emit a receipt or perform an independent observation', async () => {
    const f = remediationHandoffFixture(), begin = f.driver.begin;
    let finish: (() => void) | undefined, entered: (() => void) | undefined;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    f.driver.begin = vi.fn(async (binding, signal) => {
      const tx = await begin(binding, signal), commit = tx.commit;
      tx.commit = async () => { entered!(); await new Promise<void>(resolve => { finish = resolve; }); return commit(); };
      return tx;
    });
    let settled = false; const pending = f.ingest().then(result => { settled = true; return result; });
    await reached; expect(settled).toBe(false); expect(f.commitReader.observe).not.toHaveBeenCalled();
    finish!(); expect((await pending).status).toBe(200);
  });
  it('missing original duplicate handoff cannot be silently repaired or acknowledged', async () => {
    const f = remediationHandoffFixture(); await f.ingest(); f.original()!.inbox = null;
    expect((await f.ingest()).status).toBe(503); expect(f.trace.filter(e => e === 'commit')).toHaveLength(1);
  });
  it('concurrent identical deliveries serialize with exactly one inbox row', async () => {
    const f = remediationHandoffFixture();
    const results = await Promise.all([f.ingest(), f.ingest()]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(results.map(r => r.receipt?.disposition).sort()).toEqual(['DUPLICATE', 'INGESTED']); expect(f.inboxes.size).toBe(1);
  });
  it('cancelled/expired authority never begins handoff', async () => {
    const f = remediationHandoffFixture(), controller = new AbortController(); controller.abort();
    expect((await createAtomicAcceptanceWebhookIngestion(f.run, f.deps)({ ...f.input(), signal: controller.signal })).status).not.toBe(200);
    expect(f.driver.begin).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(f.run.expiresAt)); expect((await f.ingest()).status).not.toBe(200); expect(f.driver.begin).not.toHaveBeenCalled();
  });
});

describe('original financial transaction capture and read-only acceptance', () => {
  async function evidence() {
    const f = await verifierFixture(), d = f.database.fixtures[0], e = d.originalTransactions![0] as FinancialTransactionEvidence;
    const resign = () => { e.captureDigest = financialEvidenceDigest(e.capture); e.settlement.captureDigest = e.captureDigest; f.reanchor(); };
    return { f, d, e, resign };
  }
  it('complete same-transaction identities and ordered distinct real statement times pass', async () => {
    const { f, d, e, resign } = await evidence(), rec = d.reconciliations[0];
    d.claimHistory[1].at = rec.at + 1; d.hold.terminalAt = rec.at + 2; d.audits[1].at = rec.at + 3;
    e.capture.effects.find(e => e.kind === 'HOLD_CONSUMED')!.at = rec.at + 2;
    e.capture.effects.find(e => e.kind === 'CONFIRMATION_AUDIT')!.at = rec.at + 3;
    resign(); expect((await f.verify()).verdict).toBe('PASS');
  });
  it('missing original capture cannot be replaced by equal transaction labels in later snapshots', async () => {
    const { f, d } = await evidence(); delete d.originalTransactions; f.reanchor();
    expect(await f.verify()).toMatchObject({ verdict: 'INCOMPLETE', operationsEnabled: false });
    expect((await f.verify()).diagnostics).toContain('ORIGINAL_TRANSACTION_MISSING');
  });
  it.each(['ALLOCATION', 'CLAIM_TRANSFER', 'CONFIRMATION_NOTICE'] as const)('missing original %s evidence is INCOMPLETE', async kind => {
    const { f, e, resign } = await evidence(); e.capture.effects = e.capture.effects.filter(e => e.kind !== kind); resign();
    expect((await f.verify()).verdict).toBe('INCOMPLETE');
  });
  it.each(['source', 'run', 'native-transaction', 'effect-transaction', 'row-identity', 'settlement-digest', 'same-observer', 'before-commit-observation'])('conflicting %s requires investigation', async kind => {
    const { f, e, resign } = await evidence();
    if (kind === 'source') e.capture.collectorSourceDigest = 'f'.repeat(64);
    if (kind === 'run') e.capture.binding = { ...e.capture.binding, runId: syntheticId(9988) };
    if (kind === 'native-transaction') e.settlement.transaction = { ...e.settlement.transaction, xid8: '9000', transactionId: 'pg-xid8:9000' };
    if (kind === 'effect-transaction') e.capture.effects[1].transactionId = 'pg-xid8:9000';
    if (kind === 'row-identity') e.capture.effects[2].rowId = syntheticId(9988);
    if (kind === 'same-observer') e.settlement.observerId = e.capture.collectorId;
    if (kind === 'before-commit-observation') e.settlement.observedAt = e.capture.effects[0].at! - 1;
    resign();
    if (kind === 'settlement-digest') { e.settlement.captureDigest = 'f'.repeat(64); f.reanchor(); }
    expect((await f.verify()).verdict).toBe('INVESTIGATION_REQUIRED');
  });
  it('retrospective reconstruction is distinguishable and cannot prove original atomicity', async () => {
    const { f, e, resign } = await evidence(); e.capture.origin = 'RETROSPECTIVE_RECONSTRUCTION'; resign();
    expect((await f.verify()).verdict).toBe('INCOMPLETE');
  });
  it.each(['REJECTED', 'UNCERTAIN'] as const)('original financial transaction outcome %s never passes', async outcome => {
    const { f, e } = await evidence(); e.outcome = outcome; e.settlement.outcome = outcome;
    e.settlement.visibility = outcome === 'REJECTED' ? 'ROLLBACK_ACKNOWLEDGED' : 'UNKNOWN'; f.reanchor();
    expect((await f.verify()).verdict).toBe(outcome === 'REJECTED' ? 'FAIL' : 'INVESTIGATION_REQUIRED');
  });
  it('a STAGED receipt has no commit authority and cannot be supplied as committed verifier evidence', async () => {
    const { f, e, d } = await evidence(), tx: OriginalFinancialTransactionPort = {
      kind: 'original-domain-transaction-capture-v1', identity: vi.fn(async () => structuredClone(e.capture.transaction)),
      stageCapture: vi.fn(async capture => ({ kind: 'STAGED_IN_ORIGINAL_TRANSACTION', captureId: capture.captureId,
        captureDigest: financialEvidenceDigest(capture), transaction: capture.transaction })),
    };
    const staged = await stageOriginalFinancialCapture(f.run, e.capture, tx);
    expect(staged).toMatchObject({ state: 'STAGED', commitVerified: false, operationsEnabled: false });
    expect(tx.stageCapture).toHaveBeenCalledOnce(); d.originalTransactions = [staged]; f.reanchor();
    expect((await f.verify()).verdict).toBe('INCOMPLETE');
  });
  it.each(['foreign-context', 'different-session', 'reconstruction', 'missing-effect', 'durable-flag'])('capture seam rejects %s', async kind => {
    const { f, e } = await evidence(); const capture = structuredClone(e.capture);
    const transaction = structuredClone(capture.transaction);
    if (kind === 'foreign-context') capture.binding = { ...capture.binding, database: 'zec_acceptance_' + 'f'.repeat(32) };
    if (kind === 'different-session') transaction.backendPid++;
    if (kind === 'reconstruction') capture.origin = 'RETROSPECTIVE_RECONSTRUCTION';
    if (kind === 'missing-effect') capture.effects.pop();
    const tx: OriginalFinancialTransactionPort = { kind: 'original-domain-transaction-capture-v1', identity: async () => transaction,
      stageCapture: vi.fn(async () => ({ durable: true })) };
    await expect(stageOriginalFinancialCapture(f.run, capture, tx)).rejects.toThrow();
    if (kind !== 'durable-flag') expect(tx.stageCapture).not.toHaveBeenCalled();
  });
  it('direct proof inspector is deterministic and rejects a durable flag as missing original evidence', async () => {
    const { f } = await evidence();
    expect(inspectOriginalFinancialEvidence({ durable: true }, financialEvidenceBinding(f.run), f.now()))
      .toEqual([{ verdict: 'INCOMPLETE', code: 'ORIGINAL_CAPTURE_INCOMPLETE' }]);
  });
});

describe('source preservation and execution boundary', () => {
  it('new contracts import no operational engine, client, provider SDK, filesystem or scheduler', () => {
    for (const suffix of ['atomic-handoff', 'financial-evidence', 'financial-capture']) {
      const source = readFileSync(`src/server/stripe-acceptance-${suffix}.ts`, 'utf8');
      expect(source).not.toMatch(/from ['"]pg['"]|from ['"]stripe['"]|from ['"].*(?:payment-reconciliation|stripe-webhooks|db\/client)['"]|node:fs|node:child_process|process\.env|setTimeout\(|setInterval\(|\.listen\(/);
    }
    expect(readFileSync('src/server/stripe-automation.ts', 'utf8')).toContain('STAGE_2A_INACTIVE');
  });
});
