import { readFileSync } from 'node:fs';
import pinned from '../scripts/stripe-automation-migration-manifest.json';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalRunJson, requireSealedAcceptanceRun } from '../src/server/stripe-acceptance-run';
import { protectedAcceptanceReader, requireReviewedFreshIntegration, reviewFreshIntegration, reserveFreshResources,
  protectedArtifactReader, loadProtectedFreshIntegration, type ResourceInventory } from '../src/server/stripe-acceptance-trust';
import { anchoredEvidence, durableProviderBudget, durableSupervisionStore } from '../src/server/stripe-acceptance-durable';
import { attestFreshDocker, attestFreshPostgresLedger, FRESH_IDENTITY_SQL, postgresEvidencePort } from '../src/server/stripe-acceptance-fresh-database';
import { aggregateBoundedAcceptanceFetch, dedicatedAcceptanceHostContract, verifyBudgetedBootstrapAccount,
  withFreshExecutionLocks } from '../src/server/stripe-acceptance-integration';
import { restrictedAcceptanceAdmission, restrictedVerifierReader, restrictedStatusReader, acceptApprovedSyntheticFixture,
  type PersistedAcceptanceOwnership } from '../src/server/stripe-acceptance-evidence-adapters';
import { supervisionBinding, supervisionEntry } from '../src/server/stripe-acceptance-supervision';
import { AutomationScope } from '../src/server/stripe-automation-runtime';
import { integrationFixture, descriptorFixture, syntheticId } from './helpers/stripe-acceptance-integration-fixture';
import { verifierFixture } from './helpers/stripe-verifier-fixture';

vi.mock('pg', () => { throw Error('Real PostgreSQL forbidden'); });
vi.mock('stripe', () => { throw Error('Real Stripe SDK forbidden'); });
vi.mock('../src/db/client', () => { throw Error('Shared pool forbidden'); });
vi.mock('node:child_process', () => { throw Error('Infrastructure execution forbidden'); });
vi.mock('../src/server/stripe-automation-runner', () => { throw Error('Operational runner forbidden'); });
const scopes: AutomationScope[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(() => { throw Error('Default network forbidden'); }));
});
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.close();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const signal = () => new AbortController().signal;
function scope(f: ReturnType<typeof integrationFixture>) {
  const s = new AutomationScope(f.now() + 10000, f.now); scopes.push(s); return s;
}

