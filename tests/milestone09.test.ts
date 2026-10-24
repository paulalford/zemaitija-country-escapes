import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { planned, seed } from '../scripts/seed-reference.mjs';
import { quoteStay } from '../src/server/quote';
import { acceptBooking, type AcceptanceRequest } from '../src/server/booking-acceptance';
import { abandonBeforeDispatch, agedCreatingHolds, inspectHold, leaseSessionCommand, markHoldReconciling } from '../src/server/pending-holds';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.endsWith('_dev')) throw new Error('Local disposable dev DB required');
const pool = new Pool({connectionString:url.toString(),max:12});
process.env.ALLOW_DEV_REFERENCE_SEED = '1';
afterAll(async () => pool.end());

async function fixture() {
  await seed(url.toString());
  const unit = randomUUID(), schedule = randomUUID(), guest = randomUUID();
  await pool.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES($1,$2,2,true,1)',[unit,`m9-${unit}`]);
  await pool.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state) VALUES($1,$2,1,'DRAFT')",[schedule,unit]);
  const rates = await pool.query<{start_date:string;end_date:string;day_class:string;nightly_cents:string}>(
    'SELECT start_date::text,end_date::text,day_class,nightly_cents::text FROM seasonal_rates WHERE rate_schedule_version_id=$1',[planned()[0].scheduleId]);
  for (const rate of rates.rows) await pool.query('INSERT INTO seasonal_rates(id,rate_schedule_version_id,start_date,end_date,day_class,nightly_cents,currency) VALUES($1,$2,$3,$4,$5,$6,\'EUR\')',
    [randomUUID(),schedule,rate.start_date,rate.end_date,rate.day_class,rate.nightly_cents]);
  await pool.query("UPDATE rate_schedule_versions SET state='ACTIVE',activated_at=clock_timestamp() WHERE id=$1",[schedule]);
  await pool.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,$2,'en','SYNTHETIC')",[guest,Buffer.from('synthetic-test')]);
  return {unit,schedule,guest};
}
const beforeD = new Date('2027-06-18T11:59:59Z');
const atD = new Date('2027-06-18T12:00:00Z'); // arrival July 2, 15:00 EEST
async function request(f: Awaited<ReturnType<typeof fixture>>, arrival='2027-07-02', departure='2027-07-05', key=randomUUID(), instant=beforeD): Promise<AcceptanceRequest> {
  const quote = await quoteStay(pool,{unitId:f.unit,arrivalDate:arrival,departureDate:departure,guestCount:2},instant);
  return {operationKey:key,guestId:f.guest,locale:'en',quote,termsVersion:'SYNTHETIC_TEST_TERMS_V1',acceptedTerms:true,acknowledgedInitialCents:quote.previewSplit.initialCents,syntheticPortfolioOnly:true};
}
function runtimePool() {
  const appUrl=new URL(process.env.DATABASE_URL!);
  appUrl.pathname=url.pathname;
  return new Pool({connectionString:appUrl.toString()});
}
async function rejectSql(db: Pool, statement: string, values: unknown[] = [], code = '23514') {
  const client=await db.connect();
  try {
    await client.query('BEGIN');
    await expect((async () => { await client.query(statement,values); await client.query('COMMIT'); })()).rejects.toMatchObject({code});
  } finally { await client.query('ROLLBACK').catch(()=>{}); client.release(); }
}
async function legacyBooking(f: Awaited<ReturnType<typeof fixture>>, arrival='2027-08-01', departure='2027-08-03') {
  const bookingId=randomUUID(), holdId=randomUUID();
  await pool.query(`INSERT INTO bookings(id,guest_id,unit_id,arrival_date,departure_date,guest_count,status,version,accepted_at,check_in_local_time,property_zone,scheduled_arrival_at,warning_at,balance_due_at,grace_ends_at)
    VALUES($1,$2,$3,$4,$5,1,'AWAITING_INITIAL_PAYMENT',1,$6,'15:00','Europe/Vilnius',$6,$6,$6,$6)`,
    [bookingId,f.guest,f.unit,arrival,departure,beforeD]);
  await pool.query("INSERT INTO inventory_holds(id,booking_id,state,started_at,version) VALUES($1,$2,'CREATING',$3,1)",[holdId,bookingId,beforeD]);
  return {bookingId,holdId};
}

