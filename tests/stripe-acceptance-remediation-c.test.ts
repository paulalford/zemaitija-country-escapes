import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as launcher from '../src/server/stripe-acceptance-launcher';
import { inspectAcceptanceMonitoring, inspectAcceptanceLockHistory, MONITOR_SOURCES } from '../src/server/stripe-acceptance-monitoring';
import { inspectAcceptanceShutdown, ACCEPTANCE_PROCESS_POLICY } from '../src/server/stripe-acceptance-shutdown';
import { financialEvidenceDigest } from '../src/server/stripe-acceptance-financial-evidence';
import { RUNNER_OBSERVATIONS } from '../src/server/stripe-acceptance-fresh-runner';
import { EVIDENCE_CHANNELS } from '../src/server/stripe-acceptance-verifier-evidence';
import { anchoredEvidence, durableProviderBudget } from '../src/server/stripe-acceptance-durable';
import { appendSupervisionSimulation, inspectSupervisionSimulation, supervisionBinding } from '../src/server/stripe-acceptance-supervision';
import { integrationFixture } from './helpers/stripe-acceptance-integration-fixture';
import { SimulatedSupervisionDisk, SimulatedLockRegistry } from './helpers/stripe-supervision-store';
import { syntheticId } from './helpers/stripe-verifier-fixture';
import { captureReader } from './helpers/stripe-acceptance-remediation-b-fixture';
import { remediationCFixture } from './helpers/stripe-acceptance-remediation-c-fixture';

vi.mock('pg', () => { throw Error('Real PostgreSQL forbidden'); });
vi.mock('stripe', () => { throw Error('Real Stripe forbidden'); });
vi.mock('node:child_process', () => { throw Error('Infrastructure forbidden'); });
vi.mock('../src/db/client', () => { throw Error('Shared database forbidden'); });
vi.mock('../src/server/stripe-automation-runner', () => { throw Error('Runner forbidden'); });
vi.mock('../src/server/stripe-automation-recovery', () => { throw Error('Processors forbidden'); });
vi.mock('../src/server/stripe-acceptance', () => { throw Error('Old boundary forbidden'); });
vi.mock('../src/server/payment-reconciliation', () => { throw Error('Financial engine forbidden'); });
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('fetch', vi.fn(() => { throw Error('Network forbidden'); })); });
afterEach(() => { expect(globalThis.fetch).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); vi.useRealTimers(); vi.unstubAllGlobals(); });
const inspect = (f: Awaited<ReturnType<typeof remediationCFixture>>) => launcher.inspectTrustedAcceptanceLauncher(f.run, f.plan, f.request, { protectedIO: f.descriptor.io, monitor: f.readers });
const monitor = (f: Awaited<ReturnType<typeof remediationCFixture>>) => inspectAcceptanceMonitoring(f.run, f.plan, f.integration.review, f.readers);

