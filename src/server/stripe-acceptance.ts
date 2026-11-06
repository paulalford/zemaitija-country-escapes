import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolConfig } from 'pg';
import { z } from 'zod';
import { isolatedConnectionUrl, isolatedConnectionOptions, verifiedSession,
  type ExplicitEnvironment, type PoolFactory, type SqlSession } from '../../scripts/lib/stripe-automation-connection';
import { attestIsolatedTarget, type DockerEvidenceReader } from './stripe-automation-target';
import { stripeAutomationConfig, verifyAutomationRecoveryCapabilities } from './stripe-automation-config';
import { runStripeAutomationFoundation } from './stripe-automation';
import { runStripeAutomationVerification } from './stripe-automation-runner';
import { AutomationScope, boundedAutomationFetch } from './stripe-automation-runtime';
import { automationRecoveryProcessors } from './stripe-automation-recovery';
import { observePoolShutdown, type ShutdownObservation } from './automation-settlement';
import type { AutomationProvider } from './stripe-automation-runner';
import type { StripeConfig } from './stripe-adapter';
import { acceptBooking, type AcceptanceRequest } from './booking-acceptance';
import { quoteStay } from './quote';
import type { AvailabilityInput } from './availability';
import { ingestStripeWebhook } from './stripe-webhooks';

export class StripeAcceptanceError extends Error {
  constructor(readonly code:'DISABLED'|'CONFIGURATION'|'UNAUTHORIZED'|'CLOSED'|'IDENTITY'|'INPUT'|'CLEANUP_UNCERTAIN') {super(code);}
}
export type AcceptanceAuthority=Readonly<{stage:'2C-2';operation:'booking-and-webhook'|'automation';
  runId:string;humanApprovalReference:string;guestId:string}>;
const uuid=z.uuid();
function requireAuthority(authority:AcceptanceAuthority|undefined,operation:AcceptanceAuthority['operation']) {
  if(authority?.stage!=='2C-2' || authority.operation!==operation ||
    !/^[A-Za-z0-9_-]{16,80}$/.test(authority.runId) ||
    !/^[A-Za-z0-9_-]{16,100}$/.test(authority.humanApprovalReference) || !uuid.safeParse(authority.guestId).success)
    throw new StripeAcceptanceError('UNAUTHORIZED');
  return Object.freeze({...authority});
}
const secret=z.string().regex(/^[A-Za-z0-9_-]{43,128}$/);
const environment=z.object({
  NODE_ENV:z.literal('test'),STRIPE_ACCEPTANCE_ENABLED:z.literal('true'),
  STRIPE_ACCEPTANCE_ENVIRONMENT:z.literal('isolated-development'),STRIPE_ACCEPTANCE_DEPLOYMENT:z.literal('local'),
  STRIPE_ACCEPTANCE_DATABASE_URL:z.string(),STRIPE_ACCEPTANCE_SECRET:secret,
  STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID:z.string().regex(/^acct_[A-Za-z0-9]+$/),
  STRIPE_ACCEPTANCE_ORIGIN:z.string(),STRIPE_MODE:z.literal('test'),STRIPE_LIVEMODE:z.literal('false').optional(),
  STRIPE_SECRET_KEY:z.string().regex(/^sk_test_[A-Za-z0-9]{16,}$/),
  STRIPE_ACCOUNT_ID:z.string().regex(/^acct_[A-Za-z0-9]+$/),STRIPE_WEBHOOK_SECRET:z.string().regex(/^whsec_[A-Za-z0-9]{16,}$/),
  PATH:z.string().optional(),HOME:z.string().optional(),LANG:z.string().optional(),LC_ALL:z.string().optional(),
}).strict();
/** Dedicated environment only: never fall back to DATABASE_URL or process.env. */
export function stripeAcceptanceConfig(env:ExplicitEnvironment) {
  if(env.STRIPE_ACCEPTANCE_ENABLED===undefined || env.STRIPE_ACCEPTANCE_ENABLED==='false')throw new StripeAcceptanceError('DISABLED');
  try {
    const cfg=environment.parse(env),origin=new URL(cfg.STRIPE_ACCEPTANCE_ORIGIN);
    if(origin.origin!==cfg.STRIPE_ACCEPTANCE_ORIGIN || origin.protocol!=='http:' || origin.hostname!=='127.0.0.1' || !origin.port ||
      origin.username || origin.password || cfg.STRIPE_ACCOUNT_ID!==cfg.STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID ||
      new Set(cfg.STRIPE_ACCEPTANCE_SECRET).size<16 ||
      [cfg.STRIPE_SECRET_KEY,cfg.STRIPE_WEBHOOK_SECRET].includes(cfg.STRIPE_ACCEPTANCE_SECRET))throw Error();
    const url=isolatedConnectionUrl({NODE_ENV:'test',DATABASE_URL:cfg.STRIPE_ACCEPTANCE_DATABASE_URL},'zemaitija_app');
    if(decodeURIComponent(url.password)===cfg.STRIPE_ACCEPTANCE_SECRET)throw Error();
    return Object.freeze(cfg);
  } catch {throw new StripeAcceptanceError('CONFIGURATION');}
}
export function authorizeStripeAcceptance(header:string|null,cfg:ReturnType<typeof stripeAcceptanceConfig>) {
  const supplied=header?.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1];
  const digest=(value:string)=>createHash('sha256').update(value).digest();
  if(!supplied || !timingSafeEqual(digest(supplied),digest(cfg.STRIPE_ACCEPTANCE_SECRET)))throw new StripeAcceptanceError('UNAUTHORIZED');
}
export type AcceptanceDependencies={docker:DockerEvidenceReader;pool:PoolFactory;
  gateway:(config:StripeConfig,transport:{fetch:typeof fetch})=>AutomationProvider;
  fetch:typeof fetch;observeShutdown?:(state:ShutdownObservation)=>void};

