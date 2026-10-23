import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planned, seed } from '../scripts/seed-reference.mjs';
import { quoteStay, QuoteError } from '../src/server/quote';
import { addCalendarDays, countNights, provisionalDayClass, quoteDeadlines, splitPayment, MAX_EUR_CENTS, addCents } from '../src/server/quote-math';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
if (!['localhost','127.0.0.1'].includes(url.hostname) || !url.pathname.endsWith('_dev')) throw new Error('Local dev DB required');
process.env.ALLOW_DEV_REFERENCE_SEED = '1';
const pool = new Pool({ connectionString: url.toString() });
const units = planned();
const input = (unit = 0, arrivalDate = '2027-07-02', departureDate = '2027-07-05', guestCount = 2) => ({ unitId: units[unit].id, arrivalDate, departureDate, guestCount });
const beforeD = new Date('2027-06-17T11:59:59Z');

beforeAll(async () => seed(url.toString()));
afterAll(async () => pool.end());

describe('quote calendar and money functions', () => {
  it('classifies Friday/Saturday provisionally as weekend and Sunday/Monday as weekday', () => {
    expect(['2027-07-02','2027-07-03','2027-07-04','2027-07-05'].map(provisionalDayClass)).toEqual(['WEEKEND','WEEKEND','WEEKDAY','WEEKDAY']);
    expect(countNights(input(0,'2027-12-31','2028-01-01'))).toBe(1);
    expect(addCalendarDays('2027-12-31',1)).toBe('2028-01-01');
  });
  it('keeps years 0001–0099 literal and rejects four-digit calendar overflow', () => {
    expect(addCalendarDays('0099-12-31', 1)).toBe('0100-01-01');
    expect(addCalendarDays('0001-01-01', 1)).toBe('0001-01-02');
    expect(provisionalDayClass('0099-12-31')).toBe('WEEKDAY');
    expect(provisionalDayClass('1999-12-31')).toBe('WEEKEND');
    expect(() => addCalendarDays('0001-01-01', -1)).toThrow(RangeError);
    expect(() => addCalendarDays('9999-12-31', 1)).toThrow(RangeError);
    expect(() => addCalendarDays('0099-02-29', 1)).toThrow(RangeError);
    expect(() => quoteDeadlines('0099-12-31')).toThrow(/Unsupported Vilnius offset/);
  });
  it('rounds 10001 cents to 3000/7001 and uses FULL at the exact deadline', () => {
    const d = new Date('2027-01-01T00:00:00Z');
    expect(splitPayment(10001n,new Date(d.getTime()-1),d)).toEqual({ basis:'ADVANCE', initialCents:3000n, balanceCents:7001n });
    expect(splitPayment(10001n,d,d)).toEqual({ basis:'FULL', initialCents:10001n, balanceCents:0n });
    expect(splitPayment(1n,new Date(d.getTime()-1),d).initialCents).toBe(0n);
    expect(() => addCents(MAX_EUR_CENTS,1n)).toThrow(RangeError);
  });
  it('computes local-calendar deadlines across both Vilnius DST changes', () => {
    const april = quoteDeadlines('2027-04-10');
    expect(april.balance.toISOString()).toBe('2027-03-27T13:00:00.000Z');
    expect(april.grace.toISOString()).toBe('2027-03-28T13:00:00.000Z');
    const november = quoteDeadlines('2027-11-13');
    expect(november.balance.toISOString()).toBe('2027-10-30T12:00:00.000Z');
    expect(november.grace.toISOString()).toBe('2027-10-31T12:00:00.000Z');
  });
});