describe('protected authority and baseline compatibility', () => {
  it('walks protected directories with no-follow descriptors and closes every handle', async () => {
    const f = integrationFixture(), d = descriptorFixture(f.manifestText), reader = protectedAcceptanceReader(f.run.runId, d.io);
    const path = `/var/lib/zec-acceptance/approved/${f.run.runId}/manifest.json`;
    expect((await reader.read(path)).text).toBe(f.manifestText);
    expect(d.opened.at(-1)).toBe(path); expect(d.closed.length).toBe(d.opened.length + 1);
    await expect(reader.read('/etc/private')).rejects.toThrow();
  });
  it.each(['PARENT_OWNER', 'PARENT_MODE', 'LINK', 'FILE_MODE', 'FILE_OWNER', 'MUTATED', 'SIZE'] as const)('rejects descriptor %s', async bad => {
    const f = integrationFixture(), d = descriptorFixture(f.manifestText); d.bad(bad);
    await expect(protectedAcceptanceReader(f.run.runId, d.io).read(`/var/lib/zec-acceptance/approved/${f.run.runId}/manifest.json`)).rejects.toThrow();
    expect(d.closed.length).toBeGreaterThan(0);
  });
  it('rejects noncanonical/duplicate-key records', async () => {
    const f = integrationFixture(), d = descriptorFixture('{"a":1,"a":2}');
    await expect(protectedAcceptanceReader(f.run.runId, d.io).read(`/var/lib/zec-acceptance/reviews/${f.run.runId}.json`)).rejects.toThrow();
  });
  it('static review never substitutes for a sealed run or operational approval', () => {
    const f = integrationFixture('SOURCE_REVIEW');
    expect(() => requireSealedAcceptanceRun(f.review.manifest)).toThrow();
    expect(() => requireReviewedFreshIntegration({ ...f.review }, f.now())).toThrow();
    expect(dedicatedAcceptanceHostContract(f.review)).toMatchObject({ state: 'DISABLED', schedulingEnabled: false, operationsEnabled: false });
    expect(f.connector.open).not.toHaveBeenCalled();
  });
  it('loads protected manifest, independent approval, exact raw artifacts and separately bound SQL', async () => {
    const f = integrationFixture(), root = '/var/lib/zec-acceptance', artifacts = `${root}/artifacts/${f.run.sourceDigest}`;
    const files: Record<string, string | Uint8Array> = {
      [`${root}/reviews/${f.run.runId}.json`]: canonicalRunJson(f.approval),
      [`${root}/approved/${f.run.runId}/manifest.json`]: f.manifestText,
      [`${root}/supplemental/${f.approval.supplementalDigest}.sql`]: f.supplemental,
      [`${artifacts}/index.json`]: canonicalRunJson({ version: 1, sourcePaths: f.source.map(f => f.path), migrationPaths: f.migrations.map(f => f.path) }),
    };
    for (const file of f.source) files[`${artifacts}/source/${file.path}`] = file.bytes;
    for (const file of f.migrations) files[`${artifacts}/migrations/${file.path}`] = file.bytes;
    const d = descriptorFixture(files);
    expect((await loadProtectedFreshIntegration(f.run.runId, d.io, f.now)).approval.manifestDigest).toBe(f.approval.manifestDigest);
    expect(d.closed.length).toBeGreaterThan(100);
    files[`${artifacts}/source/${f.source[0].path}`] = 'modified';
    await expect(loadProtectedFreshIntegration(f.run.runId, d.io, f.now)).rejects.toThrow();
  });
  it('rejects unprotected artifact paths and traversal before reading arbitrary bytes', async () => {
    const d = descriptorFixture('{}'), reader = protectedArtifactReader(d.io);
    await expect(reader.read('/tmp/unreviewed/index.json')).rejects.toThrow();
    expect(d.opened).toHaveLength(0);
  });
  it.each(['source-byte', 'migration-byte', 'migration-path', 'supplemental-byte', 'approval-hash', 'closure', 'protected-target', 'url-field',
    'approval-expired-window', 'unapproved-path'])('rejects %s before any external factory', kind => {
    const f = integrationFixture();
    const a: Record<string, unknown> = { ...f.approval }, manifest = JSON.parse(f.manifestText);
    const source = f.source.map(x => ({ ...x, bytes: Buffer.from(x.bytes) })), migrations = f.migrations.map(x => ({ ...x, bytes: Buffer.from(x.bytes) }));
    let supplemental = f.supplemental;
    if (kind === 'source-byte') source[0].bytes[0] ^= 1;
    if (kind === 'migration-byte') migrations[0].bytes[0] ^= 1;
    if (kind === 'migration-path') migrations.pop();
    if (kind === 'supplemental-byte') supplemental = Buffer.from('different');
    if (kind === 'approval-hash') a.manifestDigest = 'f'.repeat(64);
    if (kind === 'closure') a.dependencyClosureReviewed = false;
    if (kind === 'protected-target') manifest.target.database = 'zemaitija_stripe_automation_dev';
    if (kind === 'url-field') manifest.databaseUrl = 'postgresql://forbidden';
    if (kind === 'approval-expired-window') a.expiresAt = Number(a.expiresAt) + 1;
    if (kind === 'unapproved-path') a.sourcePaths = ['src/server/unreviewed.ts'];
    expect(() => reviewFreshIntegration(canonicalRunJson(manifest), a, source, migrations, supplemental)).toThrow();
    expect(f.connector.open).not.toHaveBeenCalled();
  });
  it('atomic reservation races have one winner and retain retirement tombstones', async () => {
    const f = integrationFixture('G2_PREFLIGHT');
    let image: ResourceInventory = { revision: 0, complete: true, reservations: [] };
    const port = { read: async () => structuredClone(image), compareAndSwap: async (expected: number, next: ResourceInventory) => {
      if (image.revision !== expected) return 'CONFLICT' as const;
      image = structuredClone(next); return 'DURABLE' as const;
    }, fence: vi.fn(async () => {}) };
    const results = await Promise.all([reserveFreshResources(f.review, port, f.now), reserveFreshResources(f.review, port, f.now)]);
    expect(results.sort()).toEqual(['CONFLICT', 'RESERVED']);
    image.reservations[0].state = 'RETIRED';
    expect(await reserveFreshResources(f.review, port, f.now)).toBe('COLLISION');
  });
  it('uncertain reservation is fenced and never reported reserved', async () => {
    const f = integrationFixture('G2_PREFLIGHT'), fence = vi.fn(async () => {});
    expect(await reserveFreshResources(f.review, { read: async () => ({ revision: 0, complete: true, reservations: [] }),
      compareAndSwap: async () => 'UNKNOWN', fence }, f.now)).toBe('UNKNOWN'); expect(fence).toHaveBeenCalledOnce();
  });
});

