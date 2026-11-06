import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { collectAcceptanceEvidence, CAPTURE_SOURCES } from '../src/server/stripe-acceptance-collectors';
import { inspectFreshRunnerBinding, RUNNER_OBSERVATIONS, FRESH_RUNNER_SEQUENCE } from '../src/server/stripe-acceptance-fresh-runner';
import { EVIDENCE_CHANNELS } from '../src/server/stripe-acceptance-verifier-evidence';
import { financialEvidenceDigest, type FinancialTransactionEvidence } from '../src/server/stripe-acceptance-financial-evidence';
import type { HandoffCommitObservation } from '../src/server/stripe-acceptance-handoff-evidence';
import { captureReader, freshRunnerFixture, remediationBFixture } from './helpers/stripe-acceptance-remediation-b-fixture';
import { syntheticId } from './helpers/stripe-verifier-fixture';

vi.mock('pg', () => { throw Error('Database forbidden'); });
vi.mock('stripe', () => { throw Error('Stripe SDK forbidden'); });
vi.mock('node:child_process', () => { throw Error('Infrastructure forbidden'); });
vi.mock('../src/db/client', () => { throw Error('Shared pool forbidden'); });
vi.mock('../src/server/stripe-automation-runner', () => { throw Error('Runner forbidden'); });
vi.mock('../src/server/stripe-automation-recovery', () => { throw Error('Processors forbidden'); });
vi.mock('../src/server/stripe-acceptance', () => { throw Error('Old target boundary forbidden'); });
vi.mock('../src/server/payment-reconciliation', () => { throw Error('Financial engine forbidden'); });
const signal = () => new AbortController().signal;
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network forbidden'); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals(); });
const collect = (f: Awaited<ReturnType<typeof remediationBFixture>>, s = signal()) => collectAcceptanceEvidence(f.run, f.plan,
  { authority: f.authority, sources: f.sources, now: f.now, signal: s });
const inspect = (f: Awaited<ReturnType<typeof freshRunnerFixture>>, s = signal()) => inspectFreshRunnerBinding(f.run, f.integration.review, f.request,
  { authority: f.authority, sources: f.sources, now: f.now, signal: s });

