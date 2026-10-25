/** Opt-in local sandbox runner. Importing this module never opens connections. */
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import pg, { type Pool } from 'pg';
import Stripe from 'stripe';
import { z } from 'zod';
import { requestBalanceCheckout, dispatchBalanceSessionCreate, reconcileBalanceAttempt } from '../src/server/balance-payment';
import { paymentPosition } from '../src/server/payment-position';
import { processWebhookInbox } from '../src/server/stripe-webhooks';
import { StripeSdkGateway, STRIPE_API_VERSION, stripeConfig } from '../src/server/stripe-adapter';

export const BOOKING_ID='566264cc-b0ca-4511-9434-6a26a0dabd8c';
const directory=path.resolve('.local/stripe-balance-smoke');
const stateFile=path.join(directory,'state.json');
const lockFile=path.join(directory,'runner.lock');
const usage='stripe-balance-smoke.ts <preflight|start|verify> --local-sandbox-only';
const activeStates=['CREATING','OPEN','RECONCILING'];
const accountPattern=/^acct_[A-Za-z0-9]+$/;
class SmokeError extends Error {}
function fail(message:string):never { throw new SmokeError(message); }
function safeError(error:unknown):string {
  if (error instanceof SmokeError) return error.message;
  const code=(error as {code?:unknown})?.code;
  return typeof code==='string' && /^[A-Z0-9_]{1,64}$/.test(code)?`code ${code}`:'provider, database, or local I/O error';
}

type Obligation={id:string;kind:string;amount_cents:string;currency:string};
type Claim={id:string;booking_id:string|null;hold_id:string|null;origin_hold_id:string|null;released_at:string|null};
type Hold={id:string;booking_id:string;state:string;payment_attempt_id:string|null};
type Payment={id:string;attempt_id:string|null;booking_id:string|null;obligation_id:string|null;
  stripe_payment_intent_id:string;stripe_charge_id:string|null;captured_cents:string;currency:string;
  allocation_state:string;refund_encumbered_cents:string;evidence_kind:string;result:string};
type Allocation={id:string;payment_record_id:string;obligation_id:string;amount_cents:string};
type Attempt={id:string;obligation_id:string;hold_id:string|null;state:string;expected_cents:string;currency:string;
  stripe_session_id:string|null;stripe_payment_intent_id:string|null;created_at:string;
  command_id:string|null;command_state:string|null;logical_key:string|null;stripe_idempotency_key:string|null;
  reconciliation_result:string|null};
export type Snapshot={booking_id:string;status:string;synthetic:boolean;property_zone:string;
  total_cents:string;initial_cents:string;balance_cents:string;currency:string;split_basis:string;
  booking:unknown;price:unknown;holds:Hold[];claims:Claim[];obligations:Obligation[];
  payments:Payment[];allocations:Allocation[];attempts:Attempt[];refund_count:string;incident_count:string};
type Database={name:string;address:string|null;port:number|null};
const stateSchema=z.object({
  version:z.literal(1),bookingId:z.literal(BOOKING_ID),stripeAccount:z.string().regex(accountPattern),
  database:z.object({name:z.string().endsWith('_dev'),address:z.string().nullable(),port:z.number().int().nullable()}),
  preparedAt:z.iso.datetime(),baselineHash:z.string().regex(/^[a-f0-9]{64}$/),
  originalClaimId:z.uuid(),originalHoldId:z.uuid(),historicalAttemptIds:z.array(z.uuid()),
  attemptId:z.uuid().optional(),commandId:z.uuid().optional(),
}).strict().refine(s=>Boolean(s.attemptId)===Boolean(s.commandId),'Attempt and command IDs must be stored together');
type State=z.infer<typeof stateSchema>;
export type Outcome='PASS'|'PENDING'|'PAYMENT_CONFIRMED_WEBHOOK_MISSING'|'FAIL';

export function parseStage(args:string[]):'preflight'|'start'|'verify' {
  if (args.length!==2 || !['preflight','start','verify'].includes(args[0]) || args[1]!=='--local-sandbox-only') fail(`Usage: ${usage}`);
  return args[0] as 'preflight'|'start'|'verify';
}