/** Host-owned, explicitly injected source boundary. No route, pool, provider, socket,
 * environment loader, migration, fixture creation or default transport is installed. */
export async function createStripeAcceptanceBoundary(env:ExplicitEnvironment,authority:AcceptanceAuthority|undefined,
  authorization:string|null,deps:AcceptanceDependencies) {
  const approval=requireAuthority(authority,'booking-and-webhook');
  const cfg=stripeAcceptanceConfig(env);authorizeStripeAcceptance(authorization,cfg);
  const target=await attestIsolatedTarget(deps.docker);
  const appEnv={NODE_ENV:'test',DATABASE_URL:cfg.STRIPE_ACCEPTANCE_DATABASE_URL};
  const options=isolatedConnectionOptions(appEnv,'zemaitija_app',target);
  const automationEnv={...appEnv,STRIPE_AUTOMATION_ENABLED:'true',STRIPE_AUTOMATION_ENVIRONMENT:'isolated-development',
    STRIPE_AUTOMATION_DEPLOYMENT:'local',STRIPE_AUTOMATION_SECRET:cfg.STRIPE_ACCEPTANCE_SECRET,
    STRIPE_AUTOMATION_DB_NAME:'zemaitija_stripe_automation_dev',STRIPE_AUTOMATION_DB_HOST:target.address,
    STRIPE_AUTOMATION_DB_PORT:'5432',STRIPE_AUTOMATION_DB_ROLE:'zemaitija_app',STRIPE_AUTOMATION_DB_SERVER_ADDRESS:target.address,
    STRIPE_MODE:'test',STRIPE_SECRET_KEY:cfg.STRIPE_SECRET_KEY,STRIPE_ACCOUNT_ID:cfg.STRIPE_ACCOUNT_ID,
    STRIPE_AUTOMATION_EXPECTED_ACCOUNT_ID:cfg.STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID};
  const automationConfig=stripeAutomationConfig(automationEnv,target);
  let closed=false;
  function check(header:string|null) {
    if(closed)throw new StripeAcceptanceError('CLOSED');
    authorizeStripeAcceptance(header,cfg);
  }
  function guardedPool() {
    const raw=deps.pool(options),active=new Set<SqlSession>();let ended=false,closing:Promise<void>|undefined;
    async function connect() {
      if(closed || ended)throw new StripeAcceptanceError('CLOSED');
      const s=await verifiedSession(raw,'zemaitija_app',target,deps.docker);
      try {
        await s.query('BEGIN READ ONLY');
        try {await verifyAutomationRecoveryCapabilities({query:async sql=>({rows:(await s.query(sql)).rows.map(r=>({safe:r.safe===true}))})});}
        finally {await s.query('ROLLBACK');}
        if(closed || ended)throw new StripeAcceptanceError('CLOSED');
      } catch(error) {s.release(true);throw error;}
      const wrapped={query:s.query.bind(s),release:(destroy=false)=>{if(active.delete(wrapped))s.release(destroy);}};
      active.add(wrapped);return wrapped;
    }
    async function query(sql:string,values?:unknown[]) {
      const s=await connect();try {return await s.query(sql,values);}finally {s.release();}
    }
    function end() {
      if(closing)return closing;
      ended=true;
      closing=(async()=>{
        let failed=false;for(const s of active)try {s.release(true);}catch {failed=true;}
        await observePoolShutdown(()=>raw.end(),deps.observeShutdown);
        if(failed)throw new StripeAcceptanceError('IDENTITY');
      })();return closing;
    }
    return {connect,query,end} as unknown as Pool;
  }
  const pool=guardedPool();let gateway:AutomationProvider;
  const urls={successUrl:`${cfg.STRIPE_ACCEPTANCE_ORIGIN}/booking/return`,cancelUrl:`${cfg.STRIPE_ACCEPTANCE_ORIGIN}/booking/return`};
  const gatewayConfig={STRIPE_SECRET_KEY:cfg.STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET:cfg.STRIPE_WEBHOOK_SECRET,
    STRIPE_ACCOUNT_ID:cfg.STRIPE_ACCOUNT_ID,STRIPE_SUCCESS_URL:urls.successUrl,STRIPE_CANCEL_URL:urls.cancelUrl};
  function constructGateway(transport:{fetch:typeof fetch}) {
    // Never fall back to the raw transport or the adapter's optional default client.
    if(!transport || typeof transport.fetch!=='function' || transport.fetch===deps.fetch)
      throw new StripeAcceptanceError('IDENTITY');
    const provider=deps.gateway(gatewayConfig,transport);
    if(!provider || provider.accountId!==cfg.STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID || typeof provider.verifyAccount!=='function')
      throw new StripeAcceptanceError('IDENTITY');
    return provider;
  }
  async function verifyProvider() {
    if(gateway.accountId!==cfg.STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID ||
      await gateway.verifyAccount()!==cfg.STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID)throw new StripeAcceptanceError('IDENTITY');
  }
  async function preflight() {const checked=await pool.connect();checked.release(true);}
  try {
    // Verified read-only identity and capabilities precede provider construction or any domain write.
    await preflight();
    if(typeof deps.fetch!=='function')throw new StripeAcceptanceError('IDENTITY');
    const startup=new AutomationScope(Date.now()+10_000);
    try {
      gateway=constructGateway({fetch:boundedAutomationFetch(deps.fetch,()=>startup)});
      await verifyProvider();startup.check();
    } finally {startup.close();}
    // The startup gateway may verify raw webhook signatures and reuse its cached
    // account evidence, but its closed transport cannot perform later HTTP requests.
  } catch {
    closed=true;try {await pool.end();}catch {throw new StripeAcceptanceError('CLEANUP_UNCERTAIN');}
    throw new StripeAcceptanceError('IDENTITY');
  }
  return {
    async accept(header:string|null,input:AcceptanceRequest) {
      check(header);
      if(input.guestId!==approval.guestId || !input.operationKey.startsWith(`stage2c2:${approval.runId}:`))throw new StripeAcceptanceError('INPUT');
      await preflight();await verifyProvider();return acceptBooking(pool,input);
    },
    async quote(header:string|null,stay:AvailabilityInput) {check(header);return quoteStay(pool,stay);},
    async webhook(header:string|null,raw:Buffer,signature:string) {
      check(header);await preflight();await verifyProvider();return ingestStripeWebhook(pool,gateway,raw,signature);
    },
    automationStatus(header:string|null) {check(header);return runStripeAutomationFoundation(automationConfig);},
    /** Host-only future call; never exposed by the HTTP adapter or existing internal endpoint.
     * Its separate authority is procedural acknowledgement, not independently enforced approval. */
    async automation(header:string|null,permit:AcceptanceAuthority|undefined) {
      check(header);const allowed=requireAuthority(permit,'automation');
      if(allowed.runId!==approval.runId || allowed.guestId!==approval.guestId ||
        allowed.humanApprovalReference===approval.humanApprovalReference)throw new StripeAcceptanceError('UNAUTHORIZED');
      return runStripeAutomationVerification(automationEnv,header,{
        target,docker:deps.docker,fetch:deps.fetch,observeShutdown:deps.observeShutdown,
        constructDatabase:(requested:PoolConfig)=>{
          if(requested.connectionString!==options.connectionString || requested.max!==1)throw new StripeAcceptanceError('IDENTITY');
          return guardedPool();
        },constructStripe:transport=>{
          const worker=constructGateway(transport);
          if(worker===gateway)throw new StripeAcceptanceError('IDENTITY');
          return worker;
        },processors:(database,provider)=>automationRecoveryProcessors(database,provider,urls),
      });
    },
    close() {closed=true;return pool.end();},
  };
}
export type StripeAcceptanceBoundary=Awaited<ReturnType<typeof createStripeAcceptanceBoundary>>;