describe('Milestone 9 PostgreSQL acceptance', () => {
  it('atomically accepts advance cents, snapshot, both obligations, hold, claim, attempt, command and audit', async () => {
    const f=await fixture(), r=await request(f);
    const result=await acceptBooking(pool,r,{testAcceptanceInstant:beforeD});
    expect(result.initialCents).toBe(16200n);
    expect(result.balanceCents).toBe(37800n);
    const facts=await pool.query(`SELECT
      (SELECT count(*)::int FROM price_snapshot_lines WHERE snapshot_id=$1) lines,
      (SELECT count(*)::int FROM payment_obligations WHERE booking_id=$2) obligations,
      (SELECT count(*)::int FROM inventory_claims WHERE hold_id=$3 AND released_at IS NULL) claims,
      (SELECT count(*)::int FROM provider_commands WHERE id=$4 AND state='PENDING') commands,
      (SELECT count(*)::int FROM audit_events WHERE booking_id=$2 AND action='quote.accepted') audits`,[result.snapshotId,result.bookingId,result.holdId,result.commandId]);
    expect(facts.rows[0]).toMatchObject({lines:3,obligations:2,claims:1,commands:1,audits:1});
    expect((await inspectHold(pool,result.holdId))?.holdState).toBe('CREATING');
    await expect(pool.query('UPDATE price_snapshots SET total_cents=1 WHERE id=$1',[result.snapshotId])).rejects.toMatchObject({code:'23514'});
    await expect(pool.query("UPDATE bookings SET arrival_date='2027-07-03' WHERE id=$1",[result.bookingId])).rejects.toMatchObject({code:'23514'});
  });
  it('recomputes full payment at D and requires changed-term acknowledgment', async () => {
    const f=await fixture(), r=await request(f);
    await expect(acceptBooking(pool,r,{testAcceptanceInstant:atD})).rejects.toMatchObject({code:'TERMS_CHANGED'});
    r.acknowledgedInitialCents=r.quote.totalCents;
    const result=await acceptBooking(pool,r,{testAcceptanceInstant:atD});
    expect(result.initialCents).toBe(54000n);
    expect(result.balanceCents).toBe(0n);
    const balance=await pool.query("SELECT amount_cents::text FROM payment_obligations WHERE booking_id=$1 AND kind='BALANCE'",[result.bookingId]);
    expect(balance.rows[0].amount_cents).toBe('0');
  });
  it('rejects stale config and tariff provenance', async () => {
    const f=await fixture(), r=await request(f);
    await pool.query('UPDATE accommodation_units SET config_version=2 WHERE id=$1',[f.unit]);
    await expect(acceptBooking(pool,r,{testAcceptanceInstant:beforeD})).rejects.toMatchObject({code:'STALE_QUOTE'});
    const f2=await fixture(), r2=await request(f2);
    await pool.query("UPDATE rate_schedule_versions SET state='RETIRED' WHERE id=$1",[f2.schedule]);
    await expect(acceptBooking(pool,r2,{testAcceptanceInstant:beforeD})).rejects.toMatchObject({code:'STALE_QUOTE'});
  });
  it('rolls back a forced interruption and recovers with the same key', async () => {
    const f=await fixture(), r=await request(f);
    await expect(acceptBooking(pool,r,{testAcceptanceInstant:beforeD,failAfter:'CLAIM'})).rejects.toThrow('test transaction interruption');
    const rolledBack=await pool.query(`SELECT
      (SELECT count(*)::int FROM bookings WHERE unit_id=$1) bookings,
      (SELECT count(*)::int FROM price_snapshots WHERE quote_operation_key=$2) snapshots,
      (SELECT count(*)::int FROM payment_obligations WHERE booking_id IN (SELECT id FROM bookings WHERE unit_id=$1)) obligations,
      (SELECT count(*)::int FROM inventory_holds WHERE booking_id IN (SELECT id FROM bookings WHERE unit_id=$1)) holds,
      (SELECT count(*)::int FROM inventory_claims WHERE unit_id=$1) claims,
      (SELECT count(*)::int FROM payment_attempts WHERE booking_id IN (SELECT id FROM bookings WHERE unit_id=$1)) attempts,
      (SELECT count(*)::int FROM provider_commands WHERE logical_key=$3) commands,
      (SELECT count(*)::int FROM audit_events WHERE operation_key=$2) audits`,[f.unit,r.operationKey,`session-create:${r.operationKey}`]);
    expect(Object.values(rolledBack.rows[0])).toEqual(Array(8).fill(0));
    const result=await acceptBooking(pool,r,{testAcceptanceInstant:beforeD});
    expect(result.replayed).toBe(false);
  });
  it('serializes same-key submissions and rejects different payloads', async () => {
    const f=await fixture(), r=await request(f);
    const [a,b]=await Promise.all([acceptBooking(pool,r,{testAcceptanceInstant:beforeD}),acceptBooking(pool,r,{testAcceptanceInstant:beforeD})]);
    expect(a.bookingId).toBe(b.bookingId);
    expect([a.replayed,b.replayed].sort()).toEqual([false,true]);
    expect((await pool.query("SELECT count(*)::int n FROM provider_commands WHERE logical_key=$1",[`session-create:${r.operationKey}`])).rows[0].n).toBe(1);
    await expect(acceptBooking(pool,{...r,guestId:randomUUID()},{testAcceptanceInstant:beforeD})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
  });
  it('allows adjacent ranges and arbitrates overlapping guest requests', async () => {
    const f=await fixture();
    const a=await request(f,'2027-07-02','2027-07-04');
    const b=await request(f,'2027-07-03','2027-07-05');
    const results=await Promise.allSettled([acceptBooking(pool,a,{testAcceptanceInstant:beforeD}),acceptBooking(pool,b,{testAcceptanceInstant:beforeD})]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    expect((results.find(x=>x.status==='rejected') as PromiseRejectedResult).reason.code).toBe('INVENTORY_CONFLICT');
    expect((await pool.query('SELECT count(*)::int n FROM bookings WHERE unit_id=$1',[f.unit])).rows[0].n).toBe(1);
    expect((await pool.query('SELECT count(*)::int n FROM inventory_claims WHERE unit_id=$1 AND released_at IS NULL',[f.unit])).rows[0].n).toBe(1);
    const adjacent=await request(f,'2027-07-05','2027-07-07');
    await expect(acceptBooking(pool,adjacent,{testAcceptanceInstant:beforeD})).resolves.toMatchObject({replayed:false});
  });
  it('keeps aged and unknown holds blocking; permits only never-leased abandonment', async () => {
    const f=await fixture(), r=await request(f);
    const result=await acceptBooking(pool,r,{testAcceptanceInstant:beforeD});
    await pool.query("UPDATE inventory_holds SET started_at='2020-01-01' WHERE id=$1",[result.holdId]);
    expect((await agedCreatingHolds(pool)).some(h=>h.holdId===result.holdId)).toBe(true);
    expect(await abandonBeforeDispatch(pool,result.holdId)).toBe('ABANDONED');
    expect(await abandonBeforeDispatch(pool,result.holdId)).toBe('ALREADY_ABANDONED');
    expect((await inspectHold(pool,result.holdId))?.claimBlocking).toBe(false);
    const again=await request(f);
    const leased=await acceptBooking(pool,again,{testAcceptanceInstant:beforeD});
    expect(await leaseSessionCommand(pool,leased.holdId,'worker-test-01')).toMatchObject({generation:1n});
    expect(await abandonBeforeDispatch(pool,leased.holdId)).toBe('UNSAFE');
    await markHoldReconciling(pool,leased.holdId);
    expect((await inspectHold(pool,leased.holdId))?.claimBlocking).toBe(true);
    await expect(acceptBooking(pool,await request(f),{testAcceptanceInstant:beforeD})).rejects.toMatchObject({code:'INVENTORY_CONFLICT'});
  });
  it('arbitrates a guest hold against an operator block in the same exclusion domain', async () => {
    const f=await fixture(), r=await request(f);
    const admin=randomUUID(), block=randomUUID();
    await pool.query("INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,'administrator',true)",[admin,`m9-${admin}`]);
    await pool.query("INSERT INTO operator_blocks(id,unit_id,arrival_date,departure_date,reason_code,created_by_admin_id) VALUES($1,$2,$3,$4,'SYNTHETIC_TEST',$5)",[block,f.unit,r.quote.arrivalDate,r.quote.departureDate,admin]);
    await pool.query('INSERT INTO inventory_claims(id,unit_id,arrival_date,departure_date,operator_block_id,version) VALUES($1,$2,$3,$4,$5,1)',[randomUUID(),f.unit,r.quote.arrivalDate,r.quote.departureDate,block]);
    await expect(acceptBooking(pool,r,{testAcceptanceInstant:beforeD})).rejects.toMatchObject({code:'INVENTORY_CONFLICT'});
    expect((await pool.query('SELECT count(*)::int n FROM price_snapshots WHERE quote_operation_key=$1',[r.operationKey])).rows[0].n).toBe(0);
  });
  it('accepts through the scoped runtime role without migration privileges', async () => {
    const f=await fixture(), r=await request(f);
    const appUrl=new URL(process.env.DATABASE_URL!);
    appUrl.pathname=url.pathname;
    const app=new Pool({connectionString:appUrl.toString()});
    try {
      const result=await acceptBooking(app,r,{testAcceptanceInstant:beforeD});
      expect(result.replayed).toBe(false);
      expect(await abandonBeforeDispatch(app,result.holdId)).toBe('ABANDONED');
      const rights=await app.query("SELECT has_schema_privilege(current_user,'public','CREATE') ddl");
      expect(rights.rows[0].ddl).toBe(false);
    } finally { await app.end(); }
  });
  it('rejects direct SQL changes to accepted money and inventory identity', async () => {
    const f=await fixture(), r=await request(f);
    const accepted=await acceptBooking(pool,r,{testAcceptanceInstant:beforeD});
    const c=await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("UPDATE payment_obligations SET amount_cents=1 WHERE booking_id=$1 AND kind='BALANCE'",[accepted.bookingId]);
      await expect(c.query('COMMIT')).rejects.toMatchObject({code:'23514'});
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query('UPDATE inventory_claims SET departure_date=$2 WHERE hold_id=$1',[accepted.holdId,'2027-07-06']);
      await expect(c.query('COMMIT')).rejects.toMatchObject({code:'23514'});
      await c.query('ROLLBACK');
      await c.query('BEGIN');
      await c.query("UPDATE bookings SET status='EXPIRED' WHERE id=$1",[accepted.bookingId]);
      await expect(c.query('COMMIT')).rejects.toMatchObject({code:'23514'});
      await c.query('ROLLBACK');
      await expect(c.query('DELETE FROM inventory_claims WHERE hold_id=$1',[accepted.holdId])).rejects.toMatchObject({code:'23514'});
    } finally { await c.query('ROLLBACK').catch(()=>{}); c.release(); }
  });
  it('rejects accepted claim detachment, owner reassignment and combined release under both roles', async () => {
    const f=await fixture(), accepted=await acceptBooking(pool,await request(f),{testAcceptanceInstant:beforeD});
    const legacy=await legacyBooking(f);
    const claim=(await pool.query<{id:string}>('SELECT id FROM inventory_claims WHERE hold_id=$1',[accepted.holdId])).rows[0].id;
    const app=runtimePool();
    try {
      for (const db of [pool,app]) {
        await rejectSql(db,'UPDATE inventory_claims SET hold_id=NULL,booking_id=$2 WHERE id=$1',[claim,legacy.bookingId]);
        await rejectSql(db,'UPDATE inventory_claims SET hold_id=$2 WHERE id=$1',[claim,legacy.holdId]);
        await rejectSql(db,"UPDATE inventory_claims SET hold_id=NULL,booking_id=$2,released_at=clock_timestamp(),release_reason='ABANDONED_BEFORE_DISPATCH' WHERE id=$1",[claim,legacy.bookingId]);
        await rejectSql(db,'UPDATE inventory_holds SET booking_id=$2 WHERE id=$1',[accepted.holdId,legacy.bookingId]);
      }
      const owner=await pool.query('SELECT hold_id,booking_id,released_at FROM inventory_claims WHERE id=$1',[claim]);
      expect(owner.rows[0]).toMatchObject({hold_id:accepted.holdId,booking_id:null,released_at:null});
    } finally { await app.end(); }
  });
  it('retains compatible ownership updates for older bookings without accepted snapshots', async () => {
    const f=await fixture(), legacy=await legacyBooking(f);
    const claim=randomUUID();
    await pool.query("INSERT INTO inventory_claims(id,unit_id,arrival_date,departure_date,hold_id,version) VALUES($1,$2,'2027-08-01','2027-08-03',$3,1)",[claim,f.unit,legacy.holdId]);
    await pool.query('UPDATE inventory_claims SET hold_id=NULL,booking_id=$2,origin_hold_id=$3,version=version+1 WHERE id=$1',[claim,legacy.bookingId,legacy.holdId]);
    expect((await pool.query('SELECT booking_id,hold_id,origin_hold_id FROM inventory_claims WHERE id=$1',[claim])).rows[0])
      .toMatchObject({booking_id:legacy.bookingId,hold_id:null,origin_hold_id:legacy.holdId});
  });
  it('rejects release when a command was leased or records a provider request', async () => {
    const f=await fixture(), leased=await acceptBooking(pool,await request(f),{testAcceptanceInstant:beforeD});
    const app=runtimePool();
    try {
      await leaseSessionCommand(pool,leased.holdId,'worker-integrity-01');
      for (const db of [pool,app]) {
        await rejectSql(db,"UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),last_error_code='ABANDONED_BEFORE_DISPATCH' WHERE id=$1",[leased.commandId]);
        await rejectSql(db,"UPDATE inventory_claims SET released_at=clock_timestamp(),release_reason='ABANDONED_BEFORE_DISPATCH' WHERE hold_id=$1",[leased.holdId]);
      }
      expect(await abandonBeforeDispatch(pool,leased.holdId)).toBe('UNSAFE');
      expect((await inspectHold(pool,leased.holdId))?.claimBlocking).toBe(true);

      const other=await fixture(), recorded=await acceptBooking(pool,await request(other),{testAcceptanceInstant:beforeD});
      await pool.query("UPDATE provider_commands SET provider_request_id='req_test_recorded' WHERE id=$1",[recorded.commandId]);
      for (const db of [pool,app]) {
        await rejectSql(db,"UPDATE provider_commands SET provider_request_id=NULL WHERE id=$1",[recorded.commandId]);
        await rejectSql(db,"UPDATE provider_commands SET provider_request_id='req_test_rewritten' WHERE id=$1",[recorded.commandId]);
        await rejectSql(db,"UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),last_error_code='ABANDONED_BEFORE_DISPATCH' WHERE id=$1",[recorded.commandId]);
        await rejectSql(db,"UPDATE inventory_claims SET released_at=clock_timestamp(),release_reason='ABANDONED_BEFORE_DISPATCH' WHERE hold_id=$1",[recorded.holdId]);
      }
      expect(await abandonBeforeDispatch(pool,recorded.holdId)).toBe('UNSAFE');
      expect((await inspectHold(pool,recorded.holdId))?.claimBlocking).toBe(true);
      for (const db of [pool,app]) {
        await rejectSql(db,`INSERT INTO provider_commands(id,kind,payment_attempt_id,logical_key,stripe_idempotency_key,request_fingerprint,state)
          VALUES($1,'SESSION_CREATE',$2,$3,$4,$5,'UNKNOWN')`,
          [randomUUID(),recorded.attemptId,`duplicate:${randomUUID()}`,`duplicate:${randomUUID()}`,Buffer.from('synthetic')],'23505');
      }

      const uncertainUnit=await fixture(), uncertain=await acceptBooking(pool,await request(uncertainUnit),{testAcceptanceInstant:beforeD});
      await pool.query("UPDATE provider_commands SET state='UNKNOWN' WHERE id=$1",[uncertain.commandId]);
      for (const db of [pool,app]) {
        await rejectSql(db,"UPDATE provider_commands SET state='PENDING' WHERE id=$1",[uncertain.commandId]);
        await rejectSql(db,"UPDATE provider_commands SET state='RESOLVED',resolved_at=clock_timestamp(),last_error_code='ABANDONED_BEFORE_DISPATCH' WHERE id=$1",[uncertain.commandId]);
      }
      await rejectSql(pool,'DELETE FROM provider_commands WHERE id=$1',[uncertain.commandId]);
      await rejectSql(app,'DELETE FROM provider_commands WHERE id=$1',[uncertain.commandId],'42501');
      expect(await abandonBeforeDispatch(pool,uncertain.holdId)).toBe('UNSAFE');
      expect((await inspectHold(pool,uncertain.holdId))?.claimBlocking).toBe(true);
    } finally { await app.end(); }
  });
  it('keeps operator blocks in the same exclusion domain after acceptance', async () => {
    const f=await fixture(), r=await request(f);
    await acceptBooking(pool,r,{testAcceptanceInstant:beforeD});
    const admin=randomUUID(), block=randomUUID();
    await pool.query("INSERT INTO admin_users(id,external_subject,role,enabled) VALUES($1,$2,'administrator',true)",[admin,`m9-${admin}`]);
    await pool.query("INSERT INTO operator_blocks(id,unit_id,arrival_date,departure_date,reason_code,created_by_admin_id) VALUES($1,$2,$3,$4,'SYNTHETIC_TEST',$5)",[block,f.unit,r.quote.arrivalDate,r.quote.departureDate,admin]);
    await expect(pool.query('INSERT INTO inventory_claims(id,unit_id,arrival_date,departure_date,operator_block_id,version) VALUES($1,$2,$3,$4,$5,1)',
      [randomUUID(),f.unit,r.quote.arrivalDate,r.quote.departureDate,block])).rejects.toMatchObject({code:'23P01'});
  });
});
