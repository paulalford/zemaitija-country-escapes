import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { seed } from '../scripts/seed-reference.mjs';
import { publicBookingRequest } from '../src/server/public-booking-http';
import { browserBinding, openReceipt, sealBookingToken, type Receipt } from '../src/server/public-booking-token';
import { publicBookingStatus } from '../src/server/public-booking';
import { publicCatalog } from '../src/server/public-catalog';
import { stripeGateway, type CheckoutRequest, type CheckoutSession } from '../src/server/stripe-adapter';

// Only the external provider is replaced: HTTP, authorization, acceptance, worker and SQL are real.
vi.mock('../src/server/stripe-adapter', async original => ({
  ...await original<typeof import('../src/server/stripe-adapter')>(), stripeGateway: vi.fn(),
}));
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const url = new URL(process.env.MIGRATION_DATABASE_URL ?? '');
// Never run these write fixtures against the existing development database.
if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/zemaitija_m16_phase_b_20261026_dev') {
  throw Error('M16-S01 requires the existing disposable Milestone 16 database');
}
const owner = new Pool({ connectionString: url.toString() });
const runtimeUrl = new URL(process.env.DATABASE_URL!);
runtimeUrl.pathname = url.pathname;
const runtime = new Pool({ connectionString: runtimeUrl.toString() });
const validUrl = 'https://checkout.stripe.com/c/pay/cs_test_m16_recovery';
const createSession = vi.fn<(request: CheckoutRequest) => Promise<CheckoutSession>>();

beforeAll(async () => {
  process.env.ALLOW_DEV_REFERENCE_SEED = '1';
  await seed(url.toString());
  vi.stubEnv('APP_ORIGIN', 'http://localhost:3000');
  vi.stubEnv('ACCESS_SECRET', 'ef'.repeat(32));
});
beforeEach(() => {
  createSession.mockReset();
  // All other provider operations fail immediately if unexpectedly invoked.
  const unsupported = () => { throw Error('Unexpected provider operation'); };
  vi.mocked(stripeGateway).mockReturnValue({
    accountId: 'acct_test_m16', createSession,
    retrieveSession: unsupported, findSessionForPaymentIntent: unsupported,
    retrievePaymentIntent: unsupported, expireSession: unsupported, verifyEvent: unsupported,
    createRefund: unsupported, retrieveRefund: unsupported, listRefunds: unsupported,
  });
});
afterAll(async () => { vi.unstubAllEnvs(); await owner.end(); await runtime.end(); });

function request(action: string, input: unknown, browser: string, receipt = '', origin = 'http://localhost:3000') {
  return new Request(`http://localhost:3000/api/booking/${action}`, {
    method: 'POST', headers: { origin, 'content-type': 'application/json',
      cookie: `zce_booking_browser=${browser}; zce_booking_receipt=${receipt}` },
    body: JSON.stringify(input),
  });
}
function receiptFrom(response: Awaited<ReturnType<typeof publicBookingRequest>>, browser: string) {
  const cookie = response.cookies.get('zce_booking_receipt');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', maxAge: 86400 });
  expect(response.headers.get('cache-control')).toContain('no-store');
  return { raw: cookie!.value, receipt: openReceipt(cookie!.value, browser) };
}
async function fixture(destination: string) {
  const browser = randomBytes(32).toString('base64url');
  const unit = (await publicCatalog(runtime))[0];
  const dates = (await owner.query(`SELECT d::date::text "arrivalDate",(d+interval '2 days')::date::text "departureDate"
    FROM generate_series('2027-01-01'::date,'2027-12-29'::date,interval '2 days') d
    WHERE NOT EXISTS(SELECT 1 FROM inventory_claims c WHERE c.unit_id=$1 AND c.released_at IS NULL
      AND c.stay && daterange(d::date,(d+interval '2 days')::date,'[)')) ORDER BY d LIMIT 1`, [unit.id])).rows[0];
  if (!dates) throw Error('Disposable database has no free fixture dates');
  const quoted = await publicBookingRequest(runtime, request('quote', {
    locale: 'de', stay: { unitId: unit.id, ...dates, guestCount: 2 },
  }, browser), 'quote');
  expect(quoted.status).toBe(200);
  const { ticket } = await quoted.json();
  const input = { ticket, acceptedTerms: true, acknowledgedPayment: true, syntheticOnly: true };
  createSession.mockImplementation(async r => ({
    id: `cs_test_${randomUUID()}`, accountId: 'acct_test_m16', url: destination,
    created: r.expiresAt - 1800, expiresAt: r.expiresAt, status: 'open', paymentStatus: 'unpaid',
    paymentIntentId: null, amountTotal: r.amountCents, currency: 'eur', livemode: false,
    mode: 'payment', paymentMethodTypes: ['card'], clientReferenceId: r.correlation.bookingId,
    metadata: { ...r.correlation } as Record<string, string>,
  }));
  const response = await publicBookingRequest(runtime, request('accept', input, browser), 'accept');
  expect(response.status).toBe(200);
  return { browser, input, response, ...receiptFrom(response, browser) };
}
async function facts(receipt: Receipt) {
  return (await owner.query(`SELECT b.id,b.status,
    (SELECT count(*)::int FROM bookings WHERE guest_id=$2) bookings,
    (SELECT array_agg(id ORDER BY id) FROM payment_attempts WHERE booking_id=b.id) attempts,
    (SELECT array_agg(id ORDER BY id) FROM inventory_holds WHERE booking_id=b.id) holds,
    (SELECT array_agg(c.id ORDER BY c.id) FROM inventory_claims c
      JOIN inventory_holds h ON h.id=c.hold_id WHERE h.booking_id=b.id) claims,
    (SELECT count(*)::int FROM inventory_claims c JOIN inventory_holds h ON h.id=c.hold_id
      WHERE h.booking_id=b.id AND c.released_at IS NOT NULL) released_claims,
    (SELECT array_agg(id ORDER BY id) FROM provider_commands WHERE payment_attempt_id=$3) commands,
    (SELECT count(*)::int FROM payment_records WHERE booking_id=b.id) captures
    FROM bookings b WHERE b.id=$1`, [receipt.bookingId, receipt.guestId, receipt.attemptId])).rows[0];
}

