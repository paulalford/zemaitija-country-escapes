import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { requireAttestedTarget, type AttestedTarget } from './stripe-automation-target';

type Environment = Readonly<Record<string, string | undefined>>;
export type AutomationFailure = 'DISABLED' | 'CONFIGURATION' | 'UNAUTHORIZED' | 'REQUEST_PARAMETERS' |
  'DATABASE_IDENTITY' | 'DATABASE_UNAVAILABLE' | 'STAGE_2A_INACTIVE';
export class AutomationError extends Error {
  constructor(readonly code: AutomationFailure) { super(code); }
}
export const AUTOMATION_TARGET = Object.freeze({
  database: 'zemaitija_stripe_automation_dev', host: '127.0.0.1', port: 55433,
  role: 'zemaitija_app', owner: 'zemaitija_migrator', serverPort: 5432,
});
export type AutomationConfig = Readonly<{
  enabled: true;
  environment: 'isolated-development';
  deployment: 'local';
  nodeEnvironment: 'development' | 'test';
  database: Omit<typeof AUTOMATION_TARGET,'host'|'port'> & Readonly<{host:string;port:number}>;
  target?: AttestedTarget;
  serverAddress: string;
  expectedStripeAccount: string;
  /** Fixed-length digest only; never serialize configuration into logs/responses. */
  credentialDigest: string;
}>;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = (): never => { throw new AutomationError('CONFIGURATION'); };
const required = (env: Environment, name: string): string => {
  const value = env[name];
  if (!value || value.trim() !== value) return invalid();
  return value;
};

