import { observePoolShutdown, type ShutdownObservation } from '../src/server/automation-settlement';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { PoolClient } from 'pg';
import { attestIsolatedTarget, refreshIsolatedTarget, type DockerEvidenceReader } from '../src/server/stripe-automation-target';
import { isolatedConnectionOptions, isolatedConnectionUrl, requireExecution, verifyIsolatedSession, type ExecutionAuthority,
  type ExplicitEnvironment, type PoolFactory, type SqlSession } from './lib/stripe-automation-connection';

type Entry={idx:number;version:string;when:number;tag:string;breakpoints:boolean;sha256:string};
export type MigrationPlan={entries:Entry[];migrations:{sql:string[];folderMillis:number;hash:string;bps:boolean}[]};
const root=new URL('../',import.meta.url);
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
async function migrationLock(session:SqlSession) {
  if((await session.query('SELECT pg_try_advisory_lock(1937001,35) acquired')).rows[0]?.acquired!==true)
    throw new Error('MIGRATION_LOCK_UNAVAILABLE');
}
export async function reviewedMigrationPlan(read:(url:URL)=>Promise<string>=url=>readFile(url,'utf8')):Promise<MigrationPlan> {
  const manifest=JSON.parse(await read(new URL('scripts/stripe-automation-migration-manifest.json',root))) as {version:number;entries:Entry[]};
  const journal=JSON.parse(await read(new URL('drizzle/meta/_journal.json',root))) as {version:string;dialect:string;entries:Omit<Entry,'sha256'>[]};
  if(manifest.version!==1 || manifest.entries.length!==36 || journal.version!=='7' || journal.dialect!=='postgresql' ||
    journal.entries.length!==36 || manifest.entries.at(-1)?.tag!=='0035_payment_recovery_schedule')throw new Error('MIGRATION_SOURCE_REJECTED');
  const migrations=[];
  for(const [i,e] of manifest.entries.entries()) {
    const {sha256,...entry}=e;
    if(e.idx!==i || !e.tag.startsWith(String(i).padStart(4,'0')+'_') || !/^\d{4}_[a-z0-9_]+$/.test(e.tag) ||
      !/^[a-f0-9]{64}$/.test(sha256) || e.version!=='7' || !e.breakpoints || !Number.isSafeInteger(e.when) ||
      (i>0 && e.when<=manifest.entries[i-1].when) || JSON.stringify(entry)!==JSON.stringify(journal.entries[i]))
      throw new Error('MIGRATION_SOURCE_REJECTED');
    const sql=await read(new URL(`drizzle/${e.tag}.sql`,root));
    if(hash(sql)!==sha256)throw new Error('MIGRATION_SOURCE_REJECTED');
    migrations.push({sql:sql.split('--> statement-breakpoint'),folderMillis:e.when,hash:sha256,bps:e.breakpoints});
  }
  return {entries:manifest.entries,migrations};
}
export async function readMigrationLedger(session:SqlSession,plan:MigrationPlan):Promise<number> {
  await session.query('BEGIN READ ONLY');
  try {
    const exists=await session.query("SELECT to_regclass('drizzle.__drizzle_migrations') ledger");
    if(exists.rows.length!==1 || (exists.rows[0].ledger!==null && typeof exists.rows[0].ledger!=='string'))
      throw new Error('MIGRATION_LEDGER_REJECTED');
    if(exists.rows[0]?.ledger===null)return 0;
    const {rows}=await session.query('SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at,id');
    if(rows.length>plan.entries.length || rows.some((r,i)=>r.hash!==plan.entries[i].sha256 || r.created_at!==String(plan.entries[i].when)))
      throw new Error('MIGRATION_LEDGER_REJECTED');
    return rows.length;
  } finally {await session.query('ROLLBACK');}
}
export type MigrationDependencies={docker:DockerEvidenceReader;pool:PoolFactory;
  plan:()=>Promise<MigrationPlan>;observeShutdown?:(state:ShutdownObservation)=>void;apply:(session:SqlSession,plan:MigrationPlan)=>Promise<void>};

