import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { acceptBooking, type AcceptanceRequest } from '../src/server/booking-acceptance';
import { requestBalanceCheckout } from '../src/server/balance-payment';
import { quoteInTransaction } from '../src/server/quote';

vi.mock('pg',()=>{throw Error('PostgreSQL forbidden');});
vi.mock('stripe',()=>{throw Error('Stripe forbidden');});
vi.mock('../src/db/client',()=>{throw Error('Runtime database forbidden');});
vi.mock('../src/server/quote',async original=>({...await original<object>(),quoteInTransaction:vi.fn()}));
afterEach(()=>vi.restoreAllMocks());
const id='00000000-0000-4000-8000-000000000001';
const instant=new Date('2029-01-01T00:00:00Z');
function request():AcceptanceRequest {
  const quote={unitId:id,unitConfigVersion:1,scheduleId:id,scheduleVersion:1,
    arrivalDate:'2030-01-01',departureDate:'2030-01-02',guestCount:2,currency:'EUR' as const,
    lines:[],accommodationSubtotalCents:10000n,totalCents:10000n,
    previewSplit:{basis:'ADVANCE' as const,initialCents:3000n,balanceCents:7000n},
    deadlines:{arrival:new Date('2030-01-01T13:00:00Z'),warning:new Date('2029-12-11T13:00:00Z'),
      balance:new Date('2029-12-18T13:00:00Z'),grace:new Date('2029-12-19T13:00:00Z'),
      checkInLocalTime:'15:00' as const,zone:'Europe/Vilnius' as const},
    evaluatedAt:instant,provisional:true as const};
  vi.mocked(quoteInTransaction).mockResolvedValue(quote);
  return {operationKey:'synthetic-enrollment-key',guestId:id,locale:'en',quote,
    termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:3000n,syntheticPortfolioOnly:true};
}
/** Transaction fake records commit/rollback behavior of the actual application
 * writer. It does not implement or claim to verify PostgreSQL triggers. */
function writer(failAt='',balance=false,replay=false) {
  const statements:string[]=[];let committed:string[]=[];let pending:string[]=[];
  let fingerprint:Buffer|undefined;
  const stored={booking_id:id,snapshot_id:id,hold_id:id,attempt_id:id,command_id:id};
  const query=vi.fn(async(sql:string,args:unknown[]=[])=>{
    statements.push(sql);
    if(failAt && sql.includes(failAt))throw Error('injected write failure');
    if(sql==='BEGIN')pending=[];
    if(sql==='ROLLBACK')pending=[];
    if(sql==='COMMIT')committed=[...pending];
    if(sql.startsWith('INSERT'))pending.push(sql);
    if(sql.startsWith('INSERT INTO bookings'))stored.booking_id=args[0] as string;
    if(sql.startsWith('INSERT INTO price_snapshots'))stored.snapshot_id=args[0] as string;
    if(sql.startsWith('INSERT INTO inventory_holds'))stored.hold_id=args[0] as string;
    if(sql.startsWith('INSERT INTO payment_attempts'))stored.attempt_id=args[0] as string;
    if(sql.startsWith('INSERT INTO provider_commands'))stored.command_id=args[0] as string;
    if(sql.includes('INSERT INTO provider_commands'))fingerprint=args[4] as Buffer;
    if(sql.includes('quote_operation_key=$1'))return {rows:replay?[{...stored,
      accepted_at:instant,initial_cents:'3000',balance_cents:'7000',request_fingerprint:fingerprint}]:[]};
    if(sql.includes('lock_acceptance_context'))return {rows:[{locked:true}]};
    if(sql.includes('SELECT preferred_locale'))return {rows:[{preferred_locale:'en',retention_state:'SYNTHETIC'}]};
    if(sql.includes('SELECT clock_timestamp()'))return {rows:[{instant}]};
    if(sql.includes('SELECT unit_id,guest_id'))return {rows:[{unit_id:id,guest_id:id}]};
    if(balance && sql.includes('COALESCE((SELECT sum(pa.amount_cents)'))return {rows:[{id,amount_cents:'7000',status:'CONFIRMED',allocated:'0'}]};
    if(balance && sql.includes('SELECT a.id attempt_id'))return {rows:replay?[{attempt_id:id,command_id:id}]:[]};
    return {rows:[],rowCount:1};
  });
  const release=vi.fn();
  return {pool:{connect:async()=>({query,release})} as unknown as Pool,statements,
    committed:()=>committed,query,release,setReplay:()=>{replay=true;}};
}
describe('atomic enrollment in supported application writers (fake transactions)',()=>{
  it.each(['initial','balance'])('enrolls %s inside the existing commit',async lane=>{
    const fake=writer('',lane==='balance');
    if(lane==='initial')await acceptBooking(fake.pool,request());else await requestBalanceCheckout(fake.pool,id);
    const insert=fake.committed().find(s=>s.startsWith('INSERT INTO payment_attempts'))!;
    expect(insert).toContain('recovery_enabled,recovery_next_attempt_at');
    expect(insert).toContain("true,clock_timestamp()+interval '30 seconds'");
    expect(fake.statements.at(-1)).toBe('COMMIT');expect(fake.release).toHaveBeenCalledOnce();
    expect(fake.statements.some(s=>s.startsWith('UPDATE payment_attempts'))).toBe(false);
  });
  it.each(['initial','balance'])('rolls back %s on enrollment, command and deferred commit errors',async lane=>{
    for(const fail of ['INSERT INTO payment_attempts','INSERT INTO provider_commands','COMMIT']) {
      const fake=writer(fail,lane==='balance');
      await expect(lane==='initial'?acceptBooking(fake.pool,request()):requestBalanceCheckout(fake.pool,id)).rejects.toThrow();
      expect(fake.committed()).toEqual([]);expect(fake.statements.at(-1)).toBe('ROLLBACK');
      expect(fake.release).toHaveBeenCalledOnce();
    }
  });
  it('returns the same initial attempt on replay without enrolling history',async()=>{
    const fake=writer();const input=request();const first=await acceptBooking(fake.pool,input);
    fake.setReplay();fake.statements.length=0;
    const replay=await acceptBooking(fake.pool,input);
    expect(replay.replayed).toBe(true);
    expect(replay.attemptId).toBe(first.attemptId);expect(replay.bookingId).toBe(first.bookingId);
    expect(first.replayed).toBe(false);
    expect(fake.statements.some(s=>s.startsWith('INSERT')||s.startsWith('UPDATE'))).toBe(false);
  });
  it('returns an existing balance attempt without updating enrollment',async()=>{
    const fake=writer('',true,true);expect(await requestBalanceCheckout(fake.pool,id)).toEqual({attemptId:id,commandId:id});
    expect(fake.statements.some(s=>s.startsWith('INSERT')||s.startsWith('UPDATE'))).toBe(false);
  });
});

