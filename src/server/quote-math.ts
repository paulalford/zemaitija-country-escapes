import { validStay, type AvailabilityInput } from './availability';

export const MAX_EUR_CENTS = 9_223_372_036_854_775_807n;
export type DayClass = 'WEEKDAY' | 'WEEKEND';
export type Split = { basis: 'ADVANCE' | 'FULL'; initialCents: bigint; balanceCents: bigint };

export function assertCents(value: bigint): void {
  if (value < 0n || value > MAX_EUR_CENTS) throw new RangeError('EUR cents outside PostgreSQL bigint range');
}
export function addCents(a: bigint, b: bigint): bigint { assertCents(a); assertCents(b); const total = a + b; assertCents(total); return total; }
export function multiplyCents(a: bigint, quantity: number): bigint {
  assertCents(a);
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RangeError('Invalid quantity');
  const total = a * BigInt(quantity); assertCents(total); return total;
}
export function splitPayment(totalCents: bigint, evaluationInstant: Date, deadline: Date): Split {
  assertCents(totalCents);
  if (!Number.isFinite(evaluationInstant.getTime()) || !Number.isFinite(deadline.getTime())) throw new RangeError('Invalid instant');
  if (evaluationInstant.getTime() >= deadline.getTime()) return { basis: 'FULL', initialCents: totalCents, balanceCents: 0n };
  const initialCents = (totalCents * 30n + 50n) / 100n;
  return { basis: 'ADVANCE', initialCents, balanceCents: totalCents - initialCents };
}
function civilDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError('Invalid four-digit calendar date');
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (year < 1) throw new RangeError('Calendar year is outside the supported domain');
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new RangeError('Invalid calendar date');
  }
  return date;
}
export function addCalendarDays(date: string, days: number): string {
  if (!Number.isSafeInteger(days)) throw new RangeError('Invalid calendar-day offset');
  const value = civilDate(date);
  value.setUTCDate(value.getUTCDate() + days);
  if (!Number.isFinite(value.getTime()) || value.getUTCFullYear() < 1 || value.getUTCFullYear() > 9999) {
    throw new RangeError('Date is outside the four-digit calendar domain');
  }
  return value.toISOString().slice(0, 10);
}
// Provisional D17 policy, isolated for later versioned replacement.
export function provisionalDayClass(localNight: string): DayClass {
  const weekday = civilDate(localNight).getUTCDay();
  return weekday === 5 || weekday === 6 ? 'WEEKEND' : 'WEEKDAY';
}
function vilniusAt1500(localDate: string): Date {
  const date = civilDate(localDate);
  const middayUtc = new Date(date.getTime() + 12 * 60 * 60 * 1000);
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Vilnius', timeZoneName: 'shortOffset', hour: '2-digit' }).formatToParts(middayUtc).find((part) => part.type === 'timeZoneName')?.value;
  const offsetHours = Number(/^GMT\+(\d+)$/.exec(label ?? '')?.[1]);
  if (offsetHours !== 2 && offsetHours !== 3) throw new RangeError('Unsupported Vilnius offset');
  const instant = new Date(date.getTime() + (15 - offsetHours) * 60 * 60 * 1000);
  const localParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const part = (type: string) => localParts.find((item) => item.type === type)?.value;
  if (part('year') !== String(date.getUTCFullYear()).padStart(4, '0') || part('month') !== String(date.getUTCMonth() + 1).padStart(2, '0') || part('day') !== String(date.getUTCDate()).padStart(2, '0') || part('hour') !== '15' || part('minute') !== '00') {
    throw new RangeError('Unsupported Vilnius local time');
  }
  return instant;
}
export function quoteDeadlines(arrivalDate: string) {
  if (!validStay({ unitId: '00000000-0000-4000-8000-000000000000', arrivalDate, departureDate: addCalendarDays(arrivalDate, 1), guestCount: 1 })) throw new RangeError('Invalid arrival date');
  const arrival = vilniusAt1500(arrivalDate);
  const warning = vilniusAt1500(addCalendarDays(arrivalDate, -21));
  const balance = vilniusAt1500(addCalendarDays(arrivalDate, -14));
  return { arrival, warning, balance, grace: new Date(balance.getTime() + 86_400_000), checkInLocalTime: '15:00', zone: 'Europe/Vilnius' } as const;
}
export function countNights(input: AvailabilityInput): number {
  if (!validStay(input)) throw new RangeError('Invalid stay');
  let date = input.arrivalDate, count = 0;
  while (date < input.departureDate) {
    if (++count > 366) throw new RangeError('Stay exceeds provisional quote limit');
    date = addCalendarDays(date, 1);
  }
  return count;
}
