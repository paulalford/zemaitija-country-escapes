/** Opt-in local runner. Importing this module opens no connections and executes no stage. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, lstat } from 'node:fs/promises';
import path from 'node:path';
import pg, { type Pool, type PoolClient, type QueryResultRow } from 'pg';
import Stripe from 'stripe';
import { z } from 'zod';
import { settings as baseSettings, scopedInboxPool, BOOKING_ID as PROTECTED_BOOKING } from './stripe-balance-smoke';
import { checkAvailability } from '../src/server/availability';
import { paymentPosition } from '../src/server/payment-position';
import { quoteStay } from '../src/server/quote';
import { acceptBooking } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { reconcileInitialAttempt } from '../src/server/payment-reconciliation';
import { cancelBooking } from '../src/server/cancellation';
import type { InternalAuthority } from '../src/server/cancellation-authority';
import { requestRefund, dispatchRefund, reconcileRefund, type RefundRequest, type RefundGateway } from '../src/server/refund-worker';
import { processWebhookInbox } from '../src/server/stripe-webhooks';
import { StripeSdkGateway, STRIPE_API_VERSION, type StripeGateway, type CheckoutSession } from '../src/server/stripe-adapter';

const directory=path.resolve('.local/stripe-refund-smoke');
const stateFile=path.join(directory,'state.json'),lockFile=path.join(directory,'runner.lock');
const stages=['preflight','start','cancel','refund','verify'] as const;
type Stage=typeof stages[number];
export class SmokeError extends Error {}
function fail(reason:string):never { throw new SmokeError(reason); }
export function parseStage(args:string[]):Stage {
  if(args.length!==2||!stages.includes(args[0] as Stage)||args[1]!=='--local-sandbox-only')
    fail('Usage: stripe-refund-smoke.ts <preflight|start|cancel|refund|verify> --local-sandbox-only');
  return args[0] as Stage;
}
export function settings(env:NodeJS.ProcessEnv) {
  const base=baseSettings(env);
  if(env.PGOPTIONS||env.PGSERVICE)fail('PostgreSQL connection overrides are not permitted');
  if(!env.MIGRATION_DATABASE_URL)fail('MIGRATION_DATABASE_URL is required for read-only migration checks and synthetic identity fixtures');
  const app=new URL(base.databaseUrl),fixture=new URL(env.MIGRATION_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(fixture.protocol)||fixture.hostname!==app.hostname||
    (fixture.port||'5432')!==(app.port||'5432')||fixture.pathname!==app.pathname||
    decodeURIComponent(fixture.username)!=='zemaitija_migrator'||fixture.search||fixture.hash)
    fail('Fixture connection must use zemaitija_migrator on the same localhost *_dev database without overrides');
  const arrivalDate=env.SMOKE_REFUND_ARRIVAL_DATE,departureDate=env.SMOKE_REFUND_DEPARTURE_DATE;
  if(!arrivalDate||!departureDate||!/^2027-\d{2}-\d{2}$/.test(arrivalDate)||!/^2027-\d{2}-\d{2}$/.test(departureDate))
    fail('Set SMOKE_REFUND_ARRIVAL_DATE and SMOKE_REFUND_DEPARTURE_DATE to available synthetic 2027 dates');
  const expected=env.SMOKE_REFUND_EXPECTED_INITIAL_CENTS;
  if(expected!==undefined&&!/^[1-9]\d{0,4}$/.test(expected))fail('Expected initial cents must be an integer from 1 to 10000');
  if(expected!==undefined&&BigInt(expected)>10000n)fail('Initial payment exceeds the runner safety limit of EUR 100');
  return {...base,fixtureUrl:env.MIGRATION_DATABASE_URL,arrivalDate,departureDate,expectedInitial:expected};
}
const ids=z.object({bookingId:z.uuid(),holdId:z.uuid(),attemptId:z.uuid(),commandId:z.uuid(),claimId:z.uuid()}).strict();
export const stateSchema=z.object({
  version:z.literal(1),runId:z.uuid(),guestId:z.uuid(),adminId:z.uuid(),operationKey:z.string(),preparedAt:z.iso.datetime(),
  stripeAccount:z.string().regex(/^acct_[A-Za-z0-9]+$/),
  database:z.object({name:z.string().endsWith('_dev'),address:z.string().nullable(),port:z.number().nullable()}).strict(),
  protectedHash:z.string().regex(/^[a-f0-9]{64}$/),unitId:z.uuid(),unitKey:z.literal('forest-cottage'),
  arrivalDate:z.string().regex(/^2027-\d\d-\d\d$/),departureDate:z.string().regex(/^2027-\d\d-\d\d$/),
  initialCents:z.string().regex(/^[1-9]\d*$/),totalCents:z.string().regex(/^[1-9]\d*$/),
  accepted:ids.optional(),capture:z.object({id:z.uuid(),paymentIntentId:z.string().startsWith('pi_'),chargeId:z.string().startsWith('ch_'),hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().optional(),
  refundIntentAt:z.iso.datetime().optional(),refund:z.object({obligationId:z.uuid(),attemptId:z.uuid(),commandId:z.uuid()}).strict().optional(),
}).strict().superRefine((s,c)=>{
  if(s.operationKey!==`refund-smoke:${s.runId}`||BigInt(s.initialCents)>10000n||BigInt(s.totalCents)<BigInt(s.initialCents)||
    s.arrivalDate>=s.departureDate||s.accepted?.bookingId.toLowerCase()===PROTECTED_BOOKING||
    new Set([s.runId,s.guestId,s.adminId,...Object.values(s.accepted??{})]).size!==3+Object.keys(s.accepted??{}).length||
    s.capture&&!s.accepted||s.refund&&(!s.capture||!s.refundIntentAt))c.addIssue({code:'custom',message:'Unsafe or incomplete refund smoke state'});
});
export type State=z.infer<typeof stateSchema>;
function canonical(value:unknown):string {
  const clean=JSON.parse(JSON.stringify(value)) as unknown;
  function sort(v:unknown):unknown {
    if(Array.isArray(v))return v.map(sort);
    if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sort(x)]));
    return v;
  }
  return JSON.stringify(sort(clean));
}
const hash=(value:unknown)=>createHash('sha256').update(canonical(value)).digest('hex');
async function privatePath(file:string,directoryExpected=false) {
  const stat=await lstat(file);
  if(stat.isSymbolicLink()||(directoryExpected?!stat.isDirectory():!stat.isFile())||(stat.mode&0o077)!==0||stat.uid!==process.getuid?.())
    fail('Smoke state and lock must be private files/directories owned by the current user, without symlinks');
}
async function load():Promise<State|null> {
  try {await privatePath(directory,true);await privatePath(stateFile);return stateSchema.parse(JSON.parse(await readFile(stateFile,'utf8')));}
  catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function save(state:State) {
  const temporary=`${stateFile}.${process.pid}.tmp`,file=await open(temporary,'wx',0o600);
  try {await file.writeFile(JSON.stringify(stateSchema.parse(state),null,2));await file.sync();}finally{await file.close();}
  await rename(temporary,stateFile);
  const folder=await open(directory,'r');try{await folder.sync();}finally{await folder.close();}
}
type Database=State['database'];
type Protected={facts:unknown;status:string;total:string;captured:string;refunded:string;active:number;guest_id:string;intents:string[];charges:string[];sessions:string[]};
async function protectedBooking(pool:Pool):Promise<Protected> {
  const r=await pool.query<Protected>(`SELECT b.status,b.guest_id,s.total_cents::text total,
    (SELECT COALESCE(sum(captured_cents),0)::text FROM payment_records WHERE booking_id=b.id) captured,
    (SELECT COALESCE(sum(refunded_cents),0)::text FROM refund_records WHERE booking_id=b.id) refunded,
    (SELECT count(*)::int FROM inventory_claims WHERE booking_id=b.id AND released_at IS NULL) active,
    ARRAY(SELECT stripe_payment_intent_id FROM payment_records WHERE booking_id=b.id) intents,
    ARRAY(SELECT stripe_charge_id FROM payment_records WHERE booking_id=b.id AND stripe_charge_id IS NOT NULL) charges,
    ARRAY(SELECT stripe_session_id FROM payment_attempts WHERE booking_id=b.id AND stripe_session_id IS NOT NULL) sessions,
    jsonb_build_object('booking',to_jsonb(b),'price',to_jsonb(s),
      'price_lines',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM price_snapshot_lines x WHERE snapshot_id=s.id),
      'holds',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM inventory_holds x WHERE booking_id=b.id),
      'claims',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM inventory_claims x WHERE booking_id=b.id OR origin_hold_id IN (SELECT id FROM inventory_holds WHERE booking_id=b.id)),
      'obligations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM payment_obligations x WHERE booking_id=b.id),
      'attempts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM payment_attempts x WHERE booking_id=b.id),
      'payments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM payment_records x WHERE booking_id=b.id),
      'allocations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM payment_allocations x WHERE obligation_id IN (SELECT id FROM payment_obligations WHERE booking_id=b.id)),
      'assessments',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM cancellation_assessments x WHERE booking_id=b.id),
      'assessment_revisions',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM assessment_revisions x WHERE assessment_id IN (SELECT id FROM cancellation_assessments WHERE booking_id=b.id)),
      'refund_obligations',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM refund_obligations x WHERE booking_id=b.id),
      'refund_attempts',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM refund_attempts x WHERE obligation_id IN (SELECT id FROM refund_obligations WHERE booking_id=b.id)),
      'refund_records',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM refund_records x WHERE booking_id=b.id),
      'commands',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM provider_commands x WHERE payment_attempt_id IN (SELECT id FROM payment_attempts WHERE booking_id=b.id) OR refund_attempt_id IN (SELECT ra.id FROM refund_attempts ra JOIN refund_obligations ro ON ro.id=ra.obligation_id WHERE ro.booking_id=b.id)),
      'audits',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM audit_events x WHERE booking_id=b.id),
      'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM notification_outbox x WHERE booking_id=b.id)) facts
    FROM bookings b JOIN price_snapshots s ON s.booking_id=b.id JOIN guests g ON g.id=b.guest_id
    WHERE b.id=$1 AND g.retention_state='SYNTHETIC'`,[PROTECTED_BOOKING]);
  const b=r.rows[0];
  if(!b||b.status!=='CONFIRMED'||b.total!=='20000'||b.captured!=='20000'||b.refunded!=='0'||b.active!==1)
    fail('Protected EUR 200 booking must remain confirmed, fully captured, unrefunded and inventory-owning');
  return b;
}
type Context={pool:Pool;stripe:Stripe;options:ReturnType<typeof settings>;database:Database;protected:Protected};
async function fixtureConnection<T>(c:Context,readOnly:boolean,work:(client:PoolClient)=>Promise<T>) {
  const pool=new pg.Pool({connectionString:c.options.fixtureUrl,max:1,connectionTimeoutMillis:5000});
  const client=await pool.connect();
  try {
    await client.query(readOnly?'BEGIN READ ONLY':'BEGIN');
    await client.query("SET LOCAL statement_timeout='10s'");
    const target=(await client.query<{name:string;role:string;address:string|null;port:number|null;recovery:boolean}>(
      'SELECT current_database() name,current_user role,inet_server_addr()::text address,inet_server_port() port,pg_is_in_recovery() recovery')).rows[0];
    if(target.role!=='zemaitija_migrator'||target.recovery||target.name!==c.database.name||target.address!==c.database.address||target.port!==c.database.port)
      fail('Synthetic fixture connection targets another database or role');
    const result=await work(client);await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();await pool.end();}
}
async function connect():Promise<Context> {
  const options=settings(process.env),pool=new pg.Pool({connectionString:options.databaseUrl,max:3,connectionTimeoutMillis:5000});
  try {
    const target=(await pool.query<{name:string;role:string;address:string|null;port:number|null;recovery:boolean}>(
      'SELECT current_database() name,current_user role,inet_server_addr()::text address,inet_server_port() port,pg_is_in_recovery() recovery')).rows[0];
    if(target.role!=='zemaitija_app'||target.name!==options.databaseName||target.recovery||
      target.address!==null&&!/^(127\.|::1$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(target.address))fail('Local runtime database identity mismatch');
    const stripe=new Stripe(options.config.STRIPE_SECRET_KEY,{apiVersion:STRIPE_API_VERSION,maxNetworkRetries:0,timeout:10_000});
    const c:Context={pool,stripe,options,database:{name:target.name,address:target.address,port:target.port},protected:await protectedBooking(pool)};
    const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')) as {entries:{when:number;tag:string}[]};
    if(journal.entries.at(-1)?.tag!=='0028_cancellation_trigger_row_shape')fail('Expected the independently reviewed Milestone 13 migration baseline');
    await fixtureConnection(c,true,async client=>{
      const applied=(await client.query<{hash:string;created_at:string}>('SELECT hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at')).rows;
      if(applied.length!==journal.entries.length)fail('Migration count mismatch; this runner never applies migrations');
      for(const [i,e] of journal.entries.entries())if(applied[i].created_at!==String(e.when)||applied[i].hash!==createHash('sha256').update(await readFile(`drizzle/${e.tag}.sql`,'utf8')).digest('hex'))
        fail('Installed migration version/hash mismatch');
    });
    const guards=(await pool.query<{n:number}>(`SELECT count(*)::int n FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O' AND tgname=ANY($1::text[])`,[
      ['refund_attempt_finances','refund_record_finances','refund_command_financial_identity','cancellation_liability_obligation','financial_incident_guest_notice']])).rows[0];
    if(guards.n!==5)fail('Required cancellation/refund guards are missing');
    if((await stripe.accounts.retrieve(null)).id!==options.expectedAccount)fail('Stripe key belongs to another account');
    return c;
  }catch(error){await pool.end();throw error;}
}
function bind(c:Context,s:State) {
  if(s.stripeAccount!==c.options.expectedAccount||canonical(s.database)!==canonical(c.database)||s.protectedHash!==hash(c.protected.facts)||
    s.arrivalDate!==c.options.arrivalDate||s.departureDate!==c.options.departureDate||s.guestId===c.protected.guest_id||
    c.options.expectedInitial!==undefined&&s.initialCents!==c.options.expectedInitial)fail('State/database/account/dates/amount mismatch or protected booking changed');
}
async function protect(c:Context,s:State) {
  if(hash((await protectedBooking(c.pool)).facts)!==s.protectedHash)fail('Protected EUR 200 booking changed; stop and investigate');
}
type Attempt={id:string;booking_id:string;obligation_id:string;hold_id:string|null;state:string;expected_cents:string;stripe_session_id:string|null;stripe_payment_intent_id:string|null};
type Capture={id:string;attempt_id:string;booking_id:string;obligation_id:string;stripe_payment_intent_id:string;stripe_charge_id:string;captured_cents:string;currency:string;allocation_state:string;refund_encumbered_cents:string;reconciliation_id:string};
type RefundAttempt={id:string;obligation_id:string;payment_record_id:string;state:string;requested_cents:string;stripe_refund_id:string|null};
type Command={id:string;state:string;payment_attempt_id:string|null;refund_attempt_id:string|null;kind:string;logical_key:string;stripe_idempotency_key:string;first_submitted_at:Date|null;attempt_count:number;created_at:Date;request_params:unknown};
export type Snapshot={
  booking:{id:string;guest_id:string;unit_id:string;status:string;cancelled_at:Date|null;balance_due_at:Date;accepted_at:Date};
  attempts:Attempt[];holds:{id:string;state:string;payment_attempt_id:string}[];
  claims:{id:string;hold_id:string|null;booking_id:string|null;origin_hold_id:string|null;released_at:Date|null;release_reason:string|null}[];
  captures:Capture[];allocations:{payment_record_id:string;obligation_id:string;amount_cents:string}[];
  assessments:{id:string;state:string;reason:string;cap_cents:string;current_revision_no:number|null;cancelled_at:Date}[];
  obligations:{id:string;source_payment_record_id:string;amount_cents:string;refund_encumbered_cents:string;reason:string}[];
  refundAttempts:RefundAttempt[];commands:Command[];
  refunds:{id:string;refund_attempt_id:string;payment_record_id:string;stripe_refund_id:string;refunded_cents:string;currency:string;reconciliation_id:string}[];
  audits:{id:string;action:string;entity_id:string;admin_user_id:string|null;guest_id:string|null;details:Record<string,unknown>|null;amount_cents:string|null}[];
  notices:{id:string;event_type:string;recipient_kind:string;recipient_ref:string|null;locale:string;state:string;source_audit_event_id:string}[];
  incidents:number;reconciliations:{id:string;payment_attempt_id:string|null;refund_attempt_id:string|null;provider_object_id:string|null;provider_state:string;evidence_kind:string;result:string;amount_cents:string;currency:string}[];
};
async function inspectOwned(c:Context,s:State):Promise<Snapshot|null> {
  const client=await c.pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const root=(await client.query<Snapshot['booking']&{arrival_date:string;departure_date:string;total_cents:string;initial_cents:string;synthetic:boolean;email_ciphertext:Buffer}>(`SELECT b.*,b.arrival_date::text,b.departure_date::text,
      p.total_cents::text,p.initial_cents::text,g.retention_state='SYNTHETIC' synthetic,g.email_ciphertext
      FROM bookings b JOIN price_snapshots p ON p.booking_id=b.id JOIN guests g ON g.id=b.guest_id WHERE p.quote_operation_key=$1`,[s.operationKey])).rows;
    if(!root.length){if(s.accepted)fail('Saved booking is missing; never create a replacement');await client.query('COMMIT');return null;}
    const b=root[0];
    if(root.length!==1||b.id===PROTECTED_BOOKING||b.guest_id!==s.guestId||b.unit_id!==s.unitId||!b.synthetic||
      !b.email_ciphertext.equals(Buffer.from(`synthetic-refund-smoke:${s.runId}`))||b.arrival_date!==s.arrivalDate||b.departure_date!==s.departureDate||
      b.total_cents!==s.totalCents||b.initial_cents!==s.initialCents||b.accepted_at<new Date(s.preparedAt)||s.accepted&&s.accepted.bookingId!==b.id)
      fail('Operation does not identify exactly this new synthetic booking');
    const rows=async<T extends QueryResultRow>(sql:string)=>(await client.query<T>(sql,[b.id])).rows;
    const attempts=await rows<Attempt>('SELECT * FROM payment_attempts WHERE booking_id=$1 ORDER BY id');
    const holds=await rows<Snapshot['holds'][number]>('SELECT * FROM inventory_holds WHERE booking_id=$1 ORDER BY id');
    const claims=await rows<Snapshot['claims'][number]>(`SELECT * FROM inventory_claims WHERE booking_id=$1 OR hold_id IN (SELECT id FROM inventory_holds WHERE booking_id=$1)
      OR origin_hold_id IN (SELECT id FROM inventory_holds WHERE booking_id=$1) ORDER BY id`);
    const captures=await rows<Capture>('SELECT * FROM payment_records WHERE booking_id=$1 ORDER BY id');
    const allocations=await rows<Snapshot['allocations'][number]>('SELECT a.* FROM payment_allocations a JOIN payment_obligations o ON o.id=a.obligation_id WHERE o.booking_id=$1 ORDER BY a.id');
    const assessments=await rows<Snapshot['assessments'][number]>('SELECT * FROM cancellation_assessments WHERE booking_id=$1');
    const obligations=await rows<Snapshot['obligations'][number]>('SELECT * FROM refund_obligations WHERE booking_id=$1 ORDER BY id');
    const refundAttempts=await rows<RefundAttempt>('SELECT a.* FROM refund_attempts a JOIN refund_obligations o ON o.id=a.obligation_id WHERE o.booking_id=$1 ORDER BY a.id');
    const commands=await rows<Command>(`SELECT * FROM provider_commands WHERE payment_attempt_id IN (SELECT id FROM payment_attempts WHERE booking_id=$1)
      OR refund_attempt_id IN (SELECT a.id FROM refund_attempts a JOIN refund_obligations o ON o.id=a.obligation_id WHERE o.booking_id=$1) ORDER BY id`);
    const refunds=await rows<Snapshot['refunds'][number]>('SELECT * FROM refund_records WHERE booking_id=$1 ORDER BY id');
    const audits=await rows<Snapshot['audits'][number]>('SELECT * FROM audit_events WHERE booking_id=$1 ORDER BY occurred_at,id');
    const notices=await rows<Snapshot['notices'][number]>('SELECT * FROM notification_outbox WHERE booking_id=$1 ORDER BY id');
    const reconciliations=await rows<Snapshot['reconciliations'][number]>(`SELECT * FROM reconciliation_records WHERE payment_attempt_id IN (SELECT id FROM payment_attempts WHERE booking_id=$1)
      OR refund_attempt_id IN (SELECT a.id FROM refund_attempts a JOIN refund_obligations o ON o.id=a.obligation_id WHERE o.booking_id=$1)`);
    const incident=(await rows<{n:number}>(`SELECT count(*)::int n FROM provider_incidents WHERE stripe_payment_intent_id IN (SELECT stripe_payment_intent_id FROM payment_attempts WHERE booking_id=$1)
      OR stripe_session_id IN (SELECT stripe_session_id FROM payment_attempts WHERE booking_id=$1)`))[0].n;
    if(attempts.length!==1||holds.length!==1||claims.length!==1||commands.filter(x=>x.kind==='SESSION_CREATE').length!==1||incident)
      fail('Unexpected payment attempts, inventory claims, commands or incidents; no replacement is permitted');
    const a=attempts[0],h=holds[0],claim=claims[0],command=commands.find(x=>x.kind==='SESSION_CREATE')!;
    if(a.hold_id!==h.id||h.payment_attempt_id!==a.id||a.expected_cents!==s.initialCents||
      command.payment_attempt_id!==a.id||command.logical_key!==`session-create:${s.operationKey}`||command.stripe_idempotency_key!==`session-create:${a.id}`||
      s.accepted&&(s.accepted.attemptId!==a.id||s.accepted.holdId!==h.id||s.accepted.claimId!==claim.id||s.accepted.commandId!==command.id)||
      a.stripe_session_id&&c.protected.sessions.includes(a.stripe_session_id)||a.stripe_payment_intent_id&&c.protected.intents.includes(a.stripe_payment_intent_id))
      fail('Saved original checkout/inventory identities do not match');
    await client.query('COMMIT');
    return {booking:b,attempts,holds,claims,captures,allocations,assessments,obligations,refundAttempts,commands,refunds,audits,notices,reconciliations,incidents:incident};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
}
export const captureHash=(p:Capture)=>hash(Object.fromEntries(Object.entries(p).filter(([key])=>key!=='refund_encumbered_cents')));
export function assertCapture(s:State,x:Snapshot):Capture {
  const p=x.captures[0],a=x.attempts[0];
  if(x.captures.length!==1||x.allocations.length!==1||!p||!s.accepted||p.attempt_id!==s.accepted.attemptId||p.booking_id!==s.accepted.bookingId||
    p.obligation_id!==a.obligation_id||p.stripe_payment_intent_id!==a.stripe_payment_intent_id||!p.stripe_charge_id||p.captured_cents!==s.initialCents||
    p.currency!=='EUR'||p.allocation_state!=='ALLOCATED'||x.allocations[0].payment_record_id!==p.id||
    x.allocations[0].obligation_id!==p.obligation_id||x.allocations[0].amount_cents!==s.initialCents||a.state!=='SUCCEEDED')fail('Expected exactly one original verified capture and matching immutable allocation');
  if(!x.reconciliations.some(r=>r.id===p.reconciliation_id&&r.payment_attempt_id===a.id&&r.evidence_kind==='STRIPE_CURRENT'&&r.result==='VERIFIED_INITIAL'&&r.amount_cents===s.initialCents&&r.currency==='EUR'))fail('Capture reconciliation evidence is missing');
  if(s.capture&&(s.capture.id!==p.id||s.capture.paymentIntentId!==p.stripe_payment_intent_id||s.capture.chargeId!==p.stripe_charge_id||s.capture.hash!==captureHash(p)))
    fail('Original historical capture changed');
  return p;
}
export function assertCancelled(s:State,x:Snapshot) {
  const p=assertCapture(s,x),a=x.assessments[0],cl=x.claims[0],b=x.booking,o=x.obligations[0];
  if(!s.accepted||b.status!=='CANCELLED_GUEST'||!b.cancelled_at||b.cancelled_at>=b.balance_due_at||x.assessments.length!==1||
    a.state!=='NOT_REQUIRED'||a.reason!=='GUEST_EARLY'||a.cap_cents!=='0'||a.current_revision_no!==null||a.cancelled_at.getTime()!==b.cancelled_at.getTime()||
    cl.id!==s.accepted.claimId||cl.booking_id!==b.id||cl.hold_id!==null||cl.origin_hold_id!==s.accepted.holdId||
    cl.released_at?.getTime()!==b.cancelled_at.getTime()||cl.release_reason!=='CANCELLATION_RECONCILED'||x.holds[0].state!=='CONSUMED'||
    x.obligations.length!==1||o.source_payment_record_id!==p.id||o.amount_cents!==s.initialCents||o.reason!=='GUEST_EARLY')
    fail('Early zero-charge cancellation, full refund liability or original inventory release proof is missing');
}
export function assertRefundRequest(s:State,q:RefundRequest) {
  if(!s.accepted||!s.capture||!s.refund||s.accepted.bookingId===PROTECTED_BOOKING||q.attemptId!==s.refund.attemptId||q.commandId!==s.refund.commandId||
    q.obligationId!==s.refund.obligationId||q.paymentRecordId!==s.capture.id||q.paymentIntentId!==s.capture.paymentIntentId||q.chargeId!==s.capture.chargeId||
    !Number.isSafeInteger(q.amountCents)||q.amountCents!==Number(s.initialCents)||q.captureCents!==q.amountCents||q.idempotencyKey!==`refund:${s.refund.attemptId}`)
    fail('Refund POST does not match this saved original capture and exact full entitlement');
}
function gateway(c:Context,s:State,x:Snapshot,stage:Stage,allowRefundPost=false):StripeGateway&RefundGateway {
  const base=new StripeSdkGateway(c.options.config),a=x.attempts[0],accepted=s.accepted!;
  const intents=new Set([a.stripe_payment_intent_id,s.capture?.paymentIntentId].filter((id):id is string=>!!id));
  let submitted=false;
  const checkSession=(v:CheckoutSession)=>{
    if(v.livemode||v.accountId!==s.stripeAccount||!v.id.startsWith('cs_test_')||c.protected.sessions.includes(v.id)||
      a.stripe_session_id&&v.id!==a.stripe_session_id||v.clientReferenceId!==accepted.bookingId||v.amountTotal!==Number(s.initialCents)||v.currency!=='eur'||
      Object.entries({bookingId:accepted.bookingId,attemptId:accepted.attemptId,holdId:accepted.holdId,commandId:accepted.commandId}).some(([k,value])=>v.metadata[k]!==value))
      fail('Stripe Session is not the owned test-mode checkout');
    if(v.paymentIntentId){if(c.protected.intents.includes(v.paymentIntentId))fail('Protected PaymentIntent rejected');intents.add(v.paymentIntentId);}
    return v;
  };
  const checkIntent=(id:string)=>{if(!intents.has(id)||c.protected.intents.includes(id))fail('Unowned or protected PaymentIntent rejected');};
  return {
    accountId:s.stripeAccount,
    async createSession(q){
      if(stage!=='start'||x.booking.status!=='AWAITING_INITIAL_PAYMENT'||x.captures.length||q.correlation.bookingId!==accepted.bookingId||
        q.correlation.attemptId!==accepted.attemptId||q.correlation.commandId!==accepted.commandId||q.correlation.holdId!==accepted.holdId||
        q.amountCents!==Number(s.initialCents)||q.idempotencyKey!==`session-create:${accepted.attemptId}`)fail('Checkout POST outside the saved START intent');
      return checkSession(await base.createSession(q));
    },
    async retrieveSession(id){if(id!==a.stripe_session_id||c.protected.sessions.includes(id))fail('Unowned Session retrieval rejected');return checkSession(await base.retrieveSession(id));},
    async findSessionForPaymentIntent(id){checkIntent(id);const v=await base.findSessionForPaymentIntent(id);return v?checkSession(v):null;},
    async retrievePaymentIntent(id){
      checkIntent(id);const p=await base.retrievePaymentIntent(id);
      if(p.livemode||p.id!==id||p.currency!=='eur'||p.chargeId&&c.protected.charges.includes(p.chargeId)||
        Object.entries({bookingId:accepted.bookingId,attemptId:accepted.attemptId,holdId:accepted.holdId,commandId:accepted.commandId}).some(([k,value])=>p.metadata[k]!==value))fail('Unowned Stripe payment evidence rejected');
      return p;
    },
    async expireSession(){fail('This paid-then-cancel runner never expires an unpaid Session');},
    verifyEvent(raw,signature){return base.verifyEvent(raw,signature);},
    async createRefund(q){
      assertRefundRequest(s,q);
      if(stage!=='refund'||!allowRefundPost||submitted)fail('Refund POST disabled: reconcile the existing operation; never blindly retry');
      submitted=true;return base.createRefund(q);
    },
    async retrieveRefund(id){
      const r=await base.retrieveRefund(id);
      if(!s.capture||!s.refund||r.livemode||r.accountId!==s.stripeAccount||r.paymentIntentId!==s.capture.paymentIntentId||r.chargeId!==s.capture.chargeId||
        r.metadata.attemptId!==s.refund.attemptId||r.metadata.commandId!==s.refund.commandId||r.metadata.obligationId!==s.refund.obligationId||r.metadata.paymentRecordId!==s.capture.id)fail('Unowned refund evidence rejected');
      return r;
    },
    async listRefunds(id){checkIntent(id);return base.listRefunds(id);},
  };
}
function report(stage:Stage,outcome:string,reason:string,details:Record<string,unknown>={}) {
  console.log(JSON.stringify({stage:stage.toUpperCase(),outcome,reason,...details},null,2));
  if(!['PREFLIGHT_OK','READY','CANCELLED_REFUND_OWED','PASS'].includes(outcome))process.exitCode=outcome==='FAIL'?1:2;
}
async function plan(c:Context) {
  const units=(await c.pool.query<{id:string}>("SELECT id FROM accommodation_units WHERE unit_key='forest-cottage' AND enabled")).rows;
  if(units.length!==1)fail('Enabled synthetic forest-cottage reference unit is required');
  const input={unitId:units[0].id,arrivalDate:c.options.arrivalDate,departureDate:c.options.departureDate,guestCount:2};
  if(!(await checkAvailability(c.pool,input)).available)fail('Requested synthetic accommodation dates are not available');
  const q=await quoteStay(c.pool,input),now=(await c.pool.query<{now:Date}>('SELECT clock_timestamp() now')).rows[0].now;
  if(q.previewSplit.basis!=='ADVANCE'||q.previewSplit.initialCents<=0n||q.previewSplit.initialCents>10000n||
    q.deadlines.balance.getTime()-now.getTime()<86400000||q.lines.some(l=>!l.localNight.startsWith('2027-')))
    fail('Requires existing synthetic 2027 rates, an advance at most EUR 100, and more than 24 hours before the T-14 cutoff');
  return {q,now};
}
async function fixtureIdentity(c:Context,s:State,kind:'guest'|'finance') {
  await fixtureConnection(c,false,async client=>{
    if(kind==='guest') {
      const marker=Buffer.from(`synthetic-refund-smoke:${s.runId}`);
      await client.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,$2,'en','SYNTHETIC') ON CONFLICT(id) DO NOTHING",[s.guestId,marker]);
      const g=(await client.query<{email_ciphertext:Buffer;preferred_locale:string;retention_state:string}>('SELECT email_ciphertext,preferred_locale,retention_state FROM guests WHERE id=$1',[s.guestId])).rows[0];
      if(g.retention_state!=='SYNTHETIC'||g.preferred_locale!=='en'||!g.email_ciphertext.equals(marker))fail('Synthetic guest fixture identity collision');
    }else {
      const subject=`local-refund-smoke:${s.runId}`;
      await client.query("INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,'finance',true) ON CONFLICT(id) DO NOTHING",[s.adminId,subject]);
      const a=(await client.query<{external_subject:string;role:string;enabled:boolean;disabled_at:Date|null}>('SELECT external_subject,role,enabled,disabled_at FROM admin_users WHERE id=$1',[s.adminId])).rows[0];
      if(a.external_subject!==subject||a.role!=='finance'||!a.enabled||a.disabled_at)fail('Synthetic finance identity missing, revoked or changed; never enable another administrator');
    }
  });
}
function authority(s:State,kind:'GUEST'|'OPERATOR'):InternalAuthority {
  if(!s.accepted)fail('No accepted smoke booking');
  const common={service:'local-refund-smoke',authorizationRef:`refund-smoke-${kind.toLowerCase()}:${s.runId}`,expiresAt:new Date(Date.now()+10*60_000)};
  return kind==='GUEST'?{...common,kind,guestId:s.guestId,bookingId:s.accepted.bookingId,scope:'booking:cancel'}:{...common,kind,adminId:s.adminId};
}
async function preflight(c:Context) {
  const s=await load();
  if(s){bind(c,s);report('preflight','PREFLIGHT_OK','Existing run is bound; resume only its saved identities',{bookingId:s.accepted?.bookingId??null,initialCents:s.initialCents});return;}
  const orphan=(await c.pool.query(`SELECT id FROM guests WHERE substring(email_ciphertext from 1 for $1)=$2 LIMIT 1`,[Buffer.byteLength('synthetic-refund-smoke:'),Buffer.from('synthetic-refund-smoke:')])).rowCount;
  if(orphan)fail('A prior refund smoke identity exists without local state; recover its state, do not start a replacement');
  const {q}=await plan(c);
  report('preflight','PREFLIGHT_OK','Read-only checks passed; no booking, provider object or local state created',{
    database:c.database.name,stripeAccount:c.options.expectedAccount,unitKey:'forest-cottage',arrivalDate:c.options.arrivalDate,departureDate:c.options.departureDate,
    totalCents:q.totalCents.toString(),initialCents:q.previewSplit.initialCents.toString(),earlyCutoff:q.deadlines.balance.toISOString(),
    migrations:'0000–0028 hashes verified',protectedBookingUnchanged:true,next:'Set SMOKE_REFUND_EXPECTED_INITIAL_CENTS to the displayed initial amount before START'});
}
async function start(c:Context) {
  let s=await load();
  if(!s) {
    const orphan=(await c.pool.query('SELECT id FROM guests WHERE substring(email_ciphertext from 1 for $1)=$2 LIMIT 1',[Buffer.byteLength('synthetic-refund-smoke:'),Buffer.from('synthetic-refund-smoke:')])).rowCount;
    if(orphan)fail('Prior smoke identity exists without state; no replacement booking will be created');
    const {q,now}=await plan(c);
    if(c.options.expectedInitial!==q.previewSplit.initialCents.toString())fail('START requires SMOKE_REFUND_EXPECTED_INITIAL_CENTS to match the preflight quote');
    const runId=randomUUID();
    s={version:1,runId,guestId:randomUUID(),adminId:randomUUID(),operationKey:`refund-smoke:${runId}`,preparedAt:now.toISOString(),
      stripeAccount:c.options.expectedAccount,database:c.database,protectedHash:hash(c.protected.facts),unitId:q.unitId,unitKey:'forest-cottage',
      arrivalDate:c.options.arrivalDate,departureDate:c.options.departureDate,initialCents:q.previewSplit.initialCents.toString(),totalCents:q.totalCents.toString()};
    await save(s); // Durable intent precedes every database or Stripe write.
  }
  bind(c,s);
  let x=await inspectOwned(c,s);
  if(!x) {
    if(s.accepted)fail('Never replace a missing original booking');
    const {q}=await plan(c);
    if(q.unitId!==s.unitId||q.totalCents.toString()!==s.totalCents||q.previewSplit.initialCents.toString()!==s.initialCents)fail('Saved quote intent changed');
    await fixtureIdentity(c,s,'guest');
    await acceptBooking(c.pool,{operationKey:s.operationKey,guestId:s.guestId,locale:'en',quote:q,termsVersion:'SYNTHETIC_TEST_TERMS_V1',
      acceptedTerms:true,acknowledgedInitialCents:BigInt(s.initialCents),syntheticPortfolioOnly:true});
    x=await inspectOwned(c,s);
  }
  if(!x)fail('Acceptance did not produce the original booking');
  const accepted={bookingId:x.booking.id,holdId:x.holds[0].id,attemptId:x.attempts[0].id,commandId:x.commands.find(v=>v.kind==='SESSION_CREATE')!.id,claimId:x.claims[0].id};
  s={...s,accepted};await save(s); // Also recovers acceptance committed immediately before a local save crash.
  if(x.booking.status!=='AWAITING_INITIAL_PAYMENT'||x.captures.length){report('start','PENDING_NEXT_STAGE','Original booking already advanced; use CANCEL or VERIFY, never create another Session',{bookingId:accepted.bookingId});return;}
  if(!['CREATING','OPEN','RECONCILING'].includes(x.attempts[0].state))fail('Original payment attempt is terminal; no replacement is permitted');
  const result=await dispatchSessionCreate(c.pool,gateway(c,s,x,'start'),accepted.attemptId,`local-refund-smoke:${process.pid}`,
    {successUrl:c.options.config.STRIPE_SUCCESS_URL,cancelUrl:c.options.config.STRIPE_CANCEL_URL});
  await protect(c,s);
  report('start',result.status,'Use this original Checkout; complete payment manually with Stripe test details',{
    bookingId:accepted.bookingId,attemptId:accepted.attemptId,initialCents:s.initialCents,...result.status==='READY'?{checkoutUrl:result.url}:{}});
}
type InboxRow={id:string;stripe_event_id:string;event_type:string;object_type:string;object_id:string;processing_state:string};
async function signedEvents(c:Context,s:State,x:Snapshot,g:StripeGateway&RefundGateway,kind:'payment'|'refund') {
  const a=x.attempts[0],refundId=x.refundAttempts[0]?.stripe_refund_id;
  if(kind==='refund'){
    if(!s.capture||!s.refund)fail('Refund inbox requires the saved original refund operation');
    const history=await g.listRefunds(s.capture.paymentIntentId);
    if(history.length!==1||history[0].metadata.attemptId!==s.refund.attemptId||history[0].metadata.commandId!==s.refund.commandId||
      history[0].metadata.obligationId!==s.refund.obligationId||history[0].metadata.paymentRecordId!==s.capture.id)fail('Refuse to process refund inbox events for untracked or foreign operations');
  }
  const identities=kind==='payment'?[a.stripe_session_id,a.stripe_payment_intent_id]:[refundId,s.capture?.chargeId];
  const rows=(await c.pool.query<InboxRow>(`SELECT id,stripe_event_id,event_type,object_type,object_id,processing_state FROM stripe_webhook_events
    WHERE object_id=ANY($1::text[]) AND stripe_event_id LIKE 'evt_%' AND octet_length(payload_digest)=32
      AND event_type=ANY($2::text[]) ORDER BY received_at LIMIT 25`,[identities.filter(Boolean),
    kind==='payment'?['checkout.session.completed','payment_intent.succeeded']:['refund.created','refund.updated','refund.failed','charge.refunded']])).rows;
  let successes=0;
  for(const row of rows) {
    const actual=await c.stripe.events.retrieve(row.stripe_event_id);
    const object=actual.data.object as {object?:string;id?:string};
    if(actual.livemode||actual.account&&actual.account!==s.stripeAccount||actual.type!==row.event_type||object.id!==row.object_id||object.object!==row.object_type)
      fail('Signed inbox event does not match the genuine Stripe test event');
    if(['PENDING','RETRY','PROCESSING'].includes(row.processing_state))await processWebhookInbox(scopedInboxPool(c.pool,row.id),g,1,row.id);
    const processed=(await c.pool.query<{ok:boolean}>('SELECT processing_state=\'PROCESSED\' AND processed_at IS NOT NULL ok FROM stripe_webhook_events WHERE id=$1',[row.id])).rows[0]?.ok;
    if(processed) {
      if(kind==='payment')successes++;
      else if((await c.pool.query(`SELECT id FROM reconciliation_records WHERE webhook_event_id=$1 AND refund_attempt_id=$2 AND
        provider_object_id=$3 AND evidence_kind='STRIPE_CURRENT' AND provider_state='succeeded' AND result='REFUND_SUCCEEDED' AND amount_cents=$4 AND currency='EUR'`,
        [row.id,s.refund?.attemptId,refundId,s.initialCents])).rowCount)successes++;
    }
  }
  return successes;
}
async function confirmedPayment(c:Context,s:State,x:Snapshot,g:StripeGateway&RefundGateway) {
  const a=x.attempts[0];
  if(!a.stripe_session_id)return {x,signed:0,paid:false};
  const session=await g.retrieveSession(a.stripe_session_id);
  if(session.paymentStatus!=='paid'||!session.paymentIntentId)return {x,signed:0,paid:false};
  // Refresh/confirm only the owned initial attempt, then process only its genuine signed success events.
  await reconcileInitialAttempt(c.pool,g,a.id);
  x=(await inspectOwned(c,s))!;
  const signed=await signedEvents(c,s,x,g,'payment');
  x=(await inspectOwned(c,s))!;
  assertCapture(s,x);
  const p=x.captures[0],provider=await g.retrievePaymentIntent(p.stripe_payment_intent_id);
  if(provider.status!=='succeeded'||!provider.chargePaid||!provider.chargeCaptured||provider.amountReceived!==Number(s.initialCents)||
    provider.chargeAmount!==Number(s.initialCents)||provider.chargeId!==p.stripe_charge_id||provider.chargeCurrency!=='eur')fail('Payment capture lacks authoritative exact-amount Stripe evidence');
  return {x,signed,paid:true};
}
async function cancel(c:Context,s:State,x:Snapshot) {
  if(x.booking.status==='CANCELLED_GUEST'&&x.refundAttempts.length){assertCancelled(s,x);report('cancel','PENDING_FINAL_VERIFICATION','Already cancelled with an existing refund operation; use VERIFY, no cancellation or refund submitted');return;}
  const g=gateway(c,s,x,'cancel'),payment=await confirmedPayment(c,s,x,g);x=payment.x;
  if(!payment.paid){report('cancel','PENDING_PAYMENT','Initial payment is not authoritatively captured');return;}
  if(!payment.signed){report('cancel','PAYMENT_CONFIRMED_WEBHOOK_MISSING','Paid, but a matching processed signed payment webhook is required before cancellation');return;}
  const p=assertCapture(s,x);
  if(!s.capture){s={...s,capture:{id:p.id,paymentIntentId:p.stripe_payment_intent_id,chargeId:p.stripe_charge_id,hash:captureHash(p)}};await save(s);}
  if(x.booking.status==='CONFIRMED') {
    const now=(await c.pool.query<{now:Date}>('SELECT clock_timestamp() now')).rows[0].now;
    if(x.booking.balance_due_at.getTime()-now.getTime()<60*60_000)fail('Early-cancellation safety margin has elapsed; do not run a late assessment smoke test');
    if((await g.listRefunds(p.stripe_payment_intent_id)).length||x.refundAttempts.length||x.refunds.length)fail('Capture already has refunds or refund attempts before cancellation');
    const outcome=await cancelBooking(c.pool,g,s.accepted!.bookingId,authority(s,'GUEST'),{kind:'GUEST',reason:'SYNTHETIC_LOCAL_REFUND_SMOKE'});
    if(outcome!=='CANCELLED'&&outcome!=='ALREADY_CANCELLED'){report('cancel','PENDING_CANCELLATION',outcome);return;}
  }
  x=(await inspectOwned(c,s))!;assertCancelled(s,x);await protect(c,s);
  report('cancel','CANCELLED_REFUND_OWED','Zero-charge early cancellation committed; original inventory released; no refund submitted',{
    bookingId:s.accepted!.bookingId,refundDueCents:s.initialCents,claimId:s.accepted!.claimId});
}
function refundOperation(s:State,x:Snapshot) {
  if(!s.capture||!s.refundIntentAt||x.refundAttempts.length!==1||x.commands.filter(v=>v.kind==='REFUND_CREATE').length!==1)fail('Expected one saved original refund operation; no replacements');
  const a=x.refundAttempts[0],command=x.commands.find(v=>v.kind==='REFUND_CREATE')!,o=x.obligations[0];
  if(a.obligation_id!==o.id||a.payment_record_id!==s.capture.id||a.requested_cents!==s.initialCents||command.refund_attempt_id!==a.id||
    command.created_at<new Date(s.refundIntentAt)||command.stripe_idempotency_key!==`refund:${a.id}`||command.logical_key!==`refund:${a.id}`||
    !x.audits.some(v=>v.action==='refund.requested'&&v.entity_id===a.id&&v.admin_user_id===s.adminId&&v.details?.authorizationRef===`refund-smoke-operator:${s.runId}`)||
    s.refund&&(s.refund.attemptId!==a.id||s.refund.commandId!==command.id||s.refund.obligationId!==o.id))fail('Refund attempt/command/authority does not match this local intent');
  const saved={...s,refund:{obligationId:o.id,attemptId:a.id,commandId:command.id}};
  assertRefundRequest(saved,command.request_params as RefundRequest);
  return {state:saved,attempt:a,command};
}
export function firstRefundSubmission(a:Pick<RefundAttempt,'state'>,c:Pick<Command,'state'|'first_submitted_at'|'attempt_count'>) {
  return a.state==='REQUESTED'&&c.state==='PENDING'&&c.first_submitted_at===null&&c.attempt_count===0;
}
async function refund(c:Context,s:State,x:Snapshot) {
  assertCancelled(s,x);
  if(!s.capture)fail('CANCEL must persist the original capture before REFUND');
  const confirmation=await confirmedPayment(c,s,x,gateway(c,s,x,'refund'));
  if(!confirmation.paid||!confirmation.signed){report('refund','PAYMENT_CONFIRMED_WEBHOOK_MISSING','Processed signed initial payment confirmation is required');return;}
  x=confirmation.x;
  if(!x.refundAttempts.length) {
    if(s.refund)fail('Saved refund operation is missing; no replacement will be requested');
    const existing=await gateway(c,s,x,'refund').listRefunds(s.capture.paymentIntentId);
    if(existing.length)fail('Original capture already has an untracked provider refund; investigate without submitting');
    if(!s.refundIntentAt){s={...s,refundIntentAt:(await c.pool.query<{now:Date}>('SELECT clock_timestamp() now')).rows[0].now.toISOString()};await save(s);}
    await fixtureIdentity(c,s,'finance');
    const id=await requestRefund(c.pool,x.obligations[0].id,authority(s,'OPERATOR'));
    if(!id)fail('The original full refund obligation was not eligible');
    x=(await inspectOwned(c,s))!;
  }
  const op=refundOperation(s,x);s=op.state;await save(s); // Recovers a committed request before its local IDs were saved.
  const first=firstRefundSubmission(op.attempt,op.command);
  const g=gateway(c,s,x,'refund',first);
  let result:string;
  if(first)result=await dispatchRefund(c.pool,g,op.attempt.id);
  else {
    result=await reconcileRefund(c.pool,g,op.attempt.id);
    if(result==='UNKNOWN'&&(!op.command.first_submitted_at||Date.now()-op.command.first_submitted_at.getTime()>=86_400_000))
      result=await dispatchRefund(c.pool,g,op.attempt.id); // GET/quarantine only; the runner's POST guard remains disabled.
    if(result==='UNKNOWN')result='PENDING_REFUND_OUTCOME_UNKNOWN';
  }
  await protect(c,s);
  report('refund',result==='SUCCEEDED'?'PENDING_FINAL_VERIFICATION':result==='FAILED'?'FAIL':result,
    result==='SUCCEEDED'?'Provider success reconciled; run VERIFY to require signed refund webhook and final evidence':'Original operation retained; retries reconcile only, never create a replacement',
    {bookingId:s.accepted!.bookingId,refundAttemptId:s.refund!.attemptId,amountCents:s.initialCents});
}
export type FinalEvidence={providerRefunds:Awaited<ReturnType<RefundGateway['listRefunds']>>;signedPaymentCount:number;signedRefundCount:number;protectedUnchanged:boolean;
  position:{position:string;paidCents:bigint;outstandingCents:bigint;refundedCents:bigint;refundDueCents:bigint;additionalChargeReviewCents:bigint}|null};
export function finalResult(s:State,x:Snapshot,e:FinalEvidence):{outcome:string;reason:string} {
  assertCancelled(s,x);
  if(!e.protectedUnchanged)fail('Protected booking fingerprint changed');
  if(!s.refund||!x.refundAttempts.length)return {outcome:'PENDING_REFUND',reason:'REFUND has not persisted the intended operation'};
  const {attempt:a,command}=refundOperation(s,x);
  if(command.state==='QUARANTINED')return {outcome:'QUARANTINED',reason:'Refund operation requires authoritative investigation'};
  if(e.providerRefunds.length>1||x.refunds.length>1)fail('Duplicate original-capture provider refunds or ledger debits');
  if(a.state==='FAILED')fail('Original refund failed; this runner never creates a replacement');
  const r=e.providerRefunds[0];
  if(!r||r.status!=='succeeded'||a.state!=='SUCCEEDED') {
    if(x.refunds.length)fail('Refund ledger exists without matching current provider success');
    return {outcome:'PENDING_REFUND',reason:'Authoritative provider success and ledger reconciliation are not complete'};
  }
  if(r.livemode||r.accountId!==s.stripeAccount||r.id!==a.stripe_refund_id||r.chargeId!==s.capture!.chargeId||r.paymentIntentId!==s.capture!.paymentIntentId||
    r.amount!==Number(s.initialCents)||r.currency!=='eur'||r.metadata.attemptId!==a.id||r.metadata.commandId!==command.id||
    r.metadata.obligationId!==s.refund.obligationId||r.metadata.paymentRecordId!==s.capture!.id)fail('Provider refund does not match the original intended operation');
  const debit=x.refunds[0],p=x.captures[0],o=x.obligations[0];
  if(x.refunds.length!==1||debit.refund_attempt_id!==a.id||debit.payment_record_id!==p.id||debit.stripe_refund_id!==r.id||debit.refunded_cents!==s.initialCents||
    debit.currency!=='EUR'||p.refund_encumbered_cents!==s.initialCents||o.refund_encumbered_cents!==s.initialCents||command.state!=='RESOLVED')
    fail('Refund ledger, exact reservations or command completion are inconsistent');
  if(!x.reconciliations.some(v=>v.id===debit.reconciliation_id&&v.refund_attempt_id===a.id&&v.provider_object_id===r.id&&v.evidence_kind==='STRIPE_CURRENT'&&v.result==='REFUND_SUCCEEDED'&&v.provider_state==='succeeded'&&v.amount_cents===s.initialCents&&v.currency==='EUR'))fail('Refund ledger lacks exact authoritative success evidence');
  const position=e.position;
  if(!position||position.position!=='REFUNDED_FULL'||position.paidCents!==BigInt(s.initialCents)||position.refundedCents!==BigInt(s.initialCents)||
    position.refundDueCents!==0n||position.outstandingCents!==0n||position.additionalChargeReviewCents!==0n)fail('Refund liability is not fully satisfied or historical capture is lost');
  for(const action of ['quote.accepted','booking.confirmed','booking.cancelled_guest','refund.requested','refund.succeeded'])
    if(x.audits.filter(v=>v.action===action).length!==1)fail(`Expected exactly one ${action} audit event`);
  const cancellation=x.audits.find(v=>v.action==='booking.cancelled_guest')!;
  if(cancellation.guest_id!==s.guestId||cancellation.details?.authorizationRef!==`refund-smoke-guest:${s.runId}`||cancellation.amount_cents!=='0')fail('Guest cancellation authority or zero-charge audit is missing');
  for(const [event,recipient,action] of [['BOOKING_CONFIRMED','GUEST','booking.confirmed'],['CANCELLED_GUEST','GUEST','booking.cancelled_guest'],
    ['CANCELLED_GUEST','OPERATIONS','booking.cancelled_guest'],['REFUND_SUCCEEDED','GUEST','refund.succeeded']]) {
    const n=x.notices.filter(v=>v.event_type===event&&v.recipient_kind===recipient);
    if(n.length!==1||n[0].locale!=='en'||['FAILED','SUPPRESSED'].includes(n[0].state)||
      n[0].recipient_ref!==(recipient==='GUEST'?s.guestId:null)||!x.audits.some(v=>v.id===n[0].source_audit_event_id&&v.action===action))
      fail('Expected source-linked guest/operations notification is missing, duplicated or failed');
  }
  if(!e.signedPaymentCount)return {outcome:'PAYMENT_CONFIRMED_WEBHOOK_MISSING',reason:'Initial payment lacks a processed genuine signed success webhook'};
  if(!e.signedRefundCount)return {outcome:'REFUND_CONFIRMED_WEBHOOK_MISSING',reason:'Refund lacks a processed genuine signed webhook with authoritative success reconciliation'};
  return {outcome:'PASS',reason:'Original capture preserved; one full refund verified by provider, ledger and signed webhook; inventory released; required audits and notices present'};
}
async function verify(c:Context,s:State,x:Snapshot) {
  if(x.booking.status!=='CANCELLED_GUEST'){report('verify','PENDING_CANCELLATION','Run CANCEL after signed payment confirmation');return;}
  assertCancelled(s,x);
  if(!s.capture)fail('Original capture identity has not been saved by CANCEL');
  if(!s.refund&&x.refundAttempts.length) {s=refundOperation(s,x).state;await save(s);}
  if(!s.refund){report('verify','PENDING_REFUND','Run REFUND explicitly; VERIFY never submits refunds');return;}
  const ownRefund=refundOperation(s,x);s=ownRefund.state; // Validate IDs against owned DB rows before any reconciliation can mutate an operation.
  const g=gateway(c,s,x,'verify'),payment=await confirmedPayment(c,s,x,g);
  if(!payment.paid)fail('Original authoritative capture no longer matches');
  await reconcileRefund(c.pool,g,ownRefund.attempt.id);
  x=(await inspectOwned(c,s))!;
  const observedHistory=await g.listRefunds(s.capture!.paymentIntentId);
  if(observedHistory.length>1)fail('More than one provider refund exists for the original capture');
  const signedRefund=observedHistory.length?await signedEvents(c,s,x,g,'refund'):0;
  const history=await g.listRefunds(s.capture!.paymentIntentId);
  x=(await inspectOwned(c,s))!;
  const position=await paymentPosition(c.pool,s.accepted!.bookingId);
  await protect(c,s);
  const result=finalResult(s,x,{providerRefunds:history,signedPaymentCount:payment.signed,signedRefundCount:signedRefund,protectedUnchanged:true,position});
  report('verify',result.outcome,result.reason,{bookingId:s.accepted!.bookingId,refundAttemptId:ownRefund.attempt.id,originalCapturedCents:s.initialCents,
    confirmedRefundCents:x.refunds.reduce((n,r)=>n+BigInt(r.refunded_cents),0n).toString(),refundDueCents:position?.refundDueCents.toString(),
    providerRefundCount:history.length,ledgerDebitCount:x.refunds.length,processedSignedPaymentSuccesses:payment.signed,processedSignedRefundSuccesses:signedRefund,
    originalClaimReleased:true,protectedBookingUnchanged:true,notifications:'Outbox records checked; no production email delivery claimed'});
}
async function main() {
  const stage=parseStage(process.argv.slice(2));
  if(!process.stdout.isTTY||!process.stderr.isTTY)fail('Run only in an interactive local terminal; do not redirect Checkout URLs into logs');
  process.loadEnvFile('.env.local');
  if(stage==='preflight') {const c=await connect();try{await preflight(c);}finally{await c.pool.end();}return;}
  // Private local state and a process lock fence all mutating/reconciling stages.
  const parent=await lstat(path.dirname(directory)).catch(error=>{if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;});
  if(parent?.isSymbolicLink())fail('The .local directory must not be a symlink');
  await mkdir(directory,{recursive:true,mode:0o700});await privatePath(directory,true);
  const lock=await open(lockFile,'wx',0o600).catch(()=>fail('Runner lock exists; inspect its PID and preserve state before retrying'));
  try {
    await lock.writeFile(JSON.stringify({pid:process.pid,stage,startedAt:new Date().toISOString()}));await lock.sync();
    const c=await connect();
    try {
      if(stage==='start')await start(c);
      else {
        const s=await load();if(!s?.accepted)fail('START must save the original accepted booking first');bind(c,s);
        const x=await inspectOwned(c,s);if(!x)fail('Original synthetic booking is missing');
        if(stage==='cancel')await cancel(c,s,x);else if(stage==='refund')await refund(c,s,x);else await verify(c,s,x);
      }
    }finally{await c.pool.end();}
  }finally{await lock.close();await unlink(lockFile);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve('scripts/stripe-refund-smoke.ts'))main().catch(error=>{
  const code=(error as {code?:unknown})?.code;
  console.error(JSON.stringify({outcome:'FAIL',reason:error instanceof SmokeError?error.message:
    typeof code==='string'&&/^[A-Z0-9_]{1,64}$/.test(code)?`code ${code}`:'Provider, database, configuration or local I/O error; no raw credentials/responses logged'}));
  process.exitCode=1;
});
