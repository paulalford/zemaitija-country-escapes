import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrationCommand, migrationMain, migrationRejectionMessage, type MigrationDependencies, type MigrationPlan } from '../scripts/stripe-automation-migrate';
import { ISOLATED_IDENTITY_SQL, type ExplicitEnvironment } from '../scripts/lib/stripe-automation-connection';
import { syntheticDockerEvidence } from './helpers/stripe-automation-target-fixture';

// No default live dependency may be loaded, including by valid synthetic invocations.
vi.mock('pg',()=>{throw Error('Live PostgreSQL forbidden');});
vi.mock('stripe',()=>{throw Error('Stripe SDK forbidden');});
vi.mock('../scripts/lib/stripe-automation-docker',()=>{throw Error('Live Docker adapter forbidden');});
vi.mock('drizzle-orm/node-postgres',()=>{throw Error('Real migration driver forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Shared database forbidden');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

const password='synthetic_password_0123456789abcdef';
const url=`postgresql://zemaitija_migrator:${password}@172.22.0.2:5432/zemaitija_stripe_automation_dev`;
const env:ExplicitEnvironment={NODE_ENV:'test',MIGRATION_DATABASE_URL:url};
const args=['--acknowledge-stage-2b-3c-migrations','synthetic_diagnostic_run_0001','--human-approval-reference','synthetic_approval_reference_0001'];
const sensitive=`raw exception ${password} ${url} sk_test_SyntheticSecretOnly fingerprint_synthetic_private_value`;
const raw=()=>new Error(sensitive);
function sinks() {
  const stdout=vi.fn<(text:string)=>void>(),stderr=vi.fn<(text:string)=>void>();
  return {stdout,stderr,text:()=>[...stdout.mock.calls,...stderr.mock.calls].map(([text])=>text).join('')};
}
function redacted(text:string) {
  for(const forbidden of [password,url,'raw exception','sk_test_SyntheticSecretOnly','fingerprint_synthetic_private_value','Error:',sensitive])
    expect(text).not.toContain(forbidden);
}
type Failure='none'|'docker'|'refresh'|'manifest'|'pool'|'connect'|'identity'|'lock'|'ledger'|
  'apply-incomplete'|'apply-uncertain'|'lost-ack-complete'|'observer-identity'|'observer-docker'|'cleanup'|'release';
function harness(failure:Failure='none') {
  const evidence=syntheticDockerEvidence();
  const entries=Array.from({length:36},(_,idx)=>({idx,version:'7',when:idx+1,
    tag:`${String(idx).padStart(4,'0')}_synthetic`,breakpoints:true,sha256:'a'.repeat(64)}));
  const plan:MigrationPlan={entries,migrations:[]};
  let applied=0,connections=0,reads=0;
  const read=vi.fn(async()=>{
    reads++;
    if(failure==='docker' || failure==='refresh' && reads===2 || failure==='observer-docker' && reads===4)throw raw();
    return evidence;
  });
  const release=vi.fn(()=>{if(failure==='release')throw raw();});
  const queries:string[]=[];
  const connect=vi.fn(async()=>{
    if(failure==='connect')throw raw();
    const index=++connections;
    return {release,query:vi.fn(async(sql:string)=>{
      queries.push(sql);
      if(sql===ISOLATED_IDENTITY_SQL) {
        if(failure==='identity' || failure==='observer-identity' && index===2)throw raw();
        return {rows:[{database_name:'zemaitija_stripe_automation_dev',role_name:'zemaitija_migrator',session_role:'zemaitija_migrator',
          server_address:'172.22.0.2',server_port:5432,server_version:170006,in_recovery:false,database_owner:'zemaitija_migrator',
          superuser:false,create_database:false,create_role:false,replication:false,bypass_rls:false,has_memberships:false,
          database_create:true,schema_create:true}]};
      }
      if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:failure!=='lock'}]};
      if(sql.includes('to_regclass')) {
        if(failure==='ledger' || failure==='apply-uncertain' && index===2)throw raw();
        return {rows:[{ledger:applied?'drizzle.__drizzle_migrations':null}]};
      }
      if(sql.startsWith('SELECT hash,'))return {rows:entries.slice(0,applied).map(e=>({hash:e.sha256,created_at:String(e.when)}))};
      return {rows:[]};
    })};
  });
  const end=vi.fn(async()=>{if(failure==='cleanup')throw raw();});
  const pool=vi.fn<MigrationDependencies['pool']>(()=>{
    if(failure==='pool')throw raw();return {connect,end};
  });
  const loadPlan=vi.fn(async()=>{if(failure==='manifest')throw raw();return plan;});
  const apply=vi.fn(async()=>{
    if(failure==='apply-incomplete' || failure==='apply-uncertain')throw raw();
    applied=36;if(failure==='lost-ack-complete')throw raw();
  });
  const deps:MigrationDependencies={docker:{read},pool,plan:loadPlan,apply};
  return {deps,read,pool,loadPlan,apply,connect,end,release,queries};
}

