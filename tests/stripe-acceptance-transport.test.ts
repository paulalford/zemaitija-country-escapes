import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStripeAcceptanceBoundary, type AcceptanceAuthority, type AcceptanceDependencies,
  type StripeAcceptanceBoundary } from '../src/server/stripe-acceptance';
import { automationRecoveryProcessors } from '../src/server/stripe-automation-recovery';
import { workCounts } from '../src/server/payment-recovery';
import { boundedAutomationFetch, AutomationScope } from '../src/server/stripe-automation-runtime';
import { syntheticDockerEvidence } from './helpers/stripe-automation-target-fixture';
import { fakeIntegrationStripe } from './helpers/stripe-automation-postgres';

vi.mock('pg',()=>{throw Error('Live PostgreSQL forbidden');});
vi.mock('stripe',()=>{throw Error('Real Stripe SDK forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Shared pool forbidden');});
vi.mock('../scripts/lib/stripe-automation-docker',()=>{throw Error('Docker adapter forbidden');});
vi.mock('../src/server/stripe-automation-recovery',()=>({automationRecoveryProcessors:vi.fn()}));

const authority:AcceptanceAuthority={stage:'2C-2',operation:'booking-and-webhook',runId:'synthetic_stage2c3c_0001',
  humanApprovalReference:'synthetic_booking_review_0001',guestId:'00000000-0000-4000-8000-000000000001'};
const permit:AcceptanceAuthority={...authority,operation:'automation',humanApprovalReference:'synthetic_worker_review_0001'};
const token='abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789',bearer=`Bearer ${token}`;
const instances:StripeAcceptanceBoundary[]=[];
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(0);vi.clearAllMocks();
  vi.stubGlobal('fetch',vi.fn(()=>{throw Error('Default network forbidden');}));
  vi.mocked(automationRecoveryProcessors).mockImplementation((_pool,provider)=>{
    const process=async()=>{await provider.retrieveSession('cs_test_synthetic');return workCounts();};
    return {PAYMENT_WEBHOOKS:process,CHECKOUT_COMMAND_RECOVERY:process,INITIAL_RECONCILIATION:process,BALANCE_RECONCILIATION:process};
  });
});
afterEach(async()=>{
  for(const boundary of instances.splice(0))await boundary.close().catch(()=>{});
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();
});
function harness() {
  const evidence=syntheticDockerEvidence(),trace:string[]=[],ends:ReturnType<typeof vi.fn>[]=[];
  const env={NODE_ENV:'test',STRIPE_ACCEPTANCE_ENABLED:'true',STRIPE_ACCEPTANCE_ENVIRONMENT:'isolated-development',
    STRIPE_ACCEPTANCE_DEPLOYMENT:'local',STRIPE_ACCEPTANCE_SECRET:token,
    STRIPE_ACCEPTANCE_DATABASE_URL:'postgresql://zemaitija_app:synthetic_password_only_0123456789@172.22.0.2:5432/zemaitija_stripe_automation_dev',
    STRIPE_ACCEPTANCE_ORIGIN:'http://127.0.0.1:3100',STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID:'acct_synthetic',
    STRIPE_MODE:'test',STRIPE_SECRET_KEY:'sk_test_SyntheticNeverUse123456',STRIPE_ACCOUNT_ID:'acct_synthetic',
    STRIPE_WEBHOOK_SECRET:'whsec_SyntheticNeverUse123456'};
  let wrongDatabase=false,account='acct_synthetic',missingAccount=false;
  const query=vi.fn(async(sql:string)=>{
    if(sql.includes('current_database()') && sql.includes('database_name')){trace.push('database-identity');return {rows:[{
      database_name:wrongDatabase?'zemaitija_dev':'zemaitija_stripe_automation_dev',role_name:'zemaitija_app',session_role:'zemaitija_app',
      server_address:'172.22.0.2',server_port:5432,server_version:170006,in_recovery:false,database_owner:'zemaitija_migrator',
      superuser:false,create_database:false,create_role:false,replication:false,bypass_rls:false,has_memberships:false,
      database_create:false,schema_create:false}]};}
    if(sql.includes('pg_has_role'))return {rows:[{safe:true}]};
    return {rows:[],rowCount:0};
  });
  const fetch=vi.fn<typeof globalThis.fetch>(async()=>{trace.push('http');return new Response('{}');});
  const gateways:{provider:ReturnType<typeof fakeIntegrationStripe>['gateway'];transport:{fetch:typeof globalThis.fetch}}[]=[];
  const gateway=vi.fn<AcceptanceDependencies['gateway']>((_config,transport)=>{
    trace.push('gateway');const provider=fakeIntegrationStripe().gateway;
    provider.verifyAccount=vi.fn(async()=>{await transport.fetch('https://synthetic.invalid/account');return account;});
    provider.retrieveSession=vi.fn(async()=>{await transport.fetch('https://synthetic.invalid/session');return {} as never;});
    if(missingAccount)Reflect.deleteProperty(provider,'verifyAccount');
    gateways.push({provider,transport});return provider;
  });
  const pool=vi.fn<AcceptanceDependencies['pool']>(()=>{
    const end=vi.fn(async()=>{});ends.push(end);
    return {connect:async()=>({query,release:vi.fn()}),end};
  });
  const deps:AcceptanceDependencies={pool,gateway,fetch,docker:{read:vi.fn(async()=>evidence)}};
  return {env,deps,evidence,gateways,ends,trace,fetch,gateway,pool,query,
    wrongDatabase:()=>{wrongDatabase=true;},wrongAccount:()=>{account='acct_other';},missingAccount:()=>{missingAccount=true;},
    async open(){const b=await createStripeAcceptanceBoundary(env,authority,bearer,deps);instances.push(b);return b;}};
}