describe('fresh-only authenticated sessions and raw Docker isolation', () => {
  it('derives dedicated coordinates and destroys sessions after bounded fixed queries', async () => {
    const f = integrationFixture();
    await f.db.session('zec_acceptance_verifier_reader', signal(), async s => { await s.query('SELECT 1'); });
    expect(f.connector.open).toHaveBeenCalledWith(expect.objectContaining({ database: f.run.target.database,
      host: f.run.target.address, user: 'zec_acceptance_verifier_reader', statement_timeout: 1000, pipeline: false }), expect.any(AbortSignal));
    expect(f.statements).toContain(FRESH_IDENTITY_SQL); expect(f.destroy).toHaveBeenCalledOnce();
  });
  it.each(['zec_acceptance_verifier_reader', 'zec_acceptance_status_reader'] as const)('rejects effective mutation/function grants for %s', async role => {
    const f = integrationFixture(); f.identityChanges.read_safe = false;
    const operation = vi.fn();
    await expect(f.db.session(role, signal(), operation)).rejects.toThrow();
    expect(operation).not.toHaveBeenCalled(); expect(f.destroy).toHaveBeenCalledOnce();
  });
  it.each(['zemaitija_dev', 'zemaitija_stripe_automation_dev', 'foreign'])('rejects actual database %s', async database => {
    const f = integrationFixture(); f.identityChanges.database_name = database;
    const use = vi.fn(); await expect(f.db.session('zemaitija_app', signal(), use)).rejects.toThrow();
    expect(use).not.toHaveBeenCalled(); expect(f.destroy).toHaveBeenCalledOnce();
  });
  it.each(['role_name', 'session_role', 'server_address', 'server_port', 'server_version', 'database_owner',
    'superuser', 'create_database', 'create_role', 'replication', 'bypass_rls', 'has_memberships', 'database_create', 'schema_create', 'in_recovery'])('rejects identity drift: %s', async field => {
    const f = integrationFixture(); f.identityChanges[field] = 'wrong';
    await expect(f.db.session('zemaitija_app', signal(), async () => true)).rejects.toThrow();
    expect(f.destroy).toHaveBeenCalledOnce();
  });
  it.each(['source-only', 'revoked', 'expired', 'cancelled'])('rejects %s before connection', async kind => {
    const f = integrationFixture(kind === 'source-only' ? 'SOURCE_REVIEW' : 'G3_EXECUTION'), controller = new AbortController();
    if (kind === 'revoked') f.revoke();
    if (kind === 'expired') f.advance(3600000);
    if (kind === 'cancelled') controller.abort();
    await expect(f.db.session('zemaitija_app', controller.signal, async () => true)).rejects.toThrow();
    expect(f.connector.open).not.toHaveBeenCalled();
  });
  function docker(f: ReturnType<typeof integrationFixture>) {
    const t = f.run.target;
    return { imageId: t.imageId, volumeIdentity: t.volumeIdentity, independentCredentials: true,
      container: { id: t.containerId, name: t.container, image: t.image, project: t.project, service: t.service,
        running: true, privileged: false, capAdd: [], configuredPorts: {}, runtimePorts: {},
        networks: { [t.network]: { id: t.networkId, address: t.address } },
        mounts: [{ type: 'volume', name: t.volume, source: '/synthetic/data', destination: '/var/lib/postgresql/data', rw: true }] },
      network: { id: t.networkId, name: t.network, driver: 'bridge', internal: true, project: t.project, containers: [t.containerId] },
      volume: { name: t.volume, driver: 'local', mountpoint: '/synthetic/data', project: t.project, options: null } };
  }
  it('attests exact fresh image, network, volume and mount without provisioning', async () => {
    const f = integrationFixture();
    expect(await attestFreshDocker(f.review, { read: async () => docker(f) }, f.now)).toMatchObject({ containerId: f.run.target.containerId });
  });
  it.each(['image', 'recreated-volume', 'foreign-container', 'public-port', 'extra-mount', 'privileged', 'foreign-network', 'shared-network', 'reused-credentials'])('rejects Docker %s', async kind => {
    const f = integrationFixture(), d = docker(f);
    if (kind === 'image') d.imageId = `sha256:${'f'.repeat(64)}`;
    if (kind === 'recreated-volume') d.volumeIdentity = syntheticId(9876);
    if (kind === 'foreign-container') d.container.name = 'protected';
    if (kind === 'public-port') Object.assign(d.container.runtimePorts, { '5432/tcp': [{ HostIp: '0.0.0.0', HostPort: '5432' }] });
    if (kind === 'extra-mount') d.container.mounts.push({ ...d.container.mounts[0] });
    if (kind === 'privileged') d.container.privileged = true;
    if (kind === 'foreign-network') d.network.id = 'f'.repeat(64);
    if (kind === 'shared-network') d.network.containers.push('f'.repeat(64));
    if (kind === 'reused-credentials') d.independentCredentials = false;
    await expect(attestFreshDocker(f.review, { read: async () => d }, f.now)).rejects.toThrow();
  });
  it('fixed evidence SQL has parameterised CAS and no missing-row initialisation', async () => {
    const f = integrationFixture(); f.reply(async sql => sql.includes('cas_cell') ? [{ accepted: true }] : []);
    const port = postgresEvidencePort(f.review, f.db, 'supervision', signal());
    expect(await port.compareAndSwap(0, { entries: [] })).toBe('DURABLE');
    await expect(port.read()).rejects.toThrow();
    expect(f.statements.some(s => s.includes('INSERT'))).toBe(false);
  });
  it('normalises pg bigint revisions without accepting unsafe numeric truncation', async () => {
    const f = integrationFixture(); let revision = '0';
    f.reply(async () => [{ revision, image: { entries: [] }, fenced: false }]);
    const port = postgresEvidencePort(f.review, f.db, 'provider', signal());
    expect(await port.read()).toMatchObject({ revision: 0 });
    revision = '9007199254740993'; await expect(port.read()).rejects.toThrow();
  });
  it.each(['valid', 'short-ledger', 'wrong-hash', 'reordered-ledger', 'unbound-supplement'])('checks actual baseline rows and supplementary binding: %s', async kind => {
    const f = integrationFixture(), rows = pinned.entries.map(e => ({ hash: e.sha256, created_at: String(e.when) }));
    if (kind === 'short-ledger') rows.pop();
    if (kind === 'wrong-hash') rows[0].hash = 'f'.repeat(64);
    if (kind === 'reordered-ledger') rows.reverse();
    f.reply(async sql => sql.includes('drizzle.__drizzle_migrations') ? rows : sql.includes('profile_binding') ? [{
      run_id: f.run.runId, manifest_digest: f.approval.manifestDigest, baseline_digest: f.run.migrationDigest,
      supplemental_digest: kind === 'unbound-supplement' ? 'f'.repeat(64) : f.approval.supplementalDigest,
      approval_reference: f.approval.approvalReference, profile: 'stage2c-evidence-v1-proposal',
    }] : []);
    const result = attestFreshPostgresLedger(f.review, f.db, signal());
    if (kind === 'valid') expect(await result).toMatchObject({ baselineCount: 36 });
    else await expect(result).rejects.toThrow();
  });
});