describe('C disabled launcher and protected configuration', () => {
  it('loads exact protected artifacts and revalidates, with no executable result or activation switch', async () => {
    const f = await remediationCFixture(), r = await inspect(f);
    expect(r).toMatchObject({ readiness: 'NOT_READY', operationsEnabled: false, schedulingEnabled: false, processorConstructionEnabled: false, ready: false });
    expect(r.state).toBe('SOURCE_CONTRACTS_VALIDATED_BUT_DISABLED');
    expect(r.checked).toEqual(launcher.TRUSTED_LAUNCHER_SEQUENCE);
    expect(Object.keys(launcher).sort()).toEqual(['LAUNCHER_DIAGNOSTICS', 'TRUSTED_LAUNCHER_SEQUENCE', 'inspectTrustedAcceptanceLauncher'].sort());
    expect(f.descriptor.opened.filter(p => p.endsWith('/manifest.json'))).toHaveLength(2);
    expect(f.integration.connector.open).not.toHaveBeenCalled();
    expect(f.descriptor.closed.length).toBeGreaterThan(f.descriptor.opened.length);
  });
  it.each(['zemaitija_dev', 'zemaitija_stripe_automation_dev', 'foreign'])('rejects protected/foreign observed target %s', async database => {
    const f = await remediationCFixture(); (f.runner.packets.POSTGRES.data as Record<string, unknown>).database_name = database; f.reapprove();
    expect((await inspect(f)).state).toBe('HALTED'); expect(f.integration.connector.open).not.toHaveBeenCalled();
  });
  it.each(['databaseUrl', 'target', 'approvalReference', 'expiresAt', 'enabled', 'STRIPE_SECRET_KEY', 'run', 'worker', 'fetch'])('rejects caller %s override before protected reads', async field => {
    const f = await remediationCFixture(); Object.assign(f.request, { [field]: 'forbidden' });
    expect((await inspect(f)).state).toBe('HALTED'); expect(f.descriptor.opened).toEqual([]);
  });
  it.each(['source', 'approval', 'manifest', 'unprotected'])('rejects %s integrity before any monitor construction', async kind => {
    const f = await remediationCFixture(), base = '/var/lib/zec-acceptance';
    if (kind === 'source') f.files[`${base}/artifacts/${f.run.sourceDigest}/source/${f.integration.source[0].path}`] = 'changed';
    if (kind === 'approval') f.files[`${base}/reviews/${f.run.runId}.json`] = '{}';
    if (kind === 'manifest') f.files[`${base}/approved/${f.run.runId}/manifest.json`] = '{}';
    if (kind === 'unprotected') f.descriptor.bad('PARENT_MODE');
    expect((await inspect(f)).state).toBe('HALTED'); expect(f.runner.authority.read).not.toHaveBeenCalled();
  });
  it.each(['copied-seal', 'copied-plan', 'missing-descriptor', 'cancelled'])('fails closed on %s', async kind => {
    const f = await remediationCFixture(); if (kind === 'cancelled') f.controller.abort();
    const r = await launcher.inspectTrustedAcceptanceLauncher(kind === 'copied-seal' ? { ...f.run } : f.run, kind === 'copied-plan' ? { ...f.plan } : f.plan, f.request,
      { protectedIO: kind === 'missing-descriptor' ? undefined : f.descriptor.io, monitor: f.readers });
    expect(r.state).not.toBe('SOURCE_CONTRACTS_VALIDATED_BUT_DISABLED'); expect(r.operationsEnabled).toBe(false);
  });
  it.each(RUNNER_OBSERVATIONS)('missing %s never grants work', async kind => {
    const f = await remediationCFixture(); delete f.runner.sources[kind];
    expect((await inspect(f)).state).not.toBe('SOURCE_CONTRACTS_VALIDATED_BUT_DISABLED');
  });
  it('revocation during final revalidation halts instead of consuming earlier approval', async () => {
    const f = await remediationCFixture(); let reads = 0;
    f.readers.runner.authority = captureReader(async () => {
      if (++reads === 2) { (f.runner.packets.APPROVAL.data as { revoked: boolean }).revoked = true; f.runner.reapprove(); }
      return structuredClone(f.runner.authorityRecord);
    });
    expect(await inspect(f)).toMatchObject({ state: 'HALTED', diagnostic: 'REVALIDATION_REJECTED', operationsEnabled: false });
  });
});