describe('fixed migration rejection categories, mocked dependencies only',()=>{
  it.each([
    ['docker','DOCKER_ATTESTATION_REJECTED'],['refresh','DOCKER_ATTESTATION_REJECTED'],
    ['manifest','MANIFEST_REJECTED'],['pool','DATABASE_IDENTITY_REJECTED'],
    ['connect','DATABASE_IDENTITY_REJECTED'],['identity','DATABASE_IDENTITY_REJECTED'],
    ['ledger','LEDGER_REJECTED'],['lock','MIGRATION_LOCK_REJECTED'],
  ] as const)('reports %s failure at its assigned boundary',async(failure,category)=>{
    const h=harness(failure),output=sinks();
    expect(await migrationCommand(args,env,output,h.deps)).toBe(1);
    expect(output.stdout).not.toHaveBeenCalled();
    expect(output.stderr).toHaveBeenCalledExactlyOnceWith(`ISOLATED_MIGRATION_REJECTED: ${category}\n`);
    expect(h.apply).not.toHaveBeenCalled();redacted(output.text());
    if(failure==='docker' || failure==='manifest')expect(h.pool).not.toHaveBeenCalled();
    if(failure==='identity')expect(h.release).toHaveBeenCalledWith(true);
  });

  it.each([[],[...args.slice(0,2)],['--wrong',...args.slice(1)],
    [args[0],'short',args[2],args[3]],[args[0],args[1],args[2],'short']].map(supplied=>({supplied})))(
    'rejects missing/invalid authority before even reading environment or dependencies',async({supplied})=>{
      const access=vi.fn(()=>{throw raw();}),trap=new Proxy({}, {get:access}),output=sinks();
      expect(await migrationCommand(supplied,trap,output,trap as MigrationDependencies)).toBe(1);
      expect(output.stderr).toHaveBeenCalledExactlyOnceWith('ISOLATED_MIGRATION_REJECTED: AUTHORITY_REJECTED\n');
      expect(access).not.toHaveBeenCalled();redacted(output.text());
    });

  it.each([
    {},{...env,NODE_ENV:'development'},{...env,NODE_OPTIONS:sensitive},{...env,DEBUG:sensitive},
    {...env,DATABASE_URL:url},{...env,MIGRATION_DATABASE_URL:'not-a-url'},
    {...env,MIGRATION_DATABASE_URL:url.replace('postgresql:','postgres:')},
    {...env,MIGRATION_DATABASE_URL:url.replace('172.22.0.2','127.0.0.1')},
    {...env,MIGRATION_DATABASE_URL:url.replace(':5432',':55433')},
    {...env,MIGRATION_DATABASE_URL:url.replace('zemaitija_migrator:','zemaitija_bootstrap:')},
    {...env,MIGRATION_DATABASE_URL:url.replace('zemaitija_stripe_automation_dev','zemaitija_dev')},
    {...env,MIGRATION_DATABASE_URL:url+'?options=synthetic'},
    {...env,MIGRATION_DATABASE_URL:url+'#synthetic'},
    {...env,MIGRATION_DATABASE_URL:url.replace(password,'short')},
    {...env,MIGRATION_DATABASE_URL:url.replace(password,'%20'+password)},
    {...env,MIGRATION_DATABASE_URL:url.replace(password,'%zz'+password)},
  ])('rejects static environment/configuration failure before Docker or PostgreSQL %#',async supplied=>{
    const h=harness(),output=sinks();
    expect(await migrationCommand(args,supplied,output,h.deps)).toBe(1);
    expect(output.stderr).toHaveBeenCalledExactlyOnceWith('ISOLATED_MIGRATION_REJECTED: ENVIRONMENT_REJECTED\n');
    expect(h.read).not.toHaveBeenCalled();expect(h.pool).not.toHaveBeenCalled();expect(h.apply).not.toHaveBeenCalled();
    redacted(output.text());
  });

  it('requires attestation to detect a different private address, then prevents PostgreSQL access',async()=>{
    const h=harness(),output=sinks();
    expect(await migrationCommand(args,{...env,MIGRATION_DATABASE_URL:url.replace('172.22.0.2','172.22.0.9')},output,h.deps)).toBe(1);
    expect(h.read).toHaveBeenCalledOnce();expect(h.pool).not.toHaveBeenCalled();
    expect(output.stderr).toHaveBeenCalledExactlyOnceWith('ISOLATED_MIGRATION_REJECTED: ENVIRONMENT_REJECTED\n');
  });

  it('uses stage assignment even when an exception message names a different category',async()=>{
    const h=harness(),output=sinks();h.deps.plan=async()=>{throw Error('DATABASE_IDENTITY_REJECTED '+sensitive);};
    expect(await migrationCommand(args,env,output,h.deps)).toBe(1);
    expect(output.stderr).toHaveBeenCalledExactlyOnceWith('ISOLATED_MIGRATION_REJECTED: MANIFEST_REJECTED\n');
    redacted(output.text());
  });

  it('redacts unknown preflight errors and ignores forged category/message/stack properties',()=>{
    const error={category:sensitive,get message(){throw raw();},get stack(){throw raw();}};
    expect(migrationRejectionMessage(error)).toBe('ISOLATED_MIGRATION_REJECTED: PREFLIGHT_REJECTED\n');
    expect(migrationRejectionMessage(raw())).toBe('ISOLATED_MIGRATION_REJECTED: PREFLIGHT_REJECTED\n');
    expect(migrationRejectionMessage(null)).toBe('ISOLATED_MIGRATION_REJECTED: PREFLIGHT_REJECTED\n');
  });

  it('fails closed on an unknown thrown object within a preflight stage',async()=>{
    const h=harness(),output=sinks();h.deps.plan=async()=>{throw {private:sensitive};};
    expect(await migrationCommand(args,env,output,h.deps)).toBe(1);
    expect(output.stderr).toHaveBeenCalledExactlyOnceWith('ISOLATED_MIGRATION_REJECTED: MANIFEST_REJECTED\n');
    expect(h.apply).not.toHaveBeenCalled();redacted(output.text());
  });
});

