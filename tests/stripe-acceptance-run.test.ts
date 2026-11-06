import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import pinned from '../scripts/stripe-automation-migration-manifest.json';
import { artifactDigest, canonicalRunJson, freshAcceptanceNames, FRESH_ACCEPTANCE_PROFILE,
  requireSealedAcceptanceRun, runManifestDigest, sealAcceptanceRun, type AcceptanceRunEvidence,
  type ArtifactFile } from '../src/server/stripe-acceptance-run';
import { runStripeAutomationFoundation } from '../src/server/stripe-automation';

vi.mock('pg', () => { throw Error('Live PostgreSQL forbidden'); });
vi.mock('stripe', () => { throw Error('Stripe SDK forbidden'); });
vi.mock('../src/db/client', () => { throw Error('Shared database forbidden'); });
vi.mock('../scripts/lib/stripe-automation-docker', () => { throw Error('Docker adapter forbidden'); });

const runId = '10000000-0000-4000-8000-000000000001';
const migrations: ArtifactFile[] = ['scripts/stripe-automation-migration-manifest.json', 'drizzle/meta/_journal.json',
  ...pinned.entries.map(e => `drizzle/${e.tag}.sql`)].sort().map(path => ({ path, bytes: readFileSync(path) }));
const source: ArtifactFile[] = [{ path: 'src/server/synthetic.ts', bytes: Buffer.from('synthetic source\n') }];

function fixture() {
  const manifest = {
    version: 1, runId, approvalReference: 'review:stage-2c:synthetic-review-0001', profileId: FRESH_ACCEPTANCE_PROFILE.id,
    target: { ...freshAcceptanceNames(runId), containerId: 'a'.repeat(64), networkId: 'b'.repeat(64),
      volumeIdentity: '20000000-0000-4000-8000-000000000001', image: 'postgres:17.6', imageId: `sha256:${'c'.repeat(64)}`,
      address: '172.28.0.2', port: 5432 },
    sourceDigest: artifactDigest('source', source), migrationDigest: artifactDigest('migrations', migrations),
    stripe: { mode: 'test', accountId: 'acct_synthetic', webhookEndpointId: 'we_synthetic', apiVersion: '2026-08-26.dahlia' },
    operations: ['dispatch-checkout', 'ingest-payment-webhook', 'prepare-booking', 'reconcile-payment', 'verify-read-only'],
    issuedAt: '2035-01-01T00:00:00.000Z', notBefore: '2035-01-01T00:00:00.000Z', expiresAt: '2035-01-01T00:30:00.000Z',
    fixtures: { namespace: `stage2c:${runId}`, guestId: '30000000-0000-4000-8000-000000000001',
      unitId: '40000000-0000-4000-8000-000000000001', bookingOperationId: '50000000-0000-4000-8000-000000000001' },
    budgets: { invocations: 10, items: 50, providerRequests: 600, providerPerInvocation: 60,
      lanes: { PAYMENT_WEBHOOKS: 2, CHECKOUT_COMMAND_RECOVERY: 1, INITIAL_RECONCILIATION: 1,
        BALANCE_RECONCILIATION: 1, DEFERRED_INVESTIGATION: 0 } },
  };
  const evidence: AcceptanceRunEvidence = {
    now: '2035-01-01T00:01:00.000Z',
    authority: { issuer: 'protected-host-review-v1', approvalReference: manifest.approvalReference, runId,
      manifestDigest: runManifestDigest(canonicalRunJson(manifest)), sourceDigest: manifest.sourceDigest,
      migrationDigest: manifest.migrationDigest, sourcePaths: source.map(f => f.path) },
    history: { complete: true, runIds: [], resourceIdentities: [] },
    docker: { ...manifest.target, image: 'postgres:17.6', port: 5432, running: true, privileged: false,
      addedCapabilities: 0, internal: true, driver: 'bridge', soleNetwork: true, soleContainer: true,
      dedicatedVolume: true, unexpectedMounts: false, publishedPorts: 0, independentCredentials: true },
    database: { database_name: manifest.target.database, role_name: 'zemaitija_app', session_role: 'zemaitija_app',
      database_owner: 'zemaitija_migrator', server_address: manifest.target.address, server_port: 5432, server_version: 170006,
      in_recovery: false, superuser: false, create_database: false, create_role: false, replication: false, bypass_rls: false,
      has_memberships: false, database_create: false, schema_create: false, recoveryMetadataUpdate: false,
      publicRecoveryExecute: false, recoveryDefinerOwner: 'zemaitija_migrator', recoverySearchPath: 'pg_catalog, public',
      recoveryGuardsValid: true, inventoryExclusionValid: true, financialConstraintsValid: true,
      migrationCount: 36, migrationDigest: manifest.migrationDigest },
    stripe: { mode: 'test', livemode: false, accountId: 'acct_synthetic', webhookEndpointId: 'we_synthetic', apiVersion: '2026-08-26.dahlia' },
  };
  // Update only the manifest hash to exercise deeper validation, not a hash rejection.
  const seal = (sourceFiles = source, migrationFiles = migrations) => {
    const text = canonicalRunJson(manifest);
    evidence.authority.manifestDigest = runManifestDigest(text);
    return sealAcceptanceRun(text, evidence, sourceFiles, migrationFiles);
  };
  return { manifest, evidence, seal };
}