export function settings(env:NodeJS.ProcessEnv) {
  if (env.NODE_ENV==='production' || env.CI) fail('Run only in a local development terminal');
  if (!env.DATABASE_URL) fail('DATABASE_URL is required');
  const url=new URL(env.DATABASE_URL);
  const name=decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:','postgresql:'].includes(url.protocol) || !['localhost','127.0.0.1','[::1]'].includes(url.hostname) ||
      !/^[a-zA-Z0-9_]+_dev$/.test(name) || decodeURIComponent(url.username)!=='zemaitija_app' || url.search || url.hash)
    fail('Requires the restricted zemaitija_app role on a localhost PostgreSQL *_dev database without URL overrides');
  const expectedAccount=env.SMOKE_EXPECTED_STRIPE_ACCOUNT_ID;
  if (!expectedAccount || !accountPattern.test(expectedAccount)) fail('Set SMOKE_EXPECTED_STRIPE_ACCOUNT_ID independently to the intended sandbox account');
  const config=stripeConfig(env);
  if (config.STRIPE_ACCOUNT_ID!==expectedAccount) fail('Expected sandbox account differs from configured account');
  for (const value of [config.STRIPE_SUCCESS_URL,config.STRIPE_CANCEL_URL]) {
    const target=new URL(value);
    if (target.protocol!=='http:' || !['localhost','127.0.0.1'].includes(target.hostname) || target.port!=='3000' ||
        target.username || target.password) fail('Return URLs must use loopback HTTP on port 3000');
  }
  return {databaseUrl:env.DATABASE_URL,databaseName:name,expectedAccount,config};
}

export async function earlyPaymentPolicy():Promise<void> {
  const [policy,scenarios]=await Promise.all([
    readFile('docs/BOOKING_PAYMENT_SPEC.md','utf8'),readFile('docs/BOOKING_ACCEPTANCE_SCENARIOS.md','utf8'),
  ]);
  if (!policy.includes('Create a balance Checkout attempt for exactly the unpaid scheduled balance') ||
      !scenarios.includes('### 3. Full balance paid before due date'))
    fail('Approved early-balance payment evidence changed; review the specification before proceeding');
}