describe('durable journal, independent checkpoint, requests and crash recovery', () => {
  it('acknowledges only anchored persistence and reconstructs through fresh adapter instances', async () => {
    const f = integrationFixture(), first = await f.ledger.read();
    expect(await f.ledger.append(first, f.now(), { event: 'original' })).toBe('DURABLE');
    const restarted = anchoredEvidence(f.review, f.disk.cell, f.disk.head);
    expect((await restarted.read()).entries[0].data).toEqual({ event: 'original' });
  });
  it.each(['BEFORE_COMMIT', 'AFTER_COMMIT', 'HEAD'] as const)('fences %s across adapter restart', async failure => {
    const f = integrationFixture(); f.disk.failure(failure);
    expect(await f.ledger.append(await f.ledger.read(), f.now(), { event: 'unknown' })).toBe('UNKNOWN');
    f.disk.failure('NONE');
    await expect(anchoredEvidence(f.review, f.disk.cell, f.disk.head).read()).rejects.toThrow();
    expect(f.disk.state().fenced).toBe(true); expect(f.disk.state().checkpoint.fenced).toBe(true);
  });
  it.each(['chain', 'truncated-checkpoint'])('rejects %s', async kind => {
    const f = integrationFixture(); await f.ledger.append(await f.ledger.read(), f.now(), { fact: 1 });
    if (kind === 'chain') f.disk.corrupt({ entries: [] }); else f.disk.truncateHead();
    await expect(f.ledger.read()).rejects.toThrow(); expect(f.disk.state().fenced).toBe(true);
  });
  it('CAS contention never dispatches or silently retries', async () => {
    const f = integrationFixture(), s = await f.ledger.read();
    expect((await Promise.all([f.ledger.append(s, f.now(), { a: 1 }), f.ledger.append(s, f.now(), { a: 2 })])).sort()).toEqual(['CONFLICT', 'DURABLE']);
  });
  it('persists accepted v1 supervision separately and validates its chain', async () => {
    const f = integrationFixture(), store = durableSupervisionStore(f.run, f.ledger), binding = supervisionBinding(f.run);
    const initial = { sequence: 0, headDigest: '0'.repeat(64) };
    const entry = supervisionEntry(binding, syntheticId(9001), f.now(), { kind: 'OPEN', deadline: f.now() + 10000 }, initial);
    expect(await store.compareAndAppend(binding, initial, entry)).toBe('DURABLE');
    expect(await store.read(binding)).toMatchObject({ sequence: 1, headDigest: entry.digest });
    expect(await store.compareAndAppend(binding, initial, entry)).toBe('CONFLICT');
  });
  it('an interrupted request blocks restarted budget rather than refunding its allowance', async () => {
    const f = integrationFixture();
    expect(await f.budget.reserve(syntheticId(9000), syntheticId(9001), 'CHECKOUT_DISPATCH', signal())).toBe('DURABLE');
    const restarted = durableProviderBudget(f.review, anchoredEvidence(f.review, f.disk.cell, f.disk.head),
      { now: f.now, authority: f.authority, locksHeld: async () => true });
    expect(await restarted.reserve(syntheticId(9002), syntheticId(9003), 'CHECKOUT_DISPATCH', signal())).toBe('DENIED');
    expect((await restarted.inspect()).requests.size).toBe(1);
  });
  it.each(['UNCERTAIN', 'TIMEOUT', 'CANCELLED'] as const)('retains %s and denies new requests', async outcome => {
    const f = integrationFixture(); await f.budget.reserve(syntheticId(9000), syntheticId(9001), 'CHECKOUT_DISPATCH', signal());
    expect(await f.budget.settle(syntheticId(9001), outcome, null)).toBe('DURABLE');
    expect(await f.budget.reserve(syntheticId(9000), syntheticId(9002), 'CHECKOUT_DISPATCH', signal())).toBe('DENIED');
  });
  it('per-invocation exhaustion survives restart and NOT_STARTED allowances are charged', async () => {
    const f = integrationFixture(), invocation = syntheticId(9000);
    for (let i = 0; i < f.run.budgets.providerPerInvocation; i++) {
      const request = syntheticId(10000 + i);
      expect(await f.budget.reserve(invocation, request, 'CHECKOUT_DISPATCH', signal())).toBe('DURABLE');
      expect(await f.budget.settle(request, 'NOT_STARTED', null)).toBe('DURABLE');
    }
    const restart = durableProviderBudget(f.review, anchoredEvidence(f.review, f.disk.cell, f.disk.head),
      { now: f.now, authority: f.authority, locksHeld: async () => true });
    expect(await restart.reserve(invocation, syntheticId(19000), 'CHECKOUT_DISPATCH', signal())).toBe('DENIED');
  });
  it('lost locks and revoked authority cannot reserve a request', async () => {
    const f = integrationFixture(); f.loseLock();
    expect(await f.budget.reserve(syntheticId(9000), syntheticId(9001), 'CHECKOUT_DISPATCH', signal())).toBe('DENIED');
    f.revoke(); expect(await f.budget.reserve(syntheticId(9000), syntheticId(9002), 'CHECKOUT_DISPATCH', signal())).toBe('UNKNOWN');
    expect(f.disk.state().fenced).toBe(true);
  });
  it('bootstrap and later invocations share a single total cap across distinct G2/G3 approvals', async () => {
    const base = integrationFixture(), run = { ...base.run, budgets: { ...base.run.budgets,
      invocations: 2, items: 10, providerPerInvocation: 2, providerRequests: 4 } };
    const g2 = integrationFixture('G2_PREFLIGHT', run), g3 = integrationFixture('G3_EXECUTION', run);
    await g2.budget.reserve(syntheticId(9000), syntheticId(9001), 'BOOTSTRAP_ACCOUNT', signal());
    await g2.budget.dispatchDeadline(syntheticId(9001), signal());
    await g2.budget.settle(syntheticId(9001), 'KNOWN', 'req_bootstrap');
    const continuing = durableProviderBudget(g3.review, anchoredEvidence(g3.review, g2.disk.cell, g2.disk.head),
      { now: g3.now, authority: g3.authority, locksHeld: async () => true });
    for (let i = 0; i < 3; i++) {
      const request = syntheticId(9100 + i), invocation = syntheticId(9200 + Math.floor(i / 2));
      expect(await continuing.reserve(invocation, request, 'WORKER_ACCOUNT', signal())).toBe('DURABLE');
      await continuing.dispatchDeadline(request, signal());
      await continuing.settle(request, 'KNOWN', `req_${i}`);
    }
    expect(await continuing.reserve(syntheticId(9201), syntheticId(9300), 'WORKER_ACCOUNT', signal())).toBe('DENIED');
    expect((await continuing.inspect()).requests.size).toBe(4);
  });
  it.each(['lost-lock', 'deadline', 'duplicate-intent'])('revalidates dispatch after reservation: %s', async kind => {
    const f = integrationFixture(), request = syntheticId(9001);
    await f.budget.reserve(syntheticId(9000), request, 'WORKER_ACCOUNT', signal());
    if (kind === 'lost-lock') f.loseLock();
    if (kind === 'deadline') f.advance(1000);
    if (kind === 'duplicate-intent') await f.budget.dispatchDeadline(request, signal());
    await expect(f.budget.dispatchDeadline(request, signal())).rejects.toThrow();
    expect((await f.budget.inspect()).requests.size).toBe(1);
  });
  it('does not authorise undeclared financial operations or a generic operation escape hatch', async () => {
    const base = integrationFixture(), f = integrationFixture('G3_EXECUTION', { ...base.run, operations: ['verify-read-only'] });
    expect(await f.budget.reserve(syntheticId(9000), syntheticId(9001), 'CHECKOUT_DISPATCH', signal())).toBe('DENIED');
    expect(await f.budget.reserve(syntheticId(9000), syntheticId(9002), 'OTHER_AUTHORISED', signal())).toBe('DENIED');
  });
});