describe('M16-S01 Checkout destination and original-attempt recovery (PostgreSQL)', () => {
  it.each([
    'http://checkout.stripe.com/c/pay/cs_test_unsafe',
    'https://evil.test/c/pay/cs_test_unsafe',
    'not a URL',
    'https://checkout.stripe.com.evil.test/x',
    'https://user@checkout.stripe.com/x',
    'https://:password@checkout.stripe.com/x',
    'https://checkout.stripe.com:444/x',
  ])('withholds %s and preserves one booking, attempt and claim through resume/replay', async destination => {
    const f = await fixture(destination);
    expect(await f.response.json()).toEqual({ destination: '/de/booking/return' });
    expect(f.receipt).toMatchObject({ kind: 'receipt', browser: browserBinding(f.browser), accessGeneration: 0 });
    const original = await facts(f.receipt);
    expect(original).toMatchObject({ id: f.receipt.bookingId, status: 'AWAITING_INITIAL_PAYMENT',
      bookings: 1, attempts: [f.receipt.attemptId], holds: [expect.any(String)],
      claims: [expect.any(String)], released_claims: 0, commands: [expect.any(String)], captures: 0 });
    const providerRequest = createSession.mock.calls[0][0];
    expect(providerRequest.correlation).toMatchObject({ bookingId: f.receipt.bookingId, attemptId: f.receipt.attemptId });
    // The actual worker has persisted the invalid URL and will return READY from storage on retry.
    const stored = (await owner.query('SELECT state,checkout_url FROM payment_attempts WHERE id=$1', [f.receipt.attemptId])).rows[0];
    expect(stored).toEqual({ state: 'OPEN', checkout_url: destination });
    expect(await publicBookingStatus(runtime, f.receipt)).toMatchObject({ status: 'AWAITING_INITIAL_PAYMENT' });
    for (const action of ['resume', 'accept'] as const) {
      const response = await publicBookingRequest(runtime, request(action,
        action === 'resume' ? { locale: 'de' } : f.input, f.browser, f.raw), action);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ destination: '/de/booking/return' });
      expect(receiptFrom(response, f.browser).receipt).toMatchObject({ bookingId: f.receipt.bookingId,
        guestId: f.receipt.guestId, attemptId: f.receipt.attemptId });
    }
    expect(await facts(f.receipt)).toEqual(original);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('returns a valid Stripe destination on acceptance and authorized resume without another provider POST', async () => {
    const f = await fixture(validUrl);
    expect(await f.response.json()).toEqual({ destination: validUrl });
    const original = await facts(f.receipt);
    const resumed = await publicBookingRequest(runtime, request('resume', { locale: 'en' }, f.browser, f.raw), 'resume');
    expect(resumed.status).toBe(200);
    expect(await resumed.json()).toEqual({ destination: validUrl });
    expect(receiptFrom(resumed, f.browser).receipt).toEqual(f.receipt);
    expect(await facts(f.receipt)).toEqual(original);
    expect(createSession).toHaveBeenCalledTimes(1);
  });

  it('enforces receipt authority, expiry, CSRF, revocation and rate limits after an invalid destination', async () => {
    const f = await fixture('not a URL');
    const original = await facts(f.receipt);
    const expired = sealBookingToken({ ...f.receipt, expires: Date.now() - 1 });
    const changedBooking = sealBookingToken({ ...f.receipt, bookingId: randomUUID() });
    const changedAttempt = sealBookingToken({ ...f.receipt, attemptId: randomUUID() });
    for (const [browser, receipt] of [
      [f.browser, ''], [randomBytes(32).toString('base64url'), f.raw],
      [f.browser, expired], [f.browser, `!${f.raw}`], [f.browser, f.input.ticket],
      [f.browser, changedBooking], [f.browser, changedAttempt],
    ]) {
      const denied = await publicBookingRequest(runtime, request('resume', { locale: 'de' }, browser, receipt), 'resume');
      expect(denied.status).toBe(409);
      expect(await denied.json()).toEqual({ code: 'EXPIRED_QUOTE' });
      expect(denied.cookies.get('zce_booking_receipt')).toBeUndefined();
    }
    const csrf = await publicBookingRequest(runtime, request('resume', { locale: 'de' }, f.browser, f.raw, 'https://evil.test'), 'resume');
    expect(csrf.status).toBe(400);
    await owner.query('SELECT revoke_guest_access($1)', [f.receipt.bookingId]);
    for (const action of ['resume', 'accept'] as const) {
      const denied = await publicBookingRequest(runtime, request(action,
        action === 'resume' ? { locale: 'de' } : f.input, f.browser, f.raw), action);
      expect(denied.status).toBe(409);
      expect(await denied.json()).toEqual({ code: 'EXPIRED_QUOTE' });
    }
    // Exhaust the actual shared browser bucket; no HTTP dispatch can bypass it.
    let limited;
    for (let i = 0; i < 20; i++) {
      limited = await publicBookingRequest(runtime, request('resume', { locale: 'de' }, f.browser, f.raw), 'resume');
      if (limited.status === 429) break;
      expect(limited.status).toBe(409);
    }
    expect(limited!.status).toBe(429);
    expect(await limited!.json()).toEqual({ code: 'RATE_LIMITED' });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(await facts(f.receipt)).toEqual(original);
  });
});
