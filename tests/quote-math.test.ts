import { describe, expect, it } from 'vitest';
import { addCalendarDays, countNights, provisionalDayClass, quoteDeadlines, splitPayment, MAX_EUR_CENTS, addCents, multiplyCents } from '../src/server/quote-math';
import { noticeEligibility } from '../src/server/nonpayment-notices';
const input = (unit = 0, arrivalDate = '2027-07-02', departureDate = '2027-07-05', guestCount = 2) => ({ unitId: `00000000-0000-4000-8000-${String(unit + 1).padStart(12, '0')}`, arrivalDate, departureDate, guestCount });

describe('M19 bounded financial and calendar faults', () => {
  it.each([0n, 1n, 2n, 5n, 10001n, MAX_EUR_CENTS])('conserves cents and half-up advance for %s', total => {
    const d = quoteDeadlines('2027-04-10').balance;
    const split = splitPayment(total, new Date(d.getTime() - 1), d);
    expect(split.initialCents).toBe((total * 30n + 50n) / 100n);
    expect(split.initialCents + split.balanceCents).toBe(total);
    expect(splitPayment(total, d, d)).toEqual({ basis: 'FULL', initialCents: total, balanceCents: 0n });
  });
  it.each([-1n, MAX_EUR_CENTS + 1n])('rejects invalid cents %s', cents => {
    expect(() => addCents(cents, 0n)).toThrow(RangeError);
    expect(() => multiplyCents(cents, 1)).toThrow(RangeError);
    expect(() => splitPayment(cents, new Date(), new Date())).toThrow(RangeError);
  });
  it('rejects aggregate overflow, invalid quantity and invalid instants', () => {
    expect(() => multiplyCents(MAX_EUR_CENTS, 2)).toThrow(RangeError);
    for (const quantity of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect(() => multiplyCents(1n, quantity)).toThrow(RangeError);
    expect(() => splitPayment(1n, new Date(NaN), new Date())).toThrow(RangeError);
  });
  it.each(['2027-02-29', '2027-04-31', '0000-01-01', '2027-1-01'])('rejects impossible/noncanonical civil date %s', date => {
    expect(() => addCalendarDays(date, 1)).toThrow(RangeError);
  });
  it.each(['2027-04-10', '2027-11-13'])('keeps 24 elapsed-hour grace and exact eligibility for %s', arrival => {
    const d = quoteDeadlines(arrival);
    expect(d.grace.getTime() - d.balance.getTime()).toBe(86_400_000);
    const b = { id: 'synthetic', guest_id: 'synthetic', unit_id: 'synthetic', locale: 'en' as const,
      warning_at: d.warning, balance_due_at: d.balance, grace_ends_at: d.grace, accepted_at: new Date(d.warning.getTime() - 1) };
    expect(noticeEligibility(b, new Date(d.warning.getTime() - 1), 1n)).toEqual([]);
    expect(noticeEligibility(b, d.warning, 1n)).toEqual(['BALANCE_WARNING']);
    expect(noticeEligibility(b, d.balance, 1n)).toEqual(['BALANCE_DUE']);
    expect(noticeEligibility(b, new Date(d.balance.getTime() + 1), 1n)).toEqual(['BALANCE_DUE', 'BALANCE_OVERDUE']);
    expect(noticeEligibility(b, d.grace, 0n)).toEqual([]);
  });
});

describe('quote calendar and money functions', () => {
  it('classifies Friday/Saturday provisionally as weekend and Sunday/Monday as weekday', () => {
    expect(['2027-07-02','2027-07-03','2027-07-04','2027-07-05'].map(provisionalDayClass)).toEqual(['WEEKEND','WEEKEND','WEEKDAY','WEEKDAY']);
    expect(countNights(input(0,'2027-12-31','2028-01-01'))).toBe(1);
    expect(addCalendarDays('2027-12-31',1)).toBe('2028-01-01');
  });
  it('keeps the provisional calendar processing bound at 366 nights', () => {
    expect(countNights(input(0,'2027-01-01',addCalendarDays('2027-01-01',366)))).toBe(366);
    expect(() => countNights(input(0,'2027-01-01',addCalendarDays('2027-01-01',367)))).toThrow(RangeError);
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

