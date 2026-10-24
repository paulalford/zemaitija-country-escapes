import type { Pool, PoolClient } from 'pg';
import { validStay, type AvailabilityInput } from './availability';
import { addCalendarDays, addCents, assertCents, countNights, multiplyCents, provisionalDayClass, quoteDeadlines, splitPayment, type DayClass } from './quote-math';

export class QuoteError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'UNIT_UNAVAILABLE' | 'CAPACITY_EXCEEDED' | 'NO_ACTIVE_TARIFF' | 'RATE_COVERAGE' | 'INVALID_RATE', message = code) { super(message); }
}
export type NightLine = { kind: 'NIGHT'; localNight: string; dayClass: DayClass; rateId: string; scheduleId: string; unitCents: bigint; quantity: 1; amountCents: bigint };
export type QuotePreview = {
  unitId: string; unitConfigVersion: number; scheduleId: string; scheduleVersion: number;
  arrivalDate: string; departureDate: string; guestCount: number; currency: 'EUR';
  lines: NightLine[]; accommodationSubtotalCents: bigint; totalCents: bigint;
  previewSplit: ReturnType<typeof splitPayment>; deadlines: ReturnType<typeof quoteDeadlines>;
  evaluatedAt: Date; provisional: true;
};

/** Internal preview. evaluationInstant must come from a trusted server caller, never request data. */
export async function quoteStay(pool: Pool, input: AvailabilityInput, evaluationInstant: Date = new Date()): Promise<QuotePreview> {
  if (!validStay(input)) throw new QuoteError('INVALID_INPUT');
  if (!Number.isFinite(evaluationInstant.getTime())) throw new QuoteError('INVALID_INPUT');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const quote = await quoteInTransaction(client, input, evaluationInstant);
    await client.query('COMMIT');
    return quote;
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}

/** Shared pricing within a caller-owned transaction. The caller owns locking and commit. */
export async function quoteInTransaction(client: PoolClient, input: AvailabilityInput, evaluationInstant: Date): Promise<QuotePreview> {
    if (!validStay(input) || !Number.isFinite(evaluationInstant.getTime())) throw new QuoteError('INVALID_INPUT');
    const nights = countNights(input);
    const unitResult = await client.query<{ enabled: boolean; capacity: number; config_version: number }>('SELECT enabled,capacity,config_version FROM accommodation_units WHERE id=$1', [input.unitId]);
    const unit = unitResult.rows[0];
    if (!unit || !unit.enabled) throw new QuoteError('UNIT_UNAVAILABLE');
    if (input.guestCount > unit.capacity) throw new QuoteError('CAPACITY_EXCEEDED');
    const schedules = await client.query<{ id: string; version_no: number }>("SELECT id,version_no FROM rate_schedule_versions WHERE unit_id=$1 AND state='ACTIVE'", [input.unitId]);
    if (schedules.rows.length !== 1) throw new QuoteError('NO_ACTIVE_TARIFF');
    const schedule = schedules.rows[0];
    const rates = await client.query<{ id: string; start_date: string; end_date: string; day_class: string; nightly_cents: string; currency: string }>(
      "SELECT id,start_date::text,end_date::text,day_class,nightly_cents::text,currency FROM seasonal_rates WHERE rate_schedule_version_id=$1 AND daterange(start_date,end_date,'[)') && daterange($2::date,$3::date,'[)')",
      [schedule.id, input.arrivalDate, input.departureDate]);
    const lines: NightLine[] = [];
    let total = 0n, localNight = input.arrivalDate;
    for (let i = 0; i < nights; i++, localNight = addCalendarDays(localNight, 1)) {
      const dayClass = provisionalDayClass(localNight);
      const matches = rates.rows.filter((rate) => rate.day_class === dayClass && rate.start_date <= localNight && localNight < rate.end_date);
      if (matches.length !== 1) throw new QuoteError('RATE_COVERAGE');
      const rate = matches[0];
      if (rate.currency !== 'EUR' || !/^\d+$/.test(rate.nightly_cents) || !['WEEKDAY','WEEKEND'].includes(rate.day_class)) throw new QuoteError('INVALID_RATE');
      const unitCents = BigInt(rate.nightly_cents);
      try { assertCents(unitCents); total = addCents(total, multiplyCents(unitCents, 1)); }
      catch { throw new QuoteError('INVALID_RATE'); }
      lines.push({ kind: 'NIGHT', localNight, dayClass, rateId: rate.id, scheduleId: schedule.id, unitCents, quantity: 1, amountCents: unitCents });
    }
    if (lines.reduce((sum, line) => addCents(sum, line.amountCents), 0n) !== total) throw new QuoteError('INVALID_RATE');
    const deadlines = quoteDeadlines(input.arrivalDate);
    return { unitId: input.unitId, unitConfigVersion: unit.config_version, scheduleId: schedule.id, scheduleVersion: schedule.version_no,
      arrivalDate: input.arrivalDate, departureDate: input.departureDate, guestCount: input.guestCount, currency: 'EUR', lines,
      accommodationSubtotalCents: total, totalCents: total, previewSplit: splitPayment(total, evaluationInstant, deadlines.balance), deadlines,
      evaluatedAt: new Date(evaluationInstant), provisional: true };
}
