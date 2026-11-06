import { readFileSync } from 'node:fs';
import { vi } from 'vitest';
import pinned from '../../scripts/stripe-automation-migration-manifest.json';
import { canonicalRunJson, runManifestDigest, sealAcceptanceRun, type SealedAcceptanceRun } from '../../src/server/stripe-acceptance-run';
import { reviewFreshIntegration, integrationResources, type IntegrationApproval, type ProtectedDescriptor,
  type ProtectedDescriptorIO } from '../../src/server/stripe-acceptance-trust';
import { anchoredEvidence, durableProviderBudget, type AtomicEvidenceCell, type ProtectedHeadPort } from '../../src/server/stripe-acceptance-durable';
import { FRESH_IDENTITY_SQL, FRESH_READER_PRIVILEGES_SQL, freshDatabase, type FreshSqlSession, type FreshRole } from '../../src/server/stripe-acceptance-fresh-database';
import { scenarioRun } from './stripe-acceptance-scenario-fixture';
import { syntheticId } from './stripe-verifier-fixture';

export function integrationFixture(scope: IntegrationApproval['scope'] = 'G3_EXECUTION', suppliedRun?: SealedAcceptanceRun) {
  const base = scenarioRun();
  const source = [{ path: 'src/server/synthetic.ts', bytes: Buffer.from('synthetic source\n') }];
  const migrations = ['scripts/stripe-automation-migration-manifest.json', 'drizzle/meta/_journal.json',
    ...pinned.entries.map(e => `drizzle/${e.tag}.sql`)].sort().map(path => ({ path, bytes: readFileSync(path) }));
  const m = { ...base, operations: ['dispatch-checkout', 'ingest-payment-webhook', 'prepare-booking', 'reconcile-payment', 'verify-read-only'] };
  const run = suppliedRun ?? sealAcceptanceRun(canonicalRunJson(m), { now: '2035-01-01T00:01:00.000Z',
    authority: { issuer: 'protected-host-review-v1', runId: m.runId, approvalReference: m.approvalReference,
      manifestDigest: runManifestDigest(canonicalRunJson(m)), sourceDigest: m.sourceDigest, migrationDigest: m.migrationDigest,
      sourcePaths: source.map(f => f.path) }, history: { complete: true, runIds: [], resourceIdentities: [] },
    docker: { ...m.target, running: true, privileged: false, addedCapabilities: 0, internal: true, driver: 'bridge',
      soleNetwork: true, soleContainer: true, dedicatedVolume: true, unexpectedMounts: false, publishedPorts: 0, independentCredentials: true },
    database: { database_name: m.target.database, role_name: m.target.role, session_role: m.target.role,
      database_owner: m.target.owner, server_address: m.target.address, server_port: 5432, server_version: 170006,
      in_recovery: false, superuser: false, create_database: false, create_role: false, replication: false,
      bypass_rls: false, has_memberships: false, database_create: false, schema_create: false,
      recoveryMetadataUpdate: false, publicRecoveryExecute: false, recoveryDefinerOwner: m.target.owner,
      recoverySearchPath: 'pg_catalog, public', recoveryGuardsValid: true, inventoryExclusionValid: true,
      financialConstraintsValid: true, migrationCount: 36, migrationDigest: m.migrationDigest }, stripe: { ...m.stripe, livemode: false } }, source, migrations);
  const manifestText = canonicalRunJson(run);
  const supplemental = readFileSync('docs/proposals/STAGE_2C_CONSOLIDATED_RUN_1_EVIDENCE.sql');
  const approval: IntegrationApproval = { kind: 'fresh-integration-review-v1', runId: run.runId,
    manifestDigest: runManifestDigest(manifestText), sourceDigest: run.sourceDigest, migrationDigest: run.migrationDigest,
    supplementalDigest: runManifestDigest(supplemental.toString('utf8')), sourcePaths: source.map(f => f.path),
    dependencyClosureReviewed: true, profileId: run.profileId, supplementalProfile: 'stage2c-evidence-v1-proposal',
    reviewer: 'synthetic-independent-controller', approvalReference: run.approvalReference,
    notBefore: Date.parse(run.notBefore), expiresAt: Date.parse(run.expiresAt), scope,
    bootstrapRequests: 1, bootstrapIncludedInTotal: true };
  const review = reviewFreshIntegration(manifestText, approval, source, migrations, supplemental);
  let now = approval.notBefore + 60000, authorityValid = true, held = true;
  const authority = { verify: vi.fn(async () => ({ runId: run.runId, manifestDigest: approval.manifestDigest,
    supplementalDigest: approval.supplementalDigest, reservedResources: [...integrationResources(review)],
    exclusive: true, liveDockerVerified: true, credentialsIndependentVerified: true,
    livePostgresCapabilitiesVerified: true,
    accountId: run.stripe.accountId, stripeAccountVerified: scope === 'G3_EXECUTION',
    notBefore: approval.notBefore, expiresAt: approval.expiresAt, revoked: !authorityValid })) };
  const disk = memoryEvidence(), ledger = anchoredEvidence(review, disk.cell, disk.head);
  const budget = durableProviderBudget(review, ledger, { now: () => now, authority, locksHeld: async () => held });
  const identity = (role: FreshRole) => ({ database_name: run.target.database, role_name: role, session_role: role,
    server_address: run.target.address, server_port: 5432, server_version: 170006, database_owner: run.target.owner,
    in_recovery: false, superuser: false, create_database: false, create_role: false, replication: false,
    bypass_rls: false, has_memberships: false, database_create: false, schema_create: false });
  const identityChanges: Record<string, unknown> = {};
  const statements: string[] = [];
  let reply: (sql: string, values?: readonly unknown[]) => Promise<Record<string, unknown>[]> = async () => [];
  const destroy = vi.fn(async () => {});
  const connector = { open: vi.fn(async (options: { user: FreshRole }): Promise<FreshSqlSession> => ({
    query: vi.fn(async (sql, values) => {
      statements.push(sql);
      return { rows: sql === FRESH_IDENTITY_SQL ? [{ ...identity(options.user), ...identityChanges }] : sql === FRESH_READER_PRIVILEGES_SQL ? [{ safe: identityChanges.read_safe ?? true }] : await reply(sql, values) };
    }), destroy,
  })) };
  const db = freshDatabase(review, { now: () => now, authority, connector });
  return { run, review, approval, source, migrations, supplemental, manifestText, authority, disk, ledger, budget,
    now: () => now, advance: (ms: number) => { now += ms; }, revoke: () => { authorityValid = false; }, loseLock: () => { held = false; },
    connector, identityChanges, statements, destroy, db, reply: (r: typeof reply) => { reply = r; } };
}