describe('bounded provider seam and bootstrap', () => {
  it('accounts each hidden HTTP retry and denies the first request beyond its durable cap', async () => {
    const base = integrationFixture(), run = { ...base.run, budgets: { ...base.run.budgets,
      invocations: 1, items: 5, providerPerInvocation: 2, providerRequests: 2 } }, f = integrationFixture('G3_EXECUTION', run), s = scope(f);
    let request = 9900;
    const fetcher = vi.fn<typeof fetch>(async () => new Response('{}', { headers: { 'request-id': 'req_synthetic' } }));
    const transport = aggregateBoundedAcceptanceFetch({ fetch: fetcher, budget: f.budget, currentScope: () => s,
      invocationId: syntheticId(9000), operation: 'WORKER_ACCOUNT', nextRequestId: () => syntheticId(request++), revalidate: async () => {} });
    await transport('https://api.stripe.com/v1/account'); await transport('https://api.stripe.com/v1/account');
    await expect(transport('https://api.stripe.com/v1/account')).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('aborts an unsettled underlying request and records uncertainty without retry or quota refund', async () => {
    const f = integrationFixture(), s = scope(f);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(Error('aborted')), { once: true });
    }));
    const transport = aggregateBoundedAcceptanceFetch({ fetch: fetcher, budget: f.budget, currentScope: () => s,
      invocationId: syntheticId(9000), operation: 'WORKER_ACCOUNT', nextRequestId: () => syntheticId(9001), revalidate: async () => {} });
    const result = transport('https://api.stripe.com/v1/account').catch(e => e);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toBeInstanceOf(Error);
    expect((await f.budget.inspect()).requests.get(syntheticId(9001))?.outcome).toBe('UNCERTAIN');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('charges initial account verification before the fake transport and permits it only once', async () => {
    const f = integrationFixture('G2_PREFLIGHT'), s = scope(f), fetcher = vi.fn<typeof fetch>(async () => {
      expect((await f.budget.inspect()).requests.size).toBe(1);
      return Response.json({ id: f.run.stripe.accountId, object: 'account' }, { headers: { 'request-id': 'req_synthetic' } });
    });
    const deps = { fetch: fetcher, budget: f.budget, scope: s, invocationId: syntheticId(9000), nextRequestId: () => syntheticId(9001), revalidate: async () => {} };
    expect(await verifyBudgetedBootstrapAccount(f.review, deps)).toMatchObject({ accountId: f.run.stripe.accountId, operationsEnabled: false });
    await expect(verifyBudgetedBootstrapAccount(f.review, { ...deps, nextRequestId: () => syntheticId(9002) })).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each(['wrong-account', 'redirect', 'lost-response', 'oversized-body', 'uncertain-commit', 'already-aborted', 'expired-before-dispatch'])('halts on %s without retry', async kind => {
    const f = integrationFixture(), s = scope(f);
    if (kind === 'uncertain-commit') f.disk.failure('AFTER_COMMIT');
    const fetcher = vi.fn<typeof fetch>(async () => {
      if (kind === 'lost-response') throw Error('private failure');
      if (kind === 'redirect') return new Response(null, { status: 302 });
      if (kind === 'oversized-body') return new Response('x'.repeat(1024 * 1024 + 1));
      return Response.json({ id: 'acct_wrong', object: 'account' });
    });
    if (kind === 'wrong-account') {
      const g = integrationFixture('G2_PREFLIGHT');
      await expect(verifyBudgetedBootstrapAccount(g.review, { fetch: fetcher, budget: g.budget, scope: scope(g),
        invocationId: syntheticId(9000), nextRequestId: () => syntheticId(9001), revalidate: async () => {} })).rejects.toThrow();
      return;
    }
    const controller = new AbortController(); if (kind === 'already-aborted') controller.abort();
    let checks = 0;
    const transport = aggregateBoundedAcceptanceFetch({ fetch: fetcher, budget: f.budget, currentScope: () => s,
      invocationId: syntheticId(9000), operation: 'WORKER_ACCOUNT', nextRequestId: () => syntheticId(9001),
      revalidate: async () => { if (++checks === 2 && kind === 'expired-before-dispatch') f.advance(3600000); } });
    await expect(transport('https://api.stripe.com/v1/account', { signal: controller.signal })).rejects.toThrow();
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(1);
    if (['uncertain-commit', 'already-aborted', 'expired-before-dispatch'].includes(kind)) expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['https://evil.invalid/v1/account', 'https://api.stripe.com/v1/refunds', 'https://api.stripe.com/v1/account?other=1'])('rejects foreign/unsupported request %s', async url => {
    const f = integrationFixture(), fetcher = vi.fn<typeof fetch>();
    const transport = aggregateBoundedAcceptanceFetch({ fetch: fetcher, budget: f.budget, currentScope: () => scope(f),
      invocationId: syntheticId(9000), operation: 'WORKER_ACCOUNT', nextRequestId: () => syntheticId(9001), revalidate: async () => {} });
    await expect(transport(url)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  });
});

describe('host and session lock lifetime', () => {
  function locks(f: ReturnType<typeof integrationFixture>, change: string) {
    let pid = 42;
    f.reply(async sql => {
      if (sql.includes('pg_try_advisory_lock')) return [{ acquired: change !== 'db-contended', pid }];
      if (sql.includes('pg_advisory_unlock')) return [{ released: change !== 'unlock-unknown' }];
      if (change === 'session-replaced') pid++;
      return [{ pid, held: change !== 'db-lost' }];
    });
    const release = vi.fn(async () => change === 'host-release-unknown' ? 'UNKNOWN' as const : 'RELEASED' as const);
    const host = { acquire: vi.fn(async () => ({ observation: change === 'host-contended' ? 'CONTENDED' as const : 'ACQUIRED' as const,
      held: async () => change !== 'host-lost', release })) };
    return { host, release };
  }
  it('retains both locks for the callback and checks continuity before/after', async () => {
    const f = integrationFixture(), l = locks(f, 'NONE'), use = vi.fn(async c => { await c.check(); return 7; });
    expect(await withFreshExecutionLocks(f.review, f.db, { ...l, now: f.now, authority: f.authority, signal: signal() }, use)).toBe(7);
    expect(use).toHaveBeenCalledOnce(); expect(l.release).toHaveBeenCalledOnce(); expect(f.destroy).toHaveBeenCalledOnce();
  });
  it.each(['host-contended', 'host-lost', 'db-contended', 'db-lost', 'session-replaced', 'unlock-unknown', 'host-release-unknown'])('halts on %s', async kind => {
    const f = integrationFixture(), l = locks(f, kind);
    await expect(withFreshExecutionLocks(f.review, f.db, { ...l, now: f.now, authority: f.authority, signal: signal() }, async () => true)).rejects.toThrow();
    expect(l.release).toHaveBeenCalledOnce();
  });
});

describe('durable webhook ownership and independent readers', () => {
  async function admission() {
    const f = integrationFixture(), v = await verifierFixture(), m = v.mappings[0];
    const ownership: PersistedAcceptanceOwnership = { runId: f.run.runId, manifestDigest: f.approval.manifestDigest,
      bookingId: m.bookingId, attemptId: m.attemptId, holdId: m.holdId, commandId: m.commandId, sessionId: 'cs_test_synthetic', paymentIntentId: 'pi_synthetic',
      commandAttemptId: m.attemptId, attemptBookingId: m.bookingId, attemptHoldId: m.holdId,
      currentRequestDigest: 'a'.repeat(64), originalRequestDigest: 'a'.repeat(64), originalKey: `session-create:${m.attemptId}`,
      currentKey: `session-create:${m.attemptId}`, capturedOriginalIds: true };
    const input = { runId: f.run.runId, manifestDigest: f.approval.manifestDigest, database: f.run.target.database,
      payloadDigest: 'b'.repeat(64), supportedPayment: true,
      event: { id: 'evt_synthetic', type: 'checkout.session.completed', objectId: 'cs_test_synthetic', objectType: 'checkout.session',
        created: Math.floor(f.now() / 1000), accountId: f.run.stripe.accountId, livemode: false } };
    const store = restrictedAcceptanceAdmission(f.review, f.ledger, { now: f.now, authority: f.authority, ownership: async () => ownership });
    return { f, ownership, input, store };
  }
  it('retains original event, duplicate delivery and conflicting digest in an anchored journal', async () => {
    const { store, input } = await admission();
    await expect(store.commit(input, signal())).rejects.toThrow('ATOMIC_INBOX_HANDOFF_REQUIRED');
    const recorded = await store.recordEvidence(input, signal());
    expect(recorded).toMatchObject({ kind: 'ADMISSION_JOURNAL_ONLY', processingInboxHandoff: 'NOT_IMPLEMENTED', disposition: 'INGESTED', lane: 'PAYMENT' });
    expect(recorded).not.toHaveProperty('durable'); expect(recorded).not.toHaveProperty('version');
    expect(await store.recordEvidence(input, signal())).toMatchObject({ disposition: 'DUPLICATE', lane: 'PAYMENT' });
    expect(await store.recordEvidence({ ...input, payloadDigest: 'c'.repeat(64) }, signal())).toMatchObject({ disposition: 'INVESTIGATION',
      lane: 'NONE', ownership: 'DIGEST_CONFLICT', originalPayloadDigest: input.payloadDigest });
  });
  it.each(['foreign-run', 'unbound-session', 'command-attempt', 'changed-key', 'changed-request', 'unsupported'])('keeps %s outside the payment lane', async kind => {
    const { store, input, ownership } = await admission();
    if (kind === 'foreign-run') ownership.runId = syntheticId(9000);
    if (kind === 'unbound-session') ownership.sessionId = null;
    if (kind === 'command-attempt') ownership.commandAttemptId = syntheticId(9000);
    if (kind === 'changed-key') ownership.currentKey = 'changed';
    if (kind === 'changed-request') ownership.currentRequestDigest = 'f'.repeat(64);
    if (kind === 'unsupported') { input.event.type = 'customer.created'; input.event.objectType = 'customer'; input.supportedPayment = false; }
    expect(await store.recordEvidence(input, signal())).toMatchObject({ disposition: 'INVESTIGATION', lane: 'NONE' });
  });
  it('concurrent admission yields at most one acknowledged original and a retry can become duplicate', async () => {
    const { store, input } = await admission();
    const results = await Promise.allSettled([store.recordEvidence(input, signal()), store.recordEvidence(input, signal())]);
    expect(results.filter(r => r.status === 'fulfilled').length).toBe(1);
    expect(await store.recordEvidence(input, signal())).toMatchObject({ disposition: 'DUPLICATE' });
  });
  it('commit uncertainty acknowledges nothing, including after restart', async () => {
    const { store, input, f } = await admission(); f.disk.failure('AFTER_COMMIT');
    await expect(store.recordEvidence(input, signal())).rejects.toThrow(); expect(f.disk.state().fenced).toBe(true);
  });
  it('read-only verifier reader uses only fixed SELECTs and cannot replace independent envelopes with status', async () => {
    const f = integrationFixture(), v = await verifierFixture();
    // A foreign manifest is rejected before opening SQL.
    const reader = restrictedVerifierReader(f.run, f.db, 'database', signal());
    await expect(reader.read({ ...v.review.binding, manifestDigest: 'f'.repeat(64) })).rejects.toThrow(); expect(f.connector.open).not.toHaveBeenCalled();
    expect(() => restrictedVerifierReader(v.run, { ...f.db, binding: { ...f.db.binding, manifestDigest: 'f'.repeat(64) } }, 'database', signal())).toThrow();
    const compatible = integrationFixture('G3_EXECUTION', v.run);
    const ownReader = restrictedVerifierReader(v.run, compatible.db, 'database', signal());
    compatible.reply(async sql => sql.includes('verifier_snapshots') ? [{ envelope: v.envelopes.database }] : []);
    expect(await ownReader.read(v.review.binding)).toEqual(v.envelopes.database);
    expect(compatible.statements.filter(sql => !['BEGIN READ ONLY', 'ROLLBACK', 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'].includes(sql))
      .every(sql => sql.startsWith('SELECT'))).toBe(true);
    expect(Object.keys(ownReader).sort()).toEqual(['kind', 'read']);
  });
  it('status rejects unknown fixtures and preserves strict read-only capability shape', async () => {
    const v = await verifierFixture(), f = integrationFixture('G3_EXECUTION', v.run);
    const reader = restrictedStatusReader(v.run, v.plan, f.db, signal());
    await expect(reader.read({ runId: v.run.runId, manifestDigest: v.review.binding.manifestDigest,
      planDigest: v.plan.planDigest, fixtureId: syntheticId(9988), database: v.run.target.database })).rejects.toThrow();
    expect(f.connector.open).not.toHaveBeenCalled(); expect(Object.keys(reader).sort()).toEqual(['kind', 'read']);
  });
  it('fixture interface requires independent monetary/target authority before invoking the writer', async () => {
    const v = await verifierFixture(), writer = { acceptExistingAndCapture: vi.fn() };
    await expect(acceptApprovedSyntheticFixture(v.run, v.plan, v.plan.fixtures[0].fixtureId,
      { writer, grant: async () => ({ paid: true }), now: v.now, signal: signal() })).rejects.toThrow();
    expect(writer.acceptExistingAndCapture).not.toHaveBeenCalled();
  });
  it.each(['valid', 'wrong-claim-provenance', 'foreign-guest', 'changed-price', 'missing-commit', 'lost-response'])('validates original runtime capture without retry: %s', async kind => {
    const v = await verifierFixture(), fixture = v.plan.fixtures[0], mapping = { ...v.mappings[0] };
    if (kind === 'wrong-claim-provenance') mapping.claimId = mapping.holdId;
    if (kind === 'foreign-guest') mapping.guestId = syntheticId(9988);
    const writer = { acceptExistingAndCapture: vi.fn(async () => {
      if (kind === 'lost-response') throw Error('COMMIT_UNKNOWN');
      return { mapping, commitEvidenceRef: kind === 'missing-commit' ? '' : 'protected-original-commit',
        quotedInitialCents: kind === 'changed-price' ? 1 : fixture.expected.initialCents, quotedTotalCents: fixture.expected.totalCents };
    }) };
    const grant = async () => ({ runId: v.run.runId, manifestDigest: v.review.binding.manifestDigest, planDigest: v.plan.planDigest,
      fixtureId: fixture.fixtureId, operation: 'prepare-booking', scope: 'G3_EXECUTION', monetaryApprovalVerified: true,
      targetVerified: true, reservationVerified: true, captureActive: true,
      notBefore: Date.parse(v.run.notBefore), expiresAt: Date.parse(v.run.expiresAt) });
    const result = acceptApprovedSyntheticFixture(v.run, v.plan, fixture.fixtureId,
      { writer, grant, now: () => mapping.acceptedAt, signal: signal() });
    if (kind === 'valid') expect(await result).toMatchObject({ mapping, operationsEnabled: false });
    else await expect(result).rejects.toThrow();
    expect(writer.acceptExistingAndCapture).toHaveBeenCalledOnce();
  });
});

describe('no activation, environment or protected-history side effects', () => {
  it('preserves hard-inactive endpoint and avoids operational constructors in the new sources', () => {
    const paths = ['trust', 'fresh-database', 'durable', 'integration', 'evidence-adapters'];
    for (const suffix of paths) {
      const text = readFileSync(`src/server/stripe-acceptance-${suffix}.ts`, 'utf8');
      expect(text).not.toMatch(/process\.env|from ['"]pg['"]|from ['"]stripe['"]|node:fs|node:child_process|\.listen\(|setInterval\(|new Pool\(|new Stripe\(/);
    }
    const endpoint = readFileSync('src/app/api/internal/stripe-automation/route.ts', 'utf8');
    expect(endpoint).not.toMatch(/stripe-acceptance|stripe-automation-runner/);
    expect(readFileSync('src/server/stripe-automation.ts', 'utf8')).toContain('STAGE_2A_INACTIVE');
    const ddl = readFileSync('docs/proposals/STAGE_2C_CONSOLIDATED_RUN_1_EVIDENCE.sql', 'utf8');
    expect(ddl).toContain('UNAPPROVED PROPOSED'); expect(ddl).not.toMatch(/ALTER TABLE public\.|UPDATE (bookings|payment_records|inventory_claims)/);
  });
});