export async function inspect(pool:Pool,expectedName:string):Promise<{database:Database;snapshot:Snapshot;now:string}> {
  const client=await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='10s'");
    const target=(await client.query<{name:string;role:string;address:string|null;port:number|null;recovery:boolean;now:Date}>(
      'SELECT current_database() name,current_user role,inet_server_addr()::text address,inet_server_port() port,pg_is_in_recovery() recovery,clock_timestamp() now')).rows[0];
    if (!target || target.name!==expectedName || target.role!=='zemaitija_app' || target.recovery)
      fail('Database identity or runtime role mismatch');
    const address=target.address?.split('/')[0]??null;
    const privateBridge=address!==null && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address);
    if (address!==null && !['127.0.0.1','::1'].includes(address) && !privateBridge) fail('Database server is not local development PostgreSQL');
    const guards=await client.query(`SELECT
      EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='payment_attempts'::regclass AND tgname='scheduled_attempt_identity' AND tgenabled='O') scheduled,
      (SELECT count(*)::int FROM pg_index WHERE indexrelid IN ('payment_attempts_one_usable'::regclass,
        'provider_commands_one_session_create_per_attempt'::regclass) AND indisunique AND indisvalid) unique_guards`);
    if (!guards.rows[0]?.scheduled || guards.rows[0].unique_guards!==2) fail('Required payment guards are not installed; no migrations are applied by this runner');
    const report=await client.query<Snapshot>(`SELECT b.id booking_id,b.status,g.retention_state='SYNTHETIC' synthetic,b.property_zone,
      s.total_cents::text,s.initial_cents::text,s.balance_cents::text,s.currency,s.split_basis,to_jsonb(b) booking,to_jsonb(s) price,
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM inventory_holds x WHERE x.booking_id=b.id) holds,
      (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id),'[]') FROM inventory_claims c WHERE c.booking_id=b.id OR
        c.hold_id IN (SELECT id FROM inventory_holds WHERE booking_id=b.id) OR c.origin_hold_id IN (SELECT id FROM inventory_holds WHERE booking_id=b.id)) claims,
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM
        (SELECT id,kind,amount_cents::text,currency FROM payment_obligations WHERE booking_id=b.id) x) obligations,
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM
        (SELECT p.id,p.attempt_id,p.booking_id,p.obligation_id,p.stripe_payment_intent_id,p.stripe_charge_id,p.captured_cents::text,
          p.currency,p.allocation_state,p.refund_encumbered_cents::text,r.evidence_kind,r.result
         FROM payment_records p JOIN reconciliation_records r ON r.id=p.reconciliation_id WHERE p.booking_id=b.id OR
          p.stripe_payment_intent_id IN (SELECT stripe_payment_intent_id FROM payment_attempts WHERE booking_id=b.id)) x) payments,
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM
        (SELECT pa.id,pa.payment_record_id,pa.obligation_id,pa.amount_cents::text FROM payment_allocations pa
         WHERE pa.obligation_id IN (SELECT id FROM payment_obligations WHERE booking_id=b.id)) x) allocations,
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]') FROM
        (SELECT a.id,a.obligation_id,a.hold_id,a.state,a.expected_cents::text,a.currency,a.stripe_session_id,a.stripe_payment_intent_id,
          a.created_at,pc.id command_id,pc.state command_state,pc.logical_key,pc.stripe_idempotency_key,r.result reconciliation_result
         FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id AND o.kind='BALANCE'
         LEFT JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE'
         LEFT JOIN reconciliation_records r ON r.id=a.last_reconciliation_id WHERE a.booking_id=b.id) x) attempts,
      ((SELECT count(*) FROM refund_records WHERE booking_id=b.id)+(SELECT count(*) FROM refund_obligations WHERE booking_id=b.id))::text refund_count,
      (SELECT count(*)::text FROM provider_incidents i WHERE i.stripe_payment_intent_id IN
        (SELECT stripe_payment_intent_id FROM payment_attempts WHERE booking_id=b.id) OR i.stripe_session_id IN
        (SELECT stripe_session_id FROM payment_attempts WHERE booking_id=b.id)) incident_count
      FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN price_snapshots s ON s.booking_id=b.id WHERE b.id=$1`,[BOOKING_ID]);
    if (report.rows.length!==1) fail('The existing accepted booking is missing');
    await client.query('COMMIT');
    return {database:{name:target.name,address:target.address,port:target.port},snapshot:report.rows[0],now:target.now.toISOString()};
  } catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
  finally { client.release(); }
}