const rejectionCategories=Object.freeze([
  'AUTHORITY_REJECTED','ENVIRONMENT_REJECTED','DOCKER_ATTESTATION_REJECTED',
  'DATABASE_IDENTITY_REJECTED','MANIFEST_REJECTED','LEDGER_REJECTED',
  'MIGRATION_LOCK_REJECTED','PREFLIGHT_REJECTED',
] as const);
type RejectionCategory=typeof rejectionCategories[number];
class MigrationRejection extends Error {
  constructor(readonly category:RejectionCategory) {
    // Preserve existing fixed library error codes where callers already assert them.
    // Never retain the caught exception, its message, stack or cause.
    super(category==='AUTHORITY_REJECTED'?'EXECUTION_NOT_AUTHORIZED':
      category==='LEDGER_REJECTED'?'MIGRATION_LEDGER_REJECTED':category);
  }
}
async function atStage<T>(category:RejectionCategory,work:()=>T|Promise<T>):Promise<T> {
  try {return await work();}catch {throw new MigrationRejection(category);}
}
/** Only trusted assigned categories are printable. Never inspect exception messages. */
export function migrationRejectionMessage(error:unknown):string {
  const category=error instanceof MigrationRejection && rejectionCategories.includes(error.category)
    ?error.category:'PREFLIGHT_REJECTED';
  return `ISOLATED_MIGRATION_REJECTED: ${category}\n`;
}

/** No environment defaults, import-time connections, retry, seed or rollback operation.
 * Caller authority is an operator acknowledgement, not proof of independent approval. */
export async function executeIsolatedMigrations(env:ExplicitEnvironment,authority:ExecutionAuthority|undefined,deps:MigrationDependencies) {
  const approval=await atStage('AUTHORITY_REJECTED',()=>requireExecution(authority,'migrate'));
  await atStage('ENVIRONMENT_REJECTED',()=>isolatedConnectionUrl(env,'zemaitija_migrator'));
  const target=await atStage('DOCKER_ATTESTATION_REJECTED',()=>attestIsolatedTarget(deps.docker));
  // Runtime address drift is checked after the necessary attestation, never bypassed.
  const options=await atStage('ENVIRONMENT_REJECTED',()=>isolatedConnectionOptions(env,'zemaitija_migrator',target));
  const plan=await atStage('MANIFEST_REJECTED',()=>deps.plan());
  const pool=await atStage('DATABASE_IDENTITY_REJECTED',()=>deps.pool({...options,statement_timeout:15000,lock_timeout:5000,options:'-c transaction_timeout=120000'}));
  let attempted=false,attemptFailed=false,appliedCount:number|null=null,cleanupFailed=false;
  let state:'COMPLETED'|'INCOMPLETE'|'UNCERTAIN'='UNCERTAIN';
  function release(session:SqlSession) {
    try {session.release(true);}catch {cleanupFailed=true;}
  }
  async function session() {
    // Keep the existing verifiedSession sequence, with separate diagnostic boundaries.
    await atStage('DOCKER_ATTESTATION_REJECTED',()=>refreshIsolatedTarget(target,deps.docker));
    const acquired=await atStage('DATABASE_IDENTITY_REJECTED',()=>pool.connect());
    try {await atStage('DATABASE_IDENTITY_REJECTED',()=>verifyIsolatedSession(acquired,'zemaitija_migrator',target));return acquired;}
    catch(error){release(acquired);throw error;}
  }
  try {
    const applying=await session();
    try {
      await atStage('MIGRATION_LOCK_REJECTED',()=>migrationLock(applying));
      await atStage('LEDGER_REJECTED',()=>readMigrationLedger(applying,plan));
      await atStage('DOCKER_ATTESTATION_REJECTED',()=>refreshIsolatedTarget(target,deps.docker));
      attempted=true;
      // Real Drizzle PostgreSQL dialect consumes the exact captured, hash-checked bytes.
      try {await deps.apply(applying,plan);}catch {attemptFailed=true;}
    } finally {release(applying);}
    // A lost COMMIT acknowledgement is never classified from the exception alone.
    try {
      const observer=await session();
      try {
        // The same session lock prevents observing a premature INCOMPLETE outcome.
        await migrationLock(observer);
        appliedCount=await readMigrationLedger(observer,plan);
        state=appliedCount===36?'COMPLETED':'INCOMPLETE';
      } finally {release(observer);}
    } catch {state='UNCERTAIN';}
  } catch(error) {
    if(!attempted)throw error;
    // Unexpected failures after crossing the apply boundary cannot be preflight rejections.
    state='UNCERTAIN';
  } finally {try {await observePoolShutdown(()=>pool.end(),deps.observeShutdown);}catch {cleanupFailed=true;}}
  return {runId:approval.runId,state,appliedCount,attemptFailed,cleanupFailed};
}

