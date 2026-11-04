import { commitAcknowledgement } from '../scripts/lib/stripe-automation-transactions';
import { recoverPaymentAttempts } from '../src/server/payment-recovery';
import { fakeIntegrationStripe } from './helpers/stripe-automation-postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import { testFixtures, testPermit, type TestPermit } from '../scripts/lib/stripe-automation-test-contract';
import { requireExecution, ISOLATED_IDENTITY_SQL } from '../scripts/lib/stripe-automation-connection';
import { fixtureOperation, fixtureMain } from '../scripts/stripe-automation-fixtures';
import { acceptanceMain } from '../scripts/stripe-automation-postgres-acceptance';
import { applicationTestContext } from './helpers/stripe-automation-app';
import { syntheticDockerEvidence } from './helpers/stripe-automation-target-fixture';
import { reviewedMigrationPlan, migrationMain } from '../scripts/stripe-automation-migrate';
import { observePoolShutdown } from '../src/server/automation-settlement';
import { AutomationScope, boundedAutomationPool } from '../src/server/stripe-automation-runtime';

vi.mock('pg',()=>{throw Error('Live PostgreSQL forbidden');});
vi.mock('stripe',()=>{throw Error('Stripe SDK forbidden');});
vi.mock('node:child_process',()=>({execFile:vi.fn(()=>{throw Error('Live Docker forbidden');})}));
vi.mock('../src/db/client',()=>{throw Error('Shared application database forbidden');});
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
const permit:TestPermit={stage:'2B-3C-1',operation:'fixture-setup',runId:'synthetic_hardening_0001',humanApprovalReference:'synthetic_review_0001'};
const f=testFixtures(permit.runId),docker={read:async()=>syntheticDockerEvidence()};
const env=(app=false)=>({NODE_ENV:'test',[app?'DATABASE_URL':'MIGRATION_DATABASE_URL']:
  `postgresql://${app?'zemaitija_app':'zemaitija_migrator'}:synthetic_password_0123456789abcdef@172.22.0.2:5432/zemaitija_stripe_automation_dev`});