/** Durable disk and protected controller are simulated, independently restartable.
 * No defaults, real storage, filesystem writes or infrastructure exist. */
export function memoryEvidence() {
  let revision = 0, image: unknown = { entries: [] }, fenced = false;
  let checkpoint = { revision: 0, digest: '0'.repeat(64), fenced: false };
  let fail: 'NONE' | 'BEFORE_COMMIT' | 'AFTER_COMMIT' | 'HEAD' = 'NONE';
  const cell: AtomicEvidenceCell = {
    read: vi.fn(async () => structuredClone({ revision, image, fenced })),
    compareAndSwap: vi.fn(async (expected, next) => {
      if (fenced) return 'UNKNOWN';
      if (expected !== revision) return 'CONFLICT';
      if (fail === 'BEFORE_COMMIT') return 'UNKNOWN';
      image = structuredClone(next); revision++;
      return fail === 'AFTER_COMMIT' ? 'UNKNOWN' : 'DURABLE';
    }), fence: vi.fn(async () => { fenced = true; }),
  };
  const head: ProtectedHeadPort = {
    read: vi.fn(async () => structuredClone(checkpoint)),
    compareAndSwap: vi.fn(async (old, next) => {
      if (fail === 'HEAD' || checkpoint.fenced) return 'UNKNOWN';
      if (old.revision !== checkpoint.revision || old.digest !== checkpoint.digest) return 'CONFLICT';
      checkpoint = { ...next, fenced: false }; return 'DURABLE';
    }), fence: vi.fn(async () => { checkpoint.fenced = true; }),
  };
  return { cell, head, failure: (f: typeof fail) => { fail = f; },
    corrupt: (next: unknown) => { image = next; }, truncateHead: () => { checkpoint.revision--; },
    state: () => structuredClone({ revision, image, fenced, checkpoint }) };
}

export function descriptorFixture(text: string | Record<string, string | Uint8Array>) {
  const opened: string[] = [], closed: string[] = [];
  let bad: 'NONE' | 'PARENT_OWNER' | 'PARENT_MODE' | 'LINK' | 'FILE_MODE' | 'FILE_OWNER' | 'MUTATED' | 'SIZE' = 'NONE';
  function handle(path: string, file = false): ProtectedDescriptor {
    const data = typeof text === 'string' ? text : text[path] ?? '';
    const bytes = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data);
    let stats = 0;
    return {
      async stat() {
        stats++;
        return { uid: bad === (file ? 'FILE_OWNER' : 'PARENT_OWNER') ? 1000 : 0,
          mode: file ? bad === 'FILE_MODE' ? 0o644 : 0o600 : bad === 'PARENT_MODE' ? 0o777 : 0o755,
          type: file ? 'file' : 'directory', links: bad === 'LINK' && file ? 2 : 1,
          identity: path, size: file ? bad === 'SIZE' ? 2 * 1024 * 1024 : bytes.length : 0,
          change: bad === 'MUTATED' && file && stats > 1 ? 'changed' : 'stable' };
      },
      async child(name, flags) {
        if (!flags.noFollow || !flags.readOnly) throw Error('UNSAFE_OPEN');
        const next = path === '/' ? `/${name}` : `${path}/${name}`; opened.push(next);
        return handle(next, !flags.directory);
      },
      async read(max) { if (bytes.length > max) throw Error('OVERSIZE'); return bytes; },
      async close() { closed.push(path); },
    };
  }
  const io: ProtectedDescriptorIO = { root: async () => handle('/') };
  return { io, opened, closed, bad: (v: typeof bad) => { bad = v; } };
}
export { syntheticId };