/** Pure syntax/policy validation. Does not load env files, connect, or prove account ownership. */
export function stripeAutomationConfig(env: Environment, proof?:AttestedTarget): AutomationConfig {
  if (env.STRIPE_AUTOMATION_ENABLED === undefined || env.STRIPE_AUTOMATION_ENABLED === 'false')
    throw new AutomationError('DISABLED');
  if (env.STRIPE_AUTOMATION_ENABLED !== 'true') return invalid();
  if (env.STRIPE_AUTOMATION_ENVIRONMENT !== 'isolated-development' ||
      env.STRIPE_AUTOMATION_DEPLOYMENT !== 'local' ||
      !['development', 'test'].includes(env.NODE_ENV ?? '') ||
      env.VERCEL !== undefined || env.VERCEL_ENV !== undefined || env.VERCEL_TARGET_ENV !== undefined)
    return invalid();
  // A worker process must not receive migration/bootstrap credentials, even unused ones.
  if (Object.entries(env).some(([key, value]) => value !== undefined &&
      /^(MIGRATION_DATABASE_URL|MIGRATION_DB_PASSWORD|POSTGRES_PASSWORD|AUTOMATION_(MIGRATION|BOOTSTRAP)_PASSWORD)$/.test(key)))
    return invalid();
  if (Object.entries(env).some(([key, value]) => key.startsWith('PG') && value !== undefined)) return invalid();
  const secret = required(env, 'STRIPE_AUTOMATION_SECRET');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret) || new Set(secret).size < 16) return invalid();
  if (Object.entries(env).some(([key, value]) => key !== 'STRIPE_AUTOMATION_SECRET' &&
      /SECRET|TOKEN|PASSWORD|KEY/.test(key) && value === secret)) return invalid();
  const target = proof ? Object.freeze({...AUTOMATION_TARGET,
    host:requireAttestedTarget(proof).address,port:5432}) : AUTOMATION_TARGET;
  if (env.STRIPE_AUTOMATION_DB_NAME !== target.database || env.STRIPE_AUTOMATION_DB_HOST !== target.host ||
      env.STRIPE_AUTOMATION_DB_PORT !== String(target.port) || env.STRIPE_AUTOMATION_DB_ROLE !== target.role)
    return invalid();
  let url: URL;
  try { url = new URL(required(env, 'DATABASE_URL')); } catch { return invalid(); }
  if (url.protocol !== 'postgresql:' || url.hostname !== target.host || url.port !== String(target.port) ||
      url.pathname !== `/${target.database}` || url.username !== target.role || url.search || url.hash)
    return invalid();
  let password: string;
  try { password = decodeURIComponent(url.password); } catch { return invalid(); }
  if (password.length < 32 || password === secret) return invalid();
  const serverAddress = required(env, 'STRIPE_AUTOMATION_DB_SERVER_ADDRESS');
  if (!isIP(serverAddress) || (proof && serverAddress!==proof.address)) return invalid();
  if (env.STRIPE_MODE !== 'test' || (env.STRIPE_LIVEMODE !== undefined && env.STRIPE_LIVEMODE !== 'false') ||
      !/^sk_test_[A-Za-z0-9]{16,}$/.test(required(env, 'STRIPE_SECRET_KEY')))
    return invalid();
  const expectedStripeAccount = required(env, 'STRIPE_AUTOMATION_EXPECTED_ACCOUNT_ID');
  if (!/^acct_[A-Za-z0-9]+$/.test(expectedStripeAccount) || env.STRIPE_ACCOUNT_ID !== expectedStripeAccount)
    return invalid();
  // Reject unknown automation switches, including attempts to configure batches or bypass the gate.
  const allowed = new Set(['STRIPE_AUTOMATION_ENABLED', 'STRIPE_AUTOMATION_ENVIRONMENT',
    'STRIPE_AUTOMATION_DEPLOYMENT', 'STRIPE_AUTOMATION_SECRET', 'STRIPE_AUTOMATION_DB_NAME',
    'STRIPE_AUTOMATION_DB_HOST', 'STRIPE_AUTOMATION_DB_PORT', 'STRIPE_AUTOMATION_DB_ROLE',
    'STRIPE_AUTOMATION_DB_SERVER_ADDRESS', 'STRIPE_AUTOMATION_EXPECTED_ACCOUNT_ID']);
  if (Object.keys(env).some(key => key.startsWith('STRIPE_AUTOMATION_') && !allowed.has(key))) return invalid();
  if(proof) {
    const directAllowed=new Set([...allowed,'PATH','HOME','LANG','LC_ALL','NODE_ENV','DATABASE_URL',
      'STRIPE_MODE','STRIPE_LIVEMODE','STRIPE_SECRET_KEY','STRIPE_ACCOUNT_ID']);
    if(Object.entries(env).some(([key,value])=>value!==undefined && !directAllowed.has(key)))return invalid();
  }
  return Object.freeze({ enabled: true, environment: 'isolated-development', deployment: 'local',
    nodeEnvironment: env.NODE_ENV as 'development' | 'test', database: target, serverAddress,
    expectedStripeAccount, credentialDigest: digest(secret), ...(proof ? {target:proof} : {}) });
}

export function authorizeStripeAutomation(header: string | null, config: AutomationConfig): void {
  const match = header?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/);
  const supplied = digest(match?.[1] ?? '');
  const equal = timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(config.credentialDigest, 'hex'));
  if (!match || !equal) throw new AutomationError('UNAUTHORIZED');
}

/** No query/body/URL credentials are accepted, even when they repeat configured values. */
export function validateAutomationRequest(request: Request): void {
  const url = new URL(request.url);
  if (url.search || url.username || url.password || request.body !== null ||
      request.headers.has('transfer-encoding') ||
      (request.headers.has('content-length') && request.headers.get('content-length') !== '0'))
    throw new AutomationError('REQUEST_PARAMETERS');
}

export type DatabaseIdentity = {
  database_name: string; role_name: string; session_role: string; server_address: string | null;
  server_port: number | null; server_version: number; in_recovery: boolean; database_owner: string;
  superuser: boolean; create_database: boolean; create_role: boolean; bypass_rls: boolean;
};
export interface IdentityReader {
  query(sql: string): Promise<{ rows: DatabaseIdentity[] }>;
}

