import { describe,expect,it,vi,afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { attestIsolatedTarget,refreshIsolatedTarget,requireAttestedTarget,type DockerEvidence } from '../src/server/stripe-automation-target';
import { stripeAutomationConfig,verifyAutomationDatabaseIdentity } from '../src/server/stripe-automation-config';
import { isolatedConnectionOptions,verifiedSession,ISOLATED_IDENTITY_SQL,type ExecutionAuthority } from '../scripts/lib/stripe-automation-connection';
import { executeIsolatedMigrations,migrationMain,reviewedMigrationPlan,type MigrationPlan } from '../scripts/stripe-automation-migrate';
import { withIsolatedPostgres,fakeIntegrationStripe,assertLeaseFenced,assertSettlementOnce,assertPreserved,assertFairProgress } from './helpers/stripe-automation-postgres';
import { syntheticDockerEvidence as evidence } from './helpers/stripe-automation-target-fixture';
import { runStripeAutomationVerification } from '../src/server/stripe-automation-runner';

vi.mock('pg',()=>{throw Error('Live pg forbidden');});
vi.mock('stripe',()=>{throw Error('Live Stripe forbidden');});
vi.mock('node:child_process',()=>({execFile:vi.fn(()=>{throw Error('Live Docker forbidden');})}));
vi.mock('drizzle-orm/node-postgres',()=>{throw Error('Real migration driver forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Shared application pool forbidden');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const appPassword='synthetic_app_password_0123456789abcdef';
const migrationPassword='synthetic_migration_password_0123456789abcdef';
const authority:ExecutionAuthority={stage:'2B-3C',operation:'migrate',runId:'synthetic_run_0001',humanApprovalReference:'synthetic_review_0001'};
const reader=(e=evidence())=>({read:vi.fn(async()=>e)});
function appEnv(){return {NODE_ENV:'test' as const,DATABASE_URL:`postgresql://zemaitija_app:${appPassword}@172.22.0.2:5432/zemaitija_stripe_automation_dev`};}
function migrationEnv(){return {NODE_ENV:'test' as const,MIGRATION_DATABASE_URL:`postgresql://zemaitija_migrator:${migrationPassword}@172.22.0.2:5432/zemaitija_stripe_automation_dev`};}
function workerEnv(){return {...appEnv(),STRIPE_AUTOMATION_ENABLED:'true',STRIPE_AUTOMATION_ENVIRONMENT:'isolated-development',STRIPE_AUTOMATION_DEPLOYMENT:'local',STRIPE_AUTOMATION_SECRET:'abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789',STRIPE_AUTOMATION_DB_NAME:'zemaitija_stripe_automation_dev',STRIPE_AUTOMATION_DB_HOST:'172.22.0.2',STRIPE_AUTOMATION_DB_PORT:'5432',STRIPE_AUTOMATION_DB_ROLE:'zemaitija_app',STRIPE_AUTOMATION_DB_SERVER_ADDRESS:'172.22.0.2',STRIPE_MODE:'test',STRIPE_SECRET_KEY:'sk_test_SyntheticPreparationOnly123456',STRIPE_ACCOUNT_ID:'acct_synthetic',STRIPE_AUTOMATION_EXPECTED_ACCOUNT_ID:'acct_synthetic'};}
function identity(role='zemaitija_migrator') {return {database_name:'zemaitija_stripe_automation_dev',role_name:role,session_role:role,server_address:'172.22.0.2',server_port:5432,server_version:170006,in_recovery:false,database_owner:'zemaitija_migrator',superuser:false,create_database:false,create_role:false,replication:false,bypass_rls:false,has_memberships:false,database_create:role==='zemaitija_migrator',schema_create:role==='zemaitija_migrator'};}
function fakeDb(plan:MigrationPlan,initial=0) {
  let applied=initial,lockCalls=0,blockObserver=false,corrupt=false;const queries:string[]=[];const releases=vi.fn();const end=vi.fn(async()=>{});
  const pool=vi.fn((options:{connectionString:string})=>{
    const role=new URL(options.connectionString).username;
    return {end,connect:vi.fn(async()=>({release:releases,query:vi.fn(async(sql:string)=>{
      queries.push(sql);
      if(sql.includes('pg_try_advisory_lock'))return {rows:[{acquired:!(blockObserver && ++lockCalls>1)}]};
      if(sql===ISOLATED_IDENTITY_SQL)return {rows:[identity(role)]};
      if(sql.includes('to_regclass'))return {rows:[{ledger:applied?'drizzle.__drizzle_migrations':null}]};
      if(sql.startsWith('SELECT hash,'))return {rows:Array.from({length:applied},(_,i)=>{
        const e=plan.entries[i];return e?{hash:corrupt?'unreviewed':e.sha256,created_at:String(e.when)}:{hash:'unreviewed',created_at:'9999999999999'};
      })};
      if(sql.includes(') safe'))return {rows:[{safe:true}]};
      return {rows:[]};
    })}))};
  });
  return {pool,queries,releases,end,apply:vi.fn(async()=>{applied=36;}),setApplied:(n:number)=>{applied=n;},blockObserver:()=>{blockObserver=true;},corruptLedger:()=>{corrupt=true;}};
}

describe('host attestation and restricted direct configuration',()=>{
  it('accepts only genuine attestations and separates syntax from PostgreSQL verification',async()=>{
    const proof=await attestIsolatedTarget(reader());const env=workerEnv();
    expect(()=>stripeAutomationConfig(env)).toThrow();
    expect(()=>requireAttestedTarget({...proof})).toThrow();
    expect(stripeAutomationConfig(env,proof).database).toMatchObject({host:'172.22.0.2',port:5432,role:'zemaitija_app'});
    expect(()=>isolatedConnectionOptions(appEnv(),'zemaitija_app',proof)).not.toThrow();
    const query=vi.fn(async()=>({rows:[identity('zemaitija_app')]}));
    await verifyAutomationDatabaseIdentity({query},stripeAutomationConfig(env,proof),env);
    expect(query).toHaveBeenCalledOnce();
  });
  it.each([
    (e:DockerEvidence)=>{e.container.name='zemaitija-country-escapes_db_1';},
    (e:DockerEvidence)=>{e.container.project='protected';},
    (e:DockerEvidence)=>{e.container.service='worker';},
    (e:DockerEvidence)=>{e.container.image='postgres:18';},
    (e:DockerEvidence)=>{e.container.running=false;},
    (e:DockerEvidence)=>{e.container.privileged=true;},
    (e:DockerEvidence)=>{e.container.capAdd=['NET_ADMIN'];},
    (e:DockerEvidence)=>{e.container.configuredPorts['5432/tcp']![0].HostIp='0.0.0.0';},
    (e:DockerEvidence)=>{e.container.runtimePorts={'5432/tcp':[{HostIp:'0.0.0.0',HostPort:'55433'}]};},
    (e:DockerEvidence)=>{e.network.internal=false;},
    (e:DockerEvidence)=>{e.network.driver='host';},
    (e:DockerEvidence)=>{e.network.name='protected';},
    (e:DockerEvidence)=>{e.network.project='protected';},
    (e:DockerEvidence)=>{e.network.id='c'.repeat(64);},
    (e:DockerEvidence)=>{e.network.containers.push('c'.repeat(64));},
    (e:DockerEvidence)=>{e.volume.name='zemaitija-country-escapes_postgres_data';},
    (e:DockerEvidence)=>{e.volume.project='protected';},
    (e:DockerEvidence)=>{e.volume.mountpoint='/protected';},
    (e:DockerEvidence)=>{e.volume.options={device:'/protected',type:'none',o:'bind'};},
    (e:DockerEvidence)=>{e.container.mounts[1].rw=true;},
    (e:DockerEvidence)=>{e.container.networks.other={id:'c'.repeat(64),address:'172.22.0.3'};},
  ])('rejects incorrect resource identity or isolation %#',async change=>{
    const e=evidence();change(e);await expect(attestIsolatedTarget(reader(e))).rejects.toThrow('ISOLATED_TARGET_REJECTED');
  });
  it('rejects reassignment for an existing run, and requires a fresh attestation for a new binding',async()=>{
    const e=evidence(),r=reader(e),old=await attestIsolatedTarget(r);
    e.container.networks['zemaitija-stripe-automation-internal'].address='172.22.0.3';
    await expect(refreshIsolatedTarget(old,r)).rejects.toThrow();
    const fresh=await attestIsolatedTarget(r);expect(fresh.address).toBe('172.22.0.3');
    expect(()=>stripeAutomationConfig(workerEnv(),fresh)).toThrow();
    const nextEnv={...workerEnv(),STRIPE_AUTOMATION_DB_HOST:fresh.address,STRIPE_AUTOMATION_DB_SERVER_ADDRESS:fresh.address,
      DATABASE_URL:appEnv().DATABASE_URL.replace('172.22.0.2',fresh.address)};
    expect(stripeAutomationConfig(nextEnv,fresh).database.host).toBe(fresh.address);
    e.container.id='c'.repeat(64);e.network.containers=[e.container.id];
    await expect(refreshIsolatedTarget(fresh,r)).rejects.toThrow();
  });
  it('re-attests before worker resource construction and keeps a changed target inactive',async()=>{
    const e=evidence(),r=reader(e),proof=await attestIsolatedTarget(r);
    e.volume.name='protected';
    const constructDatabase=vi.fn(()=>{throw Error('Database must remain disconnected');});
    const constructStripe=vi.fn(()=>fakeIntegrationStripe().gateway),processors=vi.fn();
    const result=await runStripeAutomationVerification(workerEnv(),`Bearer ${workerEnv().STRIPE_AUTOMATION_SECRET}`,
      {target:proof,docker:r,constructDatabase,constructStripe,processors,fetch:vi.fn()});
    expect(result).toMatchObject({status:'FAILED',processingEnabled:false,guardFailed:true});
    expect(constructDatabase).not.toHaveBeenCalled();expect(constructStripe).not.toHaveBeenCalled();expect(processors).not.toHaveBeenCalled();
  });
  it('does not allow legacy loopback syntax to bypass executing-core attestation',async()=>{
    const env={...workerEnv(),STRIPE_AUTOMATION_DB_HOST:'127.0.0.1',STRIPE_AUTOMATION_DB_PORT:'55433',
      DATABASE_URL:appEnv().DATABASE_URL.replace('172.22.0.2:5432','127.0.0.1:55433')};
    const constructDatabase=vi.fn(()=>{throw Error('Forbidden');}),constructStripe=vi.fn(()=>fakeIntegrationStripe().gateway);
    const result=await runStripeAutomationVerification(env,`Bearer ${env.STRIPE_AUTOMATION_SECRET}`,
      {constructDatabase,constructStripe,processors:vi.fn(),fetch:vi.fn()});
    expect(result).toMatchObject({status:'FAILED',processingEnabled:false});expect(constructDatabase).not.toHaveBeenCalled();
  });
  it('rejects direct-worker environment overrides and leaves the HTTP endpoint hard-inactive',async()=>{
    const proof=await attestIsolatedTarget(reader());
    for(const key of ['NODE_OPTIONS','DOCKER_HOST','COMPOSE_FILE'])expect(()=>stripeAutomationConfig({...workerEnv(),[key]:'synthetic'},proof)).toThrow();
    const old=process.env;
    try {process.env=workerEnv();const {POST}=await import('../src/app/api/internal/stripe-automation/route');
      const response=await POST(new Request('http://localhost/api/internal/stripe-automation',{method:'POST',headers:{authorization:`Bearer ${workerEnv().STRIPE_AUTOMATION_SECRET}`}}));
      expect(response.status).toBe(503);expect(await response.json()).toMatchObject({status:'UNAVAILABLE'});
    } finally {process.env=old;}
  });
  it.each(['zemaitija_dev','other_dev'])('rejects database %s',async name=>{
    const p=await attestIsolatedTarget(reader());
    expect(()=>isolatedConnectionOptions({...appEnv(),DATABASE_URL:appEnv().DATABASE_URL.replace('zemaitija_stripe_automation_dev',name)},'zemaitija_app',p)).toThrow();
  });
  it.each(['PGHOST','PGOPTIONS','NODE_OPTIONS','COMPOSE_FILE','DOCKER_HOST','POSTGRES_PASSWORD','MIGRATION_DATABASE_URL','UNEXPECTED'])('rejects inherited/override variable %s',async key=>{
    const p=await attestIsolatedTarget(reader());expect(()=>isolatedConnectionOptions({...appEnv(),[key]:'synthetic'},'zemaitija_app',p)).toThrow();
  });
  it('rejects missing or cross-role credentials and arbitrary endpoint URLs',async()=>{
    const p=await attestIsolatedTarget(reader());
    expect(()=>isolatedConnectionOptions({NODE_ENV:'test'},'zemaitija_migrator',p)).toThrow();
    expect(()=>isolatedConnectionOptions(appEnv(),'zemaitija_migrator',p)).toThrow();
    expect(()=>isolatedConnectionOptions(migrationEnv(),'zemaitija_app',p)).toThrow();
    for(const url of [appEnv().DATABASE_URL.replace('172.22.0.2','172.22.0.9'),appEnv().DATABASE_URL+'?options=unsafe',appEnv().DATABASE_URL.replace('zemaitija_app:','zemaitija_migrator:')])
      expect(()=>isolatedConnectionOptions({...appEnv(),DATABASE_URL:url},'zemaitija_app',p)).toThrow();
    expect(()=>stripeAutomationConfig({...workerEnv(),MIGRATION_DB_PASSWORD:migrationPassword},p)).toThrow();
  });
  it.each([{role_name:'zemaitija_bootstrap'},{session_role:'zemaitija_bootstrap'},{server_version:170007},{server_version:160006},{server_address:'172.22.0.3'},{database_name:'zemaitija_dev'},{has_memberships:true},{superuser:true},{schema_create:true}])('rejects actual PostgreSQL mismatch %#',async change=>{
    const proof=await attestIsolatedTarget(reader()),release=vi.fn();
    const session={release,query:vi.fn(async(sql:string)=>({rows:sql===ISOLATED_IDENTITY_SQL?[{...identity('zemaitija_app'),...change}]:[]}))};
    await expect(verifiedSession({connect:async()=>session,end:async()=>{}},'zemaitija_app',proof,reader())).rejects.toThrow();
    expect(release).toHaveBeenCalledWith(true);expect(session.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('inert migration entry and captured chain/real-ledger boundary',()=>{
  it('imports without dependencies, .env.local, provider calls or execution',async()=>{
    const load=vi.spyOn(process,'loadEnvFile').mockImplementation(()=>{throw Error('Env forbidden');});
    const fetch=vi.fn(()=>{throw Error('Network forbidden');});vi.stubGlobal('fetch',fetch);
    vi.resetModules();
    await import('../scripts/stripe-automation-migrate');await import('./helpers/stripe-automation-postgres');
    await import('../scripts/lib/stripe-automation-docker');
    const {execFile}=await import('node:child_process');expect(execFile).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
    expect(readFileSync(new URL('../scripts/stripe-automation-migrate.ts',import.meta.url),'utf8')).not.toContain('drizzle.config');
  });
  it('rejects missing execution authority before even accessing dependencies',async()=>{
    await expect(executeIsolatedMigrations(migrationEnv(),undefined,undefined!)).rejects.toThrow('EXECUTION_NOT_AUTHORIZED');
    await expect(executeIsolatedMigrations(migrationEnv(),{...authority,operation:'integration'},undefined!)).rejects.toThrow('EXECUTION_NOT_AUTHORIZED');
    await expect(migrationMain([],{})).rejects.toThrow('EXECUTION_NOT_AUTHORIZED');
    await expect(migrationMain(['--approved-stage-2b-3c-migrations','short'],{})).rejects.toThrow('EXECUTION_NOT_AUTHORIZED');
  });
  it('validates all 36 ordered SQL files and rejects changed bytes or journal',async()=>{
    const plan=await reviewedMigrationPlan();expect(plan.entries).toHaveLength(36);
    expect(plan.entries.at(-1)?.tag).toBe('0035_payment_recovery_schedule');
    const read=async(url:URL)=>readFileSync(url,'utf8');
    await expect(reviewedMigrationPlan(async url=>url.pathname.endsWith('0035_payment_recovery_schedule.sql')?(await read(url))+'\n-- altered':read(url))).rejects.toThrow();
    await expect(reviewedMigrationPlan(async url=>url.pathname.endsWith('_journal.json')?JSON.stringify({version:'7',dialect:'postgresql',entries:[]}):read(url))).rejects.toThrow();
  });
  it('records completion only after independent ledger observation; uses no implicit migration configuration',async()=>{
    const plan=await reviewedMigrationPlan(),db=fakeDb(plan);
    const r=await executeIsolatedMigrations(migrationEnv(),authority,{docker:reader(),pool:db.pool,plan:async()=>plan,apply:db.apply});
    expect(r).toMatchObject({state:'COMPLETED',appliedCount:36,attemptFailed:false});
    expect(db.apply).toHaveBeenCalledOnce();expect(db.end).toHaveBeenCalledOnce();
  });
  it('does not retry a failed migration or infer rollback from failure',async()=>{
    const plan=await reviewedMigrationPlan(),db=fakeDb(plan),apply=vi.fn(async()=>{throw Error('synthetic COMMIT failure');});
    const r=await executeIsolatedMigrations(migrationEnv(),authority,{docker:reader(),pool:db.pool,plan:async()=>plan,apply});
    expect(r).toMatchObject({state:'INCOMPLETE',appliedCount:0,attemptFailed:true});expect(apply).toHaveBeenCalledOnce();
    expect(db.queries.some(s=>/DROP|DELETE|TRUNCATE/.test(s))).toBe(false);
  });
  it('recognizes committed migration despite lost acknowledgement and records unknown observation accurately',async()=>{
    const plan=await reviewedMigrationPlan(),db=fakeDb(plan);
    const r=await executeIsolatedMigrations(migrationEnv(),authority,{docker:reader(),pool:db.pool,plan:async()=>plan,apply:async()=>{db.setApplied(36);throw Error('lost acknowledgement');}});
    expect(r).toMatchObject({state:'COMPLETED',attemptFailed:true});
    const r2=await executeIsolatedMigrations(migrationEnv(),authority,{docker:reader(),pool:db.pool,plan:async()=>plan,apply:async()=>{db.setApplied(37);}});
    expect(r2.state).toBe('UNCERTAIN');
  });
  it('preserves uncertainty while an earlier migration backend still owns the lock',async()=>{
    const plan=await reviewedMigrationPlan(),db=fakeDb(plan);db.blockObserver();
    const r=await executeIsolatedMigrations(migrationEnv(),authority,{docker:reader(),pool:db.pool,plan:async()=>plan,apply:db.apply});
    expect(r).toMatchObject({state:'UNCERTAIN',appliedCount:null});expect(db.apply).toHaveBeenCalledOnce();
  });
  it('rejects credential and ledger preflight failures without applying anything',async()=>{
    const plan=await reviewedMigrationPlan(),db=fakeDb(plan,1);db.corruptLedger();
    await expect(executeIsolatedMigrations({NODE_ENV:'test'},authority,{docker:reader(),pool:db.pool,plan:async()=>plan,apply:db.apply})).rejects.toThrow();
    expect(db.pool).not.toHaveBeenCalled();
    await expect(executeIsolatedMigrations(migrationEnv(),authority,{docker:reader(),pool:db.pool,plan:async()=>plan,apply:db.apply})).rejects.toThrow('MIGRATION_LEDGER_REJECTED');
    expect(db.apply).not.toHaveBeenCalled();expect(db.end).toHaveBeenCalledOnce();
  });
});

describe('explicit integration setup, separate sessions and fake provider only',()=>{
  it('permanently rejects the retired mixed-privilege harness before touching inputs',async()=>{
    const body=vi.fn(),trap=new Proxy({}, {get(){throw Error('credentials accessed');}});
    await expect(withIsolatedPostgres(trap,undefined,trap,body)).rejects.toThrow('SEPARATE_FIXTURE_PROCESS_REQUIRED');
    expect(body).not.toHaveBeenCalled();
  });
  it('supports deterministic provider failures and invariant assertion helpers without live gateways',async()=>{
    const fake=fakeIntegrationStripe();expect(fake.calls).toEqual([]);fake.failNext();await expect(fake.gateway.verifyAccount()).rejects.toThrow('SYNTHETIC_PROVIDER_FAILURE');
    expect(()=>assertLeaseFenced(1)).toThrow();expect(()=>assertSettlementOnce({captures:2,allocations:1,notices:1})).toThrow();
    expect(()=>assertPreserved({old:1},{old:2})).toThrow();expect(()=>assertFairProgress(['a'],['a'])).toThrow();
  });
});
