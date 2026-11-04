import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolConfig } from 'pg';
import { AutomationScope, automationPoolOptions, boundedAutomationFetch, boundedAutomationPool } from '../src/server/stripe-automation-runtime';
import { stripeAutomationConfig } from '../src/server/stripe-automation-config';
import { runStripeAutomationVerification, type AutomationVerificationDependencies, type RecoveryProcessors } from '../src/server/stripe-automation-runner';
import { automationRecoveryProcessors } from '../src/server/stripe-automation-recovery';
import { workCounts } from '../src/server/payment-recovery';
import { attestIsolatedTarget, type AttestedTarget, type DockerEvidenceReader } from '../src/server/stripe-automation-target';
import { syntheticDockerEvidence } from './helpers/stripe-automation-target-fixture';

vi.mock('pg',()=>{throw Error('PostgreSQL construction forbidden');});
vi.mock('stripe',()=>{throw Error('Stripe construction forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Runtime pool import forbidden');});
let target:AttestedTarget;let docker:DockerEvidenceReader;
beforeEach(async()=>{vi.useFakeTimers();vi.setSystemTime(0);
  const evidence=syntheticDockerEvidence();
  evidence.container.networks['zemaitija-stripe-automation-internal'].address='172.29.0.2';
  docker={read:async()=>evidence};target=await attestIsolatedTarget(docker);
});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
function environment() {
  return {NODE_ENV:'test',STRIPE_AUTOMATION_ENABLED:'true',STRIPE_AUTOMATION_ENVIRONMENT:'isolated-development',
    STRIPE_AUTOMATION_DEPLOYMENT:'local',STRIPE_AUTOMATION_SECRET:'abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789',
    STRIPE_AUTOMATION_DB_NAME:'zemaitija_stripe_automation_dev',STRIPE_AUTOMATION_DB_HOST:'127.0.0.1',
    STRIPE_AUTOMATION_DB_PORT:'55433',STRIPE_AUTOMATION_DB_ROLE:'zemaitija_app',STRIPE_AUTOMATION_DB_SERVER_ADDRESS:'172.29.0.2',
    DATABASE_URL:'postgresql://zemaitija_app:0123456789abcdef0123456789ABCDEF01@127.0.0.1:55433/zemaitija_stripe_automation_dev',
    STRIPE_MODE:'test',STRIPE_SECRET_KEY:'sk_test_SyntheticFoundationKeyOnly123456',STRIPE_ACCOUNT_ID:'acct_synthetic',
    STRIPE_AUTOMATION_EXPECTED_ACCOUNT_ID:'acct_synthetic'};
}
describe('bounded database and provider transport contracts (fakes only)',()=>{
  it('requires the isolated target and configures real server/acquisition timeouts',()=>{
    const env=environment(),config=stripeAutomationConfig(env);
    expect(automationPoolOptions(config,env)).toMatchObject({max:1,pipeline:false,connectionTimeoutMillis:1000,
      statement_timeout:1000,lock_timeout:500,idle_in_transaction_session_timeout:1000,options:'-c transaction_timeout=10000'});
    expect(()=>automationPoolOptions(config,{...env,DATABASE_URL:env.DATABASE_URL.replace('_stripe_automation_dev','_dev')})).toThrow();
  });
  it('destroys a timed-out database connection and waits for actual rejection',async()=>{
    const scope=new AutomationScope(10000);let rejectQuery!:(error:Error)=>void;
    const query=vi.fn(()=>new Promise((_,reject)=>{rejectQuery=reject;}));
    const release=vi.fn((destroy:boolean)=>{if(destroy)rejectQuery(Error('connection destroyed'));});
    const raw={connect:async()=>({query,release}),end:vi.fn(async()=>{})} as unknown as Pool;
    const bounded=boundedAutomationPool(raw,()=>scope);
    const result=bounded.pool.query('SELECT synthetic_slow_work()').catch(error=>error);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toBeInstanceOf(Error);expect(release).toHaveBeenCalledExactlyOnceWith(true);
    await bounded.close();scope.close();expect(raw.end).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
  });
  it('clamps domain timeout settings and discards transactions on scope cancellation',async()=>{
    const scope=new AutomationScope(10000),query=vi.fn(async(sql:string)=>{void sql;return {rows:[]};}),release=vi.fn();
    const raw={connect:async()=>({query,release}),end:async()=>{}} as unknown as Pool;
    const bounded=boundedAutomationPool(raw,()=>scope),client=await bounded.pool.connect();
    await client.query("SET LOCAL statement_timeout='15s'");await client.query("SET LOCAL lock_timeout='5s'");
    expect(query.mock.calls.map(c=>c[0])).toEqual(["SET LOCAL statement_timeout='1000ms'","SET LOCAL lock_timeout='500ms'"]);
    scope.close();await expect(client.query('COMMIT')).rejects.toThrow();client.release();
    expect(release).toHaveBeenCalledWith(true);await bounded.close();
  });
  it('discards active clients before awaiting pool cleanup and rejects further acquisitions',async()=>{
    const scope=new AutomationScope(10000),release=vi.fn();let finish!:()=>void;
    const raw={connect:vi.fn(async()=>({query:vi.fn(),release})),
      end:vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}))} as unknown as Pool;
    const bounded=boundedAutomationPool(raw,()=>scope),client=await bounded.pool.connect();
    let settled=false;const closing=bounded.close().then(()=>{settled=true;});
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
    await expect(bounded.pool.connect()).rejects.toThrow('DATABASE_CLOSED');
    await expect(client.query('SELECT 1')).rejects.toThrow('DATABASE_CONNECTION_DISCARDED');
    expect(settled).toBe(false);finish();await closing;scope.close();
  });
  it('discards a late acquisition after the scope expired',async()=>{
    const scope=new AutomationScope(100);let acquired!:(client:object)=>void;
    const release=vi.fn(),query=vi.fn();
    const raw={connect:()=>new Promise(resolve=>{acquired=resolve;}),end:async()=>{}} as unknown as Pool;
    const bounded=boundedAutomationPool(raw,()=>scope);
    const result=bounded.pool.connect().catch(error=>error);
    await vi.advanceTimersByTimeAsync(101);acquired({query,release});
    expect(await result).toBeInstanceOf(Error);expect(release).toHaveBeenCalledWith(true);
    expect(query).not.toHaveBeenCalled();await bounded.close();scope.close();
  });
  it('aborts stalled provider headers through the actual supplied signal',async()=>{
    const scope=new AutomationScope(10000);let signal:AbortSignal|undefined;
    const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      signal=init?.signal??undefined;signal?.addEventListener('abort',()=>reject(Error('transport aborted')),{once:true});
    }));
    const fetch=boundedAutomationFetch(fetcher,()=>scope);
    const result=fetch('https://synthetic.invalid/never-a-real-call').catch(error=>error);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toBeInstanceOf(Error);expect(signal?.aborted).toBe(true);expect(fetcher).toHaveBeenCalledOnce();
    scope.close();expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps cancellation armed during a stalled body and releases its reader',async()=>{
    const scope=new AutomationScope(10000);let aborted=false;
    const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>new Response(new ReadableStream({
      start(controller){init?.signal?.addEventListener('abort',()=>{aborted=true;controller.error(Error('body aborted'));},{once:true});},
    })));
    const result=boundedAutomationFetch(fetcher,()=>scope)('https://synthetic.invalid/body').catch(error=>error);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await result).toBeInstanceOf(Error);expect(aborted).toBe(true);scope.close();expect(vi.getTimerCount()).toBe(0);
  });
  it('counts internal provider requests and bounds buffered responses',async()=>{
    const scope=new AutomationScope(10000,Date.now,undefined,2),fetcher=vi.fn(async()=>new Response('{}'));
    const fetch=boundedAutomationFetch(fetcher,()=>scope);
    await fetch('https://synthetic.invalid/a');await fetch('https://synthetic.invalid/b');
    await expect(fetch('https://synthetic.invalid/c')).rejects.toThrow('PROVIDER_REQUEST_BUDGET');
    expect(fetcher).toHaveBeenCalledTimes(2);scope.close();
    const bodyScope=new AutomationScope(10000);
    await expect(boundedAutomationFetch(async()=>new Response(new Uint8Array(1024*1024+1)),()=>bodyScope)
      ('https://synthetic.invalid/large')).rejects.toThrow('PROVIDER_RESPONSE_BUDGET');bodyScope.close();
  });
});

