import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as supervision from '../src/server/stripe-acceptance-supervision';
import { canonicalRunJson, runManifestDigest, type SealedAcceptanceRun } from '../src/server/stripe-acceptance-run';
import { scenarioRun } from './helpers/stripe-acceptance-scenario-fixture';
import { SimulatedLockRegistry, SimulatedSupervisionDisk } from './helpers/stripe-supervision-store';

const start = Date.parse('2035-01-01T00:01:00.000Z');
const iid = (n: number) => `60000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rid = (n: number) => `70000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function setup(invocations = 2) {
  const run = scenarioRun(undefined, invocations), disk = new SimulatedSupervisionDisk();
  let store = disk.connect(), invocation = iid(1), at = start;
  const add = (event: supervision.SupervisionEvent) => supervision.appendSupervisionSimulation(run, store, invocation, at, event);
  const report = () => supervision.inspectSupervisionSimulation(run, disk.image, at);
  const authority = () => add({ kind: 'AUTHORITY', verified: { manifest: true, approval: true, reservation: true,
    docker: true, postgres: true, stripeTestAccount: true, journal: true, budgetStore: true },
    database: run.target.database, targetDigest: supervision.supervisionBinding(run).targetDigest });
  async function locked() {
    expect((await add({ kind: 'OPEN', deadline: at + 60_000 })).status).toBe('RECORDED');
    expect((await authority()).simulatedState).toBe('READY_FOR_AUTHORISED_INVOCATION');
    expect((await add({ kind: 'LOCK', layer: 'HOST', observation: 'ACQUIRED' })).status).toBe('RECORDED');
    expect((await add({ kind: 'LOCK', layer: 'DATABASE', observation: 'ACQUIRED' })).simulatedState).toBe('LOCKED');
  }
  async function running() { await locked(); expect((await add({ kind: 'START' })).simulatedState).toBe('RUNNING'); }
  async function finish(state: 'COMPLETED' | 'FAILED' = 'COMPLETED') {
    await add({ kind: 'WORKER', outcome: state === 'COMPLETED' ? 'SUCCEEDED' : 'FAILED' });
    await add({ kind: 'CLEANUP', outcome: 'SETTLED' });
    await add({ kind: 'LOCK', layer: 'DATABASE', observation: 'RELEASED' });
    await add({ kind: 'LOCK', layer: 'HOST', observation: 'RELEASED' });
    return add({ kind: 'FINISH', state });
  }
  return { run, disk, add, authority, locked, running, finish, report,
    restart: () => { store = disk.connect(); }, next: () => { invocation = iid(2); at += 60_000; },
    advance: (ms: number) => { at += ms; } };
}
describe('Stage 2C-3G source-only supervision', () => {
  it('defaults disabled and exposes no execution, enablement, scheduler or worker API', () => {
    const f = setup();
    expect(f.report()).toMatchObject({ state: 'DISABLED', simulatedState: 'DISABLED', schedulingEnabled: false, operationsEnabled: false });
    expect(Object.keys(supervision).sort()).toEqual(['EMPTY_JOURNAL_DIGEST', 'PROVIDER_OPERATIONS', 'SUPERVISION_POLICY',
      'SUPERVISOR_STATES', 'appendSupervisionSimulation', 'inspectSupervisionSimulation', 'supervisionBinding', 'supervisionEntry'].sort());
  });
  it('has all ten explicit states and fixed host/run-profile database lock identities', () => {
    const f = setup(), b = supervision.supervisionBinding(f.run);
    expect(supervision.SUPERVISOR_STATES).toHaveLength(10);
    expect(supervision.SUPERVISION_POLICY.hostLock).toBe('/run/lock/zec-acceptance/invocation.lock');
    expect(b.controlLockKey).toMatch(/^[a-f0-9]{16}$/);
    expect(supervision.supervisionBinding(f.run).controlLockKey).toBe(b.controlLockKey);
    expect(supervision.supervisionBinding(scenarioRun('10000000-0000-4000-8000-000000000002')).controlLockKey).not.toBe(b.controlLockKey);
  });
  it('simulates process-lifetime host contention and cross-machine session lock contention', async () => {
    const registry = new SimulatedLockRegistry(), f = setup(), binding = supervision.supervisionBinding(f.run);
    const first = registry.process('mint-a'), second = registry.process('mint-a'), remote = registry.process('mint-b');
    const host = await first.adapter.acquireHost(); expect(host.observation).toBe('ACQUIRED');
    expect((await second.adapter.acquireHost()).observation).toBe('CONTENDED');
    expect((await remote.adapter.acquireHost()).observation).toBe('ACQUIRED');
    const control = await first.adapter.acquireDatabase(binding);
    expect(control.observation).toBe('ACQUIRED');
    expect((await remote.adapter.acquireDatabase(binding)).observation).toBe('CONTENDED');
    first.dropSession(); expect(await control.check()).toBe('LOST');
    expect(await host.check()).toBe('HELD'); // Session loss does not release the host lock.
    expect((await remote.adapter.acquireDatabase(binding)).observation).toBe('ACQUIRED');
    first.exit(); expect(await host.check()).toBe('LOST');
    expect((await second.adapter.acquireHost()).observation).toBe('ACQUIRED');
    remote.exit(); second.exit();
  });
  it('rejects a copied seal before touching storage', async () => {
    const f = setup(); let reads = 0;
    const store = { read: async () => { reads++; throw Error('private'); }, compareAndAppend: async () => 'UNKNOWN' as const };
    expect(await supervision.appendSupervisionSimulation({ ...f.run }, store, iid(1), start, { kind: 'OPEN', deadline: start + 60_000 }))
      .toEqual({ status: 'BLOCKED', diagnostic: 'INVALID_MANIFEST' });
    expect(reads).toBe(0);
  });
  it.each(['zemaitija_dev', 'zemaitija_stripe_automation_dev', 'foreign'])('rejects target %s', async database => {
    const f = setup(); await f.add({ kind: 'OPEN', deadline: start + 60_000 });
    const binding = supervision.supervisionBinding(f.run);
    expect(await f.add({ kind: 'AUTHORITY', verified: { manifest: true, approval: true, reservation: true, docker: true,
      postgres: true, stripeTestAccount: true, journal: true, budgetStore: true }, database, targetDigest: binding.targetDigest }))
      .toEqual({ status: 'BLOCKED', diagnostic: 'TARGET_REJECTED' });
  });
  it('cannot start without authority or locks; ready:false host evidence is not authority', async () => {
    const f = setup(); await f.add({ kind: 'OPEN', deadline: start + 60_000 });
    expect((await f.add({ kind: 'START' })).diagnostic).toBe('AUTHORITY_REQUIRED');
    expect((await f.add({ kind: 'AUTHORITY', ready: false } as unknown as supervision.SupervisionEvent)).status).toBe('BLOCKED');
    await f.authority(); expect((await f.add({ kind: 'START' })).status).toBe('BLOCKED');
    expect(f.report().state).toBe('DISABLED');
  });
  it.each(['manifest', 'approval', 'reservation', 'docker', 'postgres', 'stripeTestAccount', 'journal', 'budgetStore'])
    ('requires independent %s evidence even in the model', async missing => {
      const f = setup(); await f.add({ kind: 'OPEN', deadline: start + 60_000 });
      const verified = { manifest: true, approval: true, reservation: true, docker: true, postgres: true,
        stripeTestAccount: true, journal: true, budgetStore: true, [missing]: false };
      expect((await f.add({ kind: 'AUTHORITY', verified, database: f.run.target.database,
        targetDigest: supervision.supervisionBinding(f.run).targetDigest } as unknown as supervision.SupervisionEvent)).status).toBe('BLOCKED');
    });
  it.each(['HOST', 'DATABASE'] as const)('%s contention blocks worker start', async layer => {
    const f = setup(); await f.add({ kind: 'OPEN', deadline: start + 60_000 }); await f.authority();
    if (layer === 'DATABASE') await f.add({ kind: 'LOCK', layer: 'HOST', observation: 'ACQUIRED' });
    expect(await f.add({ kind: 'LOCK', layer, observation: 'CONTENDED' }))
      .toMatchObject({ simulatedState: 'HALTED', diagnostic: 'LOCK_CONTENDED' });
    expect((await f.add({ kind: 'START' })).status).toBe('BLOCKED');
  });
  it.each(['HOST', 'DATABASE'] as const)('%s loss halts processing and prevents new reservations', async layer => {
    const f = setup(); await f.running();
    expect((await f.add({ kind: 'LOCK', layer, observation: 'LOST' })).simulatedState).toBe('HALTED');
    expect((await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'WORKER_ACCOUNT' })).status).toBe('BLOCKED');
    expect((await f.finish()).status).toBe('BLOCKED');
  });
  it('requires host before database and cleanup before releasing either lock', async () => {
    const f = setup(); await f.add({ kind: 'OPEN', deadline: start + 60_000 }); await f.authority();
    expect((await f.add({ kind: 'LOCK', layer: 'DATABASE', observation: 'ACQUIRED' })).status).toBe('BLOCKED');
    await f.add({ kind: 'LOCK', layer: 'HOST', observation: 'ACQUIRED' });
    expect((await f.add({ kind: 'LOCK', layer: 'HOST', observation: 'RELEASED' })).status).toBe('BLOCKED');
  });
  it('cannot start or reserve after settled cleanup', async () => {
    const f = setup(); await f.locked(); await f.add({ kind: 'CLEANUP', outcome: 'SETTLED' });
    expect((await f.add({ kind: 'START' })).status).toBe('BLOCKED');
    expect((await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'STARTUP_ACCOUNT' })).status).toBe('BLOCKED');
  });
  it('records completed worker, cleanup and lock release without granting operational readiness', async () => {
    const f = setup(); await f.running(); expect((await f.finish()).simulatedState).toBe('COMPLETED');
    expect(f.report()).toMatchObject({ state: 'DISABLED', simulatedState: 'COMPLETED', workerObservation: 'STARTED_KNOWN_RESULT' });
    expect((await f.add({ kind: 'FINISH', state: 'FAILED' })).status).toBe('BLOCKED');
  });
  it.each(['sequence', 'digest', 'previous', 'binding', 'gap', 'head', 'truncation', 'time'] as const)
    ('rejects journal %s corruption', async corruption => {
      const f = setup(); await f.running();
      if (corruption === 'sequence') f.disk.image.entries[0].sequence++;
      if (corruption === 'digest') f.disk.image.entries[0].digest = 'a'.repeat(64);
      if (corruption === 'previous') f.disk.image.entries[0].previousDigest = 'a'.repeat(64);
      if (corruption === 'binding') f.disk.image.entries[0].binding.sourceDigest = 'a'.repeat(64);
      if (corruption === 'gap') f.disk.image.entries.splice(1, 1);
      if (corruption === 'head') f.disk.image.headDigest = 'a'.repeat(64);
      if (corruption === 'truncation') f.disk.image.entries.pop();
      if (corruption === 'time') f.disk.image.entries[0].at++;
      expect(f.report()).toMatchObject({ simulatedState: 'HALTED', diagnostic: 'JOURNAL_INVALID' });
      expect((await f.add({ kind: 'WORKER', outcome: 'SUCCEEDED' })).status).toBe('BLOCKED');
    });
  it('rejects conflicting terminal records even with a valid hash chain', async () => {
    const f = setup(); await f.running(); await f.finish();
    const e = supervision.supervisionEntry(supervision.supervisionBinding(f.run), iid(1), start,
      { kind: 'FINISH', state: 'FAILED' }, f.disk.image);
    f.disk.image.entries.push(e); f.disk.image.sequence = e.sequence; f.disk.image.headDigest = e.digest;
    expect(f.report().simulatedState).toBe('HALTED');
  });
  it('detects a changed source binding even after rehashing', async () => {
    const f = setup(); await f.running();
    const e = f.disk.image.entries[0]; e.binding.sourceDigest = 'e'.repeat(64);
    const { digest: ignored, ...core } = e; void ignored; e.digest = runManifestDigest(canonicalRunJson(core));
    expect(f.report().diagnostic).toBe('JOURNAL_INVALID');
  });
  it('reconstructs interrupted execution as uncertain across adapter restart and blocks another invocation', async () => {
    const f = setup(); await f.running(); f.restart();
    expect(f.report()).toMatchObject({ simulatedState: 'UNCERTAIN', diagnostic: 'INTERRUPTED', workerObservation: 'STARTED_UNCERTAIN_RESULT' });
    f.next(); expect((await f.add({ kind: 'OPEN', deadline: start + 120_000 })).status).toBe('BLOCKED');
  });
  it('distinguishes a definitely unstarted worker from interrupted started work', async () => {
    const f = setup(); await f.locked(); expect(f.report().workerObservation).toBe('DEFINITELY_NOT_STARTED');
    expect(f.report().simulatedState).toBe('UNCERTAIN');
  });
  it.each(supervision.PROVIDER_OPERATIONS)('accounts for %s before provider outcome', async operation => {
    const f = setup(); await f.locked();
    expect((await f.add({ kind: 'RESERVE', requestId: rid(1), operation })).status).toBe('RECORDED');
    expect(f.report().providerAllowancesUsed).toBe(1);
    await f.add({ kind: 'PROVIDER_RESULT', requestId: rid(1), outcome: 'KNOWN' });
    expect(f.report().providerResultsRecorded).toBe(1);
  });
  it.each(['UNCERTAIN', 'CANCELLED', 'TIMEOUT', 'NOT_STARTED'] as const)('%s does not return a provider allowance', async outcome => {
    const f = setup(); await f.running();
    await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'CHECKOUT_DISPATCH' });
    await f.add({ kind: 'PROVIDER_RESULT', requestId: rid(1), outcome }); f.restart();
    expect(f.report().providerAllowancesUsed).toBe(1);
    if (outcome !== 'NOT_STARTED') expect((await f.finish()).status).toBe('BLOCKED');
  });
  it('enforces per-invocation and aggregate caps across restarts and concurrent CAS attempts', async () => {
    const f = setup();
    for (let invocation = 1; invocation <= 2; invocation++) {
      await f.running();
      for (let n = 1; n <= 59; n++) {
        const requestId = rid(invocation * 100 + n);
        expect((await f.add({ kind: 'RESERVE', requestId, operation: 'PAYMENT_STATUS_RECOVERY' })).status).toBe('RECORDED');
        await f.add({ kind: 'PROVIDER_RESULT', requestId, outcome: 'KNOWN' });
      }
      const concurrent = await Promise.all([60, 61].map(n => f.add({ kind: 'RESERVE', requestId: rid(invocation * 100 + n), operation: 'PROVIDER_RECONCILIATION' })));
      expect(concurrent.filter(r => r.status === 'RECORDED')).toHaveLength(1);
      expect((await f.add({ kind: 'RESERVE', requestId: rid(999), operation: 'OTHER_AUTHORISED' })).diagnostic).toBe('BUDGET_EXHAUSTED');
      const outstanding = f.disk.image.entries.at(-1)!.event;
      if (outstanding.kind !== 'RESERVE') throw Error('expected reservation');
      await f.add({ kind: 'PROVIDER_RESULT', requestId: outstanding.requestId, outcome: 'KNOWN' });
      expect((await f.finish()).status).toBe('RECORDED'); f.restart();
      expect(f.report().providerAllowancesUsed).toBe(invocation * 60);
      if (invocation === 1) f.next();
    }
    expect(f.report().providerAllowancesUsed).toBe(f.run.budgets.providerRequests);
    expect((await f.add({ kind: 'OPEN', deadline: start + 180_000 })).status).toBe('BLOCKED');
  });
  it('rejects unreserved, duplicate and foreign provider outcomes', async () => {
    const f = setup(); await f.running();
    expect((await f.add({ kind: 'PROVIDER_RESULT', requestId: rid(1), outcome: 'KNOWN' })).status).toBe('BLOCKED');
    await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'WORKER_ACCOUNT' });
    expect((await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'WORKER_ACCOUNT' })).status).toBe('BLOCKED');
    await f.add({ kind: 'PROVIDER_RESULT', requestId: rid(1), outcome: 'KNOWN' });
    expect((await f.add({ kind: 'PROVIDER_RESULT', requestId: rid(1), outcome: 'KNOWN' })).status).toBe('BLOCKED');
  });
  it.each(['BEFORE_COMMIT', 'AFTER_COMMIT'] as const)('fences uncertain persistence %s including after simulated restart', async failure => {
    const f = setup(); await f.running(); f.disk.failure = failure;
    expect((await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'CHECKOUT_DISPATCH' })).diagnostic).toBe('JOURNAL_UNAVAILABLE');
    f.restart(); expect((await f.add({ kind: 'RESERVE', requestId: rid(2), operation: 'CHECKOUT_DISPATCH' })).status).toBe('BLOCKED');
    expect(f.disk.image.entries.filter(e => e.event.kind === 'RESERVE')).toHaveLength(failure === 'AFTER_COMMIT' ? 1 : 0);
  });
  it.each([0, 60_001, 1_800_001])('rejects an invalid invocation deadline offset %i', async offset => {
    const f = setup(); expect((await f.add({ kind: 'OPEN', deadline: start + offset })).diagnostic).toBe('DEADLINE');
  });
  it('rejects opening outside the sealed run window', async () => {
    const f = setup(); f.advance(30 * 60_000);
    expect((await f.add({ kind: 'OPEN', deadline: start + 31 * 60_000 })).diagnostic).toBe('DEADLINE');
  });
  it('prevents further admission at the exact deadline, allows cancellation evidence, never claims success', async () => {
    const f = setup(); await f.running(); f.advance(60_000);
    expect((await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'CHECKOUT_DISPATCH' })).diagnostic).toBe('DEADLINE');
    expect((await f.add({ kind: 'CANCEL', reason: 'DEADLINE' })).simulatedState).toBe('CANCELLING');
    expect((await f.finish()).status).toBe('BLOCKED');
    expect(f.report().diagnostic).toBe('DEADLINE');
  });
  it.each(['CANCELLED', 'HOST_SHUTDOWN', 'STALLED_WORKER'] as const)('handles %s cooperatively; stalled work stays uncertain', async reason => {
    const f = setup(); await f.running(); await f.add({ kind: 'CANCEL', reason });
    expect((await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'WORKER_ACCOUNT' })).status).toBe('BLOCKED');
    if (reason === 'STALLED_WORKER') {
      expect((await f.add({ kind: 'FINISH', state: 'COMPLETED' })).status).toBe('BLOCKED');
      expect(f.report().simulatedState).toBe('UNCERTAIN');
    } else expect((await f.finish('FAILED')).simulatedState).toBe('FAILED');
  });
  it('cleanup failure and unresolved reservations force uncertainty and block future invocations', async () => {
    const f = setup(); await f.running();
    await f.add({ kind: 'RESERVE', requestId: rid(1), operation: 'CHECKOUT_DISPATCH' });
    await f.add({ kind: 'WORKER', outcome: 'SUCCEEDED' });
    expect((await f.add({ kind: 'CLEANUP', outcome: 'FAILED' })).diagnostic).toBe('CLEANUP_UNCERTAIN');
    expect((await f.add({ kind: 'FINISH', state: 'COMPLETED' })).status).toBe('BLOCKED');
    expect((await f.add({ kind: 'FINISH', state: 'UNCERTAIN' })).simulatedState).toBe('UNCERTAIN');
    f.next(); expect((await f.add({ kind: 'OPEN', deadline: start + 120_000 })).status).toBe('BLOCKED');
  });
  it('fails closed for unknown durable/accounting state and invalid clocks', () => {
    const f = setup();
    expect(supervision.inspectSupervisionSimulation(f.run, { ...f.disk.image, durable: false }, start).simulatedState).toBe('HALTED');
    expect(supervision.inspectSupervisionSimulation(f.run, f.disk.image, NaN).diagnostic).toBe('JOURNAL_INVALID');
    expect(supervision.inspectSupervisionSimulation({} as SealedAcceptanceRun, f.disk.image, start).diagnostic).toBe('INVALID_MANIFEST');
  });
  it('has no operational imports, automatic timers, environment reads or route mounts', () => {
    const source = readFileSync('src/server/stripe-acceptance-supervision.ts', 'utf8');
    const imports = [...source.matchAll(/from ['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(imports).toEqual(['zod', './stripe-acceptance-run']);
    expect(source).not.toMatch(/process\.env|setTimeout\(|setInterval\(|node:fs|node:child_process|fetch\(/);
    const route = readFileSync('src/app/api/internal/stripe-automation/route.ts', 'utf8');
    expect(route).not.toContain('supervision'); expect(route).not.toContain('stripe-automation-runner');
    const foundation = readFileSync('src/server/stripe-automation.ts', 'utf8');
    expect(foundation).toContain('STAGE_2A_INACTIVE');
    expect(foundation).not.toMatch(/import\s+(?!type\b)[^;]+from ['"]\.\/stripe-automation-runner/);
  });
});
