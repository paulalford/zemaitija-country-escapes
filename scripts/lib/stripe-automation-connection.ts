import { requireAttestedTarget, refreshIsolatedTarget, type AttestedTarget, type DockerEvidenceReader } from '../../src/server/stripe-automation-target';
import { isIP } from 'node:net';

export type IsolatedRole='zemaitija_app'|'zemaitija_migrator';
export type ExplicitEnvironment=Readonly<Record<string,string|undefined>>;
export interface SqlSession {
  query(sql:string,values?:unknown[]):Promise<{rows:Record<string,unknown>[];rowCount?:number|null}>;
  release(destroy?:boolean):void;
}
export interface IsolatedPool { connect():Promise<SqlSession>; end():Promise<void> }
export type PoolFactory=(options:{connectionString:string;max:number;connectionTimeoutMillis:number;
  statement_timeout:number;lock_timeout:number;idle_in_transaction_session_timeout:number;options:string})=>IsolatedPool;
export type ExecutionAuthority=Readonly<{stage:'2B-3C';operation:'migrate'|'integration';runId:string;humanApprovalReference?:string}>;
export function requireExecution(authority:ExecutionAuthority|undefined,operation:ExecutionAuthority['operation']):ExecutionAuthority {
  if(authority?.stage!=='2B-3C' || authority.operation!==operation || !/^[a-zA-Z0-9_-]{16,80}$/.test(authority.runId))
    throw new Error('EXECUTION_NOT_AUTHORIZED');
  if(operation==='migrate' && !/^[A-Za-z0-9_-]{16,100}$/.test(authority.humanApprovalReference??''))
    throw new Error('HUMAN_APPROVAL_REFERENCE_REQUIRED');
  return authority;
}
/** Pure validation of a supplied clean child environment. Never reads process.env or files.
 * Migration credentials cannot enter an application session (or vice versa). */
export function isolatedConnectionUrl(env:ExplicitEnvironment,role:IsolatedRole):URL {
  if(role!=='zemaitija_app' && role!=='zemaitija_migrator')throw new Error('ISOLATED_CONNECTION_REJECTED');
  const key=role==='zemaitija_app'?'DATABASE_URL':'MIGRATION_DATABASE_URL';
  const allowed=new Set(['PATH','HOME','LANG','LC_ALL','NODE_ENV',key]);
  if(env.NODE_ENV!=='test' || Object.keys(env).some(k=>env[k]!==undefined && !allowed.has(k)))
    throw new Error('ISOLATED_ENVIRONMENT_REJECTED');
  let url:URL;
  try {url=new URL(env[key]??'');}catch {throw new Error('ISOLATED_CONNECTION_REJECTED');}
  let password:string;
  try {password=decodeURIComponent(url.password);}catch {throw new Error('ISOLATED_CONNECTION_REJECTED');}
  // These static address requirements already follow from mandatory target attestation.
  // They do not attest an address; the exact live address comparison remains below.
  if(url.protocol!=='postgresql:' || isIP(url.hostname)!==4 ||
    !/^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(url.hostname) || url.port!=='5432' ||
    url.username!==role || url.pathname!=='/zemaitija_stripe_automation_dev' || url.search || url.hash ||
    password.length<32 || password.trim()!==password)
    throw new Error('ISOLATED_CONNECTION_REJECTED');
  return url;
}
export function isolatedConnectionOptions(env:ExplicitEnvironment,role:IsolatedRole,proof:AttestedTarget,max=1) {
  requireAttestedTarget(proof);
  const url=isolatedConnectionUrl(env,role);
  if(url.hostname!==proof.address || !Number.isInteger(max) || max<1 || max>4)
    throw new Error('ISOLATED_CONNECTION_REJECTED');
  return {connectionString:url.toString(),max,connectionTimeoutMillis:1000,statement_timeout:1000,
    lock_timeout:500,idle_in_transaction_session_timeout:1000,options:'-c transaction_timeout=10000'};
}
export const ISOLATED_IDENTITY_SQL=`SELECT current_database() database_name,current_user role_name,
  session_user session_role,host(inet_server_addr()) server_address,inet_server_port() server_port,
  current_setting('server_version_num')::int server_version,pg_is_in_recovery() in_recovery,
  pg_get_userbyid(d.datdba) database_owner,r.rolsuper superuser,r.rolcreatedb create_database,
  r.rolcreaterole create_role,r.rolreplication replication,r.rolbypassrls bypass_rls,
  has_database_privilege(current_user,current_database(),'CREATE') database_create,
  has_schema_privilege(current_user,'public','CREATE') schema_create,
  EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid) has_memberships
  FROM pg_database d JOIN pg_roles r ON r.rolname=current_user WHERE d.datname=current_database()`;

/** Authenticated identity is independent of Docker evidence and execution authority.
 * Every newly acquired session is checked in a read-only transaction before use. */
export async function verifyIsolatedSession(session:SqlSession,role:IsolatedRole,proof:AttestedTarget):Promise<void> {
  requireAttestedTarget(proof);
  await session.query('BEGIN READ ONLY');
  try {
    const {rows}=await session.query(ISOLATED_IDENTITY_SQL),r=rows[0];
    if(rows.length!==1 || r.database_name!=='zemaitija_stripe_automation_dev' || r.role_name!==role ||
      r.session_role!==role || r.server_address!==proof.address || r.server_port!==5432 ||
      r.server_version!==170006 || r.database_owner!=='zemaitija_migrator' || r.in_recovery!==false ||
      ['superuser','create_database','create_role','replication','bypass_rls','has_memberships'].some(k=>r[k]!==false) ||
      r.database_create!==(role==='zemaitija_migrator') || r.schema_create!==(role==='zemaitija_migrator'))
      throw new Error('ISOLATED_DATABASE_IDENTITY_REJECTED');
  } finally {await session.query('ROLLBACK');}
}

export async function verifiedSession(pool:IsolatedPool,role:IsolatedRole,proof:AttestedTarget,reader:DockerEvidenceReader):Promise<SqlSession> {
  await refreshIsolatedTarget(proof,reader);
  const session=await pool.connect();
  try {await verifyIsolatedSession(session,role,proof);return session;}
  catch {session.release(true);throw new Error('ISOLATED_DATABASE_IDENTITY_REJECTED');}
}