describe('B1 non-operational fresh-runner dependency binding', () => {
  it('validates the complete synthetic authority chain, then unconditionally refuses construction/execution', async () => {
    const f = await freshRunnerFixture(), r = await inspect(f);
    expect(r).toMatchObject({ status: 'PENDING_EXTERNAL_AUTHORITY', diagnostic: 'TRUSTED_LAUNCHER_AND_REVIEWED_RUNNER_SEAM_REQUIRED',
      evidenceClass: 'SIMULATED', ready: false, operationsEnabled: false, processorConstructionEnabled: false, schedulingEnabled: false, readiness: 'NOT_READY' });
    expect(r.checked).toEqual(FRESH_RUNNER_SEQUENCE);
    expect(f.integration.connector.open).not.toHaveBeenCalled();
    expect(Object.values(r).every(v => typeof v !== 'function')).toBe(true);
  });
  it.each(['zemaitija_dev', 'zemaitija_stripe_automation_dev', 'foreign'])('rejects observed protected/foreign database %s', async database => {
    const f = await freshRunnerFixture(); (f.packets.POSTGRES.data as Record<string, unknown>).database_name = database; f.reapprove();
    const r = await inspect(f); expect(r.status).toBe('REJECTED'); expect(r.checked).not.toContain('DEPENDENCIES');
  });
  it.each(['databaseUrl', 'target', 'DATABASE_URL', 'constructDatabase', 'processors', 'fetch', 'database'])('rejects caller-supplied %s without reading authority', async field => {
    const f = await freshRunnerFixture(); Object.assign(f.request, { [field]: 'forbidden' });
    expect((await inspect(f)).status).toBe('REJECTED'); expect(f.authority.read).not.toHaveBeenCalled();
  });
  it.each(['profile', 'run', 'copied-seal', 'copied-review'])('rejects %s identity or authority before source reads', async kind => {
    const f = await freshRunnerFixture();
    if (kind === 'profile') Object.assign(f.request, { profileId: 'old-profile' });
    if (kind === 'run') f.request.runId = syntheticId(9999);
    const r = await inspectFreshRunnerBinding(kind === 'copied-seal' ? { ...f.run } : f.run,
      kind === 'copied-review' ? { ...f.integration.review } : f.integration.review, f.request,
      { authority: f.authority, sources: f.sources, now: f.now, signal: signal() });
    expect(r.status).toBe('REJECTED'); expect(f.authority.read).not.toHaveBeenCalled();
  });
  it('missing host authority remains pending, with no reader or factory fallback', async () => {
    const f = await freshRunnerFixture();
    expect(await inspectFreshRunnerBinding(f.run, undefined, f.request, { sources: f.sources, now: f.now, signal: signal() }))
      .toMatchObject({ status: 'PENDING_EXTERNAL_AUTHORITY', diagnostic: 'HOST_AUTHORITY_REQUIRED', operationsEnabled: false });
    expect(f.integration.connector.open).not.toHaveBeenCalled();
  });
  it.each(RUNNER_OBSERVATIONS)('missing %s prevents completing the dependency chain', async kind => {
    const f = await freshRunnerFixture(); delete f.sources[kind];
    const r = await inspect(f); expect(r.status).toBe('PENDING_EXTERNAL_AUTHORITY'); expect(r.checked).not.toContain(kind);
    expect(f.integration.connector.open).not.toHaveBeenCalled();
  });
  it.each(['docker-image', 'postgres-role', 'ledger', 'reservation', 'stripe-live', 'foreign-authority', 'journal-head', 'shared-pool', 'changed-key', 'raw-fetch', 'database-session'])('rejects %s conflict even after synthetic re-review', async kind => {
    const f = await freshRunnerFixture();
    const data = (k: keyof typeof f.packets) => f.packets[k].data as Record<string, unknown>;
    if (kind === 'docker-image') data('DOCKER').imageId = `sha256:${'f'.repeat(64)}`;
    if (kind === 'postgres-role') data('POSTGRES').role_name = 'zemaitija_migrator';
    if (kind === 'ledger') data('POSTGRES').ledger = [];
    if (kind === 'reservation') data('RESERVATION').resources = [];
    if (kind === 'stripe-live') data('STRIPE').identity = { ...f.run.stripe, livemode: true };
    if (kind === 'foreign-authority') f.authorityRecord.binding = { ...f.authorityRecord.binding, runId: syntheticId(9998) };
    if (kind === 'journal-head') data('JOURNAL').independentHeadDigest = 'e'.repeat(64);
    if (kind === 'shared-pool') data('DEPENDENCIES').sharedPoolFallback = true;
    if (kind === 'changed-key' || kind === 'raw-fetch') data('DEPENDENCIES').contracts = { ...(data('DEPENDENCIES').contracts as object),
      [kind === 'changed-key' ? 'idempotency' : 'providerTransport']: 'REPLACED' };
    if (kind === 'database-session') data('DATABASE_LOCK').sessionId = null;
    f.reapprove(); expect((await inspect(f)).status).toBe('REJECTED');
  });
  it.each(['unreserved', 'after-dispatch', 'uncertain', 'wrong-scope', 'bootstrap-unbudgeted', 'startup-before-lock', 'foreign-invocation'])('rejects %s provider budget/lock evidence', async kind => {
    const f = await freshRunnerFixture(), budget = f.packets.BUDGET.data as { requests: Record<string, unknown>[] }, r = budget.requests[1];
    if (kind === 'unreserved') delete r.reservationEvidenceRef;
    if (kind === 'after-dispatch') r.reservedAt = f.now() - 1;
    if (kind === 'uncertain') r.outcome = 'UNCERTAIN';
    if (kind === 'wrong-scope') r.authorityScope = 'G2_PREFLIGHT';
    if (kind === 'bootstrap-unbudgeted') budget.requests.shift();
    if (kind === 'startup-before-lock') r.reservedAt = f.now() - 2000;
    if (kind === 'foreign-invocation') r.invocationId = syntheticId(8888);
    f.reapprove(); expect((await inspect(f)).status).toBe('REJECTED');
  });
  it.each(['truncated', 'digest', 'missing-head', 'replaced-reservation'])('rejects %s durable budget history', async kind => {
    const f = await freshRunnerFixture(), b = f.packets.BUDGET.data as { ledgerEntries: { digest: string }[]; independentHeadDigest: string; requests: { reservationEvidenceRef: string }[] };
    if (kind === 'truncated') b.ledgerEntries.pop();
    if (kind === 'digest') b.ledgerEntries[0].digest = 'e'.repeat(64);
    if (kind === 'missing-head') b.independentHeadDigest = 'e'.repeat(64);
    if (kind === 'replaced-reservation') b.requests[1].reservationEvidenceRef = 'durable:true';
    f.reapprove(); expect((await inspect(f)).status).toBe('REJECTED');
  });
  it('a full RECORDED-shaped chain with a G3-scoped source grant still exposes no execution entry point', async () => {
    const f = await freshRunnerFixture('G3_EXECUTION'); f.authorityRecord.evidenceClass = 'RECORDED';
    for (const k of RUNNER_OBSERVATIONS) f.packets[k].evidenceClass = 'RECORDED';
    f.reapprove(); expect(await inspect(f)).toMatchObject({ status: 'PENDING_EXTERNAL_AUTHORITY', checked: FRESH_RUNNER_SEQUENCE,
      processorConstructionEnabled: false, operationsEnabled: false, readiness: 'NOT_READY' });
    expect(f.integration.connector.open).not.toHaveBeenCalled();
  });
  it.each(['expired', 'cancelled', 'lock-lost', 'late-reader'])('fails closed on %s without any execution', async kind => {
    const f = await freshRunnerFixture(), controller = new AbortController();
    if (kind === 'expired') f.advance(3600000);
    if (kind === 'cancelled') controller.abort();
    if (kind === 'lock-lost') { (f.packets.HOST_LOCK.data as Record<string, unknown>).observation = 'LOST'; f.reapprove(); }
    if (kind === 'late-reader') f.sources.DEPENDENCIES = captureReader(async () => { f.advance(61000); return structuredClone(f.packets.DEPENDENCIES); });
    expect((await inspect(f, controller.signal)).ready).toBe(false); expect(f.integration.connector.open).not.toHaveBeenCalled();
  });
  it('RECORDED observations cannot upgrade a SOURCE_REVIEW grant into G3 authority', async () => {
    const f = await freshRunnerFixture(); f.authorityRecord.evidenceClass = 'RECORDED';
    const r = await inspect(f); expect(r).toMatchObject({ status: 'PENDING_EXTERNAL_AUTHORITY', diagnostic: 'G3_AUTHORITY_REQUIRED', operationsEnabled: false });
  });
});

