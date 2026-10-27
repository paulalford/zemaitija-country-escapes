import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seed } from '../scripts/seed-reference.mjs';
import { publicCatalog } from '../src/server/public-catalog';
import { previewPublicStay, acceptPublicStay, publicBookingStatus } from '../src/server/public-booking';
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const url=new URL(process.env.MIGRATION_DATABASE_URL??'');
if(!['localhost','127.0.0.1'].includes(url.hostname)||!url.pathname.endsWith('_dev'))throw Error('Disposable local dev database required');
const owner=new Pool({connectionString:url.toString()});const runtimeUrl=new URL(process.env.DATABASE_URL!);runtimeUrl.pathname=url.pathname;
const runtime=new Pool({connectionString:runtimeUrl.toString()});
const browser='p'.repeat(43);
beforeAll(async()=>{process.env.ALLOW_DEV_REFERENCE_SEED='1';await seed(url.toString());process.env.APP_ORIGIN='http://localhost:3000';process.env.ACCESS_SECRET='ef'.repeat(32);});
afterAll(async()=>{await owner.end();await runtime.end();});
describe('Public booking against actual PostgreSQL and restricted runtime role',()=>{
 it('reads catalog IDs and capacities; rejects capacity, invalid dates and unknown units',async()=>{
  const units=await publicCatalog(runtime);expect(units.map(u=>[u.unit_key,u.capacity])).toEqual([['forest-cottage',2],['lakeside-cabin',2],['family-cottage',6]]);
  const base={unitId:units[0].id,arrivalDate:'2027-05-11',departureDate:'2027-05-13',guestCount:2};
  await expect(previewPublicStay(runtime,{...base,guestCount:3},browser,'lt')).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(previewPublicStay(runtime,{...base,departureDate:'2027-02-30'},browser,'lt')).rejects.toMatchObject({code:'INVALID_INPUT'});
  await expect(previewPublicStay(runtime,{...base,unitId:randomUUID()},browser,'lt')).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('limits guest provisioning to a fixed synthetic marker and preserves existing rows',async()=>{
  const id=randomUUID();await runtime.query('SELECT create_public_synthetic_guest($1,$2)',[id,'de']);await runtime.query('SELECT create_public_synthetic_guest($1,$2)',[id,'de']);
  const before=(await owner.query('SELECT * FROM guests WHERE id=$1',[id])).rows[0];expect(before.retention_state).toBe('SYNTHETIC');expect(before.email_ciphertext.toString()).toBe('synthetic-portfolio-only');
  await expect(runtime.query('SELECT create_public_synthetic_guest($1,$2)',[id,'en'])).rejects.toMatchObject({code:'23514'});
  await expect(runtime.query('SELECT create_public_synthetic_guest($1,$2)',[randomUUID(),'xx'])).rejects.toMatchObject({code:'23514'});
  expect((await owner.query('SELECT * FROM guests WHERE id=$1',[id])).rows[0]).toEqual(before);
  expect((await runtime.query("SELECT has_table_privilege(current_user,'guests','INSERT') allowed")).rows[0].allowed).toBe(false);
 });
 it('quotes, accepts and concurrently replays one synthetic booking without provider dispatch',async()=>{
  const unit=(await publicCatalog(runtime))[2];
  const dates=(await owner.query<{arrival:string;departure:string}>(`SELECT d::date::text arrival,(d+interval '2 days')::date::text departure
    FROM generate_series('2027-01-01'::date,'2027-12-29'::date,interval '2 days') d
    WHERE NOT EXISTS(SELECT 1 FROM inventory_claims c WHERE c.unit_id=$1 AND c.released_at IS NULL
      AND c.stay && daterange(d::date,(d+interval '2 days')::date,'[)')) ORDER BY d LIMIT 1`,[unit.id])).rows[0];
  if(!dates)throw Error('Fresh disposable test database required: no free fixture dates');
  const stay={unitId:unit.id,arrivalDate:dates.arrival,departureDate:dates.departure,guestCount:6};
  const quote=await previewPublicStay(runtime,stay,browser,'de');
  const first=await acceptPublicStay(runtime,quote.ticket,browser);
  const replays=await Promise.all([acceptPublicStay(runtime,quote.ticket,browser),acceptPublicStay(runtime,quote.ticket,browser)]);
  expect(replays.every(r=>r.accepted.bookingId===first.accepted.bookingId&&r.accepted.replayed)).toBe(true);
  const status=await publicBookingStatus(runtime,first.receipt);expect(status).toMatchObject({status:'AWAITING_INITIAL_PAYMENT',total_cents:quote.totalCents,guest_count:6});
  const facts=(await owner.query(`SELECT (SELECT count(*)::int FROM inventory_claims WHERE hold_id=$1) claims,
    (SELECT count(*)::int FROM provider_commands WHERE payment_attempt_id=$2 AND state='PENDING' AND first_submitted_at IS NULL) undispatched,
    (SELECT count(*)::int FROM payment_records WHERE booking_id=$3) captures`,[first.accepted.holdId,first.accepted.attemptId,first.accepted.bookingId])).rows[0];expect(facts).toEqual({claims:1,undispatched:1,captures:0});
  await expect(previewPublicStay(runtime,stay,'q'.repeat(43),'en')).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(publicBookingStatus(runtime,{...first.receipt,guestId:randomUUID()})).rejects.toMatchObject({code:'EXPIRED_QUOTE'});
  await owner.query('SELECT revoke_guest_access($1)',[first.accepted.bookingId]);
  await expect(publicBookingStatus(runtime,first.receipt)).rejects.toMatchObject({code:'EXPIRED_QUOTE'});
  const replayAfterRevocation=await acceptPublicStay(runtime,quote.ticket,browser);
  await expect(publicBookingStatus(runtime,replayAfterRevocation.receipt)).rejects.toMatchObject({code:'EXPIRED_QUOTE'});
 });
});
