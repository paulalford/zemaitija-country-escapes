import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { planned, seed } from '../scripts/seed-reference.mjs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
process.env.ALLOW_DEV_REFERENCE_SEED = '1';
const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_dev')) throw new Error('Local development database required');
const pool = new Pool({ connectionString: url.toString() });
const units = planned();

async function rejected(sql: string, values: unknown[], code: string) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await expect(c.query(sql, values)).rejects.toMatchObject({ code });
  } finally { await c.query('ROLLBACK'); c.release(); }
}

describe('synthetic accommodation and tariff seed', () => {
  beforeAll(async () => seed(url.toString()));
  afterAll(async () => pool.end());

  it('has exactly three stable reference units with approved fixture capacities', async () => {
    const result = await pool.query('SELECT id,unit_key,capacity FROM accommodation_units WHERE unit_key = ANY($1) ORDER BY unit_key', [units.map((u) => u.key)]);
    expect(result.rows).toHaveLength(3);
    expect(result.rows).toEqual(units.map((u) => ({ id: u.id, unit_key: u.key, capacity: u.capacity })).sort((a,b) => a.unit_key.localeCompare(b.unit_key)));
  });

  it('has complete deterministic 2027 low, shoulder and high EUR-cent bands for both day classes', async () => {
    for (const unit of units) {
      const result = await pool.query('SELECT id,start_date::text AS start_date,end_date::text AS end_date,day_class,nightly_cents::int AS cents,currency FROM seasonal_rates WHERE rate_schedule_version_id=$1', [unit.scheduleId]);
      expect(result.rows).toHaveLength(10);
      for (const rate of unit.rates) expect(result.rows).toContainEqual({ id: rate.id, start_date: rate.start, end_date: rate.end, day_class: rate.dayClass, cents: rate.cents, currency: 'EUR' });
      expect((await pool.query('SELECT state,version_no FROM rate_schedule_versions WHERE id=$1', [unit.scheduleId])).rows[0]).toEqual({ state: 'ACTIVE', version_no: 1 });
    }
  });

  it('is idempotent and rejects drift without altering active data', async () => {
    const before = await pool.query('SELECT count(*)::int AS n, sum(nightly_cents)::bigint::text AS total FROM seasonal_rates WHERE rate_schedule_version_id = ANY($1)', [units.map((u) => u.scheduleId)]);
    await seed(url.toString());
    const after = await pool.query('SELECT count(*)::int AS n, sum(nightly_cents)::bigint::text AS total FROM seasonal_rates WHERE rate_schedule_version_id = ANY($1)', [units.map((u) => u.scheduleId)]);
    expect(after.rows).toEqual(before.rows);
    await rejected('UPDATE seasonal_rates SET nightly_cents=1 WHERE id=$1', [units[0].rates[0].id], '23514');
  });

  it('allows adjacent draft bands but rejects overlaps, negative rates and invalid dates', async () => {
    const schedule = randomUUID();
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state) VALUES ($1,$2,2,'DRAFT')", [schedule, units[0].id]);
      const insert = 'INSERT INTO seasonal_rates(id,rate_schedule_version_id,start_date,end_date,day_class,nightly_cents,currency) VALUES ($1,$2,$3,$4,$5,$6,\'EUR\')';
      await c.query(insert, [randomUUID(), schedule, '2027-01-01', '2027-02-01', 'WEEKDAY', 100]);
      await c.query(insert, [randomUUID(), schedule, '2027-02-01', '2027-03-01', 'WEEKDAY', 100]);
      for (const [start,end,cents,code] of [['2027-01-15','2027-02-15',100,'23P01'],['2027-03-01','2027-04-01',-1,'23514'],['2027-04-01','2027-04-01',100,'23514']] as const) {
        await c.query('SAVEPOINT invalid_rate');
        await expect(c.query(insert, [randomUUID(), schedule, start, end, 'WEEKDAY', cents])).rejects.toMatchObject({ code });
        await c.query('ROLLBACK TO SAVEPOINT invalid_rate');
      }
    } finally { await c.query('ROLLBACK'); c.release(); }
  });

  it('rejects mutation of an active tariff and does not rewrite accepted snapshots', async () => {
    await rejected("UPDATE rate_schedule_versions SET version_no=9 WHERE id=$1", [units[0].scheduleId], '23514');
    await rejected("DELETE FROM seasonal_rates WHERE id=$1", [units[0].rates[0].id], '23514');
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      const guest = randomUUID(), booking = randomUUID(), snapshot = randomUUID();
      await c.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES ($1,$2,'en','SYNTHETIC')", [guest, Buffer.from('synthetic')]);
      await c.query("INSERT INTO bookings(id,guest_id,unit_id,arrival_date,departure_date,guest_count,status,version,accepted_at,check_in_local_time,property_zone,scheduled_arrival_at,warning_at,balance_due_at,grace_ends_at) VALUES ($1,$2,$3,'2027-07-01','2027-07-03',1,'CONFIRMED',1,now(),'15:00','Europe/Vilnius',now(),now(),now(),now())", [booking, guest, units[0].id]);
      await c.query("INSERT INTO price_snapshots(id,booking_id,rate_schedule_version_id,accepted_at,terms_version,policy_version,locale,currency,total_cents,initial_cents,balance_cents,split_basis,quote_operation_key) VALUES ($1,$2,$3,now(),'test','test','en','EUR',10000,10000,0,'FULL',$4)", [snapshot, booking, units[0].scheduleId, `synthetic-${snapshot}`]);
      await seed(url.toString());
      expect((await c.query('SELECT total_cents::int AS cents FROM price_snapshots WHERE id=$1', [snapshot])).rows[0].cents).toBe(10000);
      await c.query('SAVEPOINT immutable_snapshot');
      await expect(c.query('UPDATE price_snapshots SET total_cents=1 WHERE id=$1', [snapshot])).rejects.toMatchObject({ code: '23514' });
    } finally { await c.query('ROLLBACK'); c.release(); }
  });
});