async function database() {
  const plan=await reviewedMigrationPlan(),sql:string[]=[],roles:string[]=[];
  let loseCommit=false,unrelated=false,ownership=true;
  const end=vi.fn(async()=>{}),release=vi.fn();
  const pool=vi.fn((options:{connectionString:string})=>{
    const role=new URL(options.connectionString).username;roles.push(role);
    return {end,connect:async()=>({release,query:async(statement:string)=>{
      sql.push(statement);
      if(statement===ISOLATED_IDENTITY_SQL)return {rows:[{database_name:'zemaitija_stripe_automation_dev',role_name:role,session_role:role,
        server_address:'172.22.0.2',server_port:5432,server_version:170006,in_recovery:false,database_owner:'zemaitija_migrator',
        superuser:false,create_database:false,create_role:false,replication:false,bypass_rls:false,has_memberships:false,
        database_create:role==='zemaitija_migrator',schema_create:role==='zemaitija_migrator'}]};
      if(statement.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};
      if(statement.includes('to_regclass'))return {rows:[{ledger:'drizzle.__drizzle_migrations'}]};
      if(statement.startsWith('SELECT hash,'))return {rows:plan.entries.map(e=>({hash:e.sha256,created_at:String(e.when)}))};
      if(statement.includes(') safe'))return {rows:[{safe:true}]};
      if(statement.includes('SELECT u.unit_key'))return {rows:ownership?[{unit_key:f.key,retention_state:'SYNTHETIC',marker:f.key,unit_id:f.unit,state:'ACTIVE'}]:[]};
      if(statement.includes('SELECT a.recovery_enabled'))return {rows:[{recovery_enabled:false,guest_id:f.guest,unit_id:f.unit}]};
      if(statement.includes('count(*)'))return {rows:[{n:unrelated?1:0}]};
      if(statement==='COMMIT' && loseCommit)throw Error('synthetic reply loss');
      return {rows:[]};
    }})};
  });
  return {pool,plan,sql,roles,end,release,lose:()=>{loseCommit=true;},unrelated:()=>{unrelated=true;},foreign:()=>{ownership=false;}};
}
describe('explicit human approval assertions and isolated process boundaries',()=>{
  it('requires a review reference without treating it as independent authorization',async()=>{
    expect(()=>requireExecution({stage:'2B-3C',operation:'migrate',runId:permit.runId},'migrate')).toThrow('HUMAN_APPROVAL_REFERENCE_REQUIRED');
    await expect(migrationMain(['--approved-stage-2b-3c-migrations',permit.runId],{})).rejects.toThrow('EXECUTION_NOT_AUTHORIZED');
    for(const operation of ['fixture-setup','app-tests','fixture-retain'] as const) {
      expect(()=>testPermit([`--acknowledge-stage-2b-3c-1-${operation}`,permit.runId,'--human-approval-reference',permit.humanApprovalReference],operation)).not.toThrow();
      expect(()=>testPermit([],operation)).toThrow('LIVE_TEST_GATE_CLOSED');
    }
  });
  it('rejects every live entry before dependencies or credentials when its gate is absent',async()=>{
    const trap=new Proxy({}, {get(){throw Error('dependency touched');}});
    await expect(fixtureOperation({},undefined,trap as never)).rejects.toThrow('LIVE_TEST_GATE_CLOSED');
    await expect(applicationTestContext({},undefined,trap as never)).rejects.toThrow('LIVE_TEST_GATE_CLOSED');
    await expect(fixtureMain([],{})).rejects.toThrow('LIVE_TEST_GATE_CLOSED');
    await expect(acceptanceMain([],{})).rejects.toThrow('LIVE_TEST_GATE_CLOSED');
  });
  it('rejects cross-role credentials before pool construction',async()=>{
    const db=await database();
    await expect(applicationTestContext({...env(true),...env()}, {...permit,operation:'app-tests'}, {docker,pool:db.pool})).rejects.toThrow('ISOLATED_ENVIRONMENT_REJECTED');
    await expect(fixtureOperation(env(true),permit,{docker,pool:db.pool})).rejects.toThrow('ISOLATED_ENVIRONMENT_REJECTED');
    expect(db.pool).not.toHaveBeenCalled();
  });
  it('creates fixed run-owned synthetic fixtures and never accepts SQL callbacks',async()=>{
    const db=await database();await fixtureOperation(env(),permit,{docker,pool:db.pool,plan:async()=>db.plan});
    expect(db.roles).toEqual(['zemaitija_migrator']);expect(db.sql.filter(s=>s==='COMMIT')).toHaveLength(1);
    expect(db.sql.some(s=>/DELETE|TRUNCATE|DROP|DISABLE TRIGGER/.test(s))).toBe(false);
    expect(testFixtures(permit.runId)).toEqual(f);expect(testFixtures('different_run_0001').unit).not.toBe(f.unit);
    expect(db.end).toHaveBeenCalledOnce();
  });
  it('separately authorized cleanup verifies ownership and retains all immutable data',async()=>{
    const db=await database();const result=await fixtureOperation(env(),{...permit,operation:'fixture-retain'},{docker,pool:db.pool,plan:async()=>db.plan});
    expect(result.state).toBe('EVIDENCE_RETAINED');expect(db.sql.some(s=>/^(INSERT|UPDATE|DELETE|TRUNCATE|DROP)/.test(s))).toBe(false);
    db.foreign();await expect(fixtureOperation(env(),{...permit,operation:'fixture-retain'},{docker,pool:db.pool,plan:async()=>db.plan})).rejects.toThrow('FIXTURE_REJECTED_PRESERVE');
  });
  it('preserves uncertain fixture commit evidence with no retry or rollback claim',async()=>{
    const db=await database();db.lose();await expect(fixtureOperation(env(),permit,{docker,pool:db.pool,plan:async()=>db.plan})).rejects.toThrow('FIXTURE_COMMIT_UNCERTAIN_PRESERVE');
    expect(db.sql.filter(s=>s==='COMMIT')).toHaveLength(1);expect(db.sql.at(-1)).toBe('COMMIT');expect(db.end).toHaveBeenCalledOnce();
  });
  it('refuses setup when isolated data already exists',async()=>{
    const db=await database();db.unrelated();await expect(fixtureOperation(env(),permit,{docker,pool:db.pool,plan:async()=>db.plan})).rejects.toThrow('FIXTURE_REJECTED_PRESERVE');
    expect(db.sql.some(s=>s.startsWith('INSERT'))).toBe(false);
  });
  it('application callbacks can access only application sessions and close all acquired sessions',async()=>{
    const db=await database();const h=await applicationTestContext(env(true),{...permit,operation:'app-tests'},{docker,pool:db.pool});
    expect(db.roles).toEqual(['zemaitija_app']);expect(h).not.toHaveProperty('rollbackFixture');expect(h).not.toHaveProperty('withOwnedFixtures');
    const [a,b]=await Promise.all([h.connect(),h.connect()]);expect(a).not.toBe(b);
    await h.close();await expect(h.connect()).rejects.toThrow('INTEGRATION_CLOSED');expect(db.end).toHaveBeenCalledOnce();
    expect(db.release).toHaveBeenCalledWith(true);expect(h.stripe.calls).toEqual([]);
  });
  it('keeps privileged setup out of the app entry and keeps live definitions out of unit discovery',()=>{
    const app=readFileSync(new URL('../scripts/stripe-automation-postgres-acceptance.ts',import.meta.url),'utf8');
    expect(app).not.toContain('stripe-automation-fixtures');expect(app).not.toContain('MIGRATION_DATABASE_URL');
    const scenarios=readFileSync(new URL('./stripe-automation-postgres.scenarios.ts',import.meta.url),'utf8');
    expect(scenarios).not.toContain("from 'vitest'");expect(scenarios).not.toContain('new Pool');
    expect(JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts).not.toHaveProperty('postinstall');
  });
});
describe('truthful cleanup observations and external supervision',()=>{
  it('reports normal settlement and shutdown rejection without leaving timers',async()=>{
    vi.useFakeTimers();const observe=vi.fn();await observePoolShutdown(async()=>{},observe);
    expect(observe).toHaveBeenCalledExactlyOnceWith('SETTLED');
    await expect(observePoolShutdown(async()=>{throw Error('shutdown failed');},observe)).rejects.toThrow('shutdown failed');
    expect(observe).toHaveBeenLastCalledWith('FAILED');expect(vi.getTimerCount()).toBe(0);
  });
  it('reports a stalled pool without resolving or claiming cancellation',async()=>{
    vi.useFakeTimers();const observe=vi.fn();let finish!:()=>void,settled=false;
    const pending=observePoolShutdown(()=>new Promise<void>(r=>{finish=r;}),observe).then(()=>{settled=true;});
    await vi.advanceTimersByTimeAsync(1001);expect(observe).toHaveBeenCalledExactlyOnceWith('PENDING_EXTERNAL_SUPERVISION');
    expect(settled).toBe(false);finish();await pending;expect(observe).toHaveBeenLastCalledWith('SETTLED');
  });
  it('closes idempotently and still settles the pool after a destructive-release error',async()=>{
    vi.useFakeTimers();const scope=new AutomationScope(Date.now()+10000),end=vi.fn(async()=>{});
    const raw={connect:async()=>({release:()=>{throw Error('release failure');}}),end} as unknown as Pool;
    const h=boundedAutomationPool(raw,()=>scope);await h.pool.connect();
    const first=h.close(),second=h.close();expect(first).toBe(second);await expect(first).rejects.toThrow('DATABASE_RELEASE_FAILED');
    expect(end).toHaveBeenCalledOnce();scope.close();expect(vi.getTimerCount()).toBe(0);
  });
  it('does not abandon cleanup when its reporting callback throws',async()=>{
    await expect(observePoolShutdown(async()=>{},()=>{throw Error('reporting failed');})).resolves.toBeUndefined();
  });
});

