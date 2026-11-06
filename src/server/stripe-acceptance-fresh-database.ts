import 'server-only';
import { z } from 'zod';
import pinnedMigrations from '../../scripts/stripe-automation-migration-manifest.json';
import { canonicalRunJson } from './stripe-acceptance-run';
import { acceptanceDigest, integrationResources, requireReviewedFreshIntegration, type ReviewedFreshIntegration } from './stripe-acceptance-trust';
import type { DockerEvidence } from './stripe-automation-target';

const fail = (): never => { throw Error('FRESH_DATABASE_REJECTED'); };
export const FRESH_ROLES = ['zemaitija_app', 'zec_acceptance_evidence_writer', 'zec_acceptance_lock',
  'zec_acceptance_status_reader', 'zec_acceptance_verifier_reader'] as const;
export type FreshRole = typeof FRESH_ROLES[number];
export interface FreshSqlSession {
  query(sql: string, values?: readonly unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  destroy(): Promise<void>;
}
/** Injected private credential/session capability; accepts NO URLs, env or pool.
 * It must implement bounded connect/query cancellation and discard on abort.
 * Only reviewed run-derived connection coordinates can be supplied. */
export interface FreshSessionConnector {
  open(options: Readonly<{ host: string; port: 5432; database: string; user: FreshRole;
    connectionTimeoutMillis: 1000; statement_timeout: 1000; lock_timeout: 500;
    idle_in_transaction_session_timeout: 1000; transaction_timeout: 10000; pipeline: false }>, signal: AbortSignal): Promise<FreshSqlSession>;
}
export interface FreshLiveAuthority {
  verify(): Promise<unknown>;
}
const grantSchema = z.object({ runId: z.uuid(), manifestDigest: z.string().regex(/^[a-f0-9]{64}$/),
  supplementalDigest: z.string().regex(/^[a-f0-9]{64}$/), reservedResources: z.array(z.string()).length(8),
  exclusive: z.literal(true), liveDockerVerified: z.literal(true), credentialsIndependentVerified: z.literal(true),
  livePostgresCapabilitiesVerified: z.literal(true),
  accountId: z.string(), stripeAccountVerified: z.boolean(),
  notBefore: z.number().int(), expiresAt: z.number().int(), revoked: z.literal(false) }).strict();
export async function requireFreshAuthority(review: ReviewedFreshIntegration, authority: FreshLiveAuthority,
  now: () => number, signal: AbortSignal) {
  requireReviewedFreshIntegration(review, now());
  if (review.approval.scope === 'SOURCE_REVIEW' || signal.aborted) return fail();
  const g = grantSchema.parse(await authority.verify()), n = now();
  requireReviewedFreshIntegration(review, n);
  if (signal.aborted || n < g.notBefore || n >= g.expiresAt || g.notBefore < review.approval.notBefore ||
    g.expiresAt > review.approval.expiresAt || g.runId !== review.manifest.runId ||
    g.manifestDigest !== review.approval.manifestDigest || g.supplementalDigest !== review.approval.supplementalDigest ||
    g.accountId !== review.manifest.stripe.accountId || review.approval.scope === 'G3_EXECUTION' && !g.stripeAccountVerified ||
    canonicalRunJson(g.reservedResources) !== canonicalRunJson(integrationResources(review))) return fail();
}

/** Read-only Docker metadata port. No CLI/socket/default reader is constructed. */
export async function attestFreshDocker(review: ReviewedFreshIntegration, reader: {
  read(names: Readonly<{ container: string; network: string; volume: string }>): Promise<DockerEvidence & {
    imageId: string; volumeIdentity: string; independentCredentials: boolean }>;
}, now: () => number) {
  requireReviewedFreshIntegration(review, now());
  const t = review.manifest.target;
  const e = await reader.read({ container: t.container, network: t.network, volume: t.volume });
  const c = e.container, n = e.network, v = e.volume, link = c.networks[t.network];
  requireReviewedFreshIntegration(review, now());
  if (c.id !== t.containerId || c.name !== t.container || c.image !== t.image || e.imageId !== t.imageId ||
    c.project !== t.project || c.service !== t.service || !c.running || c.privileged || (c.capAdd?.length ?? 0) !== 0 ||
    Object.values(c.configuredPorts).some(p => p !== null && p.length !== 0) ||
    Object.values(c.runtimePorts).some(p => p !== null && p.length !== 0) || Object.keys(c.networks).length !== 1 ||
    !link || link.id !== t.networkId || link.address !== t.address || n.id !== t.networkId || n.name !== t.network ||
    n.project !== t.project || !n.internal || n.driver !== 'bridge' || n.containers.length !== 1 || n.containers[0] !== t.containerId ||
    v.name !== t.volume || v.driver !== 'local' || v.project !== t.project || !v.mountpoint ||
    v.options !== null && Object.keys(v.options).length !== 0 || e.volumeIdentity !== t.volumeIdentity || !e.independentCredentials ||
    c.mounts.length !== 1 || c.mounts[0].type !== 'volume' || c.mounts[0].name !== t.volume ||
    c.mounts[0].source !== v.mountpoint || c.mounts[0].destination !== '/var/lib/postgresql/data' || !c.mounts[0].rw) return fail();
  return Object.freeze({ targetDigest: acceptanceDigest(t), observedAt: now(), containerId: c.id, networkId: n.id,
    volumeIdentity: e.volumeIdentity });
}

export const FRESH_IDENTITY_SQL = `SELECT current_database() database_name,current_user role_name,session_user session_role,
  host(inet_server_addr()) server_address,inet_server_port() server_port,
  current_setting('server_version_num')::int server_version,pg_is_in_recovery() in_recovery,
  pg_get_userbyid(d.datdba) database_owner,r.rolsuper superuser,r.rolcreatedb create_database,
  r.rolcreaterole create_role,r.rolreplication replication,r.rolbypassrls bypass_rls,
  has_database_privilege(current_user,current_database(),'CREATE') database_create,
  has_schema_privilege(current_user,'public','CREATE') schema_create,
  EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) has_memberships
  FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()`;
/** Effective mutation privileges, including column grants and SECURITY DEFINER
 * entry points, must be absent for both reader roles. This complements READ ONLY. */
export const FRESH_READER_PRIVILEGES_SQL = `SELECT (
  NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','zec_acceptance','drizzle') AND c.relkind IN ('r','p','v','m','f') AND
    (has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
     EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
       AND has_column_privilege(current_user,c.oid,a.attnum,'INSERT,UPDATE,REFERENCES'))))
  AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','zec_acceptance','drizzle') AND c.relkind='S'
    AND has_sequence_privilege(current_user,c.oid,'USAGE,UPDATE'))
  AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','zec_acceptance','drizzle') AND p.prosecdef
    AND p.prorettype NOT IN ('trigger'::regtype,'event_trigger'::regtype)
    AND has_function_privilege(current_user,p.oid,'EXECUTE'))
) safe`;
/** Construction alone opens nothing. Every session checks actual authenticated
 * identity before exposing any scoped adapter operation. No shared pool fallback. */
export function freshDatabase(review: ReviewedFreshIntegration, deps: { now: () => number;
  authority: FreshLiveAuthority; connector: FreshSessionConnector }) {
  return Object.freeze({ binding: Object.freeze({ runId: review.manifest.runId, manifestDigest: review.approval.manifestDigest,
    database: review.manifest.target.database }), async session<T>(role: FreshRole, signal: AbortSignal,
    operation: (session: FreshSqlSession) => Promise<T>): Promise<T> {
    if (!FRESH_ROLES.includes(role)) return fail();
    let session: FreshSqlSession | undefined;
    try {
      await requireFreshAuthority(review, deps.authority, deps.now, signal);
      const t = review.manifest.target;
      session = await deps.connector.open({ host: t.address, port: 5432, database: t.database, user: role,
        connectionTimeoutMillis: 1000, statement_timeout: 1000, lock_timeout: 500,
        idle_in_transaction_session_timeout: 1000, transaction_timeout: 10000, pipeline: false }, signal);
      await session.query('BEGIN READ ONLY');
      const { rows } = await session.query(FRESH_IDENTITY_SQL), r = rows[0];
      if (rows.length !== 1 || r.database_name !== t.database || r.role_name !== role || r.session_role !== role ||
        r.server_address !== t.address || r.server_port !== 5432 || r.server_version !== 170006 ||
        r.database_owner !== t.owner || ['in_recovery', 'superuser', 'create_database', 'create_role', 'replication',
          'bypass_rls', 'has_memberships', 'database_create', 'schema_create'].some(k => r[k] !== false)) return fail();
      if (role === 'zec_acceptance_verifier_reader' || role === 'zec_acceptance_status_reader') {
        const permissions = await session.query(FRESH_READER_PRIVILEGES_SQL);
        if (permissions.rows.length !== 1 || permissions.rows[0].safe !== true) return fail();
      }
      await session.query('ROLLBACK');
      await requireFreshAuthority(review, deps.authority, deps.now, signal);
      const raw = session;
      const guarded: FreshSqlSession = { destroy: () => raw.destroy(), async query(sql, values) {
        await requireFreshAuthority(review, deps.authority, deps.now, signal);
        const result = await raw.query(sql, values);
        await requireFreshAuthority(review, deps.authority, deps.now, signal);
        return result;
      } };
      return await operation(guarded);
    } catch { return fail(); }
    finally { await session?.destroy(); }
  } });
}
export type FreshDatabase = ReturnType<typeof freshDatabase>;

/** Atomic whole-image CAS for the separate evidence schema. Financial tables are
 * inaccessible to this role. SQL functions are an UNAPPROVED deployment proposal. */
export function postgresEvidencePort(review: ReviewedFreshIntegration, db: FreshDatabase,
  kind: 'supervision' | 'provider' | 'admission', signal: AbortSignal) {
  if (!['supervision', 'provider', 'admission'].includes(kind) || db.binding.runId !== review.manifest.runId ||
    db.binding.manifestDigest !== review.approval.manifestDigest) return fail();
  const key = `${review.manifest.runId}:${kind}`;
  return {
    async read() {
      return db.session('zec_acceptance_evidence_writer', signal, async s => {
        const r = await s.query('SELECT revision, image, fenced FROM zec_acceptance.read_cell($1)', [key]);
        if (r.rows.length !== 1) return fail();
        const row = r.rows[0], revision = typeof row.revision === 'string' && /^(0|[1-9]\d*)$/.test(row.revision)
          ? Number(row.revision) : row.revision;
        if (!Number.isSafeInteger(revision) || Number(revision) < 0 || typeof row.fenced !== 'boolean') return fail();
        return { revision, image: row.image, fenced: row.fenced };
      });
    },
    async compareAndSwap(revision: number, image: unknown): Promise<'DURABLE' | 'CONFLICT' | 'UNKNOWN'> {
      try {
        if (!Number.isSafeInteger(revision) || revision < 0) return fail();
        return await db.session('zec_acceptance_evidence_writer', signal, async s => {
          const r = await s.query('SELECT zec_acceptance.cas_cell($1,$2,$3::jsonb) accepted', [key, revision, canonicalRunJson(image)]);
          if (r.rows.length !== 1 || typeof r.rows[0].accepted !== 'boolean') return 'UNKNOWN';
          return r.rows[0].accepted ? 'DURABLE' : 'CONFLICT';
        });
      } catch { return 'UNKNOWN'; }
    },
    async fence() {
      await db.session('zec_acceptance_evidence_writer', signal, async s => {
        const r = await s.query('SELECT zec_acceptance.fence_cell($1) fenced', [key]);
        if (r.rows.length !== 1 || r.rows[0].fenced !== true) return fail();
      });
    },
  };
}

/** Independently queried baseline ledger and supplemental binding, never a
 * replacement aggregate hash or an automatically applied migration. */
export async function attestFreshPostgresLedger(review: ReviewedFreshIntegration, db: FreshDatabase, signal: AbortSignal) {
  if (db.binding.manifestDigest !== review.approval.manifestDigest) return fail();
  return db.session('zec_acceptance_verifier_reader', signal, async s => {
    await s.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try {
      const ledger = await s.query('SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at,id');
      if (ledger.rows.length !== 36 || ledger.rows.some((r, i) => r.hash !== pinnedMigrations.entries[i].sha256 ||
        r.created_at !== String(pinnedMigrations.entries[i].when))) return fail();
      const profile = await s.query('SELECT run_id,manifest_digest,baseline_digest,supplemental_digest,approval_reference,profile FROM zec_acceptance.profile_binding WHERE singleton');
      const row = profile.rows[0];
      if (profile.rows.length !== 1 || row.run_id !== review.manifest.runId || row.manifest_digest !== review.approval.manifestDigest ||
        row.baseline_digest !== review.manifest.migrationDigest || row.supplemental_digest !== review.approval.supplementalDigest ||
        row.approval_reference !== review.approval.approvalReference || row.profile !== 'stage2c-evidence-v1-proposal') return fail();
      return Object.freeze({ baselineCount: 36, supplementalDigest: row.supplemental_digest });
    } finally { await s.query('ROLLBACK'); }
  });
}