describe('C independent read-only monitoring', () => {
  it('reports identity, budgets, journal, safe investigation and final-verifier limits without mutating inputs', async () => {
    const f = await remediationCFixture(), before = financialEvidenceDigest({ r: f.runner.packets, c: f.collector.packets, m: f.packets });
    const r = await monitor(f);
    expect(r.safetyState).toBe('DISABLED'); expect(r.authorityValid).toBe(true); expect(r.artifactIntegrity).toBe(true);
    expect(r.providerBudget).toMatchObject({ verified: true, used: 22, bootstrap: 1 });
    expect(r.journal.verified).toBe(true); expect(r.locks.state).toBe('HELD');
    expect(r.backlog).toEqual({ paymentInbox: 0, investigations: 0, expectedSafetyInvestigations: 1 });
    expect(r.collection.verification.scenarios[4]).toMatchObject({ paidBookingVerified: false, expectedInvestigationSafe: true });
    expect(r.finalVerifierReady).toBe(false); expect(r.collection.verification.evidenceClass).toBe('SIMULATED');
    expect(financialEvidenceDigest({ r: f.runner.packets, c: f.collector.packets, m: f.packets })).toBe(before);
  });
  it.each(MONITOR_SOURCES)('missing %s produces fixed diagnostics and no readiness', async key => {
    const f = await remediationCFixture(); delete f.readers.sources[key];
    const r = await monitor(f); expect(r.safetyState).toBe('HALTED'); expect(r.operationsEnabled).toBe(false);
  });
  it.each(['LIVE', 'UNKNOWN'])('rejects %s credential metadata without reading a credential', async mode => {
    const f = await remediationCFixture(); Object.assign(f.data.SERVICE, { credentialMode: mode }); f.reapprove();
    expect((await monitor(f)).diagnostics).toContain('LIVE_CREDENTIALS_REJECTED');
  });
  it.each(['root-user', 'identity', 'service-enabled', 'timer-enabled', 'cleanup', 'resource'])('exposes %s service uncertainty', async kind => {
    const f = await remediationCFixture();
    if (kind === 'root-user') f.data.SERVICE.uid = 0;
    if (kind === 'identity') Object.assign(f.data.SERVICE, { identity: 'foreign-service' });
    if (kind === 'service-enabled') f.data.SERVICE.serviceEnabled = true;
    if (kind === 'timer-enabled') f.data.SERVICE.timerEnabled = true;
    if (kind === 'cleanup') f.data.SERVICE.cleanup = 'UNCERTAIN';
    if (kind === 'resource') f.data.SERVICE.resources = 'UNCERTAIN';
    f.reapprove(); expect((await monitor(f)).safetyState).toBe('HALTED');
  });
  it.each(['alias-object', 'alias-function', 'changed-root', 'changed-packet', 'stale', 'expired'])('does not hide %s in observation wrappers', async kind => {
    const f = await remediationCFixture();
    if (kind === 'alias-object') f.collector.sources.provider = f.collector.sources.database;
    if (kind === 'alias-function') f.collector.sources.provider = { ...f.collector.sources.provider!, read: f.collector.sources.database!.read };
    if (kind === 'changed-root') f.authorityRecord.runnerReviewDigest = 'e'.repeat(64);
    if (kind === 'changed-packet') f.packets.SERVICE.recordId = 'unreviewed';
    if (kind === 'stale') f.advance(30001);
    if (kind === 'expired') f.advance(3600000);
    expect((await monitor(f)).safetyState).toBe('HALTED');
  });
  it.each(EVIDENCE_CHANNELS)('missing %s collector evidence never becomes final readiness', async channel => {
    const f = await remediationCFixture(); delete f.collector.sources[channel];
    const r = await monitor(f); expect(r.finalVerifierReady).toBe(false); expect(r.diagnostics).toContain('COLLECTORS_INCOMPLETE');
  });
  it('corrupt journal and ambiguous budget remain visible, never repaired', async () => {
    const f = await remediationCFixture(); f.collector.supervision.journal.headDigest = 'e'.repeat(64);
    (f.runner.packets.BUDGET.data as { requests: { outcome: string }[] }).requests[1].outcome = 'UNCERTAIN'; f.reapprove();
    const before = financialEvidenceDigest(f.runner.packets.BUDGET);
    const r = await monitor(f); expect(r.safetyState).toBe('HALTED'); expect(r.diagnostics).toContain('BUDGET_UNCERTAIN');
    expect(r.diagnostics).toContain('JOURNAL_INVALID'); expect(financialEvidenceDigest(f.runner.packets.BUDGET)).toBe(before);
  });
  it.each(['missing-request', 'journal-head', 'receipt-identity'])('halts on %s cross-source disagreement', async kind => {
    const f = await remediationCFixture();
    if (kind === 'missing-request') {
      const b = f.runner.packets.BUDGET.data as { requests: { id: string }[] };
      b.requests = b.requests.filter(r => r.id !== f.collector.supervision.requests[0].requestId);
    }
    if (kind === 'journal-head') {
      Object.assign(f.runner.packets.JOURNAL.data as object, { sequence: 0, headDigest: '0'.repeat(64), independentHeadDigest: '0'.repeat(64) });
      f.runner.reapprove(); f.authorityRecord.runnerReviewDigest = financialEvidenceDigest(f.runner.authorityRecord);
    } else {
      if (kind === 'receipt-identity') f.collector.supervision.requests[0].providerRequestId = 'req_conflicting';
      f.reapprove();
    }
    const r = await monitor(f); expect(r.safetyState).toBe('HALTED');
    expect(r.diagnostics).toContain(kind === 'journal-head' ? 'JOURNAL_SOURCE_CONFLICT' : 'BUDGET_SOURCE_CONFLICT');
  });
  it('an unissued run cannot expose caller-injected resource fields', async () => {
    const f = await remediationCFixture(), unissued = { ...f.run, target: { ...f.run.target, database: 'private-injected-value' } };
    const r = await inspectAcceptanceMonitoring(unissued, f.plan, f.integration.review, f.readers);
    expect(r.safetyState).toBe('HALTED'); expect(r.resources).toBeNull(); expect(r.runId).toBeNull();
    expect(JSON.stringify(r)).not.toContain('private-injected-value');
  });
  it('late source reads invalidate earlier snapshots instead of refreshing their capture times', async () => {
    const f = await remediationCFixture();
    f.readers.sources.LOCK_HISTORY = captureReader(async () => { f.advance(30001); return structuredClone(f.packets.LOCK_HISTORY); });
    const r = await monitor(f); expect(r.safetyState).toBe('HALTED'); expect(r.finalVerifierReady).toBe(false);
  });
  it('opaque monitor-reader errors do not leak private values', async () => {
    const f = await remediationCFixture(); f.readers.sources.SERVICE = captureReader(async () => { throw Error('private-value'); });
    const r = await monitor(f); expect(r.safetyState).toBe('HALTED'); expect(JSON.stringify(r)).not.toContain('private-value');
  });
});