function canonical(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value!==null && typeof value==='object') return `{${Object.entries(value).sort(([a],[b])=>a.localeCompare(b))
    .map(([key,item])=>`${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export function baselineHash(s:Snapshot):string {
  const initial=s.obligations.find(o=>o.kind==='INITIAL');
  return createHash('sha256').update(canonical({booking:s.booking,price:s.price,holds:s.holds,claims:s.claims,obligations:s.obligations,
    initialPayments:s.payments.filter(p=>p.obligation_id===initial?.id),
    initialAllocations:s.allocations.filter(a=>a.obligation_id===initial?.id)})).digest('hex');
}
export function assertFixedPosition(s:Snapshot):void {
  if (s.booking_id!==BOOKING_ID || s.status!=='CONFIRMED' || !s.synthetic || s.property_zone!=='Europe/Vilnius' ||
      s.total_cents!=='20000' || s.initial_cents!=='6000' || s.balance_cents!=='14000' || s.currency!=='EUR' || s.split_basis!=='ADVANCE')
    fail('Booking is not the authorized confirmed synthetic EUR 200.00 advance booking');
  if (s.obligations.length!==2 || !s.obligations.some(o=>o.kind==='INITIAL' && o.amount_cents==='6000' && o.currency==='EUR') ||
      !s.obligations.some(o=>o.kind==='BALANCE' && o.amount_cents==='14000' && o.currency==='EUR')) fail('Scheduled obligations changed');
  const initial=s.obligations.find(o=>o.kind==='INITIAL')!;
  const payments=s.payments.filter(p=>p.obligation_id===initial.id);
  const allocations=s.allocations.filter(a=>a.obligation_id===initial.id);
  if (payments.length!==1 || allocations.length!==1 || payments[0].booking_id!==BOOKING_ID ||
      payments[0].captured_cents!=='6000' || payments[0].currency!=='EUR' || payments[0].allocation_state!=='ALLOCATED' ||
      !payments[0].stripe_charge_id || payments[0].evidence_kind!=='STRIPE_CURRENT' || payments[0].result!=='VERIFIED_INITIAL' ||
      payments[0].refund_encumbered_cents!=='0' || allocations[0].payment_record_id!==payments[0].id || allocations[0].amount_cents!=='6000')
    fail('The original verified EUR 60.00 payment and allocation are not intact');
  if (s.claims.length!==1 || s.claims[0].booking_id!==BOOKING_ID || s.claims[0].hold_id!==null ||
      !s.claims[0].origin_hold_id || s.claims[0].released_at!==null || s.holds.length!==1 ||
      s.holds[0].id!==s.claims[0].origin_hold_id || s.holds[0].booking_id!==BOOKING_ID ||
      s.holds[0].state!=='CONSUMED' || s.holds[0].payment_attempt_id!==payments[0].attempt_id)
    fail('Expected exactly the original transferred booking claim and original hold');
  if (s.refund_count!=='0' || s.incident_count!=='0') fail('A refund or provider incident requires separate review');
}
export function assertFresh(s:Snapshot):void {
  assertFixedPosition(s);
  if (s.payments.length!==1 || s.allocations.length!==1) fail('Balance is already credited or financial records are inconsistent');
  for (const a of s.attempts) {
    if (!['FAILED','EXPIRED'].includes(a.state) || a.command_state!=='RESOLVED' ||
        !['TERMINAL_UNPAID','TERMINAL_FAILED'].includes(a.reconciliation_result??''))
      fail('An unresolved or competing balance attempt exists; do not create another Checkout');
  }
}
export function assertBaseline(s:Snapshot,state:State):void {
  assertFixedPosition(s);
  if (baselineHash(s)!==state.baselineHash || s.claims[0].id!==state.originalClaimId ||
      s.claims[0].origin_hold_id!==state.originalHoldId) fail('Original booking, financial schedule, initial payment, claim, or holds changed');
  if (state.historicalAttemptIds.some(id=>!s.attempts.some(a=>a.id===id))) fail('Historical balance attempt disappeared');
  if (s.attempts.filter(a=>!state.historicalAttemptIds.includes(a.id)).length>1) fail('Competing balance attempts detected');
}

/** Resume only the original canonical attempt; never select a replacement. */
export function originalAttempt(s:Snapshot,state:State):Attempt|null {
  assertBaseline(s,state);
  const created=s.attempts.filter(a=>!state.historicalAttemptIds.includes(a.id));
  const a=created[0];
  if (!a && !state.attemptId) return null;
  if (!a || !a.command_id || state.attemptId && (a.id!==state.attemptId || a.command_id!==state.commandId) ||
      a.obligation_id!==s.obligations.find(o=>o.kind==='BALANCE')?.id || a.hold_id!==null ||
      a.currency!=='EUR' || a.expected_cents!=='14000' || !activeStates.includes(a.state) ||
      a.logical_key!==`balance-session:${a.id}` || a.stripe_idempotency_key!==`balance-session:${a.id}` ||
      !Number.isFinite(Date.parse(a.created_at)) || Date.parse(a.created_at)<Date.parse(state.preparedAt))
    fail('Original attempt is missing, unexpected, or terminal; no automatic replacement is permitted');
  return a;
}

async function save(state:State):Promise<void> {
  const temporary=`${stateFile}.${process.pid}.tmp`;
  const file=await open(temporary,'wx',0o600);
  try { await file.writeFile(JSON.stringify(stateSchema.parse(state),null,2));await file.sync(); }
  finally {await file.close();}
  await rename(temporary,stateFile);
}
async function load():Promise<State|null> {
  try { return stateSchema.parse(JSON.parse(await readFile(stateFile,'utf8'))); }
  catch(error) { if ((error as NodeJS.ErrnoException).code==='ENOENT') return null;throw error; }
}

type Context={pool:Pool;gateway:StripeSdkGateway;options:ReturnType<typeof settings>;database:Database};
async function connect():Promise<Context> {
  await earlyPaymentPolicy();
  const options=settings(process.env);
  const pool=new pg.Pool({connectionString:options.databaseUrl,max:3,connectionTimeoutMillis:5000});
  try {
    const {database}=await inspect(pool,options.databaseName);
    // Only a GET. PREFLIGHT never creates Stripe objects or invokes a write service.
    const stripe=new Stripe(options.config.STRIPE_SECRET_KEY,{apiVersion:STRIPE_API_VERSION,maxNetworkRetries:0,timeout:10_000});
    if ((await stripe.accounts.retrieve(null)).id!==options.expectedAccount) fail('Stripe test key belongs to another account');
    return {pool,gateway:new StripeSdkGateway(options.config),options,database};
  } catch(error) {await pool.end();throw error;}
}
function bindState(context:Context,state:State):void {
  if (state.stripeAccount!==context.options.expectedAccount || canonical(state.database)!==canonical(context.database))
    fail('Local state belongs to another sandbox account or database');
}
async function preflight(context:Context):Promise<void> {
  const {snapshot}=await inspect(context.pool,context.options.databaseName);
  assertFresh(snapshot);
  const position=await paymentPosition(context.pool,BOOKING_ID);
  if (!position || position.paidCents!==6000n || position.outstandingCents!==14000n ||
      !['BALANCE_DUE','OVERDUE'].includes(position.position)) fail('Outstanding balance must remain exactly EUR 140.00');
  console.log(JSON.stringify({stage:'PREFLIGHT',outcome:'PREFLIGHT_OK',bookingId:BOOKING_ID,database:context.database.name,
    stripeAccount:context.options.expectedAccount,totalCents:20000,initialAllocatedCents:6000,outstandingCents:14000,
    unresolvedBalanceAttempts:0,originalClaimId:snapshot.claims[0].id,
    earlyPaymentEvidence:'docs/BOOKING_ACCEPTANCE_SCENARIOS.md scenario 3; docs/BOOKING_PAYMENT_SPEC.md section 5'},null,2));
}

async function start(context:Context):Promise<void> {
  let state=await load();
  const before=await inspect(context.pool,context.options.databaseName);
  if (!state) {
    assertFresh(before.snapshot);
    state={version:1,bookingId:BOOKING_ID,database:before.database,stripeAccount:context.options.expectedAccount,
      preparedAt:before.now,baselineHash:baselineHash(before.snapshot),originalClaimId:before.snapshot.claims[0].id,
      originalHoldId:before.snapshot.claims[0].origin_hold_id!,historicalAttemptIds:before.snapshot.attempts.map(a=>a.id)};
    await save(state); // Durable intent and inventory baseline precede any database write.
  }
  bindState(context,state);
  assertBaseline(before.snapshot,state);
  if (before.snapshot.payments.length!==1 || before.snapshot.allocations.length!==1)
    fail('Balance may already be paid; use VERIFY. START cannot create another collection');
  const position=await paymentPosition(context.pool,BOOKING_ID);
  if (!position || position.outstandingCents!==14000n || position.paidCents!==6000n ||
      !['BALANCE_DUE','OVERDUE'].includes(position.position)) fail('Balance is no longer exactly EUR 140.00');
  const resumed=originalAttempt(before.snapshot,state);
  if (!state.attemptId && resumed) {
    state={...state,attemptId:resumed.id,commandId:resumed.command_id!}; // Recover a crash after the request committed, before local save.
    await save(state);
  }
  if (!state.attemptId) {
    const requested=await requestBalanceCheckout(context.pool,BOOKING_ID);
    if (!requested) fail('Balance request was not eligible; no replacement attempted');
    state={...state,...requested};
    await save(state); // IDs are persisted before Stripe can be called.
  }
  const current=(await inspect(context.pool,context.options.databaseName)).snapshot;
  originalAttempt(current,state);
  const checkout=await dispatchBalanceSessionCreate(context.pool,context.gateway,state.attemptId!,`local-balance-smoke:${process.pid}`,
    {successUrl:context.options.config.STRIPE_SUCCESS_URL,cancelUrl:context.options.config.STRIPE_CANCEL_URL});
  assertBaseline((await inspect(context.pool,context.options.databaseName)).snapshot,state);
  console.log(JSON.stringify({stage:'START',outcome:checkout.status,bookingId:BOOKING_ID,attemptId:state.attemptId,
    commandId:state.commandId,amountCents:14000,currency:'EUR',...(checkout.status==='READY'?{checkoutUrl:checkout.url}:{})},null,2));
  if (checkout.status!=='READY') process.exitCode=2;
}

/** Scope the existing worker's otherwise-global lease-limit cleanup to this event.
 * All financial reconciliation and event claiming still run through the existing services.
 */
export function scopedInboxPool(pool:Pool,eventId:string):Pool {
  return new Proxy(pool,{get(target,key) {
    if (key==='query') return (sql:string,values?:unknown[])=>{
      if (typeof sql!=='string') fail('Unexpected inbox query format');
      if (!values && /^\s*UPDATE stripe_webhook_events/.test(sql)) {
        if (!sql.includes("processing_state='INVESTIGATE'") || !sql.includes("processing_state='PROCESSING'"))
          fail('Unexpected unscoped inbox housekeeping query');
        return target.query(`${sql} AND id=$1`,[eventId]);
      }
      return target.query(sql,values);
    };
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}

export function classify(s:Snapshot,state:State,position:Awaited<ReturnType<typeof paymentPosition>>,
  reconciliation:string,signedSuccessCount:number):Outcome {
  assertBaseline(s,state);
  const balance=s.obligations.find(o=>o.kind==='BALANCE')!;
  const attempts=s.attempts.filter(a=>!state.historicalAttemptIds.includes(a.id));
  const a=attempts[0];
  if (attempts.length!==1 || a.id!==state.attemptId || a.command_id!==state.commandId ||
      a.hold_id!==null || a.expected_cents!=='14000' || a.currency!=='EUR' || !position) return 'FAIL';
  const payments=s.payments.filter(p=>p.obligation_id===balance.id);
  const allocations=s.allocations.filter(x=>x.obligation_id===balance.id);
  const cleanPending=s.payments.length===1 && s.allocations.length===1 && !payments.length && !allocations.length &&
    position.paidCents===6000n && position.outstandingCents===14000n && ['BALANCE_DUE','OVERDUE'].includes(position.position);
  if (cleanPending) return activeStates.includes(a.state) && reconciliation!=='UNALLOCATABLE'?'PENDING':'FAIL';
  const paid=s.payments.length===2 && s.allocations.length===2 && payments.length===1 && allocations.length===1 &&
    a.state==='SUCCEEDED' && payments[0].attempt_id===a.id && payments[0].booking_id===BOOKING_ID &&
    payments[0].stripe_payment_intent_id===a.stripe_payment_intent_id && !!payments[0].stripe_charge_id &&
    payments[0].captured_cents==='14000' && payments[0].currency==='EUR' && payments[0].allocation_state==='ALLOCATED' &&
    payments[0].refund_encumbered_cents==='0' && payments[0].evidence_kind==='STRIPE_CURRENT' && payments[0].result==='VERIFIED_BALANCE' &&
    allocations[0].payment_record_id===payments[0].id && allocations[0].amount_cents==='14000' &&
    position.position==='PAID_IN_FULL' && position.paidCents===20000n && position.outstandingCents===0n;
  if (!paid) return 'FAIL';
  if (!['PAID_IN_FULL','ALREADY_RECORDED'].includes(reconciliation)) return 'PENDING';
  return signedSuccessCount>0?'PASS':'PAYMENT_CONFIRMED_WEBHOOK_MISSING';
}

async function verify(context:Context):Promise<void> {
  const state=await load();
  if (!state?.attemptId || !state.commandId) fail('START has not saved the original attempt and command');
  bindState(context,state);
  const before=(await inspect(context.pool,context.options.databaseName)).snapshot;
  assertBaseline(before,state);
  const a=before.attempts.find(a=>a.id===state.attemptId);
  if (!a || a.command_id!==state.commandId) fail('Saved balance attempt does not match the database');
  const identities=[a.stripe_session_id,a.stripe_payment_intent_id].filter((id):id is string=>!!id);
  if (a.stripe_session_id) {
    try {
      const session=await context.gateway.retrieveSession(a.stripe_session_id);
      if (!session.livemode && session.accountId===context.options.expectedAccount && session.metadata.attemptId===a.id && session.paymentIntentId)
        identities.push(session.paymentIntentId);
    } catch { /* Unknown provider evidence remains PENDING, never a false PASS. */ }
  }
  const events=await context.pool.query<{id:string}>(`SELECT id FROM stripe_webhook_events
    WHERE object_id=ANY($1::text[]) AND stripe_event_id LIKE 'evt_%' AND octet_length(payload_digest)=32
      AND ((object_type='checkout.session' AND event_type IN ('checkout.session.completed','checkout.session.expired')) OR
        (object_type='payment_intent' AND event_type IN ('payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled')))
      AND processing_state IN ('PENDING','RETRY','PROCESSING') ORDER BY received_at LIMIT 25`,[identities]);
  let processed=0;
  for (const event of events.rows) processed+=await processWebhookInbox(scopedInboxPool(context.pool,event.id),context.gateway,1,event.id);
  const reconciliation=await reconcileBalanceAttempt(context.pool,context.gateway,a.id);
  const after=(await inspect(context.pool,context.options.databaseName)).snapshot;
  const current=after.attempts.find(x=>x.id===a.id);
  const success=await context.pool.query<{count:string}>(`SELECT count(*)::text FROM stripe_webhook_events
    WHERE processing_state='PROCESSED' AND processed_at IS NOT NULL AND stripe_event_id LIKE 'evt_%' AND octet_length(payload_digest)=32 AND
      ((object_type='checkout.session' AND object_id=$1 AND event_type='checkout.session.completed') OR
       (object_type='payment_intent' AND object_id=$2 AND event_type='payment_intent.succeeded'))`,
    [current?.stripe_session_id??null,current?.stripe_payment_intent_id??null]);
  const position=await paymentPosition(context.pool,BOOKING_ID);
  const signedSuccessCount=Number(success.rows[0].count);
  const outcome=classify(after,state,position,reconciliation,signedSuccessCount);
  console.log(JSON.stringify({stage:'VERIFY',outcome,bookingId:BOOKING_ID,attemptId:a.id,commandId:state.commandId,reconciliation,
    processedWebhookCountThisRun:processed,matchingProcessedSignedSuccessCount:signedSuccessCount,bookingState:after.status,
    balanceAllocatedCents:after.allocations.filter(x=>x.obligation_id===a.obligation_id).reduce((sum,x)=>sum+BigInt(x.amount_cents),0n).toString(),
    totalAllocatedCents:after.allocations.reduce((sum,x)=>sum+BigInt(x.amount_cents),0n).toString(),
    paymentPosition:position?.position,outstandingCents:position?.outstandingCents.toString(),paymentRecords:after.payments.length,
    allocations:after.allocations.length,originalClaimId:state.originalClaimId,inventoryUnchanged:true},null,2));
  if (outcome!=='PASS') process.exitCode=outcome==='FAIL'?1:2;
}

async function main():Promise<void> {
  const stage=parseStage(process.argv.slice(2)); // Opt-in is checked before reading credentials or opening connections.
  if (!process.stdout.isTTY) fail('Run in a local terminal; Checkout URLs must not be redirected into logs');
  process.loadEnvFile('.env.local');
  if (stage==='preflight') {
    const context=await connect();
    try {await preflight(context);} finally {await context.pool.end();}
    return; // No directory, lock, state, database, or provider writes in PREFLIGHT.
  }
  await mkdir(directory,{recursive:true,mode:0o700});
  const lock=await open(lockFile,'wx',0o600).catch(()=>fail('Runner lock exists; inspect .local/stripe-balance-smoke/runner.lock before retrying'));
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,stage,startedAt:new Date().toISOString()}));
    const context=await connect();
    try {if (stage==='start') await start(context);else await verify(context);}
    finally {await context.pool.end();}
  } finally {await lock.close();await unlink(lockFile);}
}
if (process.argv[1] && path.resolve(process.argv[1])===path.resolve('scripts/stripe-balance-smoke.ts')) {
  main().catch(error=>{
    console.error(JSON.stringify({outcome:'FAIL',reason:safeError(error)}));
    process.exitCode=1;
  });
}