describe('financial and transaction settlement evidence',()=>{
  it('classifies a missing commit reply as uncertain and never retries or rolls back',async()=>{
    const query=vi.fn(async()=>{throw Error('synthetic lost acknowledgement');});
    expect(await commitAcknowledgement({query})).toBe('UNCERTAIN');
    expect(query).toHaveBeenCalledExactlyOnceWith('COMMIT');
    expect(await commitAcknowledgement({query:async()=>({rows:[]})})).toBe('ACKNOWLEDGED');
  });
  it('preserves committed financial success when metadata completion fails',async()=>{
    const fake=fakeIntegrationStripe(),reconcile=vi.fn(async()=> 'CONFIRMED');
    const pool={query:vi.fn(async(sql:string)=>{
      if(sql.includes('claim_payment_recovery'))return {rows:[{attempt_id:f.historyAttempt,generation:'1',failure_count:0}]};
      if(sql.startsWith('SELECT state'))return {rows:[{state:'SUCCEEDED',stripe_session_id:'cs_test_synthetic'}]};
      if(sql.includes('finish_payment_recovery'))throw Error('synthetic lost metadata acknowledgement');
      throw Error('unexpected query');
    })} as unknown as Pool;
    const result=await recoverPaymentAttempts(pool,fake.gateway,'INITIAL',reconcile,1,{workerId:'worker_synthetic',random:()=>0});
    expect(result).toMatchObject({financialSucceeded:1,processed:0,deferred:1,failed:1});
    expect(result.items[0]).toMatchObject({observation:'SUCCESS',scheduleCommitted:false});
    expect(reconcile).not.toHaveBeenCalled();expect(fake.calls).toEqual([]);
  });
});