describe('C process observations and lock lifecycle', () => {
  it('defines a disabled oneshot/timer policy without an execution command', () => {
    expect(ACCEPTANCE_PROCESS_POLICY).toMatchObject({ serviceType: 'oneshot', serviceEnabled: false, timerEnabled: false, restart: 'NO', invocationMilliseconds: 60000, outerLifetimeMilliseconds: 65000 });
    expect(ACCEPTANCE_PROCESS_POLICY).not.toHaveProperty('ExecStart');
  });
  it.each(['SIGTERM', 'CANCELLED', 'DEADLINE', 'LOCK_LOST', 'STORAGE_UNCERTAIN'] as const)('%s stops admission in the model and never refunds or restarts', async reason => {
    const f = await remediationCFixture(), start = f.now() - 1000, deadline = f.now() + 59000, stop = reason === 'DEADLINE' ? deadline : f.now();
    const raw = { invocationId: syntheticId(9010), complete: true, deadline, observations: [
      { kind: 'START_OBSERVED', at: start, pid: 91, cgroupId: 'synthetic-cgroup' },
      { kind: 'STOP_REQUIRED', at: stop, reason }, { kind: 'SIGTERM_OBSERVED', at: stop, cgroupId: 'synthetic-cgroup' },
    ] };
    expect(inspectAcceptanceShutdown(f.run, raw, stop + 1)).toMatchObject({ state: 'CANCELLING', operationsEnabled: false, automaticRestartAllowed: false, financialOutcome: 'UNKNOWN' });
    const overdue = inspectAcceptanceShutdown(f.run, raw, stop + 5000);
    expect(overdue.state).toBe('HALTED'); expect(overdue.diagnostics).toContain('HARD_TERMINATION_DUE');
  });
  it('settled process exit requires all descendants gone and does not establish financial outcome', async () => {
    const f = await remediationCFixture(), raw = { invocationId: syntheticId(9010), complete: true, deadline: f.now() + 59000, observations: [
      { kind: 'START_OBSERVED', at: f.now() - 1000, pid: 91, cgroupId: 'cgroup-91' },
      { kind: 'EXIT_OBSERVED', at: f.now() - 20, cgroupId: 'cgroup-91', descendantsGone: true },
      { kind: 'CLEANUP_OBSERVED', at: f.now() - 10, outcome: 'SETTLED' },
    ] };
    expect(inspectAcceptanceShutdown(f.run, raw, f.now())).toMatchObject({ state: 'SETTLED', financialOutcome: 'UNKNOWN' });
    (raw.observations[1] as { descendantsGone: boolean }).descendantsGone = false;
    expect(inspectAcceptanceShutdown(f.run, raw, f.now()).state).toBe('UNKNOWN');
  });
  it.each(['missed-deadline', 'cleanup', 'foreign-cgroup', 'early-kill', 'long-window', 'future-event'])('detects %s without sending signals', async kind => {
    const f = await remediationCFixture(), raw = { invocationId: syntheticId(9010), complete: true, deadline: f.now() - 1, observations: [
      { kind: 'START_OBSERVED', at: f.now() - 1000, pid: 91, cgroupId: 'cgroup-91' },
    ] as Record<string, unknown>[] };
    if (kind === 'cleanup') raw.observations.push({ kind: 'EXIT_OBSERVED', at: f.now() - 10, cgroupId: 'cgroup-91', descendantsGone: true }, { kind: 'CLEANUP_OBSERVED', at: f.now(), outcome: 'UNCERTAIN' });
    if (kind === 'foreign-cgroup') raw.observations.push({ kind: 'SIGTERM_OBSERVED', at: f.now(), cgroupId: 'foreign' });
    if (kind === 'early-kill') raw.observations.push({ kind: 'SIGTERM_OBSERVED', at: f.now(), cgroupId: 'cgroup-91' }, { kind: 'SIGKILL_OBSERVED', at: f.now(), cgroupId: 'cgroup-91' });
    if (kind === 'long-window') raw.deadline = f.now() + 61000;
    if (kind === 'future-event') raw.observations[0].at = f.now() + 1;
    const r = inspectAcceptanceShutdown(f.run, raw, f.now()); expect(r.diagnostics.some(d => ['DEADLINE_MISSED', 'CLEANUP_UNCERTAIN', 'SHUTDOWN_EVIDENCE_INVALID'].includes(d))).toBe(true);
  });
  it('late cleanup cannot hide a missed cancellation grace period', async () => {
    const f = await remediationCFixture(), start = f.now() - 10000;
    const r = inspectAcceptanceShutdown(f.run, { complete: true, invocationId: syntheticId(9010), deadline: start + 60000, observations: [
      { kind: 'START_OBSERVED', at: start, pid: 9, cgroupId: 'group-9' },
      { kind: 'STOP_REQUIRED', at: start + 10, reason: 'CANCELLED' },
      { kind: 'SIGTERM_OBSERVED', at: start + 10, cgroupId: 'group-9' },
      { kind: 'EXIT_OBSERVED', at: start + 9000, cgroupId: 'group-9', descendantsGone: true },
      { kind: 'CLEANUP_OBSERVED', at: start + 9001, outcome: 'SETTLED' },
    ] }, f.now());
    expect(r.state).toBe('HALTED'); expect(r.diagnostics).toContain('HARD_TERMINATION_DUE');
  });
  it('SIGKILL is only an observed fact; a valid escalation and cleanup still cannot prove payment outcome', async () => {
    const f = await remediationCFixture(), start = f.now() - 10000;
    const r = inspectAcceptanceShutdown(f.run, { complete: true, invocationId: syntheticId(9010), deadline: start + 60000, observations: [
      { kind: 'START_OBSERVED', at: start, pid: 9, cgroupId: 'group-9' },
      { kind: 'SIGTERM_OBSERVED', at: start + 1, cgroupId: 'group-9' },
      { kind: 'SIGKILL_OBSERVED', at: start + 5001, cgroupId: 'group-9' },
      { kind: 'EXIT_OBSERVED', at: start + 5001, cgroupId: 'group-9', descendantsGone: true },
      { kind: 'CLEANUP_OBSERVED', at: start + 5002, outcome: 'SETTLED' },
    ] }, f.now());
    expect(r).toMatchObject({ state: 'SETTLED', operationsEnabled: false, automaticRestartAllowed: false, financialOutcome: 'UNKNOWN' });
  });
  it.each(['HOST', 'DATABASE'] as const)('%s contention or loss halts', async layer => {
    const f = await remediationCFixture(); f.locks.observations.push({ ...f.locks.observations.find(o => o.layer === layer)!, at: f.now(), observation: 'LOST', validUntil: null });
    expect(inspectAcceptanceLockHistory(f.run, f.locks, f.now()).state).toBe('HALTED');
  });
  it('continuity observations cannot replace a session, extend lock lifetime or masquerade as reservations', async () => {
    const f = await remediationCFixture(), db = f.locks.observations[1];
    f.locks.observations.push({ ...db, at: f.now(), observation: 'RENEWED' });
    expect(inspectAcceptanceLockHistory(f.run, f.locks, f.now()).state).toBe('HELD');
    f.locks.observations.at(-1)!.sessionId = 'replacement';
    expect(inspectAcceptanceLockHistory(f.run, f.locks, f.now()).state).toBe('UNKNOWN');
    f.locks.observations.at(-1)!.sessionId = db.sessionId; f.locks.observations.at(-1)!.validUntil!++;
    expect(inspectAcceptanceLockHistory(f.run, f.locks, f.now()).state).toBe('UNKNOWN');
  });
});