function harness() {
  const env={...environment(),STRIPE_AUTOMATION_DB_HOST:'172.29.0.2',STRIPE_AUTOMATION_DB_PORT:'5432',
    DATABASE_URL:environment().DATABASE_URL.replace('127.0.0.1:55433','172.29.0.2:5432')},trace:string[]=[];
  let safe=true,databaseName=env.STRIPE_AUTOMATION_DB_NAME,observationFailure=false;
  const query=vi.fn(async(sql:string)=>{
    if(sql.includes('current_database() AS database_name')){trace.push('identity');return {rows:[{
      database_name:databaseName,role_name:'zemaitija_app',session_role:'zemaitija_app',server_address:'172.29.0.2',
      server_port:5432,server_version:170006,in_recovery:false,database_owner:'zemaitija_migrator',
      superuser:false,create_database:false,create_role:false,bypass_rls:false}]};}
    if(sql.includes('pg_has_role')){trace.push('capabilities');return {rows:[{safe}]};}
    if(sql.includes('LIMIT 26')){if(observationFailure)throw Error('sensitive error');return {rows:Array.from({length:26},()=>({id:'synthetic'}))};}
    return {rows:[],rowCount:0};
  });
  const raw={connect:async()=>({query,release:vi.fn()}),end:vi.fn(async()=>{})} as unknown as Pool;
  const provider={accountId:'acct_synthetic',verifyAccount:vi.fn(async()=>{trace.push('account');return 'acct_synthetic';}),
    createSession:vi.fn(),retrieveSession:vi.fn(),retrievePaymentIntent:vi.fn(),findSessionForPaymentIntent:vi.fn(),expireSession:vi.fn(),verifyEvent:vi.fn()};
  const processors:RecoveryProcessors={PAYMENT_WEBHOOKS:vi.fn(async()=>workCounts()),CHECKOUT_COMMAND_RECOVERY:vi.fn(async()=>workCounts()),
    INITIAL_RECONCILIATION:vi.fn(async()=>workCounts()),BALANCE_RECONCILIATION:vi.fn(async()=>workCounts())};
  const deps:AutomationVerificationDependencies={target,docker,
    constructDatabase:vi.fn((options:PoolConfig)=>{expect(options.connectionTimeoutMillis).toBe(1000);trace.push('database');return raw;}),
    constructStripe:vi.fn(()=>{trace.push('stripe');return provider;}),fetch:vi.fn(async()=>{throw Error('Unexpected network');}),
    processors:vi.fn(()=>{trace.push('processors');return processors;}),
  };
  return {env,deps,processors,trace,raw,query,provider,
    run:()=>runStripeAutomationVerification(env,`Bearer ${env.STRIPE_AUTOMATION_SECRET}`,deps),
    unsafe:()=>{safe=false;},wrongDatabase:()=>{databaseName='zemaitija_dev';},observationFailure:()=>{observationFailure=true;}};
}
describe('source-only bounded orchestration with deterministic injected resources',()=>{
  it('authenticates before touching factories and rejects disabled/protected configuration',async()=>{
    const f=harness();
    await expect(runStripeAutomationVerification(f.env,null,f.deps)).rejects.toThrow('UNAUTHORIZED');
    await expect(runStripeAutomationVerification({...f.env,STRIPE_AUTOMATION_ENABLED:'false'},null,f.deps)).rejects.toThrow('DISABLED');
    await expect(runStripeAutomationVerification({...f.env,STRIPE_AUTOMATION_DB_NAME:'zemaitija_dev'},null,f.deps)).rejects.toThrow();
    expect(f.deps.constructDatabase).not.toHaveBeenCalled();expect(f.deps.constructStripe).not.toHaveBeenCalled();
  });
  it('verifies actual database capabilities before provider identity and processors',async()=>{
    const f=harness(),result=await f.run();
    expect(f.trace.slice(0,6)).toEqual(['database','identity','capabilities','stripe','account','processors']);
    expect(f.trace.filter(s=>s==='identity')).toHaveLength(5);
    expect(result.status).toBe('BOUNDED');expect(result.processingEnabled).toBe(true);
    expect(result.deadlineExceeded).toBe(false);
    expect(f.raw.end).toHaveBeenCalledOnce();expect(f.deps.fetch).not.toHaveBeenCalled();
    expect(f.processors.PAYMENT_WEBHOOKS).toHaveBeenCalledWith(2,expect.objectContaining({admit:expect.any(Function)}));
    for(const name of ['CHECKOUT_COMMAND_RECOVERY','INITIAL_RECONCILIATION','BALANCE_RECONCILIATION'] as const)
      expect(f.processors[name]).toHaveBeenCalledWith(1,expect.any(Object));
    expect(result.deferred.refundEvents).toEqual({available:true,sampled:25,hasMore:true});
    expect(result.deferred.refundLiabilities.available).toBe(true);expect(result.deferred.investigation.available).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['wrongDatabase','unsafe'] as const)('rejects %s before constructing a provider',async condition=>{
    const f=harness();f[condition]();const result=await f.run();
    expect(result.status).toBe('FAILED');expect(result.lanes).toEqual([]);
    expect(result.processingEnabled).toBe(false);
    expect(f.deps.constructStripe).not.toHaveBeenCalled();expect(f.raw.end).toHaveBeenCalledOnce();
  });
  it('rejects mismatched provider identity before admitting any lane',async()=>{
    const f=harness();f.provider.verifyAccount.mockResolvedValue('acct_wrong');const result=await f.run();
    expect(result.status).toBe('FAILED');expect(f.deps.processors).not.toHaveBeenCalled();
    expect(result.processingEnabled).toBe(false);
  });
  it('reports partial lane failure and still admits independent lanes',async()=>{
    const f=harness();vi.mocked(f.processors.PAYMENT_WEBHOOKS).mockRejectedValue(Error('sensitive raw provider error'));
    const result=await f.run();expect(result.status).toBe('PARTIAL');expect(result.lanes[0].state).toBe('FAILED');
    expect(result.processingEnabled).toBe(true);
    expect(result.lanes.slice(1).every(l=>l.state==='DONE')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sensitive');
  });
  it('enforces admission deadlines without borrowing budgets or pretending deferred lanes ran',async()=>{
    const f=harness();let instant=0;f.deps.now=()=>instant;
    vi.mocked(f.processors.PAYMENT_WEBHOOKS).mockImplementation(async()=>{instant+=8000;return workCounts();});
    vi.mocked(f.processors.CHECKOUT_COMMAND_RECOVERY).mockImplementation(async()=>{instant+=8000;return workCounts();});
    const result=await f.run();
    expect(result.lanes.map(l=>l.state)).toEqual(['DONE','DONE','DEFERRED','DEFERRED']);
    expect(f.processors.INITIAL_RECONCILIATION).not.toHaveBeenCalled();expect(f.processors.BALANCE_RECONCILIATION).not.toHaveBeenCalled();
  });
  it('reports no processing when all lanes miss admission after successful guards',async()=>{
    const f=harness();
    f.provider.verifyAccount.mockImplementation(async()=>{vi.setSystemTime(15000);return 'acct_synthetic';});
    const result=await f.run();
    expect(result.processingEnabled).toBe(false);
    expect(result.lanes.every(l=>l.state==='DEFERRED')).toBe(true);
    for(const processor of Object.values(f.processors))expect(processor).not.toHaveBeenCalled();
  });
  it('awaits stalled cleanup beyond the cooperative deadline and reports the overrun',async()=>{
    const f=harness();let finish!:()=>void,started!:()=>void;
    const cleaning=new Promise<void>(resolve=>{started=resolve;});
    vi.mocked(f.raw.end).mockImplementation(()=>new Promise<void>(resolve=>{finish=resolve;started();}));
    let settled=false;
    const pending=f.run().then(result=>{settled=true;return result;});
    await cleaning;
    await vi.advanceTimersByTimeAsync(60001);
    expect(settled).toBe(false); // No race abandons pending cleanup.
    finish();const result=await pending;
    expect(result).toMatchObject({status:'PARTIAL',deadlineExceeded:true,cleanupFailed:false,processingEnabled:true});
    expect(vi.getTimerCount()).toBe(0);
  });
  it('retains financial success and failed metadata counts in lane reporting',async()=>{
    const f=harness();
    vi.mocked(f.processors.INITIAL_RECONCILIATION).mockResolvedValue({...workCounts(),
      attempted:1,financialSucceeded:1,processed:0,failed:1,deferred:1});
    const result=await f.run();
    expect(result.status).toBe('PARTIAL');
    expect(result.lanes[2]).toMatchObject({state:'FAILED',financialSucceeded:1,processed:0,failed:1,deferred:1});
  });
  it('rejects over-budget accounting and reports unknown observations and cleanup errors',async()=>{
    const f=harness();vi.mocked(f.processors.PAYMENT_WEBHOOKS).mockResolvedValue({...workCounts(),attempted:3});
    f.observationFailure();vi.mocked(f.raw.end).mockRejectedValue(Error('cleanup failed'));
    const result=await f.run();expect(result.status).toBe('PARTIAL');expect(result.cleanupFailed).toBe(true);
    expect(result.lanes[0].state).toBe('FAILED');expect(result.deferred.refundEvents.available).toBe(false);
  });
  it('retains known partial counters when a lane reaches its deadline',async()=>{
    const f=harness();let instant=0;f.deps.now=()=>instant;
    vi.mocked(f.processors.PAYMENT_WEBHOOKS).mockImplementation(async()=>{
      instant=10001;return {...workCounts(),attempted:1,processed:1};
    });
    const result=await f.run();expect(result.status).toBe('PARTIAL');
    expect(result.lanes[0]).toMatchObject({state:'FAILED',attempted:1,processed:1,failed:1});
  });
  it('wires the actual four recovery interfaces with no due fake work',async()=>{
    const f=harness();f.deps.processors=(pool,gateway)=>automationRecoveryProcessors(pool,gateway,
      {successUrl:'http://localhost/success',cancelUrl:'http://localhost/cancel'});
    const result=await f.run();expect(result.status).toBe('BOUNDED');
    expect(result.lanes.every(l=>l.state==='DONE'&&l.attempted===0)).toBe(true);
    expect(f.provider.createSession).not.toHaveBeenCalled();expect(f.provider.retrieveSession).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(([sql])=>sql.includes('claim_payment_recovery'))).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