describe('B2 separately anchored read-only evidence collection', () => {
  it('feeds unchanged original evidence to the verifier while keeping simulated safety distinct from operational readiness', async () => {
    const f = await remediationBFixture(), before = financialEvidenceDigest(f.packets), r = await collect(f);
    expect(r).toMatchObject({ verdict: 'PASS', readiness: 'NOT_READY', operationsEnabled: false, diagnostics: [] });
    expect(r.verification.evidenceClass).toBe('SIMULATED'); expect(r.verification.scenarios.filter(s => s.paidBookingVerified)).toHaveLength(4);
    expect(r.verification.scenarios[4]).toMatchObject({ expectedInvestigationSafe: true, paidBookingVerified: false });
    expect(f.database.fixtures[4].inbox).toEqual([]); expect(financialEvidenceDigest(f.packets)).toBe(before);
    expect(Object.keys(r.captures)).toEqual(EVIDENCE_CHANNELS);
  });
  it.each(EVIDENCE_CHANNELS)('missing %s source cannot pass', async channel => {
    const f = await remediationBFixture(); delete f.sources[channel];
    const r = await collect(f); expect(r.verdict).toBe('INCOMPLETE'); expect(r.diagnostics).toContain('SOURCE_UNAVAILABLE');
  });
  it.each(['reader-object', 'reader-function', 'reader-name', 'source-system', 'status-object', 'unanchored', 'foreign-run', 'changed-source'])('rejects %s evidence provenance', async kind => {
    const f = await remediationBFixture();
    if (kind === 'reader-object') f.sources.provider = f.sources.database;
    if (kind === 'reader-function') f.sources.provider = { ...f.sources.provider!, read: f.sources.database!.read };
    if (kind === 'reader-name') f.authorityRecord.pins.provider.readerId = f.authorityRecord.pins.database.readerId;
    if (kind === 'source-system') { f.packets.provider.sourceSystem = CAPTURE_SOURCES.database; f.reapprove(); }
    if (kind === 'status-object') f.sources.provider = captureReader(async () => ({ durable: true, paid: true }));
    if (kind === 'unanchored') f.packets.provider.recordId = 'unreviewed-record';
    if (kind === 'foreign-run') { f.packets.provider.binding = { ...f.packets.provider.binding, runId: syntheticId(8899) }; f.reapprove(); }
    if (kind === 'changed-source') { f.packets.provider.binding = { ...f.packets.provider.binding, sourceDigest: 'e'.repeat(64) }; f.reapprove(); }
    expect((await collect(f)).verdict).not.toBe('PASS');
  });
  it.each(['missing-item', 'duplicate-item', 'changed-row', 'retrospective-ids', 'missing-native', 'missing-commit', 'wrong-native', 'wrong-backend'])('rejects %s original capture coverage', async kind => {
    const f = await remediationBFixture(), item = f.packets.bindings.items[0];
    if (kind === 'missing-item') f.packets.bindings.items.pop();
    if (kind === 'duplicate-item') f.packets.bindings.items.push(structuredClone(item));
    if (kind === 'changed-row') item.digest = 'f'.repeat(64);
    if (kind === 'retrospective-ids') item.origin = 'RETROSPECTIVE_RECONSTRUCTION';
    if (kind === 'missing-native') item.transaction = null;
    if (kind === 'missing-commit') item.commitEvidenceRef = null;
    if (kind === 'wrong-native') item.transaction = { mechanism: 'POSTGRES_XID8', xid8: '5000', transactionId: 'pg-xid8:5000', backendPid: 55 };
    if (kind === 'wrong-backend') f.packets.database.items.find(i => i.key.startsWith('financial:'))!.transaction!.backendPid++;
    f.reapprove(false); expect((await collect(f)).verdict).not.toBe('PASS');
  });
  it.each(['provider-account', 'provider-amount', 'provider-uncertain', 'handoff-inbox', 'handoff-commit', 'financial-xid', 'financial-original', 'hold', 'claim', 'notice', 'lock', 'budget', 'journal'])('preserves independent verifier checks for %s', async kind => {
    const f = await remediationBFixture();
    if (kind === 'provider-account') f.provider.payments[0].accountId = 'acct_foreign';
    if (kind === 'provider-amount') f.provider.payments[0].receivedCents++;
    if (kind === 'provider-uncertain') f.provider.payments[0].outcome = 'UNCERTAIN';
    if (kind === 'handoff-inbox') f.database.fixtures[0].inbox = [];
    if (kind === 'handoff-commit') f.webhooks.handoffObservations = [];
    if (kind === 'financial-xid') { const e = f.database.fixtures[0].originalTransactions![0] as FinancialTransactionEvidence; e.settlement.transaction = { ...e.settlement.transaction, xid8: '9999', transactionId: 'pg-xid8:9999' }; }
    if (kind === 'financial-original') f.database.fixtures[0].originalTransactions = [];
    if (kind === 'hold') f.database.fixtures[0].hold.state = 'ACTIVE';
    if (kind === 'claim') f.database.claims[0].originHoldId = null;
    if (kind === 'notice') f.database.fixtures[0].notices = [];
    if (kind === 'lock') f.supervision.executions[0].lockContinuity = 'LOST';
    if (kind === 'budget') f.supervision.requests[0].outcome = 'UNCERTAIN';
    if (kind === 'journal') f.supervision.journal.headDigest = 'e'.repeat(64);
    f.reapprove(); expect((await collect(f)).verdict).not.toBe('PASS');
  });
  it('keeps conflict digest and original inbox separately captured and never creates another allocation', async () => {
    const f = await remediationBFixture(), h = f.webhooks.deliveries[0], w = structuredClone(f.handoffObservations[0]);
    const conflicting = { ...h, deliveryId: syntheticId(8800), digest: 'e'.repeat(64), lane: 'NONE' as const,
      disposition: 'INVESTIGATION' as const, ownership: 'DIGEST_CONFLICT' as const, receiptId: 'conflict-8800' };
    w.plan = { ...w.plan, deliveryId: conflicting.deliveryId, incomingDigest: conflicting.digest, originalAction: 'PRESERVE', inboxAction: 'PRESERVE',
      signature: { ...w.plan.signature, payloadDigest: conflicting.digest }, reason: 'DIGEST_CONFLICT', result: 'INVESTIGATION', investigationId: syntheticId(8801) };
    w.investigationId = w.plan.investigationId; w.planDigest = financialEvidenceDigest(w.plan);
    f.webhooks.deliveries.push(conflicting); (f.webhooks.handoffObservations as HandoffCommitObservation[]).push(w);
    f.database.fixtures[0].investigations.push({ id: w.investigationId!, eventId: h.eventId, digest: conflicting.digest,
      reason: 'DIGEST_CONFLICT', durableReceiptId: conflicting.receiptId, financiallyUncertain: false });
    // Missing new-item provenance remains explicit; the anchored verifier still
    // establishes the incoming conflict rather than replacing original records.
    f.reapprove(false); const before = financialEvidenceDigest(f.database.fixtures[0].allocations), r = await collect(f);
    expect(r.verdict).toBe('INVESTIGATION_REQUIRED'); expect(f.database.fixtures[0].inbox[0].digest).toBe(h.digest);
    expect(financialEvidenceDigest(f.database.fixtures[0].allocations)).toBe(before);
  });
  it.each(['stale', 'future', 'partial', 'uncertain', 'cancelled', 'missing-authority', 'late-reader'])('never upgrades %s evidence', async kind => {
    const f = await remediationBFixture(), controller = new AbortController();
    if (kind === 'stale') f.advance(30001);
    if (kind === 'future') { f.packets.provider.capturedAt = f.now() + 1; f.reapprove(); }
    if (kind === 'partial') { f.packets.provider.completeness = 'PARTIAL'; f.reapprove(); }
    if (kind === 'uncertain') { f.packets.provider.items[0].uncertainty = 'UNCERTAIN'; f.reapprove(); }
    if (kind === 'cancelled') controller.abort();
    if (kind === 'missing-authority') Object.assign(f, { authority: undefined });
    if (kind === 'late-reader') f.sources.supervision = captureReader(async () => { f.advance(30001); return structuredClone(f.packets.supervision); });
    const r = await collect(f, controller.signal); expect(r.verdict).not.toBe('PASS');
  });
  it('relabelled recorded envelopes cannot manufacture authentic provider or signature evidence', async () => {
    const f = await remediationBFixture(); f.review.evidenceClass = 'RECORDED';
    for (const c of EVIDENCE_CHANNELS) { f.envelopes[c].evidenceClass = 'RECORDED'; f.packets[c].evidenceClass = 'RECORDED'; }
    f.reapprove(); const r = await collect(f); expect(r.verdict).toBe('INCOMPLETE');
    expect(r.verification.diagnostics).toContain('INDEPENDENCE_UNVERIFIED');
  });
  it('later source mutation cannot rewrite an already captured independent snapshot', async () => {
    const f = await remediationBFixture();
    f.sources.supervision = captureReader(async () => { f.database.fixtures[0].bookingState = 'CANCELLED_GUEST'; return structuredClone(f.packets.supervision); });
    expect((await collect(f)).verdict).toBe('PASS');
  });
  it.each(['authority', 'provider'])('redacts raw %s source failures into fixed diagnostic codes', async kind => {
    const f = await remediationBFixture(), broken = captureReader(async () => { throw Error('private-error-value'); });
    if (kind === 'authority') f.authority = broken; else f.sources.provider = broken;
    const r = await collect(f); expect(r.verdict).toBe('INCOMPLETE'); expect(JSON.stringify(r)).not.toContain('private-error-value');
    expect(r.diagnostics).toContain('SOURCE_UNAVAILABLE');
  });
  it('missing provenance cannot mask an independently anchored duplicate allocation FAIL', async () => {
    const f = await remediationBFixture(); f.database.fixtures[0].allocations.push({ ...f.database.fixtures[0].allocations[0], id: syntheticId(8888) });
    f.packets.database.items = []; f.reapprove(false);
    const r = await collect(f); expect(r.verdict).toBe('FAIL'); expect(r.verification.diagnostics).toContain('DUPLICATE_FINANCIAL_EFFECT');
  });
});