/** A reference records the operator's assertion only; it is not independently verified.
 * Separate human approval MUST precede invocation. Importing this entry is inert.
 * Optional dependencies are an explicit deterministic-test seam, never CLI input. */
export async function migrationMain(args:string[],env:ExplicitEnvironment,deps?:MigrationDependencies) {
  const authority=await atStage('AUTHORITY_REJECTED',()=>{
    if(args.length!==4 || args[0]!=='--acknowledge-stage-2b-3c-migrations' || args[2]!=='--human-approval-reference')throw new Error('EXECUTION_NOT_AUTHORIZED');
    return requireExecution({stage:'2B-3C',operation:'migrate',runId:args[1],humanApprovalReference:args[3]},'migrate');
  });
  await atStage('ENVIRONMENT_REJECTED',()=>isolatedConnectionUrl(env,'zemaitija_migrator'));
  const dependencies=deps??await atStage('DOCKER_ATTESTATION_REJECTED',async()=>{
    const {hostDockerReader}=await import('./lib/stripe-automation-docker');
    return {
      observeShutdown:(state:ShutdownObservation)=>{if(state==='PENDING_EXTERNAL_SUPERVISION')process.stderr.write('CLEANUP_PENDING_EXTERNAL_SUPERVISION\n');},
      docker:hostDockerReader(),plan:()=>reviewedMigrationPlan(),
      pool:options=>new MigrationPool(options),
      apply:async(session,plan)=>{
        const [{PgDialect},{NodePgDriver}]=await Promise.all([import('drizzle-orm/pg-core'),import('drizzle-orm/node-postgres')]);
        const dialect=new PgDialect();
        // Drizzle's migrate declaration erases the driver's schema/query-result generics.
        const driverSession=new NodePgDriver(session as unknown as PoolClient,dialect).createSession(undefined);
        await dialect.migrate(plan.migrations,driverSession as unknown as Parameters<typeof dialect.migrate>[1],
          {migrationsFolder:'drizzle',migrationsSchema:'drizzle',migrationsTable:'__drizzle_migrations'});
      },
    } satisfies MigrationDependencies;
  });
  return executeIsolatedMigrations(env,authority,dependencies);
}
/** Same reporting path as the CLI, injectable sinks for tests; never prints exceptions. */
export async function migrationCommand(args:string[],env:ExplicitEnvironment,
  output:{stdout:(text:string)=>void;stderr:(text:string)=>void},deps?:MigrationDependencies):Promise<number> {
  let result:Awaited<ReturnType<typeof migrationMain>>;
  try {
    result=await migrationMain(args,env,deps);
  } catch(error) {
    try {output.stderr(migrationRejectionMessage(error));}catch { /* Do not print sink exceptions. */ }
    return 1;
  }
  try {output.stdout(JSON.stringify(result)+'\n');}
  catch {
    // Reporting failure after execution is not a preflight rejection or rollback proof.
    try {output.stderr('ISOLATED_MIGRATION_OUTCOME_UNAVAILABLE: UNCERTAIN\n');}catch { /* Preserve silence on sink failure. */ }
    return 1;
  }
  return result.state==='COMPLETED' && !result.cleanupFailed?0:1;
}
// Lazy pg construction keeps even an imported CLI entirely disconnected.
class MigrationPool {
  private pool:Promise<import('pg').Pool>;
  constructor(options:Parameters<PoolFactory>[0]) {this.pool=import('pg').then(({Pool})=>new Pool(options));}
  async connect(){return (await this.pool).connect();}
  async end(){await (await this.pool).end();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  migrationCommand(process.argv.slice(2),process.env,{
    stdout:text=>{process.stdout.write(text);},stderr:text=>{process.stderr.write(text);},
  }).then(code=>{process.exitCode=code;});
}