describe('C existing journal/budget contracts across simulated restarts', () => {
  it('bootstrap is durably charged across restart and a second bootstrap cannot be reissued', async () => {
    const f = integrationFixture('G2_PREFLIGHT'), id = syntheticId(9200), invocation = syntheticId(9201), signal = new AbortController().signal;
    expect(await f.budget.reserve(invocation, id, 'BOOTSTRAP_ACCOUNT', signal)).toBe('DURABLE');
    await f.budget.dispatchDeadline(id, signal); expect(await f.budget.settle(id, 'KNOWN', 'req_bootstrap')).toBe('DURABLE');
    const resumed = durableProviderBudget(f.review, anchoredEvidence(f.review, f.disk.cell, f.disk.head), { now: f.now, authority: f.authority, locksHeld: async () => true });
    expect((await resumed.inspect()).requests.size).toBe(1);
    expect(await resumed.reserve(invocation, syntheticId(9202), 'BOOTSTRAP_ACCOUNT', signal)).toBe('DENIED');
  });
  it.each(['UNCERTAIN', 'CANCELLED', 'TIMEOUT'] as const)('%s retains allowance and blocks a new invocation after restart', async outcome => {
    const f = integrationFixture(), signal = new AbortController().signal;
    expect(await f.budget.reserve(syntheticId(9300), syntheticId(9301), 'STARTUP_ACCOUNT', signal)).toBe('DURABLE');
    await f.budget.dispatchDeadline(syntheticId(9301), signal); await f.budget.settle(syntheticId(9301), outcome, null);
    const resumed = durableProviderBudget(f.review, anchoredEvidence(f.review, f.disk.cell, f.disk.head), { now: f.now, authority: f.authority, locksHeld: async () => true });
    expect((await resumed.inspect()).requests.size).toBe(1);
    expect(await resumed.reserve(syntheticId(9302), syntheticId(9303), 'STARTUP_ACCOUNT', signal)).toBe('DENIED');
  });
  it('per-invocation exhaustion survives restart and NOT_STARTED never refunds allowance', async () => {
    const f = integrationFixture(), invocation = syntheticId(9600), signal = new AbortController().signal;
    for (let i = 0; i < f.run.budgets.providerPerInvocation; i++) {
      const id = syntheticId(9610 + i);
      expect(await f.budget.reserve(invocation, id, 'STARTUP_ACCOUNT', signal)).toBe('DURABLE');
      expect(await f.budget.settle(id, 'NOT_STARTED', null)).toBe('DURABLE');
    }
    const resumed = durableProviderBudget(f.review, anchoredEvidence(f.review, f.disk.cell, f.disk.head), { now: f.now, authority: f.authority, locksHeld: async () => true });
    expect((await resumed.inspect()).requests.size).toBe(f.run.budgets.providerPerInvocation);
    expect(await resumed.reserve(invocation, syntheticId(9700), 'STARTUP_ACCOUNT', signal)).toBe('DENIED');
  });
  it('unknown commit acknowledgement fences both stores and survives adapter restart', async () => {
    const f = integrationFixture(), signal = new AbortController().signal; f.disk.failure('AFTER_COMMIT');
    expect(await f.budget.reserve(syntheticId(9400), syntheticId(9401), 'STARTUP_ACCOUNT', signal)).toBe('UNKNOWN');
    const resumed = anchoredEvidence(f.review, f.disk.cell, f.disk.head);
    await expect(resumed.read()).rejects.toThrow(); expect(f.disk.state().fenced).toBe(true); expect(f.disk.state().checkpoint.fenced).toBe(true);
  });
  it('unfinished original invocation replays as uncertainty and never resumes a worker', async () => {
    const f = integrationFixture(), disk = new SimulatedSupervisionDisk(), at = f.now();
    await appendSupervisionSimulation(f.run, disk.connect(), syntheticId(9500), at, { kind: 'OPEN', deadline: at + 60000 });
    const report = inspectSupervisionSimulation(f.run, await disk.connect().read(supervisionBinding(f.run)), at + 1);
    expect(report).toMatchObject({ state: 'DISABLED', simulatedState: 'UNCERTAIN', diagnostic: 'INTERRUPTED', operationsEnabled: false });
  });
  it('fake host and session loss observations preserve their separate ownership semantics', async () => {
    const f = integrationFixture(), registry = new SimulatedLockRegistry(), first = registry.process('mint-a'), second = registry.process('mint-a');
    const host = await first.adapter.acquireHost(), db = await first.adapter.acquireDatabase(supervisionBinding(f.run));
    expect((await second.adapter.acquireHost()).observation).toBe('CONTENDED');
    first.dropSession(); expect(await db.check()).toBe('LOST'); expect(await host.check()).toBe('HELD');
    first.exit(); expect(await host.check()).toBe('LOST'); second.exit();
  });
});