describe('acceptance boundary using the real runner and fake resources',()=>{
  it('constructs a fresh gateway on the runner transport and routes every worker request through it',async()=>{
    const h=harness(),b=await h.open();
    expect(h.fetch).toHaveBeenCalledTimes(1); // Separately bounded startup account read.
    const result=await b.automation(bearer,permit);
    expect(result).toMatchObject({status:'BOUNDED',processingEnabled:true,cleanupFailed:false});
    expect(h.gateways).toHaveLength(2);
    expect(h.gateways[1].provider).not.toBe(h.gateways[0].provider);
    expect(h.gateways[1].transport.fetch).not.toBe(h.deps.fetch);
    expect(h.gateways[1].transport.fetch).not.toBe(h.gateways[0].transport.fetch);
    expect(h.fetch).toHaveBeenCalledTimes(6); // Startup + worker account + four lane requests.
    expect(h.gateways[0].provider.retrieveSession).not.toHaveBeenCalled();
    expect(h.gateways[1].provider.retrieveSession).toHaveBeenCalledTimes(4);
    expect(h.trace.indexOf('database-identity')).toBeLessThan(h.trace.indexOf('gateway'));
    await expect(h.gateways[0].transport.fetch('https://synthetic.invalid/late-startup')).rejects.toThrow('AUTOMATION_DEADLINE');
    await expect(h.gateways[1].transport.fetch('https://synthetic.invalid/late-worker')).rejects.toThrow('AUTOMATION_DEADLINE');
    expect(h.fetch).toHaveBeenCalledTimes(6);expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('rejects authority and changed target before constructing a worker provider',async()=>{
    const h=harness(),b=await h.open();
    await expect(b.automation(bearer,authority)).rejects.toThrow('UNAUTHORIZED');
    h.wrongDatabase();const result=await b.automation(bearer,permit);
    expect(result).toMatchObject({status:'FAILED',processingEnabled:false});
    expect(h.gateway).toHaveBeenCalledTimes(1);expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(automationRecoveryProcessors).not.toHaveBeenCalled();
  });
  it('rejects initial target drift before any gateway or provider request',async()=>{
    const h=harness();h.evidence.network.internal=false;
    await expect(h.open()).rejects.toThrow();expect(h.gateway).not.toHaveBeenCalled();expect(h.fetch).not.toHaveBeenCalled();
  });
  it('requires a new account verification for each invocation and blocks mismatches before processors',async()=>{
    const h=harness(),b=await h.open();h.wrongAccount();
    const result=await b.automation(bearer,permit);
    expect(result).toMatchObject({status:'FAILED',processingEnabled:false});
    expect(h.gateways[1].provider.verifyAccount).toHaveBeenCalledOnce();
    expect(automationRecoveryProcessors).not.toHaveBeenCalled();
  });
  it('fails safely for missing account evidence and raw transport',async()=>{
    const h=harness();h.missingAccount();await expect(h.open()).rejects.toThrow('IDENTITY');
    expect(h.fetch).not.toHaveBeenCalled();expect(h.ends[0]).toHaveBeenCalledOnce();
    const g=harness();Object.assign(g.deps,{fetch:undefined});
    await expect(g.open()).rejects.toThrow('IDENTITY');expect(g.gateway).not.toHaveBeenCalled();
  });
  it('bounds startup account HTTP verification and aborts a possibly sent request',async()=>{
    const h=harness();let signal:AbortSignal|undefined;
    h.fetch.mockImplementation(async(_input,init)=>new Promise((_resolve,reject)=>{
      signal=init?.signal??undefined;signal?.addEventListener('abort',()=>reject(Error('outcome unknown')),{once:true});
    }));
    const pending=h.open().catch(error=>error);
    await vi.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({code:'IDENTITY'});expect(signal?.aborted).toBe(true);
    expect(h.fetch).toHaveBeenCalledOnce();expect(automationRecoveryProcessors).not.toHaveBeenCalled();
  });
  it('rejects startup account evidence that arrives after the overall startup deadline',async()=>{
    const h=harness();h.gateway.mockImplementationOnce(()=>{
      const provider=fakeIntegrationStripe().gateway;
      provider.verifyAccount=async()=>{vi.setSystemTime(10001);return 'acct_synthetic';};
      return provider;
    });
    await expect(h.open()).rejects.toThrow('IDENTITY');expect(h.fetch).not.toHaveBeenCalled();
    expect(automationRecoveryProcessors).not.toHaveBeenCalled();
  });
  it('aborts worker HTTP and reports partial processing without declaring a payment failure',async()=>{
    const h=harness(),b=await h.open();let signal:AbortSignal|undefined;
    h.fetch.mockImplementation(async(input,init)=>{
      if(String(input).endsWith('/account'))return new Response('{}');
      return new Promise((_resolve,reject)=>{
        signal=init?.signal??undefined;signal?.addEventListener('abort',()=>reject(Error('sent, response unknown')),{once:true});
      });
    });
    const pending=b.automation(bearer,permit);
    await vi.advanceTimersByTimeAsync(4001);
    const result=await pending;
    expect(result).toMatchObject({status:'PARTIAL',processingEnabled:true});
    expect(signal?.aborted).toBe(true);expect(result.lanes.every(l=>l.state==='FAILED')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('sent, response unknown');
  });
  it('exhausts the supplied scope budget before sending another request',async()=>{
    const h=harness(),b=await h.open();
    vi.mocked(automationRecoveryProcessors).mockImplementation((_pool,provider)=>({
      PAYMENT_WEBHOOKS:async()=>{for(let i=0;i<13;i++)await provider.retrieveSession('cs_test_synthetic');return workCounts();},
      CHECKOUT_COMMAND_RECOVERY:async()=>workCounts(),INITIAL_RECONCILIATION:async()=>workCounts(),BALANCE_RECONCILIATION:async()=>workCounts(),
    }));
    const result=await b.automation(bearer,permit);
    expect(result.status).toBe('PARTIAL');expect(result.lanes[0].state).toBe('FAILED');
    expect(h.fetch).toHaveBeenCalledTimes(14); // Startup + worker account + 12 sent lane requests.
  });
  it('surfaces startup cleanup failure without leaking raw errors',async()=>{
    const h=harness();h.missingAccount();
    h.pool.mockImplementation(()=>({connect:async()=>({query:h.query,release:vi.fn()}),end:async()=>{throw Error('private driver details');}}));
    await expect(h.open()).rejects.toMatchObject({code:'CLEANUP_UNCERTAIN',message:'CLEANUP_UNCERTAIN'});
  });
  it('reports worker cleanup failure and leaves the status operation inactive',async()=>{
    const h=harness(),b=await h.open();
    h.pool.mockImplementation(()=>({connect:async()=>({query:h.query,release:vi.fn()}),end:async()=>{throw Error('private cleanup details');}}));
    const result=await b.automation(bearer,permit);
    expect(result).toMatchObject({status:'PARTIAL',cleanupFailed:true});
    expect(b.automationStatus(bearer)).toMatchObject({status:'INACTIVE',processingEnabled:false});
  });
});

describe('provider requests rejected before transmission',()=>{
  it.each(['expired','cancelled','caller-aborted'] as const)('does not send after %s',async kind=>{
    const scope=new AutomationScope(kind==='expired'?0:10000),fetcher=vi.fn(async()=>new Response('{}'));
    const controller=new AbortController();
    if(kind==='cancelled')scope.close();
    if(kind==='caller-aborted')controller.abort();
    try {
      await expect(boundedAutomationFetch(fetcher,()=>scope)('https://synthetic.invalid/not-sent',{signal:controller.signal}))
        .rejects.toThrow('AUTOMATION_DEADLINE');
      expect(fetcher).not.toHaveBeenCalled();
    } finally {scope.close();}
  });
});
