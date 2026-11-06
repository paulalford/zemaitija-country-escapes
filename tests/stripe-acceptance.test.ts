import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createStripeAcceptanceBoundary, stripeAcceptanceConfig, type AcceptanceAuthority } from '../src/server/stripe-acceptance';
import { stripeAcceptanceHttp } from '../src/server/stripe-acceptance-http';
import { acceptBooking, type AcceptanceRequest } from '../src/server/booking-acceptance';
import { quoteStay, type QuotePreview } from '../src/server/quote';
import { runStripeAutomationVerification } from '../src/server/stripe-automation-runner';
import { ISOLATED_IDENTITY_SQL, type ExplicitEnvironment, type PoolFactory } from '../scripts/lib/stripe-automation-connection';
import { syntheticDockerEvidence } from './helpers/stripe-automation-target-fixture';
import { fakeIntegrationStripe } from './helpers/stripe-automation-postgres';

const shared=vi.hoisted(()=>({pool:{query:vi.fn(),connect:vi.fn()},booking:vi.fn()}));
vi.mock('pg',()=>{throw Error('Live PostgreSQL forbidden');});
vi.mock('stripe',()=>({default:class {constructor(){throw Error('Real Stripe construction forbidden');}}}));
vi.mock('../src/db/client',()=>({pool:shared.pool}));
vi.mock('../src/server/public-booking-http',()=>({publicBookingRequest:shared.booking}));
vi.mock('../src/server/booking-acceptance',async original=>({...await original<object>(),acceptBooking:vi.fn()}));
vi.mock('../src/server/quote',async original=>({...await original<object>(),quoteStay:vi.fn()}));
vi.mock('../src/server/stripe-automation-runner',()=>({runStripeAutomationVerification:vi.fn(async()=>({status:'FAKE_ONLY',processingEnabled:false}))}));
vi.mock('../scripts/lib/stripe-automation-docker',()=>{throw Error('Host Docker adapter forbidden');});
const id='00000000-0000-4000-8000-000000000001',unit='00000000-0000-4000-8000-000000000002';
const authority:AcceptanceAuthority={stage:'2C-2',operation:'booking-and-webhook',runId:'synthetic_stage2c2_0001',humanApprovalReference:'synthetic_review_0001',guestId:id};
const token='abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const bearer=`Bearer ${token}`;
const password='synthetic_acceptance_password_0123456789';
const databaseUrl=`postgresql://zemaitija_app:${password}@172.22.0.2:5432/zemaitija_stripe_automation_dev`;
const origin='http://127.0.0.1:3100';
function environment():ExplicitEnvironment {return {
  NODE_ENV:'test',STRIPE_ACCEPTANCE_ENABLED:'true',STRIPE_ACCEPTANCE_ENVIRONMENT:'isolated-development',STRIPE_ACCEPTANCE_DEPLOYMENT:'local',
  STRIPE_ACCEPTANCE_DATABASE_URL:databaseUrl,STRIPE_ACCEPTANCE_SECRET:token,STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID:'acct_synthetic',
  STRIPE_ACCEPTANCE_ORIGIN:origin,STRIPE_MODE:'test',STRIPE_SECRET_KEY:'sk_test_SyntheticAcceptanceOnly123456',
  STRIPE_ACCOUNT_ID:'acct_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_SyntheticAcceptanceOnly123456',
};}
function quote():QuotePreview {return {
  unitId:unit,unitConfigVersion:1,scheduleId:unit,scheduleVersion:1,arrivalDate:'2035-01-01',departureDate:'2035-01-02',guestCount:1,
  currency:'EUR',lines:[],accommodationSubtotalCents:10000n,totalCents:10000n,
  previewSplit:{basis:'ADVANCE',initialCents:3000n,balanceCents:7000n},
  deadlines:{arrival:new Date('2035-01-01T13:00Z'),warning:new Date('2034-12-11T13:00Z'),balance:new Date('2034-12-18T13:00Z'),
    grace:new Date('2034-12-19T13:00Z'),checkInLocalTime:'15:00',zone:'Europe/Vilnius'},evaluatedAt:new Date('2034-01-01'),provisional:true,
};}
function input():AcceptanceRequest {return {guestId:id,locale:'en',quote:quote(),operationKey:`stage2c2:${authority.runId}:booking_0001`,
  termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:3000n,syntheticPortfolioOnly:true};}
