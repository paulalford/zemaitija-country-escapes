import type { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  BOOKING_ID, assertBaseline, assertFresh, baselineHash, classify, earlyPaymentPolicy,
  inspect, originalAttempt, parseStage, scopedInboxPool, settings, type Snapshot,
} from '../scripts/stripe-balance-smoke';

// Any accidental connection during these checks fails before reaching the network.
vi.mock('stripe',()=>({default:class { constructor() {throw new Error('Real Stripe calls are forbidden in runner validation');} }}));
vi.mock('pg',()=>({default:{Pool:class {constructor() {throw new Error('Real PostgreSQL connections are forbidden in runner validation');}}}}));

const id=(n:number)=>`00000000-0000-4000-8000-${n.toString().padStart(12,'0')}`;
const env:NodeJS.ProcessEnv={NODE_ENV:'test',DATABASE_URL:'postgresql://zemaitija_app:synthetic@127.0.0.1:5432/synthetic_dev',
  STRIPE_SECRET_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_ACCOUNT_ID:'acct_synthetic',
  SMOKE_EXPECTED_STRIPE_ACCOUNT_ID:'acct_synthetic',STRIPE_SUCCESS_URL:'http://localhost:3000/booking/return',
  STRIPE_CANCEL_URL:'http://localhost:3000/booking/return'};

function pendingSnapshot():Snapshot {
  return {booking_id:BOOKING_ID,status:'CONFIRMED',synthetic:true,property_zone:'Europe/Vilnius',
    total_cents:'20000',initial_cents:'6000',balance_cents:'14000',currency:'EUR',split_basis:'ADVANCE',
    booking:{id:BOOKING_ID,status:'CONFIRMED',version:2},price:{total_cents:20000,split_basis:'ADVANCE'},
    holds:[{id:id(1),booking_id:BOOKING_ID,state:'CONSUMED',payment_attempt_id:id(6)}],
    claims:[{id:id(2),booking_id:BOOKING_ID,hold_id:null,origin_hold_id:id(1),released_at:null}],
    obligations:[{id:id(3),kind:'INITIAL',amount_cents:'6000',currency:'EUR'},{id:id(4),kind:'BALANCE',amount_cents:'14000',currency:'EUR'}],
    payments:[{id:id(5),attempt_id:id(6),booking_id:BOOKING_ID,obligation_id:id(3),stripe_payment_intent_id:'pi_initial',
      stripe_charge_id:'ch_initial',captured_cents:'6000',currency:'EUR',allocation_state:'ALLOCATED',
      refund_encumbered_cents:'0',evidence_kind:'STRIPE_CURRENT',result:'VERIFIED_INITIAL'}],
    allocations:[{id:id(7),payment_record_id:id(5),obligation_id:id(3),amount_cents:'6000'}],
    attempts:[],refund_count:'0',incident_count:'0'};
}
function fixture(paid=false) {
  const snapshot=pendingSnapshot();
  const state:Parameters<typeof classify>[1]={version:1,bookingId:BOOKING_ID,stripeAccount:'acct_synthetic',
    database:{name:'synthetic_dev',address:'127.0.0.1',port:5432},preparedAt:'2026-10-25T12:00:00.000Z',
    baselineHash:baselineHash(snapshot),originalClaimId:id(2),originalHoldId:id(1),historicalAttemptIds:[],attemptId:id(8),commandId:id(9)};
  snapshot.attempts.push({id:id(8),obligation_id:id(4),hold_id:null,state:paid?'SUCCEEDED':'OPEN',expected_cents:'14000',currency:'EUR',
    stripe_session_id:'cs_test_balance',stripe_payment_intent_id:paid?'pi_balance':null,created_at:'2026-10-25T12:01:00.000Z',
    command_id:id(9),command_state:'RESOLVED',logical_key:`balance-session:${id(8)}`,stripe_idempotency_key:`balance-session:${id(8)}`,
    reconciliation_result:paid?'VERIFIED_BALANCE':null});
  if (paid) {
    snapshot.payments.push({id:id(10),attempt_id:id(8),booking_id:BOOKING_ID,obligation_id:id(4),stripe_payment_intent_id:'pi_balance',
      stripe_charge_id:'ch_balance',captured_cents:'14000',currency:'EUR',allocation_state:'ALLOCATED',refund_encumbered_cents:'0',
      evidence_kind:'STRIPE_CURRENT',result:'VERIFIED_BALANCE'});
    snapshot.allocations.push({id:id(11),payment_record_id:id(10),obligation_id:id(4),amount_cents:'14000'});
  }
  const position={position:paid?'PAID_IN_FULL' as const:'BALANCE_DUE' as const,paidCents:paid?20000n:6000n,
    outstandingCents:paid?0n:14000n,balanceDueAt:new Date('2027-03-27T13:00:00Z'),graceEndsAt:new Date('2027-03-28T13:00:00Z')};
  return {snapshot,state,position};
}