describe('reviewed SQL, metadata and writer coverage (source evidence only)',()=>{
  const read=(path:string)=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
  it('registers the exact reviewed SQL body without changing historical SQL',()=>{
    const body=(s:string)=>s.slice(s.indexOf('ALTER TABLE'));
    const sql=read('drizzle/0035_payment_recovery_schedule.sql');
    expect(body(sql)).toBe(body(read('docs/proposals/0035_payment_recovery_schedule.sql')));
    const journal=JSON.parse(read('drizzle/meta/_journal.json'));
    expect(journal.entries.at(-1)).toMatchObject({idx:35,tag:'0035_payment_recovery_schedule',breakpoints:true});
    const before=JSON.parse(read('drizzle/meta/0034_snapshot.json')),after=JSON.parse(read('drizzle/meta/0035_snapshot.json'));
    expect(after.prevId).toBe(before.id);expect(after.id).not.toBe(before.id);
    const table=after.tables['public.payment_attempts'];
    for(const [name,value] of Object.entries(before.tables))if(name!=='public.payment_attempts')expect(after.tables[name]).toEqual(value);
    for(const [name,value] of Object.entries(before.tables['public.payment_attempts'].columns))expect(table.columns[name]).toEqual(value);
    const grant=sql.split('GRANT UPDATE (')[1].split(') ON public.payment_attempts')[0].match(/\w+/g)!.sort();
    expect(grant).toEqual(Object.keys(before.tables['public.payment_attempts'].columns).sort());
    expect(Object.keys(table.columns).filter(c=>c.startsWith('recovery_'))).toHaveLength(6);
    expect(table.columns.recovery_enabled.default).toBe(false);
    expect(table.columns.recovery_lease_generation.type).toBe('bigint');
    expect(table.indexes.payment_attempts_recovery_due.where).toContain('recovery_enabled');
    expect(sql).toContain(table.checkConstraints.payment_recovery_metadata_valid.value);
    expect(read('src/db/schema/payments.ts')).toContain(table.checkConstraints.payment_recovery_metadata_valid.value);
    expect(sql).toContain('REVOKE UPDATE ON public.payment_attempts FROM zemaitija_app');
    expect(sql).toContain('AFTER INSERT');expect(sql).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(sql).toContain('NEW.recovery_enabled IS DISTINCT FROM OLD.recovery_enabled');
    expect(sql).toContain('p_generation');expect(sql).toContain('FOR UPDATE OF a SKIP LOCKED');
    expect(sql).not.toMatch(/UPDATE public\.(bookings|inventory_claims|payment_records)/);
  });
  it('covers every production raw-SQL attempt writer',()=>{
    const dir=new URL('../src/',import.meta.url);
    const writers=readdirSync(dir,{recursive:true,encoding:'utf8'}).filter(f=>/\.tsx?$/.test(f)&&
      /INSERT INTO payment_attempts|\.insert\(\s*payment_attempts\s*\)/.test(readFileSync(new URL(f,dir),'utf8')));
    expect(writers.sort()).toEqual(['server/balance-payment.ts','server/booking-acceptance.ts']);
    for(const file of writers)expect(read(`src/${file}`)).toMatch(/INSERT INTO payment_attempts\([^)]*recovery_enabled,recovery_next_attempt_at\)/);
  });
});
