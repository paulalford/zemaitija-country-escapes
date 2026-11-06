import { describe, expect, it } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import https from 'node:https';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { Pool, Client } from 'pg';
import Stripe from 'stripe';
import { privatePath, rejectedProbe } from './helpers/m19-offline-safety';
import { databaseSuites, deferredSuites, offlineSuites, validateOfflineArguments } from './helpers/m19-suite-selection';
import { m19DatabaseTarget, validateM19Target, M19_TARGET_REJECTED, type M19Identity, type M19Approval } from './helpers/m19-database-target';

const resource: M19Identity = { runId: '11111111-1111-4111-8111-111111111111',
  clusterId: '22222222-2222-4222-8222-222222222222', host: '127.0.0.1', port: 55440,
  database: 'zemaitija_m19_11111111111141118111111111111111_dev', schema: 'm19-baseline-through-0035',
  postgresVersion: 170006, migrationRole: 'zemaitija_migrator', runtimeRole: 'zemaitija_app' };
const approval: M19Approval = { reference: 'owner:m19:run2:synthetic-only', resource,
  notBefore: 1000, expiresAt: 2000, operations: ['synthetic-postgres-qa'],
  disposition: 'retain-on-failure-no-automatic-destruction' };
const url = (role: string, password: string) => `postgresql://${role}:${password}@127.0.0.1:55440/${resource.database}`;
const migration = url('zemaitija_migrator', 'synthetic-migration');
const runtime = url('zemaitija_app', 'synthetic-runtime');

describe('M19 offline selection rejects before collection', () => {
  it('keeps every reviewed integration and subprocess suite outside offline collection', () => {
    expect(databaseSuites).toHaveLength(12); expect(deferredSuites).toHaveLength(1);
    expect(new Set(offlineSuites).size).toBe(offlineSuites.length);
    for (const path of [...databaseSuites, ...deferredSuites]) expect(offlineSuites).not.toContain(path);
    validateOfflineArguments(['run', '--config', 'vitest.offline.config.mts', '--reporter=dot', offlineSuites[0]]);
  });
  it.each([...databaseSuites, ...deferredSuites, 'tests/unknown.test.ts', '../tests/milestone15.test.tsx',
    '--include=tests/**', '--setupFiles=unsafe.ts', '--watch', '--pool=forks', '--coverage', '--config=other.mts'])
  ('rejects mixed approved and unapproved selection: %s', path => {
    expect(() => validateOfflineArguments(['run', offlineSuites[0], path])).toThrow('M19_OFFLINE_ARGUMENT_NOT_ALLOWLISTED');
  });
  it('has no inherited operational values', () => {
    for (const name of ['DATABASE_URL', 'MIGRATION_DATABASE_URL', 'PGHOST', 'STRIPE_SECRET_KEY', 'ACCESS_SECRET', 'ADMIN_OIDC_CLIENT_SECRET'])
      expect(process.env[name]).toBeUndefined();
  });
});

describe('M19 negative safety probes perform no IO', () => {
  it.each([
    () => new net.Socket().connect(1, '127.0.0.1'),
    () => net.createServer().listen(0),
    () => tls.connect(443, 'synthetic.invalid'),
    () => https.request('https://synthetic.invalid'),
    () => fetch('https://synthetic.invalid'),
    () => childProcess.spawn('never-executed'),
    () => childProcess.execSync('never-executed'),
    () => process.loadEnvFile('.env.local'),
    () => fs.readFileSync('.env.local'),
    () => fs.openSync('/private/credential-backup', 'r'),
    () => new Worker('never-executed', { eval: true }),
    () => fs.writeFileSync('/tmp/m19-run1/never-written', 'synthetic'),
  ])('rejects resource probe %# before the underlying operation', probe => rejectedProbe(probe));
  it('rejects real database/provider constructors', () => {
    expect(() => new Pool()).toThrow('M19_REAL_DATABASE_CONSTRUCTOR_FORBIDDEN');
    expect(() => new Client()).toThrow('M19_REAL_DATABASE_CONSTRUCTOR_FORBIDDEN');
    expect(() => new Stripe('sk_test_synthetic')).toThrow('M19_REAL_PROVIDER_CONSTRUCTOR_FORBIDDEN');
  });
  it('classifies private paths without inspecting their existence or bytes', () => {
    for (const path of ['.env.local', '/x/.env', '/x/.aws/config', '/x/backup.txt', '/x/key.pem',
      Buffer.from('.env.local'), new URL('file:///private/%2eenv.local')]) expect(privatePath(path)).toBe(true);
    expect(privatePath('src/server/access.ts')).toBe(false);
  });
});