describe('local balance smoke safety and evidence gates',()=>{
  it('requires an explicit command and opt-in before any environment or connection work',()=>{
    for (const stage of ['preflight','start','verify']) expect(parseStage([stage,'--local-sandbox-only'])).toBe(stage);
    for (const args of [[],['start'],['start','--live'],['reset','--local-sandbox-only'],['verify','--local-sandbox-only','extra']])
      expect(()=>parseStage(args)).toThrow('Usage:');
  });
  it('accepts only the expected sandbox and local restricted development database',()=>{
    expect(settings(env)).toMatchObject({databaseName:'synthetic_dev',expectedAccount:'acct_synthetic'});
    const invalid:Partial<NodeJS.ProcessEnv>[]=[
      {STRIPE_SECRET_KEY:'sk_live_rejected'}, {SMOKE_EXPECTED_STRIPE_ACCOUNT_ID:'acct_different'},
      {DATABASE_URL:env.DATABASE_URL!.replace('127.0.0.1','example.com')},
      {DATABASE_URL:env.DATABASE_URL!.replace('synthetic_dev','synthetic_prod')},
      {DATABASE_URL:env.DATABASE_URL!.replace('zemaitija_app','zemaitija_migrator')},
      {DATABASE_URL:`${env.DATABASE_URL}?host=example.com`}, {NODE_ENV:'production'}, {CI:'true'},
      {STRIPE_SUCCESS_URL:'https://example.com/return'}, {SMOKE_EXPECTED_STRIPE_ACCOUNT_ID:undefined},
    ];
    for (const changes of invalid) expect(()=>settings({...env,...changes})).toThrow();
  });
  it('finds explicit approved early-payment evidence in repository documents',async()=>{
    await expect(earlyPaymentPolicy()).resolves.toBeUndefined();
  });
  it('inspects database and booking evidence in a read-only transaction',async()=>{
    const snapshot=pendingSnapshot(),queries:string[]=[];
    const client={query:vi.fn(async(sql:string)=>{
      queries.push(sql);
      if (sql.includes('current_database()')) return {rows:[{name:'synthetic_dev',role:'zemaitija_app',address:'127.0.0.1',port:5432,recovery:false,now:new Date('2026-10-25T12:00:00Z')}]};
      if (sql.includes('pg_trigger')) return {rows:[{scheduled:true,unique_guards:2}]};
      if (sql.includes('booking_id,b.status')) return {rows:[snapshot]};
      return {rows:[]};
    }),release:vi.fn()};
    const pool={connect:vi.fn(async()=>client)} as unknown as Pool;
    expect((await inspect(pool,'synthetic_dev')).snapshot).toBe(snapshot);
    expect(queries[0]).toBe('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    expect(queries.at(-1)).toBe('COMMIT');
    expect(queries.every(sql=>/^(BEGIN|SET LOCAL|SELECT|COMMIT)/.test(sql))).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });
  it('refuses an active balance attempt in a fresh preflight',()=>{
    expect(()=>assertFresh(pendingSnapshot())).not.toThrow();
    expect(()=>assertFresh(fixture().snapshot)).toThrow('unresolved or competing');
  });
  it('resumes the saved attempt and command across repeated requests',()=>{
    const {snapshot,state}=fixture();
    expect(originalAttempt(snapshot,state)?.id).toBe(state.attemptId);
    snapshot.attempts[0].state='RECONCILING';snapshot.attempts[0].command_state='UNKNOWN';
    expect(originalAttempt(snapshot,state)?.command_id).toBe(state.commandId);
  });
  it('recovers a request committed after saved intent, but refuses an older or competing attempt',()=>{
    const {snapshot,state}=fixture();
    const intent={...state,attemptId:undefined,commandId:undefined};
    expect(originalAttempt(snapshot,intent)?.id).toBe(state.attemptId);
    snapshot.attempts[0].created_at='2026-10-25T11:59:00Z';
    expect(()=>originalAttempt(snapshot,intent)).toThrow('no automatic replacement');
    snapshot.attempts.push({...snapshot.attempts[0],id:id(22)});
    expect(()=>originalAttempt(snapshot,intent)).toThrow('Competing');
  });
  it('refuses to replace the original terminal or missing attempt',()=>{
    const {snapshot,state}=fixture();snapshot.attempts[0].state='EXPIRED';
    expect(()=>originalAttempt(snapshot,state)).toThrow('no automatic replacement');
    snapshot.attempts=[];
    expect(()=>originalAttempt(snapshot,state)).toThrow('no automatic replacement');
  });
  it('reports PENDING for a clean unpaid original attempt',()=>{
    const {snapshot,state,position}=fixture();
    expect(classify(snapshot,state,position,'OPEN',0)).toBe('PENDING');
  });
  it('requires a matching processed signed success event even after authoritative payment confirmation',()=>{
    const {snapshot,state,position}=fixture(true);
    expect(classify(snapshot,state,position,'PAID_IN_FULL',0)).toBe('PAYMENT_CONFIRMED_WEBHOOK_MISSING');
    expect(classify(snapshot,state,position,'ALREADY_RECORDED',1)).toBe('PASS');
  });
  it('keeps provider uncertainty PENDING even with paid ledger facts and an earlier webhook',()=>{
    const {snapshot,state,position}=fixture(true);
    expect(classify(snapshot,state,position,'RECONCILING',1)).toBe('PENDING');
  });
  it('fails a terminal unpaid attempt rather than creating or approving a replacement',()=>{
    const {snapshot,state,position}=fixture();snapshot.attempts[0].state='EXPIRED';
    expect(classify(snapshot,state,position,'EXPIRED',1)).toBe('FAIL');
  });
  it('fails duplicate credits or allocations',()=>{
    for (const duplicate of ['payment','allocation']) {
      const {snapshot,state,position}=fixture(true);
      if (duplicate==='payment') snapshot.payments.push({...snapshot.payments[1],id:id(12)});
      else snapshot.allocations.push({...snapshot.allocations[1],id:id(12)});
      expect(classify(snapshot,state,position,'ALREADY_RECORDED',1)).toBe('FAIL');
    }
  });
  it('fails wrong balance amount, currency, or remaining position',()=>{
    for (const mutation of ['amount','currency','position']) {
      const {snapshot,state,position}=fixture(true);
      if (mutation==='amount') snapshot.allocations[1].amount_cents='13999';
      if (mutation==='currency') snapshot.payments[1].currency='USD';
      if (mutation==='position') position.outstandingCents=1n;
      expect(classify(snapshot,state,position,'ALREADY_RECORDED',1)).toBe('FAIL');
    }
  });
  it('refuses cancellation, released or changed claims, and additional holds',()=>{
    for (const mutation of ['cancel','release','claim','hold']) {
      const {snapshot,state}=fixture();
      if (mutation==='cancel') snapshot.status='CANCELLED_GUEST';
      if (mutation==='release') snapshot.claims[0].released_at='2026-10-25T12:00:00Z';
      if (mutation==='claim') snapshot.claims[0].id=id(20);
      if (mutation==='hold') snapshot.holds.push({...snapshot.holds[0],id:id(21)});
      expect(()=>assertBaseline(snapshot,state)).toThrow();
    }
  });
  it('restricts inbox maintenance to the selected event and preserves ordinary query parameters',async()=>{
    const query=vi.fn(async()=>({rows:[]}));
    const pool={query} as unknown as Pool;
    const scoped=scopedInboxPool(pool,id(30));
    const cleanup="UPDATE stripe_webhook_events SET processing_state='INVESTIGATE' WHERE processing_state='PROCESSING' AND processing_attempts>=5";
    await scoped.query(cleanup);
    expect(query).toHaveBeenLastCalledWith(`${cleanup} AND id=$1`,[id(30)]);
    const sql='SELECT id FROM payment_attempts WHERE id=$1';
    await scoped.query(sql,[id(8)]);
    expect(query).toHaveBeenLastCalledWith(sql,[id(8)]);
    expect(()=>scoped.query('UPDATE stripe_webhook_events SET delivery_count=0')).toThrow('Unexpected unscoped');
  });
});