describe('execution outcomes stay separate from preflight rejection',()=>{
  it.each([
    ['apply-incomplete','INCOMPLETE',1,0,true],['apply-uncertain','UNCERTAIN',1,null,true],
    ['observer-identity','UNCERTAIN',1,null,false],['observer-docker','UNCERTAIN',1,null,false],
    ['lost-ack-complete','COMPLETED',0,36,true],['cleanup','COMPLETED',1,36,false],
    ['release','COMPLETED',1,36,false],['none','COMPLETED',0,36,false],
  ] as const)('preserves independently observed outcome after %s',async(failure,state,exit,appliedCount,attemptFailed)=>{
    const h=harness(failure),output=sinks();
    expect(await migrationCommand(args,env,output,h.deps)).toBe(exit);
    expect(JSON.parse(output.stdout.mock.calls[0][0])).toMatchObject({state,appliedCount,attemptFailed,
      cleanupFailed:failure==='cleanup'||failure==='release',runId:args[1]});
    expect(output.stderr).not.toHaveBeenCalled();expect(h.apply).toHaveBeenCalledOnce();expect(h.end).toHaveBeenCalledOnce();
    expect(output.text()).not.toContain('ISOLATED_MIGRATION_REJECTED');redacted(output.text());
  });

  it('preserves successful preflight options, locking and independent ledger observation',async()=>{
    const h=harness(),result=await migrationMain(args,env,h.deps);
    expect(result.state).toBe('COMPLETED');
    expect(h.pool).toHaveBeenCalledExactlyOnceWith({connectionString:url,max:1,connectionTimeoutMillis:1000,
      statement_timeout:15000,lock_timeout:5000,idle_in_transaction_session_timeout:1000,options:'-c transaction_timeout=120000'});
    expect(h.connect).toHaveBeenCalledTimes(2);
    expect(h.queries.filter(sql=>sql.includes('pg_try_advisory_lock'))).toHaveLength(2);
    expect(h.queries.filter(sql=>sql.includes('to_regclass'))).toHaveLength(2);
    expect(h.release).toHaveBeenCalledTimes(2);expect(h.read).toHaveBeenCalledTimes(4);
  });

  it('never labels a failed outcome-report write as a preflight rejection',async()=>{
    const h=harness(),output=sinks();output.stdout.mockImplementation(()=>{throw raw();});
    expect(await migrationCommand(args,env,output,h.deps)).toBe(1);
    expect(output.stderr).toHaveBeenCalledExactlyOnceWith('ISOLATED_MIGRATION_OUTCOME_UNAVAILABLE: UNCERTAIN\n');
    redacted(output.text());
  });

  it('returns unsuccessful exit status without leaking a failed diagnostic sink',async()=>{
    const h=harness(),output=sinks();output.stderr.mockImplementation(()=>{throw raw();});
    expect(await migrationCommand([],env,output,h.deps)).toBe(1);redacted(output.text());
    expect(h.read).not.toHaveBeenCalled();
  });

  it('imports inertly without environment loading, network or default factories',async()=>{
    const load=vi.spyOn(process,'loadEnvFile').mockImplementation(()=>{throw raw();});
    const fetch=vi.fn(()=>{throw raw();});vi.stubGlobal('fetch',fetch);
    vi.resetModules();await import('../scripts/stripe-automation-migrate');
    expect(load).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
    // All live module imports above are traps, including the default Docker adapter.
  });
});
