import 'server-only';
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';
import pinnedMigrations from '../../scripts/stripe-automation-migration-manifest.json';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
const approvalReference = z.string().regex(/^review:stage-2c:[a-z0-9][a-z0-9-]{15,79}$/);
const instant = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine(s => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s);
const privateAddress = z.string().refine(s => isIP(s) === 4 && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(s));
const resourceId = z.string().regex(/^[a-f0-9]{64}$/);
const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const accountId = z.string().regex(/^acct_[A-Za-z0-9]+$/);
const endpointId = z.string().regex(/^we_[A-Za-z0-9]+$/);
const apiVersion = z.literal('2026-08-26.dahlia');
const operation = z.enum(['prepare-booking', 'dispatch-checkout', 'ingest-payment-webhook', 'reconcile-payment', 'verify-read-only']);
const fail = (): never => { throw new Error('FRESH_ACCEPTANCE_CONTRACT_REJECTED'); };

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Canonical JSON: ASCII schema keys sorted lexically, array order preserved,
 * JSON.stringify scalar encoding, UTF-8, no whitespace/BOM/final newline. */
export function canonicalRunJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalRunJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    if (Object.getPrototypeOf(value) !== Object.prototype) return fail();
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map(k => `${JSON.stringify(k)}:${canonicalRunJson(object[k])}`).join(',')}}`;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean' ||
    typeof value === 'number' && Number.isSafeInteger(value)) return JSON.stringify(value);
  return fail();
}
export const runManifestDigest = (canonicalText: string): string => createHash('sha256').update(canonicalText, 'utf8').digest('hex');

export type ArtifactFile = Readonly<{ path: string; bytes: Uint8Array }>;
/** No IO. Exact raw file bytes; no line-ending or Unicode normalization. The
 * trusted approval pins the resulting digest AND the complete ordered path set. */
export function artifactDigest(kind: 'source' | 'migrations', files: readonly ArtifactFile[]): string {
  if (!['source', 'migrations'].includes(kind) || files.length === 0 || files.length > 4096) return fail();
  const hash = createHash('sha256').update(`zec-acceptance-${kind}-v1\n`);
  let previous = '';
  for (const file of files) {
    if (!(/^(src|scripts|tests|drizzle)\/[A-Za-z0-9_./-]+\.(ts|tsx|mts|mjs|json|sql)$/.test(file.path) ||
      /^(package(-lock)?\.json|tsconfig\.json|vitest\.config\.mts)$/.test(file.path)) ||
      file.path.split('/').some(p => p === '' || p === '.' || p === '..' || p === 'node_modules') ||
      file.path <= previous || !(file.bytes instanceof Uint8Array)) return fail();
    const path = Buffer.from(file.path, 'utf8');
    hash.update(`${path.length}:`).update(path).update(`${file.bytes.byteLength}:`).update(file.bytes);
    previous = file.path;
  }
  return hash.digest('hex');
}

export const FRESH_ACCEPTANCE_PROFILE = freeze({
  id: 'stage-2c-fresh-pg17-v1', postgresMajor: 17, serverVersion: 170006,
  image: 'postgres:17.6', owner: 'zemaitija_migrator', role: 'zemaitija_app', port: 5432,
  schema: 'public', migrationCount: 36, lastMigration: '0035_payment_recovery_schedule',
  pinnedManifestSha256: 'c1ed48f3e7f730e641a98d8357e2e61e7a24b66da2c6ed26b21544d2f08d4abc',
  capabilities: ['full-pinned-ledger', 'recovery-functions-0035', 'inventory-exclusion', 'financial-idempotency'],
} as const);

/** Only the UUID varies; no caller-selected database/resource names or endpoint. */
export function freshAcceptanceNames(runId: string) {
  const suffix = uuid.parse(runId).replaceAll('-', '');
  const prefix = `zec-acceptance-${suffix}`;
  return freeze({ project: prefix, service: 'acceptance-db', container: `${prefix}-db`,
    network: `${prefix}-internal`, volume: `zec_acceptance_${suffix}_data`,
    database: `zec_acceptance_${suffix}`, owner: FRESH_ACCEPTANCE_PROFILE.owner, role: FRESH_ACCEPTANCE_PROFILE.role });
}

const names = z.object({ project: z.string(), service: z.string(), container: z.string(), network: z.string(),
  volume: z.string(), database: z.string(), owner: z.literal('zemaitija_migrator'), role: z.literal('zemaitija_app') }).strict();
const target = z.object({ ...names.shape, containerId: resourceId, networkId: resourceId, volumeIdentity: uuid,
  image: z.literal('postgres:17.6'), imageId, address: privateAddress, port: z.literal(5432) }).strict();
const budgets = z.object({ invocations: z.number().int().min(1).max(30), items: z.number().int().min(1).max(150),
  providerRequests: z.number().int().min(1).max(1800), providerPerInvocation: z.number().int().min(1).max(60),
  lanes: z.object({ PAYMENT_WEBHOOKS: z.number().int().min(1).max(2), CHECKOUT_COMMAND_RECOVERY: z.literal(1),
    INITIAL_RECONCILIATION: z.literal(1), BALANCE_RECONCILIATION: z.literal(1), DEFERRED_INVESTIGATION: z.literal(0) }).strict(),
}).strict();
const manifestSchema = z.object({ version: z.literal(1), runId: uuid, approvalReference,
  profileId: z.literal('stage-2c-fresh-pg17-v1'), target,
  sourceDigest: digest, migrationDigest: digest,
  stripe: z.object({ mode: z.literal('test'), accountId, webhookEndpointId: endpointId, apiVersion }).strict(),
  operations: z.array(operation).min(1).max(5),
  issuedAt: instant, notBefore: instant, expiresAt: instant,
  fixtures: z.object({ namespace: z.string(), guestId: uuid, unitId: uuid, bookingOperationId: uuid }).strict(),
  budgets,
}).strict();
type Manifest = z.infer<typeof manifestSchema>;
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type SealedAcceptanceRun = DeepReadonly<Manifest>;

const authoritySchema = z.object({ issuer: z.literal('protected-host-review-v1'), approvalReference, runId: uuid,
  manifestDigest: digest, sourceDigest: digest, migrationDigest: digest,
  sourcePaths: z.array(z.string()).min(1).max(4096),
}).strict();
const historySchema = z.object({ complete: z.literal(true), runIds: z.array(uuid),
  resourceIdentities: z.array(z.string().min(1)),
}).strict();
const databaseSchema = z.object({ database_name: z.string(), role_name: z.literal('zemaitija_app'),
  session_role: z.literal('zemaitija_app'), database_owner: z.literal('zemaitija_migrator'),
  server_address: privateAddress, server_port: z.literal(5432), server_version: z.literal(170006),
  in_recovery: z.literal(false), superuser: z.literal(false), create_database: z.literal(false),
  create_role: z.literal(false), replication: z.literal(false), bypass_rls: z.literal(false),
  has_memberships: z.literal(false), database_create: z.literal(false), schema_create: z.literal(false),
  recoveryMetadataUpdate: z.literal(false), publicRecoveryExecute: z.literal(false),
  recoveryDefinerOwner: z.literal('zemaitija_migrator'), recoverySearchPath: z.literal('pg_catalog, public'),
  recoveryGuardsValid: z.literal(true), inventoryExclusionValid: z.literal(true), financialConstraintsValid: z.literal(true),
  migrationCount: z.literal(36), migrationDigest: digest,
}).strict();
const evidenceSchema = z.object({ now: instant, authority: authoritySchema, history: historySchema,
  docker: target.extend({ running: z.literal(true), privileged: z.literal(false), addedCapabilities: z.literal(0),
    internal: z.literal(true), driver: z.literal('bridge'), soleNetwork: z.literal(true),
    soleContainer: z.literal(true), dedicatedVolume: z.literal(true), unexpectedMounts: z.literal(false),
    publishedPorts: z.literal(0), independentCredentials: z.literal(true),
  }).strict(), database: databaseSchema,
  stripe: z.object({ mode: z.literal('test'), livemode: z.literal(false), accountId,
    webhookEndpointId: endpointId, apiVersion }).strict(),
}).strict();
export type AcceptanceRunEvidence = z.input<typeof evidenceSchema>;
const sealed = new WeakSet<object>();

function verifyMigrations(files: readonly ArtifactFile[]) {
  const expectedPaths = ['scripts/stripe-automation-migration-manifest.json', 'drizzle/meta/_journal.json',
    ...pinnedMigrations.entries.map(e => `drizzle/${e.tag}.sql`)].sort();
  if (canonicalRunJson(files.map(f => f.path)) !== canonicalRunJson(expectedPaths)) return fail();
  const byPath = new Map(files.map(f => [f.path, f.bytes]));
  const raw = byPath.get('scripts/stripe-automation-migration-manifest.json')!;
  if (createHash('sha256').update(raw).digest('hex') !== FRESH_ACCEPTANCE_PROFILE.pinnedManifestSha256) return fail();
  const journal = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(byPath.get('drizzle/meta/_journal.json'))) as unknown;
  const expectedJournal = { version: '7', dialect: 'postgresql', entries: pinnedMigrations.entries.map(entry => {
    const { sha256: unused, ...rest } = entry; void unused; return rest;
  }) };
  if (canonicalRunJson(journal) !== canonicalRunJson(expectedJournal)) return fail();
  for (const entry of pinnedMigrations.entries) {
    if (createHash('sha256').update(byPath.get(`drizzle/${entry.tag}.sql`)!).digest('hex') !== entry.sha256) return fail();
  }
}

/** Static pre-seal review for budgeted bootstrap. This does NOT issue a seal,
 * assert provider identity, connect, or grant execution authority. */
export function reviewAcceptanceManifest(text: string, authority: unknown,
  sourceFiles: readonly ArtifactFile[], migrationFiles: readonly ArtifactFile[]): SealedAcceptanceRun {
  try {
    if (Buffer.byteLength(text) > 16384 || canonicalRunJson(JSON.parse(text)) !== text) return fail();
    const m = manifestSchema.parse(JSON.parse(text)), a = authoritySchema.parse(authority);
    if (m.runId !== a.runId || m.approvalReference !== a.approvalReference || runManifestDigest(text) !== a.manifestDigest ||
      m.sourceDigest !== a.sourceDigest || m.migrationDigest !== a.migrationDigest ||
      artifactDigest('source', sourceFiles) !== m.sourceDigest || artifactDigest('migrations', migrationFiles) !== m.migrationDigest ||
      canonicalRunJson(a.sourcePaths) !== canonicalRunJson(sourceFiles.map(f => f.path))) return fail();
    verifyMigrations(migrationFiles);
    const derived = freshAcceptanceNames(m.runId);
    if (Object.entries(derived).some(([k, v]) => m.target[k as keyof typeof m.target] !== v) ||
      m.target.containerId === m.target.networkId || new Set(m.operations).size !== m.operations.length ||
      [...m.operations].sort().join() !== m.operations.join() || m.fixtures.namespace !== `stage2c:${m.runId}` ||
      new Set([m.fixtures.guestId, m.fixtures.unitId, m.fixtures.bookingOperationId]).size !== 3 ||
      Date.parse(m.issuedAt) > Date.parse(m.notBefore) || Date.parse(m.notBefore) - Date.parse(m.issuedAt) > 1800000 ||
      Date.parse(m.expiresAt) <= Date.parse(m.notBefore) || Date.parse(m.expiresAt) - Date.parse(m.notBefore) > 1800000 ||
      m.budgets.items !== m.budgets.invocations * Object.values(m.budgets.lanes).reduce((s, n) => s + n, 0) ||
      m.budgets.providerRequests !== m.budgets.invocations * m.budgets.providerPerInvocation) return fail();
    return freeze(m) as SealedAcceptanceRun;
  } catch { return fail(); }
}

/** Pure contract validation, never execution authority. Evidence must come from
 * a future trusted host launcher, not HTTP/env JSON. No factories or IO accepted. */
export function sealAcceptanceRun(text: string, evidence: unknown, sourceFiles: readonly ArtifactFile[],
  migrationFiles: readonly ArtifactFile[]): SealedAcceptanceRun {
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 16384) return fail();
    const parsed: unknown = JSON.parse(text);
    if (canonicalRunJson(parsed) !== text) return fail(); // Also rejects duplicate JSON keys.
    const m = manifestSchema.parse(parsed), e = evidenceSchema.parse(evidence), a = e.authority;
    if (runManifestDigest(text) !== a.manifestDigest || m.approvalReference !== a.approvalReference || m.runId !== a.runId ||
      m.sourceDigest !== a.sourceDigest || m.migrationDigest !== a.migrationDigest ||
      artifactDigest('source', sourceFiles) !== m.sourceDigest || artifactDigest('migrations', migrationFiles) !== m.migrationDigest ||
      canonicalRunJson(sourceFiles.map(f => f.path)) !== canonicalRunJson(a.sourcePaths)) return fail();
    verifyMigrations(migrationFiles);
    const now = Date.parse(e.now), start = Date.parse(m.notBefore), end = Date.parse(m.expiresAt);
    if (Date.parse(m.issuedAt) > start || start > now || now >= end || end <= start || end - start > 30 * 60_000 ||
      start - Date.parse(m.issuedAt) > 30 * 60_000) return fail();
    if (canonicalRunJson(freshAcceptanceNames(m.runId)) !== canonicalRunJson(Object.fromEntries(
      Object.keys(names.shape).map(k => [k, m.target[k as keyof typeof m.target]])))) return fail();
    const { running, privileged, addedCapabilities, internal, driver, soleNetwork, soleContainer, dedicatedVolume,
      unexpectedMounts, publishedPorts, independentCredentials, ...observedTarget } = e.docker;
    void [running, privileged, addedCapabilities, internal, driver, soleNetwork, soleContainer, dedicatedVolume,
      unexpectedMounts, publishedPorts, independentCredentials];
    if (canonicalRunJson(m.target) !== canonicalRunJson(observedTarget)) return fail();
    const resources = [m.target.project, m.target.container, m.target.network, m.target.volume,
      m.target.database, m.target.containerId, m.target.networkId, m.target.volumeIdentity];
    if (e.history.runIds.includes(m.runId) || resources.some(r => e.history.resourceIdentities.includes(r)) ||
      new Set([m.target.containerId, m.target.networkId]).size !== 2) return fail();
    const db = e.database;
    if (db.database_name !== m.target.database || db.server_address !== m.target.address || db.migrationDigest !== m.migrationDigest ||
      e.stripe.accountId !== m.stripe.accountId || e.stripe.webhookEndpointId !== m.stripe.webhookEndpointId) return fail();
    if (new Set(m.operations).size !== m.operations.length || [...m.operations].sort().join() !== m.operations.join() ||
      m.fixtures.namespace !== `stage2c:${m.runId}` || new Set(Object.values(m.fixtures).slice(1)).size !== 3) return fail();
    const b = m.budgets, laneItems = Object.values(b.lanes).reduce((sum, n) => sum + n, 0);
    if (b.items !== b.invocations * laneItems || b.providerRequests !== b.invocations * b.providerPerInvocation) return fail();
    const result = freeze(m) as SealedAcceptanceRun;
    sealed.add(result); return result;
  } catch { return fail(); } // No untrusted fields, credentials or parser errors in diagnostics.
}

/** Clones, deserialized JSON and structurally matching objects are not sealed. */
export function requireSealedAcceptanceRun(value: SealedAcceptanceRun): void {
  if (!sealed.has(value)) return fail();
}
