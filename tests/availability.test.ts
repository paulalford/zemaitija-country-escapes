import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkAvailability, isInventoryConflict, type AvailabilityInput } from '../src/server/availability';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_dev')) throw new Error('Local disposable development database required');
const pool = new Pool({ connectionString: url.toString(), max: 6 });
const unitIds = [randomUUID(), randomUUID(), randomUUID()];
const guest = randomUUID(), admin = randomUUID();
const bookingIds = [randomUUID(), randomUUID(), randomUUID()];
const holdIds = [randomUUID(), randomUUID(), randomUUID()];
const now = new Date('2027-03-01T00:00:00Z');
const request = (unit = 0, arrivalDate = '2027-06-01', departureDate = '2027-06-05', guestCount = 2): AvailabilityInput => ({ unitId: unitIds[unit], arrivalDate, departureDate, guestCount });
async function claim(c: PoolClient, owner: 'hold' | 'booking' | 'operator_block', id: string, unit = 0, start = '2027-06-01', end = '2027-06-05', released = false) {
  return c.query(`INSERT INTO inventory_claims(id,unit_id,arrival_date,departure_date,${owner}_id,released_at,version) VALUES ($1,$2,$3,$4,$5,$6,1)`, [randomUUID(), unitIds[unit], start, end, id, released ? now : null]);
}
async function rollbackCase(fn: (c: PoolClient) => Promise<void>) {
  const c = await pool.connect();
  try { await c.query('BEGIN'); await fn(c); }
  finally { await c.query('ROLLBACK'); c.release(); }
}
async function block(c: PoolClient, unit = 0, start = '2027-06-01', end = '2027-06-05') {
  const id = randomUUID();
  await c.query("INSERT INTO operator_blocks(id,unit_id,arrival_date,departure_date,reason_code,created_by_admin_id) VALUES ($1,$2,$3,$4,'SYNTHETIC_TEST',$5)", [id, unitIds[unit], start, end, admin]);
  return id;
}
async function concurrent(first: (c: PoolClient) => Promise<unknown>, second: (c: PoolClient) => Promise<unknown>, expectedConflict: boolean) {
  const a = await pool.connect(), b = await pool.connect();
  try {
    for (const c of [a,b]) {
      await c.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await c.query("SET LOCAL statement_timeout='8s'");
      await c.query("SET LOCAL lock_timeout='5s'");
    }
    const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await first(a);
    const pending = second(b).then(() => null, (e: unknown) => e);
    if (expectedConflict) {
      let blocked = false;
      for (let i = 0; i < 80; i++) {
        const state = await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [bPid]);
        if (state.rows[0]?.wait_event_type === 'Lock') { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(blocked).toBe(true);
    }
    await a.query('COMMIT');
    const error = await pending;
    if (expectedConflict) { expect(isInventoryConflict(error)).toBe(true); await b.query('ROLLBACK'); }
    else { expect(error).toBeNull(); await b.query('COMMIT'); }
    return { first: 'COMMIT', second: expectedConflict ? '23P01 ROLLBACK' : 'COMMIT' };
  } finally {
    await a.query('ROLLBACK').catch(() => {}); await b.query('ROLLBACK').catch(() => {});
    a.release(); b.release();
    await pool.query('DELETE FROM inventory_claims WHERE unit_id=$1', [unitIds[0]]);
  }
}

describe('Milestone 7 availability and acquisition', () => {
  beforeAll(async () => {
    for (let i = 0; i < 3; i++) await pool.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES ($1,$2,$3,true,1)', [unitIds[i], `availability-test-${unitIds[i]}`, i === 2 ? 6 : 2]);
    await pool.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES ($1,$2,'en','SYNTHETIC')", [guest, Buffer.from('synthetic')]);
    await pool.query("INSERT INTO admin_users(id,external_subject,role,enabled) VALUES ($1,$2,'administrator',true)", [admin, `synthetic-${admin}`]);
    for (let i = 0; i < 3; i++) {
      await pool.query("INSERT INTO bookings(id,guest_id,unit_id,arrival_date,departure_date,guest_count,status,version,accepted_at,check_in_local_time,property_zone,scheduled_arrival_at,warning_at,balance_due_at,grace_ends_at) VALUES ($1,$2,$3,'2027-06-01','2027-06-05',1,'AWAITING_INITIAL_PAYMENT',1,$4,'15:00','Europe/Vilnius',$4,$4,$4,$4)", [bookingIds[i], guest, unitIds[i], now]);
      await pool.query("INSERT INTO inventory_holds(id,booking_id,state,started_at,version) VALUES ($1,$2,'CREATING',$3,1)", [holdIds[i], bookingIds[i], now]);
    }
  });
  afterAll(async () => {
    await pool.query('DELETE FROM inventory_claims WHERE unit_id = ANY($1)', [unitIds]);
    await pool.query('DELETE FROM operator_blocks WHERE unit_id = ANY($1)', [unitIds]);
    await pool.query('DELETE FROM inventory_holds WHERE booking_id = ANY($1)', [bookingIds]);
    await pool.query('DELETE FROM bookings WHERE id = ANY($1)', [bookingIds]);
    await pool.query('DELETE FROM guests WHERE id=$1', [guest]);
    await pool.query('DELETE FROM admin_users WHERE id=$1', [admin]);
    await pool.query('DELETE FROM accommodation_units WHERE id = ANY($1)', [unitIds]);
    await pool.end();
  });
  it('reports a free unit and interval', async () => expect(await checkAvailability(pool, request())).toEqual({ available: true, reason: 'AVAILABLE' }));
  it('rejects missing units and disabled units', async () => {
    expect(await checkAvailability(pool, { ...request(), unitId: randomUUID() })).toEqual({ available: false, reason: 'UNIT_UNAVAILABLE' });
    await pool.query('UPDATE accommodation_units SET enabled=false WHERE id=$1', [unitIds[0]]);
    try { expect(await checkAvailability(pool, request())).toEqual({ available: false, reason: 'UNIT_UNAVAILABLE' }); }
    finally { await pool.query('UPDATE accommodation_units SET enabled=true WHERE id=$1', [unitIds[0]]); }
  });
  it('rejects excess guests and accepts the six-guest unit', async () => {
    expect(await checkAvailability(pool, request(0, '2027-06-01', '2027-06-05', 3))).toEqual({ available: false, reason: 'CAPACITY_EXCEEDED' });
    expect(await checkAvailability(pool, request(2, '2027-06-01', '2027-06-05', 6))).toEqual({ available: true, reason: 'AVAILABLE' });
  });
  it('rejects malformed, impossible, zero-length and reversed dates and guest counts', async () => {
    for (const input of [{ ...request(), unitId: 'bad' }, request(0,'2027-02-29','2027-03-01'), request(0,'2027-06-02','2027-06-02'), request(0,'2027-06-03','2027-06-02'), request(0,'2027-06-01','2027-06-05',0)]) expect(await checkAvailability(pool, input)).toEqual({ available: false, reason: 'INVALID_INPUT' });
    expect(await checkAvailability(pool, request(0,'2028-02-29','2028-03-01'))).toEqual({ available: true, reason: 'AVAILABLE' });
  });
  it('blocks overlapping active holds and allows adjacent half-open stays', async () => rollbackCase(async (c) => {
    await claim(c,'hold',holdIds[0]);
    expect(await checkAvailability(pool,request())).toEqual({ available: true, reason: 'AVAILABLE' }); // uncommitted claim is invisible
    await c.query('COMMIT');
    try {
      expect(await checkAvailability(pool,request())).toEqual({ available: false, reason: 'INVENTORY_CONFLICT' });
      expect(await checkAvailability(pool,request(0,'2027-06-05','2027-06-08'))).toEqual({ available: true, reason: 'AVAILABLE' });
    } finally { await pool.query('DELETE FROM inventory_claims WHERE hold_id=$1', [holdIds[0]]); }
  }));
  it('keeps an expired-looking unresolved hold blocking', async () => rollbackCase(async (c) => {
    await c.query("UPDATE inventory_holds SET state='RECONCILING',started_at='2020-01-01' WHERE id=$1", [holdIds[0]]);
    await claim(c,'hold',holdIds[0]);
    await c.query('COMMIT');
    try { expect(await checkAvailability(pool,request())).toEqual({ available: false, reason: 'INVENTORY_CONFLICT' }); }
    finally { await pool.query('DELETE FROM inventory_claims WHERE hold_id=$1', [holdIds[0]]); await pool.query("UPDATE inventory_holds SET state='CREATING',started_at=$2 WHERE id=$1", [holdIds[0], now]); }
  }));
  it('blocks confirmed-booking claims and permits the same dates on another unit', async () => rollbackCase(async (c) => {
    await claim(c,'booking',bookingIds[0]); await c.query('COMMIT');
    try { expect(await checkAvailability(pool,request())).toEqual({ available: false, reason: 'INVENTORY_CONFLICT' }); expect(await checkAvailability(pool,request(1))).toEqual({ available: true, reason: 'AVAILABLE' }); }
    finally { await pool.query('DELETE FROM inventory_claims WHERE booking_id=$1', [bookingIds[0]]); }
  }));
  it('includes operator blocks in the same exclusion domain', async () => rollbackCase(async (c) => {
    const id = await block(c); await claim(c,'operator_block',id); await c.query('COMMIT');
    try { expect(await checkAvailability(pool,request())).toEqual({ available: false, reason: 'INVENTORY_CONFLICT' }); }
    finally { await pool.query('DELETE FROM inventory_claims WHERE operator_block_id=$1', [id]); await pool.query('DELETE FROM operator_blocks WHERE id=$1', [id]); }
  }));
  it('ignores explicitly released claims and preserves the exclusion constraint', async () => rollbackCase(async (c) => {
    await claim(c,'hold',holdIds[0],0,'2027-06-01','2027-06-05',true); await c.query('COMMIT');
    try { expect(await checkAvailability(pool,request())).toEqual({ available: true, reason: 'AVAILABLE' }); }
    finally { await pool.query('DELETE FROM inventory_claims WHERE hold_id=$1', [holdIds[0]]); }
    const constraints = await pool.query("SELECT conname FROM pg_constraint WHERE conrelid='inventory_claims'::regclass AND contype='x'");
    expect(constraints.rows).toEqual([{ conname: 'inventory_claims_no_overlap' }]);
  }));
  it('turns a stale available read into a deterministic acquisition conflict', async () => {
    expect(await checkAvailability(pool,request())).toEqual({ available: true, reason: 'AVAILABLE' });
    const a = await pool.connect();
    try { await a.query('BEGIN'); await claim(a,'hold',holdIds[0]); await a.query('COMMIT'); }
    finally { a.release(); }
    const b = await pool.connect();
    try { await b.query('BEGIN'); await expect(claim(b,'booking',bookingIds[0])).rejects.toSatisfy(isInventoryConflict); }
    finally { await b.query('ROLLBACK'); b.release(); await pool.query('DELETE FROM inventory_claims WHERE hold_id=$1', [holdIds[0]]); }
  });
  it('allows only one concurrent overlapping acquisition to commit', async () => {
    expect(await concurrent((c) => claim(c,'hold',holdIds[0]), (c) => claim(c,'booking',bookingIds[0]), true)).toEqual({ first:'COMMIT', second:'23P01 ROLLBACK' });
  });
  it('allows both concurrent adjacent acquisitions to commit', async () => {
    expect(await concurrent((c) => claim(c,'hold',holdIds[0],0,'2027-06-01','2027-06-05'), (c) => claim(c,'booking',bookingIds[0],0,'2027-06-05','2027-06-08'), false)).toEqual({ first:'COMMIT', second:'COMMIT' });
  });
  it('serializes a guest hold against a competing operator block', async () => {
    const c = await pool.connect(); let id: string;
    try { await c.query('BEGIN'); id = await block(c); await c.query('COMMIT'); }
    finally { c.release(); }
    try { expect(await concurrent((a) => claim(a,'hold',holdIds[0]), (b) => claim(b,'operator_block',id), true)).toEqual({ first:'COMMIT', second:'23P01 ROLLBACK' }); }
    finally { await pool.query('DELETE FROM operator_blocks WHERE id=$1', [id]); }
  });
  it('classifies only 23P01 as inventory conflict', async () => {
    expect(isInventoryConflict({ code:'23P01' })).toBe(true);
    expect(isInventoryConflict({ code:'23503' })).toBe(false);
    expect(isInventoryConflict(new Error('connection lost'))).toBe(false);
    await rollbackCase(async (c) => { await expect(claim(c,'hold',randomUUID())).rejects.toMatchObject({ code:'23503' }); });
  });
});