describe('M19 pure PostgreSQL target contract; never constructs a connection', () => {
  it('accepts only fully bound synthetic coordinates with distinct roles', () => {
    expect(validateM19Target(resource, approval, migration, runtime, 1500)).toEqual({ resource, migrationUrl: migration, runtimeUrl: runtime });
  });
  it.each(['zemaitija_dev', 'zemaitija_stripe_automation_dev', 'zemaitija_m16_phase_b_20261026_dev', 'zemaitija_m17_20261027_dev', 'other_dev'])
  ('rejects protected, retained or arbitrary database %s even if the record approves it', database => {
    const changed = { ...resource, database };
    expect(() => validateM19Target(changed, { ...approval, resource: changed }, migration, runtime, 1500)).toThrow(M19_TARGET_REJECTED);
  });
  it.each(['host', 'port', 'cluster', 'run', 'role', 'schema', 'version', 'expired', 'future', 'extra', 'operation', 'cleanup'])
  ('rejects mismatched or unsupported %s', kind => {
    const target: Record<string, unknown> = { ...resource }, grant = structuredClone(approval);
    if (kind === 'host') target.host = 'localhost';
    if (kind === 'port') target.port = 55441;
    if (kind === 'cluster') target.clusterId = '33333333-3333-4333-8333-333333333333';
    if (kind === 'run') target.runId = '33333333-3333-4333-8333-333333333333';
    if (kind === 'role') target.runtimeRole = 'postgres';
    if (kind === 'schema') target.schema = 'unreviewed';
    if (kind === 'version') target.postgresVersion = 170007;
    if (kind === 'expired') grant.expiresAt = 1500;
    if (kind === 'future') grant.notBefore = 1501;
    if (kind === 'extra') target.url = migration;
    if (kind === 'operation') (grant.operations as string[]) = ['live-stripe'];
    if (kind === 'cleanup') (grant as unknown as Record<string, unknown>).disposition = 'reset-on-failure';
    expect(() => validateM19Target(target, grant, migration, runtime, 1500)).toThrow(M19_TARGET_REJECTED);
  });
  it.each([
    [runtime, migration], [migration, migration], ['', runtime], [migration, ''],
    [migration + '?options=-csearch_path%3Devil', runtime],
    [migration.replace('55440', '55432'), runtime],
    [migration.replace('127.0.0.1', 'localhost'), runtime],
    [migration, runtime.replace('synthetic-runtime', 'synthetic-migration')],
    [migration, runtime.replace('synthetic-runtime', 'synthetic-migrati%6fn')],
  ])('rejects URL/role/default/option mismatch %# without leaking supplied values', (m, r) => {
    expect(() => validateM19Target(resource, approval, m, r, 1500)).toThrow(new Error(M19_TARGET_REJECTED));
  });
  it('requires explicit Run 2 authority before reading target or URL properties', () => {
    const env = { get M19_POSTGRES_TARGET(): string { throw Error('must not inspect'); }, DATABASE_URL: runtime };
    expect(() => m19DatabaseTarget(env)).toThrow(new Error(M19_TARGET_REJECTED));
    expect(() => m19DatabaseTarget({ M19_POSTGRES_EXECUTION: 'OWNER_APPROVED_RUN_2', DATABASE_URL: runtime })).toThrow(M19_TARGET_REJECTED);
  });
});