function harness() {
  const trace:string[]=[],writes:string[]=[],evidence=syntheticDockerEvidence(),stripe=fakeIntegrationStripe();
  let identityChange:Record<string,unknown>={},safe=true,connectFailed=false;
  const release=vi.fn(),end=vi.fn(async()=>{});
  const query=vi.fn(async(sql:string)=>{
    trace.push(sql);
    if(sql===ISOLATED_IDENTITY_SQL)return {rows:[{database_name:'zemaitija_stripe_automation_dev',role_name:'zemaitija_app',session_role:'zemaitija_app',
      server_address:'172.22.0.2',server_port:5432,server_version:170006,in_recovery:false,database_owner:'zemaitija_migrator',
      superuser:false,create_database:false,create_role:false,replication:false,bypass_rls:false,has_memberships:false,
      database_create:false,schema_create:false,...identityChange}]};
    if(sql.includes('pg_has_role'))return {rows:[{safe}]};
    if(/^(INSERT|UPDATE|DELETE)/.test(sql)){writes.push(sql);return {rows:[{id,inserted:true}]};}
    return {rows:[]};
  });
  const pool=vi.fn<PoolFactory>(()=>({connect:async()=>{if(connectFailed)throw Error(`synthetic authentication error ${databaseUrl}`);return {query,release};},end}));
  const read=vi.fn(async()=>evidence),gateway=vi.fn(()=>stripe.gateway);
  const fetch=vi.fn(async()=>{throw Error('External transport forbidden');});
  return {deps:{pool,docker:{read},gateway,fetch},stripe,writes,trace,read,pool,gateway,end,release,evidence,
    changeIdentity:(change:Record<string,unknown>)=>{identityChange=change;},unsafe:()=>{safe=false;},badCredentials:()=>{connectFailed=true;}};
}
let instances:Awaited<ReturnType<typeof createStripeAcceptanceBoundary>>[]=[];
async function open(h:ReturnType<typeof harness>,env=environment()) {
  const b=await createStripeAcceptanceBoundary(env,authority,bearer,h.deps);instances.push(b);return b;
}
beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(acceptBooking).mockResolvedValue({bookingId:id,holdId:id,attemptId:id,commandId:id,snapshotId:id,acceptedAt:new Date('2034-01-01'),initialCents:3000n,balanceCents:7000n,replayed:false});
  vi.mocked(quoteStay).mockResolvedValue(quote());
});
afterEach(async()=>{for(const b of instances)await b.close().catch(()=>{});instances=[];vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('dedicated acceptance environment and explicit invocation',()=>{
  it.each([
    {STRIPE_ACCEPTANCE_ENABLED:undefined},{STRIPE_ACCEPTANCE_ENABLED:'false'},{STRIPE_ACCEPTANCE_ENABLED:'1'},
    {NODE_ENV:'development'},{NODE_ENV:'production'},{STRIPE_ACCEPTANCE_ENVIRONMENT:'production'},{STRIPE_ACCEPTANCE_DEPLOYMENT:'vercel'},
    {DATABASE_URL:databaseUrl},{MIGRATION_DATABASE_URL:databaseUrl},{PGHOST:'127.0.0.1'},{NODE_OPTIONS:'--synthetic'},
    {STRIPE_SECRET_KEY:'sk_live_SyntheticNeverUse123456'},{STRIPE_MODE:'live'},{STRIPE_LIVEMODE:'true'},
    {STRIPE_ACCOUNT_ID:'acct_other'},{STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID:'acct_other'},
    {STRIPE_ACCEPTANCE_DATABASE_URL:databaseUrl.replace('zemaitija_stripe_automation_dev','zemaitija_dev')},
    {STRIPE_ACCEPTANCE_DATABASE_URL:databaseUrl.replace('zemaitija_app:','zemaitija_migrator:')},
    {STRIPE_ACCEPTANCE_DATABASE_URL:databaseUrl.replace('172.22.0.2:5432','127.0.0.1:55433')},
    {STRIPE_ACCEPTANCE_DATABASE_URL:databaseUrl+'?options=unsafe'},
    {STRIPE_ACCEPTANCE_DATABASE_URL:databaseUrl.replace(password,'short')},
    {STRIPE_ACCEPTANCE_ORIGIN:'https://synthetic.invalid'},{STRIPE_ACCEPTANCE_ORIGIN:origin+'/path'},
  ])('rejects configuration before resources %#',async change=>{
    const h=harness();await expect(createStripeAcceptanceBoundary({...environment(),...change},authority,bearer,h.deps)).rejects.toThrow();
    expect(h.read).not.toHaveBeenCalled();expect(h.pool).not.toHaveBeenCalled();expect(h.gateway).not.toHaveBeenCalled();expect(h.writes).toEqual([]);
  });
  it.each([undefined,{...authority,operation:'automation' as const},{...authority,humanApprovalReference:'short'}])('rejects absent/wrong authority first',async permit=>{
    const trap=new Proxy({}, {get(){throw Error('dependencies touched');}});
    await expect(createStripeAcceptanceBoundary({},permit,null,trap as never)).rejects.toThrow('UNAUTHORIZED');
  });
  it.each([null,'Bearer wrong',`Bearer ${token}x`])('rejects incorrect invocation credentials before Docker',async supplied=>{
    const h=harness();await expect(createStripeAcceptanceBoundary(environment(),authority,supplied,h.deps)).rejects.toThrow('UNAUTHORIZED');
    expect(h.read).not.toHaveBeenCalled();expect(h.pool).not.toHaveBeenCalled();
  });
  it('rejects wrong Docker target without PostgreSQL or provider construction',async()=>{
    const h=harness();h.evidence.network.internal=false;await expect(open(h)).rejects.toThrow();
    expect(h.pool).not.toHaveBeenCalled();expect(h.gateway).not.toHaveBeenCalled();
  });
  it('rejects unattested private address before connection construction',async()=>{
    const h=harness();await expect(open(h,{...environment(),STRIPE_ACCEPTANCE_DATABASE_URL:databaseUrl.replace('172.22.0.2','172.22.0.9')})).rejects.toThrow();
    expect(h.pool).not.toHaveBeenCalled();
  });
  it.each([{database_name:'zemaitija_dev'},{role_name:'zemaitija_migrator'},{session_role:'zemaitija_bootstrap'},
    {server_address:'172.22.0.9'},{server_version:170007},{database_owner:'zemaitija_bootstrap'},
    {superuser:true},{schema_create:true},{has_memberships:true}])('rejects actual SQL identity mismatch %#',async change=>{
    const h=harness();h.changeIdentity(change);await expect(open(h)).rejects.toThrow('IDENTITY');
    expect(h.gateway).not.toHaveBeenCalled();expect(h.writes).toEqual([]);expect(h.end).toHaveBeenCalledOnce();
  });
  it('rejects incorrect database credentials before constructing Stripe',async()=>{
    const h=harness();h.badCredentials();await expect(open(h)).rejects.toThrow('IDENTITY');expect(h.gateway).not.toHaveBeenCalled();expect(h.writes).toEqual([]);
  });
  it('requires 0035 capability and role-privilege checks before provider construction',async()=>{
    const h=harness();h.unsafe();await expect(open(h)).rejects.toThrow('IDENTITY');expect(h.gateway).not.toHaveBeenCalled();
  });
  it('rejects declared gateway-account mismatch before provider invocation or writes',async()=>{
    const h=harness();Object.defineProperty(h.stripe.gateway,'accountId',{value:'acct_other'});
    await expect(open(h)).rejects.toThrow('IDENTITY');expect(h.stripe.calls).toEqual([]);expect(h.writes).toEqual([]);
  });
  it('requires actual account evidence before any writes',async()=>{
    const h=harness();vi.spyOn(h.stripe.gateway,'verifyAccount').mockResolvedValue('acct_other');
    await expect(open(h)).rejects.toThrow('IDENTITY');expect(h.writes).toEqual([]);
  });
});

describe('existing services receive only the checked isolated pool',()=>{
  it('delegates acceptance unchanged and rechecks each acquired session before writes',async()=>{
    const h=harness(),b=await open(h),request=input();
    vi.mocked(acceptBooking).mockImplementationOnce(async(pool)=>{await pool.query('INSERT INTO synthetic_test_probe');return {} as never;});
    await b.accept(bearer,request);
    expect(acceptBooking).toHaveBeenCalledExactlyOnceWith(expect.any(Object),request);
    expect(h.pool.mock.calls[0][0]).toMatchObject({connectionString:databaseUrl,max:1});
    const write=h.trace.indexOf('INSERT INTO synthetic_test_probe');
    expect(h.trace.slice(0,write).filter(sql=>sql===ISOLATED_IDENTITY_SQL).length).toBeGreaterThan(1);
    expect(h.trace.slice(0,write).some(sql=>sql.includes('pg_has_role'))).toBe(true);
    expect(shared.pool.query).not.toHaveBeenCalled();expect(shared.pool.connect).not.toHaveBeenCalled();
    expect(h.stripe.count('createSession')).toBe(0);expect(h.deps.fetch).not.toHaveBeenCalled();
  });
  it('retains actual domain validation for non-synthetic input',async()=>{
    const actual=await vi.importActual<typeof import('../src/server/booking-acceptance')>('../src/server/booking-acceptance');
    vi.mocked(acceptBooking).mockImplementationOnce(actual.acceptBooking);
    const h=harness(),b=await open(h);
    await expect(b.accept(bearer,{...input(),syntheticPortfolioOnly:false} as never)).rejects.toThrow();expect(h.writes).toEqual([]);
  });
  it('does not accept another guest or operation namespace',async()=>{
    const h=harness(),b=await open(h);
    await expect(b.accept(bearer,{...input(),guestId:unit})).rejects.toThrow('INPUT');
    await expect(b.accept(bearer,{...input(),operationKey:'unrelated_operation_0001'})).rejects.toThrow('INPUT');
    expect(acceptBooking).not.toHaveBeenCalled();
  });
  it('rechecks target drift before later provider invocation and booking writes',async()=>{
    const h=harness(),b=await open(h);h.evidence.network.internal=false;const calls=h.stripe.calls.length;
    await expect(b.accept(bearer,input())).rejects.toThrow();expect(h.stripe.calls).toHaveLength(calls);expect(acceptBooking).not.toHaveBeenCalled();
  });
  it('preserves raw webhook bytes and uses existing verifier before durable ingestion',async()=>{
    const h=harness(),b=await open(h),raw=Buffer.from('synthetic unsigned test bytes');
    h.stripe.event('synthetic-signature',{id:'evt_synthetic',type:'checkout.session.completed',objectType:'checkout.session',objectId:'cs_test_synthetic',created:1,livemode:false,accountId:'acct_synthetic'});
    const verify=vi.spyOn(h.stripe.gateway,'verifyEvent');
    expect(await b.webhook(bearer,raw,'synthetic-signature')).toEqual({duplicate:false,eventId:id});
    expect(verify).toHaveBeenCalledExactlyOnceWith(raw,'synthetic-signature');expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toContain('INSERT INTO stripe_webhook_events');expect(h.stripe.count('createSession')).toBe(0);
  });
  it.each(['invalid-signature','live-event','wrong-account'] as const)('rejects %s without webhook rows',async kind=>{
    const h=harness(),b=await open(h);
    const event={id:'evt_synthetic',type:'checkout.session.completed',objectType:'checkout.session',objectId:'cs_test_synthetic',created:1,livemode:kind==='live-event',accountId:kind==='wrong-account'?'acct_other':'acct_synthetic'};
    vi.spyOn(h.stripe.gateway,'verifyEvent').mockImplementation(()=>{if(kind==='invalid-signature')throw Error('synthetic signature rejection');return event;});
    await expect(b.webhook(bearer,Buffer.from('synthetic'),'synthetic-signature')).rejects.toThrow();expect(h.writes).toEqual([]);
  });
  it('keeps automation inactive and requires separate run-bound authority for the existing runner',async()=>{
    const h=harness(),b=await open(h);
    expect(b.automationStatus(bearer)).toMatchObject({status:'INACTIVE',processingEnabled:false});
    await expect(b.automation(bearer,authority)).rejects.toThrow('UNAUTHORIZED');
    await expect(b.automation(bearer,{...authority,operation:'automation'})).rejects.toThrow('UNAUTHORIZED');
    await expect(b.automation(bearer,{...authority,operation:'automation',runId:'another_synthetic_run_0001'})).rejects.toThrow('UNAUTHORIZED');
    expect(runStripeAutomationVerification).not.toHaveBeenCalled();
    await b.automation(bearer,{...authority,operation:'automation',humanApprovalReference:'separate_automation_review_0001'});
    expect(runStripeAutomationVerification).toHaveBeenCalledOnce();
    const deps=vi.mocked(runStripeAutomationVerification).mock.calls[0][2];
    const worker=fakeIntegrationStripe().gateway,transport={fetch:vi.fn<typeof fetch>()};
    h.deps.gateway.mockReturnValueOnce(worker);
    expect(deps.constructStripe(transport)).toBe(worker);
    expect(h.deps.gateway).toHaveBeenLastCalledWith(expect.any(Object),transport);
    expect(()=>deps.constructStripe({fetch:h.deps.fetch})).toThrow('IDENTITY');
    expect(()=>deps.constructStripe(undefined as never)).toThrow('IDENTITY');
    expect(()=>deps.constructStripe(transport)).toThrow('IDENTITY'); // Prebuilt gateway reuse.
    expect(()=>deps.constructDatabase({connectionString:databaseUrl.replace('zemaitija_stripe_automation_dev','zemaitija_dev'),max:1,pipeline:false})).toThrow('IDENTITY');
  });
  it('closes idempotently and rejects further use',async()=>{
    const h=harness(),b=await open(h);await b.close();await b.close();expect(h.end).toHaveBeenCalledOnce();
    await expect(b.accept(bearer,input())).rejects.toThrow('CLOSED');await expect(b.webhook(bearer,Buffer.from('x'),'x')).rejects.toThrow('CLOSED');
  });
});

function bookingBody() {return {stay:{unitId:unit,arrivalDate:'2035-01-01',departureDate:'2035-01-02',guestCount:1},locale:'en',
  operationKey:input().operationKey,acknowledgedInitialCents:'3000',acceptedTerms:true,syntheticOnly:true};}
function request(path='/api/acceptance/booking',body:unknown=bookingBody(),authorization=bearer) {
  return new Request(origin+path,{method:'POST',headers:{authorization,'content-type':'application/json'},body:JSON.stringify(body)});
}
describe('unmounted host-only HTTP adapter',()=>{
  it('builds a fresh server quote and delegates synthetic acceptance, without Checkout dispatch',async()=>{
    const h=harness(),handler=stripeAcceptanceHttp(environment(),authority,h.deps);
    const response=await handler(request());expect(response.status).toBe(200);
    expect(quoteStay).toHaveBeenCalledWith(expect.any(Object),bookingBody().stay);
    expect(acceptBooking).toHaveBeenCalledWith(expect.any(Object),expect.objectContaining({guestId:id,quote:quote(),acknowledgedInitialCents:3000n,syntheticPortfolioOnly:true}));
    expect(h.stripe.count('createSession')).toBe(0);expect(h.end).toHaveBeenCalledOnce();
  });
  it('does not expose automation or unknown actions',async()=>{
    const h=harness();const response=await stripeAcceptanceHttp(environment(),authority,h.deps)(request('/api/acceptance/automation'));
    expect(response.status).toBe(503);expect(h.pool).not.toHaveBeenCalled();expect(runStripeAutomationVerification).not.toHaveBeenCalled();
  });
  it.each(['bad-auth','query','foreign-origin','arbitrary-guest','raw-quote'] as const)('rejects %s before creating resources',async kind=>{
    const h=harness();let r=request();
    if(kind==='bad-auth')r=request(undefined,undefined,'Bearer wrong');
    if(kind==='query')r=request('/api/acceptance/booking?bypass=true');
    if(kind==='foreign-origin')r=new Request(r,{headers:{authorization:bearer,'content-type':'application/json',origin:'https://synthetic.invalid'}});
    if(kind==='arbitrary-guest')r=request(undefined,{...bookingBody(),guestId:unit});
    if(kind==='raw-quote')r=request(undefined,{...bookingBody(),quote:quote().unitId});
    expect((await stripeAcceptanceHttp(environment(),authority,h.deps)(r)).status).toBeGreaterThanOrEqual(400);expect(h.pool).not.toHaveBeenCalled();
  });
  it('returns only fixed non-sensitive errors for bad database credentials',async()=>{
    const h=harness();h.badCredentials();const response=await stripeAcceptanceHttp(environment(),authority,h.deps)(request());
    expect(response.status).toBe(503);expect(await response.text()).toBe('{"code":"UNAVAILABLE"}');
  });
  it('passes original webhook bytes and signature to the existing ingestion verifier',async()=>{
    const h=harness(),text=' synthetic raw body \n';
    h.stripe.event('synthetic-http-signature',{id:'evt_http_synthetic',type:'checkout.session.completed',objectType:'checkout.session',
      objectId:'cs_test_synthetic',created:1,livemode:false,accountId:'acct_synthetic'});
    const verify=vi.spyOn(h.stripe.gateway,'verifyEvent');
    const r=new Request(origin+'/api/acceptance/stripe/webhook',{method:'POST',headers:{authorization:bearer,'stripe-signature':'synthetic-http-signature'},body:text});
    expect((await stripeAcceptanceHttp(environment(),authority,h.deps)(r)).status).toBe(200);
    expect(verify).toHaveBeenCalledExactlyOnceWith(Buffer.from(text),'synthetic-http-signature');expect(h.writes).toHaveLength(1);
    expect(h.end).toHaveBeenCalledOnce();
  });
  it('does not construct resources for oversized or unsigned requests',async()=>{
    for(const oversized of [false,true]) {
      const h=harness(),r=new Request(origin+'/api/acceptance/stripe/webhook',{method:'POST',headers:{authorization:bearer},body:oversized?'x'.repeat(1024*1024+1):'synthetic'});
      expect((await stripeAcceptanceHttp(environment(),authority,h.deps)(r)).status).toBe(400);expect(h.pool).not.toHaveBeenCalled();
    }
  });
  it('does not retry acceptance or claim rollback when cleanup fails after domain success',async()=>{
    const h=harness();h.end.mockRejectedValueOnce(Error('synthetic cleanup failure'));
    const response=await stripeAcceptanceHttp(environment(),authority,h.deps)(request());
    expect(response.status).toBe(503);expect(await response.text()).toBe('{"code":"UNCERTAIN"}');
    expect(acceptBooking).toHaveBeenCalledOnce();expect(h.end).toHaveBeenCalledOnce();
  });
  it('reports startup cleanup uncertainty without exposing driver errors or retrying',async()=>{
    const h=harness();h.badCredentials();h.end.mockRejectedValueOnce(Error('private cleanup detail'));
    const response=await stripeAcceptanceHttp(environment(),authority,h.deps)(request());
    expect(response.status).toBe(503);expect(await response.text()).toBe('{"code":"UNCERTAIN"}');
    expect(acceptBooking).not.toHaveBeenCalled();expect(h.gateway).not.toHaveBeenCalled();expect(h.end).toHaveBeenCalledOnce();
  });
});

describe('shared routes and resources remain separate',()=>{
  it('continues passing the shared pool to the existing public booking handler',async()=>{
    const {POST}=await import('../src/app/api/booking/[action]/route');
    shared.booking.mockResolvedValueOnce(new Response(null,{status:204}));const r=request();
    expect((await POST(r,{params:Promise.resolve({action:'quote'})})).status).toBe(204);
    expect(shared.booking).toHaveBeenCalledExactlyOnceWith(shared.pool,r,'quote');
  });
  it('preserves original shared connection and route source without acceptance imports',()=>{
    for(const file of ['src/db/client.ts','src/db/env.ts','src/app/api/booking/[action]/route.ts','src/app/api/stripe/webhook/route.ts','src/app/api/internal/stripe-automation/route.ts']) {
      const text=readFileSync(new URL(`../${file}`,import.meta.url),'utf8');expect(text).not.toContain('stripe-acceptance');
    }
    expect(readFileSync(new URL('../src/db/client.ts',import.meta.url),'utf8')).toContain('databaseEnv.DATABASE_URL');
  });
  it('keeps the shared webhook route on the shared pool and original ingestion path',async()=>{
    const adapter=await import('../src/server/stripe-adapter'),h=harness();
    h.stripe.event('synthetic-shared-signature',{id:'evt_shared_synthetic',type:'checkout.session.completed',objectType:'checkout.session',
      objectId:'cs_test_synthetic',created:1,livemode:false,accountId:'acct_synthetic'});
    const forbiddenRefund=async()=>{throw Error('Refund operation forbidden');};
    vi.spyOn(adapter,'stripeGateway').mockReturnValue({...h.stripe.gateway,
      createRefund:forbiddenRefund,retrieveRefund:forbiddenRefund,listRefunds:forbiddenRefund});
    shared.pool.query.mockResolvedValueOnce({rows:[{id,inserted:true}]});
    const {POST}=await import('../src/app/api/stripe/webhook/route');
    const response=await POST(new Request(origin+'/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':'synthetic-shared-signature'},body:'synthetic'}));
    expect(response.status).toBe(200);expect(shared.pool.query).toHaveBeenCalledOnce();expect(h.pool).not.toHaveBeenCalled();
  });
  it('imports acceptance modules without loading environment files or making network calls',async()=>{
    const load=vi.spyOn(process,'loadEnvFile').mockImplementation(()=>{throw Error('Environment loading forbidden');});
    const fetch=vi.fn(()=>{throw Error('Network forbidden');});vi.stubGlobal('fetch',fetch);vi.resetModules();
    await import('../src/server/stripe-acceptance');await import('../src/server/stripe-acceptance-http');
    expect(load).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(shared.pool.connect).not.toHaveBeenCalled();
  });
  it('validates configuration without constructing resources or printing credentials',()=>{
    const cfg=stripeAcceptanceConfig(environment());expect(cfg.STRIPE_ACCEPTANCE_DATABASE_URL).toBe(databaseUrl);
  });
});