it('B source modules import only read-only contracts, with no operational construction or IO', () => {
  const allowed = new Set(['zod', '../../scripts/stripe-automation-migration-manifest.json', './stripe-acceptance-run', './stripe-acceptance-trust',
    './stripe-acceptance-fixtures', './stripe-acceptance-financial-evidence', './stripe-acceptance-handoff-evidence', './stripe-acceptance-supervision',
    './stripe-acceptance-verifier-evidence', './stripe-acceptance-verifier', './stripe-acceptance-capture-provenance']);
  for (const name of ['capture-provenance', 'collectors', 'fresh-runner']) {
    const code = readFileSync(`src/server/stripe-acceptance-${name}.ts`, 'utf8');
    for (const match of code.matchAll(/from ['"]([^'"]+)['"]/g)) expect(allowed.has(match[1])).toBe(true);
    expect(code).not.toMatch(/process\.env|node:fs|node:child_process|import\(|new Pool|new Stripe|setTimeout\(|setInterval\(|fetch\(|\.query\(|\.execute\(/);
  }
  expect(readFileSync('src/app/api/internal/stripe-automation/route.ts', 'utf8')).not.toMatch(/fresh-runner|collectors|stripe-automation-runner/);
  expect(readFileSync('src/server/stripe-automation.ts', 'utf8')).toContain('STAGE_2A_INACTIVE');
});