describe('fresh-run profile and sealed manifest (pure, no execution)', () => {
  it('accepts synthetic evidence and the complete 36-migration baseline', () => {
    const f = fixture(), sealed = f.seal();
    expect(sealed.runId).toBe(runId);
    expect(FRESH_ACCEPTANCE_PROFILE).toMatchObject({ postgresMajor: 17, serverVersion: 170006, migrationCount: 36 });
    expect(sealed.target.database).not.toContain('zemaitija');
    expect(() => requireSealedAcceptanceRun(sealed)).not.toThrow();
  });
  it.each(['zemaitija_dev', 'zemaitija_stripe_automation_dev'])('rejects protected database %s', database => {
    const f = fixture(); f.manifest.target.database = database; f.evidence.docker.database = database;
    f.evidence.database.database_name = database; expect(f.seal).toThrow('FRESH_ACCEPTANCE_CONTRACT_REJECTED');
  });
  it.each([
    ['container', 'zemaitija-stripe-automation-db'], ['project', 'zemaitija-stripe-automation'],
    ['network', 'zemaitija-stripe-automation-internal'], ['volume', 'zemaitija_stripe_automation_data'],
    ['volume', 'zemaitija-country-escapes_postgres_data'], ['service', 'db'],
  ] as const)('rejects protected/old %s', (key, value) => {
    const f = fixture(); f.manifest.target[key] = value; f.evidence.docker[key] = value; expect(f.seal).toThrow();
  });
  it.each(['project', 'container', 'network', 'volume', 'database', 'containerId', 'networkId', 'volumeIdentity'] as const)
  ('rejects reuse of %s', key => {
    const f = fixture(); f.evidence.history.resourceIdentities.push(f.manifest.target[key]); expect(f.seal).toThrow();
  });
  it('rejects previous run and incomplete resource inventory', () => {
    const f = fixture(); f.evidence.history.runIds.push(runId); expect(f.seal).toThrow();
    expect(() => sealAcceptanceRun(canonicalRunJson(f.manifest), { ...f.evidence, history: {} }, source, migrations)).toThrow();
  });
  it.each(['superuser', 'create_database', 'create_role', 'replication', 'bypass_rls', 'has_memberships', 'database_create',
    'schema_create', 'recoveryMetadataUpdate', 'publicRecoveryExecute'] as const)('rejects privilege %s', key => {
    const f = fixture(); Object.assign(f.evidence.database, { [key]: true }); expect(f.seal).toThrow();
  });
  it.each(['role_name', 'session_role', 'database_owner', 'recoveryDefinerOwner'] as const)('rejects wrong %s', key => {
    const f = fixture(); Object.assign(f.evidence.database, { [key]: 'zemaitija_bootstrap' }); expect(f.seal).toThrow();
  });
  it.each(['recoveryGuardsValid', 'inventoryExclusionValid', 'financialConstraintsValid'] as const)('requires %s', key => {
    const f = fixture(); Object.assign(f.evidence.database, { [key]: false }); expect(f.seal).toThrow();
  });
  it.each(['sourceDigest', 'migrationDigest'] as const)('rejects %s mismatch', key => {
    const f = fixture(); f.manifest[key] = 'd'.repeat(64); expect(f.seal).toThrow();
  });
  it.each(['', 'sha256:' + 'a'.repeat(64), 'A'.repeat(64), 'a'.repeat(63)])('rejects malformed digest %s', value => {
    const f = fixture(); f.manifest.sourceDigest = value; expect(f.seal).toThrow();
  });
  it('checks actual source bytes and exact reviewed path set', () => {
    const f = fixture(); expect(() => f.seal([{ ...source[0], bytes: Buffer.from('changed') }])).toThrow();
    f.evidence.authority.sourcePaths = ['src/server/omitted.ts']; expect(f.seal).toThrow();
  });
  it.each(['sql', 'journal', 'manifest', 'missing'] as const)('rejects altered migration %s even if new digest is approved', kind => {
    const f = fixture(), files = migrations.map(file => ({ ...file, bytes: Buffer.from(file.bytes) }));
    const path = kind === 'sql' ? `drizzle/${pinned.entries[0].tag}.sql`
      : kind === 'journal' ? 'drizzle/meta/_journal.json' : 'scripts/stripe-automation-migration-manifest.json';
    if (kind === 'missing') files.pop(); else files.find(file => file.path === path)!.bytes = Buffer.from('{}');
    f.manifest.migrationDigest = artifactDigest('migrations', files);
    f.evidence.authority.migrationDigest = f.manifest.migrationDigest;
    f.evidence.database.migrationDigest = f.manifest.migrationDigest;
    expect(() => f.seal(source, files)).toThrow();
  });
  it.each([
    ['expiresAt', '2035-01-01T00:01:00.000Z'], ['notBefore', '2035-01-01T00:02:00.000Z'],
    ['expiresAt', '2035-01-01T00:31:00.000Z'], ['issuedAt', '2034-12-31T23:00:00.000Z'],
    ['issuedAt', '2035-01-01T00:00:01.000Z'], ['notBefore', '2035-02-30T00:00:00.000Z'],
    ['expiresAt', '2035-01-01'], ['expiresAt', '2035-01-01T00:30:00+00:00'],
  ] as const)('rejects authority window %s=%s', (key, value) => {
    const f = fixture(); f.manifest[key] = value; expect(f.seal).toThrow();
  });
  it.each(['invocations', 'items', 'providerRequests', 'providerPerInvocation'] as const)('rejects missing/excessive budget %s', key => {
    const f = fixture(); Object.assign(f.manifest.budgets, { [key]: 100000 }); expect(f.seal).toThrow();
    Reflect.deleteProperty(f.manifest.budgets, key); expect(f.seal).toThrow();
  });
  it('rejects inconsistent totals and excessive lane budget', () => {
    const f = fixture(); f.manifest.budgets.items--; expect(f.seal).toThrow();
    f.manifest.budgets.items++; f.manifest.budgets.lanes.PAYMENT_WEBHOOKS = 3; expect(f.seal).toThrow();
  });
  it.each(['migrate', 'refund', 'start-scheduler', 'live-payment'])('rejects unsupported operation %s', name => {
    const f = fixture(); f.manifest.operations = [name]; expect(f.seal).toThrow();
  });
  it.each(['databaseUrl', 'password', 'secretKey', 'profileOverride', 'targetOverride'])('rejects unexpected field %s', key => {
    const f = fixture(); Object.assign(f.manifest, { [key]: 'synthetic-only' }); expect(f.seal).toThrow();
  });
  it('rejects an unreviewed profile and nested target overrides', () => {
    const f = fixture(); Object.assign(f.manifest, { profileId: 'caller-selected-profile' }); expect(f.seal).toThrow();
    const g = fixture(); Object.assign(g.manifest.target, { databaseUrl: 'synthetic-not-a-connection' }); expect(g.seal).toThrow();
  });
  it.each([{ mode: 'live' }, { accountId: '' }, { webhookEndpointId: '' },
    { secretKey: 'sk_live_SyntheticNeverUse' }, { secretKey: 'sk_test_SyntheticNeverUse' }])
  ('rejects unsafe or ambiguous manifest Stripe fields %#', change => {
    const f = fixture(); Object.assign(f.manifest.stripe, change); expect(f.seal).toThrow();
  });
  it('rejects duplicate/unsorted operations and fixture ambiguity', () => {
    const f = fixture(); f.manifest.operations.push('prepare-booking'); expect(f.seal).toThrow();
    f.manifest.operations.pop(); f.manifest.fixtures.unitId = f.manifest.fixtures.guestId; expect(f.seal).toThrow();
  });
  it.each([
    { mode: 'live' }, { livemode: true }, { accountId: 'acct_other' }, { webhookEndpointId: 'we_other' },
    { apiVersion: 'latest' }, { secretKey: 'sk_live_SyntheticNeverUse' },
  ])('rejects unsafe Stripe evidence %#', change => {
    const f = fixture(); Object.assign(f.evidence.stripe, change); expect(f.seal).toThrow();
  });
  it.each(['authority', 'history', 'docker', 'database', 'stripe'] as const)('requires evidence %s', key => {
    const f = fixture(); Reflect.deleteProperty(f.evidence, key); expect(() => sealAcceptanceRun(canonicalRunJson(f.manifest), f.evidence, source, migrations)).toThrow();
  });
  it('rejects ambiguous approval, wrong manifest hash and missing manifest fields', () => {
    const f = fixture(); f.evidence.authority.approvalReference = 'review:stage-2c:another-review-0001'; expect(f.seal).toThrow();
    const g = fixture(); g.evidence.authority.manifestDigest = 'e'.repeat(64);
    expect(() => sealAcceptanceRun(canonicalRunJson(g.manifest), g.evidence, source, migrations)).toThrow();
    Reflect.deleteProperty(g.manifest, 'runId'); expect(g.seal).toThrow();
  });
  it.each(['internal', 'soleNetwork', 'soleContainer', 'dedicatedVolume', 'independentCredentials'] as const)
  ('requires Docker property %s', key => {
    const f = fixture(); Object.assign(f.evidence.docker, { [key]: false }); expect(f.seal).toThrow();
  });
  it('rejects endpoint, image, identity and schema drift', () => {
    for (const change of [{ address: '127.0.0.1' }, { image: 'postgres:latest' }, { publishedPorts: 1 },
      { imageId: `sha256:${'d'.repeat(64)}` }, { containerId: 'e'.repeat(64) }]) {
      const f = fixture(); Object.assign(f.evidence.docker, change); expect(f.seal).toThrow();
    }
    const f = fixture(); Object.assign(f.evidence.database, { migrationCount: 35 }); expect(f.seal).toThrow();
  });
  it('deep-freezes a detached result and rejects copied seals', () => {
    const f = fixture(), result = f.seal();
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.target)).toBe(true);
    expect(Object.isFrozen(result.budgets.lanes)).toBe(true); expect(Object.isFrozen(result.operations)).toBe(true);
    expect(Reflect.set(result.target, 'database', 'zemaitija_dev')).toBe(false);
    expect(() => (result.operations as unknown as string[]).push('migrate')).toThrow();
    f.manifest.target.database = 'changed'; f.evidence.docker.database = 'changed';
    expect(result.target.database).toBe(freshAcceptanceNames(runId).database);
    expect(() => requireSealedAcceptanceRun(structuredClone(result))).toThrow();
  });
  it('rejects noncanonical JSON, duplicate keys and ambiguous artifact encodings', () => {
    const f = fixture(), text = canonicalRunJson(f.manifest);
    for (const input of [text + '\n', `{"version":1,${text.slice(1)}`, 'null', '{'])
      expect(() => sealAcceptanceRun(input, f.evidence, source, migrations)).toThrow();
    expect(() => artifactDigest('source', [source[0], source[0]])).toThrow();
    expect(() => artifactDigest('source', [{ ...source[0], path: 'src/../.env.local' }])).toThrow();
    expect(artifactDigest('source', source)).not.toBe(artifactDigest('source', [{ ...source[0], bytes: Buffer.from('synthetic source\r\n') }]));
  });
  it('accepts no factories and constructs no resources for rejected validation', () => {
    const f = fixture(), constructDatabase = vi.fn(() => { throw Error('forbidden'); }), constructStripe = vi.fn();
    Object.assign(f.evidence, { constructDatabase, constructStripe });
    expect(f.seal).toThrow(); expect(constructDatabase).not.toHaveBeenCalled(); expect(constructStripe).not.toHaveBeenCalled();
  });
  it('leaves the existing automation foundation hard inactive', () => {
    const trap = () => { throw Error('activation forbidden'); };
    const result = runStripeAutomationFoundation({} as never, { constructDatabase: trap, constructStripe: trap });
    expect(result).toMatchObject({ status: 'INACTIVE', processingEnabled: false });
    const current = readFileSync('src/server/stripe-acceptance.ts', 'utf8');
    expect(current).not.toContain('stripe-acceptance-run');
    expect(readFileSync('src/server/stripe-acceptance-http.ts', 'utf8')).not.toContain('stripe-acceptance-run');
  });
});
