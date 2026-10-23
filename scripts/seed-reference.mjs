import { createHash } from 'node:crypto';
import pg from 'pg';

const units = [
  ['forest-cottage', 'Forest Cottage', 2, [9000, 11000, 12000, 14000, 16000, 19000]],
  ['lakeside-cabin', 'Lakeside Cabin', 2, [10000, 12000, 14000, 16000, 19000, 22000]],
  ['family-cottage', 'Family Cottage', 6, [15000, 18000, 20000, 23000, 26000, 30000]],
];
const bands = [
  ['2027-01-01', '2027-05-01', 0], // low
  ['2027-05-01', '2027-07-01', 1], // shoulder
  ['2027-07-01', '2027-09-01', 2], // high
  ['2027-09-01', '2027-11-01', 1], // shoulder
  ['2027-11-01', '2028-01-01', 0], // low
];
function stableId(label) {
  const bytes = createHash('sha256').update(`zemaitija-fixture-v1:${label}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
function planned() {
  return units.map(([key, name, capacity, prices]) => ({
    key, name, capacity, id: stableId(`unit:${key}`), scheduleId: stableId(`schedule:${key}:1`),
    rates: bands.flatMap(([start, end, season]) => ['WEEKDAY', 'WEEKEND'].map((dayClass, offset) => ({
      id: stableId(`rate:${key}:1:${start}:${dayClass}`), start, end, dayClass,
      cents: prices[season * 2 + offset],
    }))),
  }));
}
export { planned };

export async function seed(connectionString = process.env.MIGRATION_DATABASE_URL) {
  const url = new URL(connectionString ?? '');
  if (process.env.ALLOW_DEV_REFERENCE_SEED !== '1' || !['127.0.0.1', 'localhost'].includes(url.hostname) || !url.pathname.endsWith('_dev')) {
    throw new Error('Reference seed requires ALLOW_DEV_REFERENCE_SEED=1 and a localhost *_dev database');
  }
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('zemaitija-reference-v1'))");
    for (const unit of planned()) {
      await client.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES ($1,$2,$3,true,1) ON CONFLICT (id) DO NOTHING', [unit.id, unit.key, unit.capacity]);
      const existing = await client.query('SELECT id,unit_key,capacity,enabled,config_version FROM accommodation_units WHERE id=$1 OR unit_key=$2', [unit.id, unit.key]);
      if (existing.rows.length !== 1 || existing.rows[0].id !== unit.id || existing.rows[0].unit_key !== unit.key || existing.rows[0].capacity !== unit.capacity || !existing.rows[0].enabled || existing.rows[0].config_version !== 1) throw new Error(`Unit drift: ${unit.key}`);
      await client.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state) VALUES ($1,$2,1,'DRAFT') ON CONFLICT (id) DO NOTHING", [unit.scheduleId, unit.id]);
      const schedule = await client.query('SELECT id,unit_id,version_no,state,activated_at FROM rate_schedule_versions WHERE id=$1 OR (unit_id=$2 AND version_no=1)', [unit.scheduleId, unit.id]);
      if (schedule.rows.length !== 1 || schedule.rows[0].id !== unit.scheduleId || schedule.rows[0].unit_id !== unit.id || schedule.rows[0].version_no !== 1 || !['DRAFT','ACTIVE'].includes(schedule.rows[0].state)) throw new Error(`Tariff drift: ${unit.key}`);
      if (schedule.rows[0].state === 'DRAFT') {
        for (const rate of unit.rates) {
          await client.query('INSERT INTO seasonal_rates(id,rate_schedule_version_id,start_date,end_date,day_class,nightly_cents,currency) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING', [rate.id, unit.scheduleId, rate.start, rate.end, rate.dayClass, rate.cents, 'EUR']);
        }
      }
      const actual = await client.query('SELECT id,start_date::text AS start_date,end_date::text AS end_date,day_class,nightly_cents::int AS nightly_cents,currency FROM seasonal_rates WHERE rate_schedule_version_id=$1 ORDER BY id', [unit.scheduleId]);
      if (actual.rows.length !== unit.rates.length || unit.rates.some((rate) => !actual.rows.some((r) => r.id === rate.id && r.start_date === rate.start && r.end_date === rate.end && r.day_class === rate.dayClass && r.nightly_cents === rate.cents && r.currency === 'EUR'))) throw new Error(`Rate drift: ${unit.key}`);
      if (schedule.rows[0].state === 'DRAFT') await client.query("UPDATE rate_schedule_versions SET state='ACTIVE',activated_at=now() WHERE id=$1", [unit.scheduleId]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { await client.end(); }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if (process.env.MIGRATION_DATABASE_URL === undefined && process.env.NODE_ENV !== 'production') process.loadEnvFile('.env.local');
  seed().then(() => console.log('Synthetic reference seed verified')).catch((error) => { console.error(error); process.exitCode = 1; });
}
