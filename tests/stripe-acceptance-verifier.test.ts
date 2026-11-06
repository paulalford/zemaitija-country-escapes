import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyAcceptanceEvidence } from '../src/server/stripe-acceptance-verifier';
import { EVIDENCE_CHANNELS, type AcceptanceEvidenceReader } from '../src/server/stripe-acceptance-verifier-evidence';
import { inspectSupervisionSimulation } from '../src/server/stripe-acceptance-supervision';
import { evidenceHash, readOnly, syntheticId, verifierFixture } from './helpers/stripe-verifier-fixture';

vi.mock('pg', () => { throw Error('Database forbidden'); });
vi.mock('stripe', () => { throw Error('Provider SDK forbidden'); });
vi.mock('../src/db/client', () => { throw Error('Shared pool forbidden'); });
vi.mock('../src/server/booking-acceptance', () => { throw Error('Acceptance forbidden'); });
vi.mock('../src/server/checkout-worker', () => { throw Error('Checkout forbidden'); });
vi.mock('../src/server/payment-reconciliation', () => { throw Error('Reconciliation forbidden'); });
vi.mock('../src/server/stripe-automation-runner', () => { throw Error('Worker forbidden'); });
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network forbidden'); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Stage 2C-3H independent source verifier', () => {
  it('corroborated evidence yields five independent PASS results without claiming a genuine run', async () => {
    const f = await verifierFixture(), r = await f.verify();
    expect(r).toMatchObject({ verdict: 'PASS', evidenceClass: 'SIMULATED', operationsEnabled: false, diagnostics: [] });
    expect(r.scenarios.map(s => s.verdict)).toEqual(['PASS', 'PASS', 'PASS', 'PASS', 'PASS']);
    expect(r.scenarios.filter(s => s.paidBookingVerified)).toHaveLength(4);
    expect(r.scenarios[4]).toMatchObject({ paidBookingVerified: false, expectedInvestigationSafe: true });
    expect(r.provenance?.reportDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(r.scenarios[0])).toBe(true);
    expect(await f.verify()).toEqual(r);
    expect(inspectSupervisionSimulation(f.run, f.supervision.journal, f.now()).simulatedState).toBe('COMPLETED');
  });
  it('a paid flag or self-reported runner result cannot replace independent evidence', async () => {
    const f = await verifierFixture();
    for (const c of EVIDENCE_CHANNELS) f.envelopes[c].data = { paid: true, status: 'BOUNDED', workerSuccess: true };
    f.reanchor(); expect((await f.verify()).verdict).toBe('INCOMPLETE');
  });
  it.each(['allocation', 'payment', 'cross-booking-payment'])('duplicate %s is an established failure', async kind => {
    const f = await verifierFixture(), d = f.database.fixtures[0];
    if (kind === 'allocation') d.allocations.push({ ...d.allocations[0], id: syntheticId(9001) });
    else if (kind === 'payment') d.payments.push({ ...d.payments[0], id: syntheticId(9001), paymentIntentId: 'pi_extra' });
    else f.database.fixtures[1].payments[0].paymentIntentId = d.payments[0].paymentIntentId;
    f.reanchor(); const r = await f.verify(); expect(r.verdict).toBe('FAIL'); expect(r.diagnostics).toContain('DUPLICATE_FINANCIAL_EFFECT');
  });
  it('missing transfer history is incomplete; an incorrect transfer is a verified violation', async () => {
    const f = await verifierFixture(); f.database.fixtures[0].claimHistory.pop(); f.reanchor();
    expect((await f.verify()).diagnostics).toContain('INVENTORY_TRANSFER_MISSING');
    f.database.fixtures[0].claimHistory.push({ ...f.database.fixtures[0].claimHistory[0], bookingId: syntheticId(9000) }); f.reanchor();
    expect((await f.verify()).verdict).toBe('FAIL');
  });
  it('detects overlapping operator blocks and duplicate active claims', async () => {
    const f = await verifierFixture(), claim = f.database.claims[0];
    f.database.claims.push({ ...claim, id: syntheticId(9001), bookingId: null, originHoldId: null, operatorBlockId: syntheticId(9002) });
    f.reanchor(); expect((await f.verify()).diagnostics).toContain('INVENTORY_VIOLATION');
  });
  it('detects duplicate logical confirmations even with different keys', async () => {
    const f = await verifierFixture(), d = f.database.fixtures[0]; d.notices.push({ ...d.notices[0], id: syntheticId(9001), key: 'another-key' });
    f.reanchor(); expect((await f.verify()).diagnostics).toContain('DUPLICATE_NOTIFICATION');
  });
  it('counts confirmation notices separately and verifies retries retain their key', async () => {
    const f = await verifierFixture(), d = f.database.fixtures[0]; d.notices.push({ ...d.notices[0], id: syntheticId(9001), event: 'GUEST_PAYMENT_UPDATE', key: 'guest-money-status:test' });
    f.reanchor(); expect((await f.verify()).verdict).toBe('PASS');
    d.notificationAttempts.push({ id: syntheticId(9002), notificationId: d.notices[0].id, logicalKey: 'changed', attempt: 1 });
    f.reanchor(); expect((await f.verify()).diagnostics).toContain('NOTIFICATION_IDEMPOTENCY');
  });
  it.each(['zemaitija_dev', 'zemaitija_stripe_automation_dev', 'foreign'])('rejects target evidence for %s', async database => {
    const f = await verifierFixture(); f.envelopes.database.binding = { ...f.review.binding, database }; f.reanchor();
    expect((await f.verify()).verdict).toBe('INVESTIGATION_REQUIRED');
  });
  it('rejects a foreign fixture, source hash, approval, reservation collision or copied seal', async () => {
    const f = await verifierFixture(); f.database.fixtures[0].fixtureId = syntheticId(999); f.reanchor();
    expect((await f.verify()).diagnostics).toContain('FOREIGN_FIXTURE');
    const g = await verifierFixture(); g.review.inventory.foreignResources.push(g.run.target.database);
    expect((await g.verify()).diagnostics).toContain('TARGET_REJECTED');
    const h = await verifierFixture(); h.review.binding = { ...h.review.binding, sourceDigest: 'f'.repeat(64) };
    expect((await h.verify()).diagnostics).toContain('PROVENANCE_CONFLICT');
    const i = await verifierFixture(); i.review.approvalReference = 'review:foreign'; expect((await i.verify()).verdict).not.toBe('PASS');
    expect((await verifyAcceptanceEvidence({ ...i.run }, i.plan, { now: i.now, readers: i.readers })).diagnostics).toContain('INVALID_RUN_OR_PLAN');
  });
  it.each(['signature', 'ownership', 'signature-reference'])('requires independent webhook %s evidence', async kind => {
    const f = await verifierFixture(), h = f.webhooks.deliveries[0];
    if (kind === 'signature') h.signature = 'UNVERIFIED';
    if (kind === 'ownership') h.ownership = 'METADATA_ONLY';
    if (kind === 'signature-reference') h.signatureEvidenceRef = null;
    f.reanchor(); expect((await f.verify()).verdict).toBe('INCOMPLETE');
  });
  it('conflicting webhook payload digests require investigation', async () => {
    const f = await verifierFixture(); f.webhooks.deliveries[0].digest = 'f'.repeat(64); f.reanchor();
    expect((await f.verify()).verdict).toBe('INVESTIGATION_REQUIRED');
  });
  it.each(['manual', 'missing-recovery', 'foreign-invocation', 'stale-fence'])('missing-webhook recovery needs scheduled evidence: %s', async kind => {
    const f = await verifierFixture(), recovery = f.supervision.recovery[0];
    if (kind === 'manual') f.supervision.executions.find(x => x.invocationId === recovery.invocationId)!.origin = 'MANUAL';
    if (kind === 'missing-recovery') f.supervision.recovery = [];
    if (kind === 'foreign-invocation') recovery.invocationId = syntheticId(999);
    if (kind === 'stale-fence') recovery.finishAccepted = false;
    f.reanchor(); expect((await f.verify()).diagnostics).toContain('RECOVERY_UNPROVEN');
  });
  it.each(['key', 'request', 'unbounded', 'no-delay'])('checks original delayed command %s', async kind => {
    const f = await verifierFixture(), c = f.database.fixtures[3].command;
    if (kind === 'key') c.currentKey = 'replacement';
    if (kind === 'request') c.currentRequestDigest = 'f'.repeat(64);
    if (kind === 'unbounded') c.dispatches[0].leaseValidUntil = c.dispatches[0].at;
    if (kind === 'no-delay') c.persistedAt = c.dispatches[0].at;
    f.reanchor(); const r = await f.verify(); expect(r.verdict).not.toBe('PASS');
    expect(r.scenarios[3].diagnostics).toContain(kind === 'unbounded' ? 'DEADLINE_VIOLATION' : kind === 'no-delay' ? 'DELAY_UNPROVEN' : 'COMMAND_CHANGED');
  });
  it('expected investigation must be durable and cannot masquerade as a paid booking', async () => {
    const f = await verifierFixture(); f.database.fixtures[4].investigations = []; f.reanchor();
    expect((await f.verify()).scenarios[4].verdict).toBe('INCOMPLETE');
    const g = await verifierFixture(); g.database.fixtures[4].bookingState = 'CONFIRMED'; g.reanchor();
    expect((await g.verify()).diagnostics).toContain('FALSE_CONFIRMATION');
    const h = await verifierFixture(); h.database.fixtures[4].investigations[0].financiallyUncertain = true; h.reanchor();
    expect((await h.verify()).scenarios[4]).toMatchObject({ verdict: 'INVESTIGATION_REQUIRED', expectedInvestigationSafe: false, paidBookingVerified: false });
  });
  it.each(['digest', 'head', 'gap', 'incomplete'])('journal %s corruption cannot pass', async kind => {
    const f = await verifierFixture();
    if (kind === 'digest') f.supervision.journal.entries[0].digest = 'a'.repeat(64);
    if (kind === 'head') f.review.journalCheckpoint.headDigest = 'f'.repeat(64);
    if (kind === 'gap') f.supervision.journal.entries.splice(1, 1);
    if (kind === 'incomplete') f.supervision.journal.entries.pop();
    if (kind !== 'head') f.reanchor();
    const r = await f.verify(); expect(r.verdict).not.toBe('PASS'); expect(r.diagnostics).toContain('JOURNAL_CORRUPT');
  });
  it('verifies the entire history, including earlier cleanup failure and lock loss', async () => {
    const f = await verifierFixture(); f.supervision.executions[0].lockContinuity = 'LOST'; f.reanchor();
    expect((await f.verify()).diagnostics).toContain('LOCK_LOST');
    const g = await verifierFixture(); g.supervision.executions[0].cleanup = 'UNKNOWN'; g.reanchor();
    expect((await g.verify()).verdict).toBe('INVESTIGATION_REQUIRED');
  });
  it('counts every reserved request, including cancelled/uncertain and unstarted requests', async () => {
    const f = await verifierFixture();
    const reserve = f.supervision.journal.entries.find(e => e.event.kind === 'RESERVE')!;
    const result = f.supervision.journal.entries.find(e => e.event.kind === 'PROVIDER_RESULT')!;
    if (result.event.kind !== 'PROVIDER_RESULT' || reserve.event.kind !== 'RESERVE') throw Error('expected request');
    result.event.outcome = 'CANCELLED'; f.supervision.requests[0].outcome = 'CANCELLED'; f.rechain();
    expect((await f.verify()).diagnostics).toContain('ACCOUNTING_UNCERTAIN');
  });
  it('independently enforces aggregate and per-invocation budget without resetting at restart', async () => {
    const f = await verifierFixture();
    const source = f.supervision.journal.entries.find(e => e.event.kind === 'RESERVE')!;
    const index = f.supervision.journal.entries.indexOf(source);
    for (let n = 0; n < 601; n++) {
      const clone = structuredClone(source);
      if (clone.event.kind !== 'RESERVE') throw Error('expected reserve');
      clone.event.requestId = syntheticId(10000 + n); f.supervision.journal.entries.splice(index, 0, clone);
    }
    f.rechain(); expect((await f.verify()).diagnostics).toContain('BUDGET_OVERRUN');
  });
  it.each(['provider', 'database', 'bindings', 'webhooks', 'supervision'] as const)('missing %s evidence is incomplete', async channel => {
    const f = await verifierFixture(), readers = { ...f.readers }; delete readers[channel];
    expect((await verifyAcceptanceEvidence(f.run, f.plan, { now: f.now, readers })).verdict).toBe('INCOMPLETE');
  });
  it('stale evidence and expired authority, including expiration during reads, are incomplete', async () => {
    const f = await verifierFixture(); f.advance(30001); expect((await f.verify()).verdict).toBe('INCOMPLETE');
    const g = await verifierFixture(); g.review.expiresAt = g.now() + 1;
    const original = g.readers.supervision!;
    const readers = { ...g.readers, supervision: readOnly(async b => { g.advance(2); return original.read(b); }) };
    expect((await verifyAcceptanceEvidence(g.run, g.plan, { now: g.now, readers })).verdict).toBe('INCOMPLETE');
  });
  it.each(['UNCERTAIN', 'PROCESSING', 'CONFLICT'] as const)('provider %s is financially unresolved, never a failed payment', async outcome => {
    const f = await verifierFixture(); f.provider.payments[0].outcome = outcome; f.reanchor();
    const r = await f.verify(); expect(r.verdict).toBe('INVESTIGATION_REQUIRED'); expect(r.scenarios[0].paidBookingVerified).toBe(false);
  });
  it.each(['account', 'live', 'currency', 'amount', 'metadata'])('provider %s is checked independently', async kind => {
    const f = await verifierFixture();
    if (kind === 'account') f.provider.accountId = 'acct_foreign';
    if (kind === 'live') f.provider.livemode = true;
    if (kind === 'currency') f.provider.payments[0].currency = 'usd';
    if (kind === 'amount') f.provider.payments[0].chargeCents++;
    if (kind === 'metadata') f.provider.payments[0].ownership = 'METADATA_ONLY';
    f.reanchor(); expect((await f.verify()).verdict).toBe(kind === 'metadata' ? 'INCOMPLETE' : 'FAIL');
  });
  it('recorded provenance cannot turn simulated provider/signature evidence into genuine evidence', async () => {
    const f = await verifierFixture(); f.review.evidenceClass = 'RECORDED';
    for (const c of EVIDENCE_CHANNELS) f.envelopes[c].evidenceClass = 'RECORDED';
    f.reanchor(); expect((await f.verify()).verdict).toBe('INCOMPLETE');
  });
  it('cross-source provider identity conflicts require investigation rather than inferred payment failure', async () => {
    const f = await verifierFixture(); f.provider.payments[0].paymentIntentId = 'pi_conflicting'; f.reanchor();
    expect((await f.verify()).verdict).toBe('INVESTIGATION_REQUIRED');
  });
  it('a valid journal chain without independently anchored execution receipts is incomplete', async () => {
    const f = await verifierFixture(); f.supervision.executions = []; f.reanchor();
    expect((await f.verify()).verdict).toBe('INCOMPLETE');
  });
  it.each(['unit', 'interval', 'hold-transaction', 'regression'])('original inventory %s must be established', async kind => {
    const f = await verifierFixture();
    if (kind === 'unit') f.database.claims[0].unitId = syntheticId(999);
    if (kind === 'interval') f.database.claims[0].departure = '2035-02-12';
    if (kind === 'hold-transaction') f.database.fixtures[0].hold.transitionTransactionId = 'other-transaction';
    if (kind === 'regression') f.database.fixtures[0].claimHistory.splice(1, 0, { ...f.database.fixtures[0].claimHistory[0] });
    f.reanchor(); expect((await f.verify()).verdict).toBe('FAIL');
  });
  it('a provider observation without its budgeted HTTP request cannot pass', async () => {
    const f = await verifierFixture(); f.provider.payments[0].requestId = 'req_unaccounted'; f.reanchor();
    expect((await f.verify()).diagnostics).toContain('PAYMENT_EVIDENCE_MISSING');
  });
  it('a falsely labelled supported payment event cannot pass the unsupported-event safety scenario', async () => {
    const f = await verifierFixture(), h = f.webhooks.deliveries.find(h => h.fixtureId === f.plan.fixtures[4].fixtureId)!;
    h.type = 'payment_intent.succeeded'; h.objectType = 'payment_intent'; f.reanchor();
    expect((await f.verify()).verdict).toBe('INVESTIGATION_REQUIRED');
  });
  it('an isolated scenario failure does not overwrite other scenario findings', async () => {
    const f = await verifierFixture(); f.database.fixtures[0].notices = []; f.reanchor();
    const r = await f.verify(); expect(r.scenarios[0].verdict).toBe('INCOMPLETE');
    expect(r.scenarios.slice(1).every(s => s.verdict === 'PASS')).toBe(true);
  });
  it.each(['normal-pending', 'investigation-missing', 'duplicate-original', 'notice-key'])('checks durable delivery/notice idempotency: %s', async kind => {
    const f = await verifierFixture();
    if (kind === 'normal-pending') f.database.fixtures[0].inbox[0].state = 'PENDING';
    if (kind === 'investigation-missing') f.database.fixtures[4].investigations = [];
    if (kind === 'duplicate-original') f.webhooks.deliveries.find(h => h.disposition === 'DUPLICATE')!.originalDigest = 'f'.repeat(64);
    if (kind === 'notice-key') f.database.fixtures[0].notices.push({ ...f.database.fixtures[0].notices[0], id: syntheticId(999), event: 'GUEST_PAYMENT_UPDATE' });
    f.reanchor(); expect((await f.verify()).verdict).not.toBe('PASS');
  });
  it('FAIL takes precedence over uncertainty and incompleteness; unaffected scenarios remain separate', async () => {
    const f = await verifierFixture(); f.database.fixtures[0].allocations.push({ ...f.database.fixtures[0].allocations[0], id: syntheticId(9001) });
    f.provider.payments[1].outcome = 'UNCERTAIN'; f.database.fixtures[3].notices = []; f.reanchor();
    const r = await f.verify(); expect(r.verdict).toBe('FAIL');
    expect(r.scenarios[1].verdict).toBe('INVESTIGATION_REQUIRED'); expect(r.scenarios[2].verdict).toBe('PASS');
    expect(r.scenarios[3].verdict).toBe('INCOMPLETE');
  });
  it('an independently established duplicate allocation still fails when runtime bindings are unavailable', async () => {
    const f = await verifierFixture(), readers = { ...f.readers }; delete readers.bindings;
    f.database.fixtures[0].allocations.push({ ...f.database.fixtures[0].allocations[0], id: syntheticId(9999) }); f.reanchor();
    const r = await verifyAcceptanceEvidence(f.run, f.plan, { now: f.now, readers });
    expect(r.verdict).toBe('FAIL'); expect(r.diagnostics).toContain('DUPLICATE_FINANCIAL_EFFECT');
  });
  it('rejects mutable/pool-like readers, reused readers and self-issued producer identities', async () => {
    const f = await verifierFixture(), unsafe = { ...f.readers.database!, write: () => { throw Error('must never call'); } };
    expect((await verifyAcceptanceEvidence(f.run, f.plan, { now: f.now, readers: { ...f.readers, database: unsafe } })).diagnostics).toContain('READER_REJECTED');
    expect((await verifyAcceptanceEvidence(f.run, f.plan, { now: f.now, readers: { ...f.readers, provider: f.readers.database } })).diagnostics).toContain('INDEPENDENCE_UNVERIFIED');
    f.review.anchors.provider.producer = f.review.reviewer; expect((await f.verify()).diagnostics).toContain('INDEPENDENCE_UNVERIFIED');
  });
  it('detects tampering without independent re-anchoring and returns fixed diagnostics only', async () => {
    const f = await verifierFixture(); f.provider.payments[0].chargeCents++;
    expect((await f.verify()).verdict).toBe('INVESTIGATION_REQUIRED');
    const readers = { ...f.readers, provider: readOnly(async () => { throw Error('private-token-and-guest'); }) };
    const report = await verifyAcceptanceEvidence(f.run, f.plan, { now: f.now, readers });
    expect(JSON.stringify(report)).not.toContain('private-token-and-guest');
  });
  it('reads detached snapshots and never mutates supplied evidence', async () => {
    const f = await verifierFixture(), before = evidenceHash(f.envelopes); await f.verify(); expect(evidenceHash(f.envelopes)).toBe(before);
    const mutate = readOnly(async () => { f.database.fixtures[0].bookingState = 'BAD'; return structuredClone(f.envelopes.provider); });
    const r = await verifyAcceptanceEvidence(f.run, f.plan, { now: f.now, readers: { ...f.readers, provider: mutate } });
    expect(r.verdict).toBe('PASS'); // Already read/anchored database copy cannot change under a later reader.
  });
  it('invalid clock and unavailable review fail closed without leaking private errors', async () => {
    const f = await verifierFixture();
    expect((await verifyAcceptanceEvidence(f.run, f.plan, { now: () => NaN, readers: f.readers })).verdict).toBe('INCOMPLETE');
    const authority: AcceptanceEvidenceReader = readOnly(async () => { throw Error('private'); });
    expect((await verifyAcceptanceEvidence(f.run, f.plan, { now: f.now, readers: { authority } })).diagnostics).toContain('AUTHORITY_UNAVAILABLE');
  });
  it('has only read-only contract imports and leaves inactive HTTP/worker barriers intact', () => {
    const source = readFileSync('src/server/stripe-acceptance-verifier.ts', 'utf8');
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(imports).toEqual(['./stripe-acceptance-handoff-evidence', './stripe-acceptance-run', './stripe-acceptance-fixtures', './stripe-acceptance-verifier-evidence', './stripe-acceptance-financial-evidence']);
    for (const path of ['src/server/stripe-acceptance-verifier.ts', 'src/server/stripe-acceptance-verifier-evidence.ts', 'src/server/stripe-acceptance-handoff-evidence.ts']) {
      const code = readFileSync(path, 'utf8');
      expect(code).not.toMatch(/node:fs|node:child_process|process\.env|setTimeout\(|setInterval\(|fetch\(|compareAndAppend|appendSupervision/);
    }
    expect([...readFileSync('src/server/stripe-acceptance-handoff-evidence.ts', 'utf8').matchAll(/from ['"]([^'"]+)['"]/g)].map(m => m[1])).toEqual(['zod', './stripe-acceptance-financial-evidence']);
    const endpoint = readFileSync('src/app/api/internal/stripe-automation/route.ts', 'utf8');
    expect(endpoint).not.toMatch(/verifier|stripe-automation-runner/);
    expect(readFileSync('src/server/stripe-automation.ts', 'utf8')).toContain('STAGE_2A_INACTIVE');
  });
  it('investigation-only commits need no payment inbox and never verify a paid booking', async () => {
    const f = await verifierFixture();
    expect(f.database.fixtures[4].inbox).toEqual([]);
    const w = f.handoffObservations.at(-1)!;
    expect(w.plan.original.disposition).toBe('INVESTIGATION');
    expect(w.plan.original.inbox).toBeNull(); expect(w.inbox).toBeNull();
    expect(w.plan.original.investigationId).toBe(f.database.fixtures[4].investigations[0].id);
    expect((await f.verify()).scenarios[4]).toMatchObject({ verdict: 'PASS', expectedInvestigationSafe: true, paidBookingVerified: false });
  });
  it.each(['payment-inbox', 'incident', 'observation', 'original-delivery', 'original-admission', 'commit-incident', 'ack-only'])('missing %s cannot establish durable acceptance', async kind => {
    const f = await verifierFixture(), w = f.handoffObservations.at(-1)!;
    if (kind === 'payment-inbox') f.database.fixtures[0].inbox = [];
    if (kind === 'incident') f.database.fixtures[4].investigations = [];
    if (kind === 'observation') f.handoffObservations.pop();
    if (kind === 'original-delivery') f.webhooks.deliveries = f.webhooks.deliveries.filter(h => h.deliveryId !== w.plan.deliveryId);
    if (kind === 'original-admission') { w.plan.originalAction = 'PRESERVE'; w.planDigest = evidenceHash(w.plan); }
    if (kind === 'commit-incident') w.investigationId = null;
    if (kind === 'ack-only') f.webhooks.handoffObservations = [{ durable: true, receiptId: f.webhooks.deliveries.at(-1)!.receiptId }];
    f.reanchor(); expect((await f.verify()).verdict).not.toBe('PASS');
  });
  it.each(['foreign-run', 'original-digest', 'commit-digest', 'native-transaction', 'account', 'endpoint', 'incident-digest', 'ownership', 'unsupported-payment'])('independently detects conflicting %s evidence', async kind => {
    const f = await verifierFixture(), w = f.handoffObservations[0], investigation = f.handoffObservations.at(-1)!;
    if (kind === 'foreign-run') w.plan.ownershipObservation = { ...w.plan.ownershipObservation!, binding: { ...w.plan.ownershipObservation!.binding, runId: syntheticId(9991) } };
    if (kind === 'original-digest') w.plan.original.payloadDigest = 'e'.repeat(64);
    if (kind === 'native-transaction') w.transaction = { ...w.transaction, xid8: '7000', transactionId: 'pg-xid8:7000' };
    if (kind === 'account') w.plan.signature.accountId = 'acct_foreign';
    if (kind === 'endpoint') w.plan.signature.endpointId = 'we_foreign';
    if (kind === 'incident-digest') f.database.fixtures[4].investigations[0].digest = 'e'.repeat(64);
    if (kind === 'ownership') { investigation.plan.ownershipObservation = structuredClone(w.plan.ownershipObservation); }
    if (kind === 'unsupported-payment') { f.webhooks.deliveries.at(-1)!.lane = 'PAYMENT'; }
    w.planDigest = evidenceHash(w.plan); investigation.planDigest = evidenceHash(investigation.plan);
    if (kind === 'commit-digest') w.planDigest = 'e'.repeat(64);
    f.reanchor(); expect((await f.verify()).verdict).toBe('INVESTIGATION_REQUIRED');
  });
  it('explicit unresolved ownership is durable investigation evidence, never a payment success', async () => {
    const f = await verifierFixture(), h = f.webhooks.deliveries.at(-1)!, w = f.handoffObservations.at(-1)!;
    h.ownership = 'UNKNOWN'; w.plan.reason = 'UNKNOWN_OWNERSHIP';
    f.database.fixtures[4].investigations[0].reason = 'UNRESOLVED'; w.planDigest = evidenceHash(w.plan); f.reanchor();
    const r = await f.verify(); expect(r.scenarios[4]).toMatchObject({ verdict: 'INVESTIGATION_REQUIRED', paidBookingVerified: false, expectedInvestigationSafe: false });
    expect(r.diagnostics).not.toContain('INVESTIGATION_EVIDENCE_MISSING');
  });

  async function conflictingDuplicate() {
    const f = await verifierFixture(), original = f.webhooks.deliveries[0], w = structuredClone(f.handoffObservations[0]);
    const h = { ...original, deliveryId: syntheticId(8100), receivedAt: original.receivedAt + 10, digest: 'e'.repeat(64),
      disposition: 'INVESTIGATION' as const, ownership: 'DIGEST_CONFLICT' as const, lane: 'NONE' as const, receiptId: 'conflicting-receipt' };
    // The original payment admission/inbox is retained; only this delivery has a
    // new native transaction, incoming digest and durable investigation.
    w.transaction = { mechanism: 'POSTGRES_XID8', xid8: '8100', backendPid: 81, transactionId: 'pg-xid8:8100' };
    w.plan = { ...w.plan, transaction: w.transaction, deliveryId: h.deliveryId, incomingDigest: h.digest,
      signature: { ...w.plan.signature, payloadDigest: h.digest }, originalAction: 'PRESERVE', inboxAction: 'PRESERVE',
      result: 'INVESTIGATION', reason: 'DIGEST_CONFLICT', investigationId: syntheticId(8101) };
    w.investigationId = w.plan.investigationId; w.evidenceRef = 'conflicting-commit'; w.planDigest = evidenceHash(w.plan);
    f.database.fixtures[0].investigations.push({ id: w.investigationId!, eventId: h.eventId, digest: h.digest,
      reason: 'DIGEST_CONFLICT', durableReceiptId: h.receiptId, financiallyUncertain: false });
    f.webhooks.deliveries.push(h); f.handoffObservations.push(w); f.reanchor();
    return { f, h, w };
  }
  it('a committed conflicting duplicate preserves the original inbox and allocation, with investigation instead of replacement admission', async () => {
    const { f, h, w } = await conflictingDuplicate(), d = f.database.fixtures[0];
    const before = structuredClone({ inbox: d.inbox, payments: d.payments, allocations: d.allocations, original: w.plan.original });
    const r = await f.verify(); expect(r.scenarios[0].verdict).toBe('INVESTIGATION_REQUIRED');
    expect(r.diagnostics).not.toContain('INVESTIGATION_EVIDENCE_MISSING');
    expect(w.plan.original.payloadDigest).toBe('b'.repeat(64)); expect(h.digest).toBe('e'.repeat(64));
    expect(h.inboxId).toBe(d.inbox[0].id); expect(h.lane).toBe('NONE');
    expect({ inbox: d.inbox, payments: d.payments, allocations: d.allocations, original: w.plan.original }).toEqual(before);
  });
  it.each(['replace-inbox', 'replace-original', 'missing-incident', 'second-allocation'])('a conflicting duplicate cannot hide %s', async kind => {
    const { f, w } = await conflictingDuplicate(), d = f.database.fixtures[0];
    if (kind === 'replace-inbox') d.inbox[0].digest = 'e'.repeat(64);
    if (kind === 'replace-original') { w.plan.original.payloadDigest = 'e'.repeat(64); w.planDigest = evidenceHash(w.plan); }
    if (kind === 'missing-incident') d.investigations = [];
    if (kind === 'second-allocation') d.allocations.push({ ...d.allocations[0], id: syntheticId(8102) });
    f.reanchor(); const r = await f.verify();
    expect(r.verdict).toBe(kind === 'second-allocation' ? 'FAIL' : 'INVESTIGATION_REQUIRED');
    if (kind === 'second-allocation') expect(r.diagnostics).toContain('DUPLICATE_FINANCIAL_EFFECT');
    if (kind === 'missing-incident') expect(r.diagnostics).toContain('INVESTIGATION_EVIDENCE_MISSING');
  });
  it('paid financial evidence still needs the original transaction capture after no-inbox investigation is accepted', async () => {
    const f = await verifierFixture(); f.database.fixtures[0].originalTransactions = []; f.reanchor();
    const r = await f.verify(); expect(r.verdict).toBe('INCOMPLETE'); expect(r.diagnostics).toContain('ORIGINAL_TRANSACTION_MISSING');
    expect(r.scenarios[4]).toMatchObject({ verdict: 'PASS', paidBookingVerified: false, expectedInvestigationSafe: true });
  });

});