it('C imports no executable runner, service, database, transport or provider and has no writer/launch API', () => {
  const allowed = new Set(['zod', './stripe-acceptance-run', './stripe-acceptance-fixtures', './stripe-acceptance-trust', './stripe-acceptance-financial-evidence',
    './stripe-acceptance-verifier-evidence', './stripe-acceptance-collectors', './stripe-acceptance-fresh-runner', './stripe-acceptance-capture-provenance',
    './stripe-acceptance-supervision', './stripe-acceptance-shutdown', './stripe-acceptance-monitoring', './stripe-acceptance-durable']);
  for (const name of ['launcher', 'monitoring', 'shutdown']) {
    const code = readFileSync(`src/server/stripe-acceptance-${name}.ts`, 'utf8');
    for (const m of code.matchAll(/from ['"]([^'"]+)['"]/g)) expect(allowed.has(m[1])).toBe(true);
    expect(code).not.toMatch(/process\.env|node:fs|node:child_process|node:net|import\(|fetch\(|setTimeout\(|setInterval\(|\.kill\(|\.spawn\(|\.query\(|\.compareAndAppend\(|\.reserve\(/);
  }
  expect(readFileSync('src/app/api/internal/stripe-automation/route.ts', 'utf8')).not.toMatch(/launcher|monitoring|stripe-automation-runner/);
});