/** Explicit, read-only guard for a future connected client. Never called by the Stage 2A route. */
export async function verifyAutomationDatabaseIdentity(
  reader: IdentityReader, config: AutomationConfig, env: Environment,
): Promise<void> {
  // Revalidate the current environment before even issuing the read-only query.
  const fresh = stripeAutomationConfig(env,config.target);
  if (JSON.stringify(fresh) !== JSON.stringify(config)) throw new AutomationError('DATABASE_IDENTITY');
  let rows: DatabaseIdentity[];
  try {
    ({ rows } = await reader.query(`SELECT current_database() AS database_name, current_user AS role_name,
      session_user AS session_role, host(inet_server_addr()) AS server_address,
      inet_server_port() AS server_port, current_setting('server_version_num')::int AS server_version,
      pg_is_in_recovery() AS in_recovery, pg_get_userbyid(d.datdba) AS database_owner,
      r.rolsuper AS superuser, r.rolcreatedb AS create_database, r.rolcreaterole AS create_role,
      r.rolbypassrls AS bypass_rls FROM pg_database d JOIN pg_roles r ON r.rolname=current_user
      WHERE d.datname=current_database()`));
  } catch { throw new AutomationError('DATABASE_UNAVAILABLE'); }
  const row = rows[0], target = config.database;
  if (rows.length !== 1 || row.database_name !== target.database || row.role_name !== target.role ||
      row.session_role !== target.role || row.server_address !== config.serverAddress ||
      row.server_port !== target.serverPort || !Number.isInteger(row.server_version) ||
      row.server_version !== 170006 || row.in_recovery !== false ||
      row.database_owner !== target.owner || row.superuser !== false || row.create_database !== false ||
      row.create_role !== false || row.bypass_rls !== false) throw new AutomationError('DATABASE_IDENTITY');
}

/** Read-only feature/ACL guard for the reviewed 0035 capabilities. Full migration
 * ledger verification remains a separate migration-role preflight in Stage 2B-3. */
export async function verifyAutomationRecoveryCapabilities(reader:{query(sql:string):Promise<{rows:{safe:boolean}[]}>}):Promise<void> {
  let rows:{safe:boolean}[];
  try {({rows}=await reader.query(`SELECT (
    current_setting('server_version_num')::int=170006
    AND NOT pg_has_role(current_user,'zemaitija_migrator','MEMBER')
    AND NOT has_database_privilege(current_user,current_database(),'CREATE')
    AND NOT has_schema_privilege(current_user,'public','CREATE')
    AND NOT has_table_privilege(current_user,'public.payment_attempts','UPDATE')
    AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['recovery_enabled','recovery_next_attempt_at',
      'recovery_lease_owner','recovery_lease_until','recovery_lease_generation','recovery_failure_count']) c
      WHERE has_column_privilege(current_user,'public.payment_attempts',c,'UPDATE'))
    AND (SELECT count(*)=2 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.oid IN (
        to_regprocedure('public.claim_payment_recovery(text,text,integer)'),
        to_regprocedure('public.finish_payment_recovery(uuid,text,bigint,text,integer)'))
      AND p.prosecdef AND pg_get_userbyid(p.proowner)='zemaitija_migrator'
      AND p.proconfig @> ARRAY['search_path=pg_catalog, public']
      AND has_function_privilege(current_user,p.oid,'EXECUTE')
      AND NOT EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl,acldefault('f',p.proowner))) a
        WHERE a.grantee=0 AND a.privilege_type='EXECUTE'))
    AND EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.payment_attempts'::regclass
      AND conname='payment_recovery_metadata_valid' AND convalidated)
    AND (SELECT count(*)=2 FROM pg_trigger WHERE tgrelid='public.payment_attempts'::regclass
      AND tgname IN ('payment_recovery_metadata_guard','new_payment_recovery_enrollment') AND tgenabled='O')
  ) safe`));} catch {throw new AutomationError('DATABASE_IDENTITY');}
  if(rows.length!==1 || rows[0].safe!==true)throw new AutomationError('DATABASE_IDENTITY');
}