describe('real PostgreSQL quote preview', () => {
  it('prices each fictional unit from its active version with itemized provenance', async () => {
    for (const [index, expected] of [54000n,63000n,86000n].entries()) {
      const quote = await quoteStay(pool,input(index),beforeD);
      expect(quote.totalCents).toBe(expected);
      expect(quote.lines.map((line) => line.dayClass)).toEqual(['WEEKEND','WEEKEND','WEEKDAY']);
      expect(quote.lines.every((line) => line.scheduleId === units[index].scheduleId && line.rateId.length === 36)).toBe(true);
      expect(quote.lines.reduce((sum,line) => sum+line.amountCents,0n)).toBe(quote.accommodationSubtotalCents);
      expect(quote.scheduleVersion).toBe(1);
    }
  });
  it('resolves all seasonal boundaries and half-open departures', async () => {
    for (const boundary of ['2027-05-01','2027-07-01','2027-09-01','2027-11-01']) {
      const previous = addCalendarDays(boundary,-1);
      const quote = await quoteStay(pool,input(0,previous,addCalendarDays(boundary,1)),beforeD);
      expect(quote.lines.map((line) => line.localNight)).toEqual([previous,boundary]);
      expect(quote.lines[0].rateId).not.toBe(quote.lines[1].rateId);
    }
  });
  it('prices December 31 but rejects a stay containing an unpriced 2028 night', async () => {
    expect((await quoteStay(pool,input(0,'2027-12-31','2028-01-01'),beforeD)).lines).toHaveLength(1);
    await expect(quoteStay(pool,input(0,'2027-12-31','2028-01-02'),beforeD)).rejects.toMatchObject({ code:'RATE_COVERAGE' });
  });
  it('rejects invalid, missing, disabled and over-capacity units', async () => {
    await expect(quoteStay(pool,input(0,'2027-02-29','2027-03-01'))).rejects.toMatchObject({ code:'INVALID_INPUT' });
    await expect(quoteStay(pool,input(0,'2027-07-01','2027-07-01'))).rejects.toMatchObject({ code:'INVALID_INPUT' });
    await expect(quoteStay(pool,input(0,'2027-07-02','2027-07-01'))).rejects.toMatchObject({ code:'INVALID_INPUT' });
    await expect(quoteStay(pool,{ ...input(), unitId:randomUUID() })).rejects.toMatchObject({ code:'UNIT_UNAVAILABLE' });
    await expect(quoteStay(pool,input(0,'2027-07-02','2027-07-05',3))).rejects.toMatchObject({ code:'CAPACITY_EXCEEDED' });
    const disabledUnit = randomUUID();
    await pool.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES ($1,$2,2,false,1)', [disabledUnit, `quote-disabled-${disabledUnit}`]);
    try { await expect(quoteStay(pool,{ ...input(), unitId: disabledUnit })).rejects.toMatchObject({ code:'UNIT_UNAVAILABLE' }); }
    finally { await pool.query('DELETE FROM accommodation_units WHERE id=$1', [disabledUnit]); }
  });
  it('rejects units with missing, draft or retired tariffs without changing seeded active rates', async () => {
    for (const [index, state] of ['NONE','DRAFT','RETIRED'].entries()) {
      const unit = `00000008-0000-4000-8000-00000000000${index}`;
      const schedule = `00000008-0000-4000-8000-00000000001${index}`;
      await pool.query('INSERT INTO accommodation_units(id,unit_key,capacity,enabled,config_version) VALUES ($1,$2,2,true,1) ON CONFLICT (id) DO NOTHING',[unit,`quote-test-${state.toLowerCase()}`]);
      if (state !== 'NONE') await pool.query("INSERT INTO rate_schedule_versions(id,unit_id,version_no,state,activated_at) VALUES ($1,$2,1,$3,$4) ON CONFLICT (id) DO NOTHING",[schedule,unit,state,state === 'RETIRED' ? new Date('2027-01-01T00:00:00Z') : null]);
      await expect(quoteStay(pool,{ ...input(), unitId:unit })).rejects.toMatchObject({ code:'NO_ACTIVE_TARIFF' });
    }
  });
  it('recomputes the preview split at a trusted evaluation instant and propagates DB failures', async () => {
    const early = await quoteStay(pool,input(),beforeD);
    const atD = await quoteStay(pool,input(),early.deadlines.balance);
    expect(early.previewSplit.basis).toBe('ADVANCE');
    expect(atD.previewSplit.basis).toBe('FULL');
    const closed = new Pool({ connectionString:url.toString() }); await closed.end();
    await expect(quoteStay(closed,input(),beforeD)).rejects.not.toBeInstanceOf(QuoteError);
  });
});
