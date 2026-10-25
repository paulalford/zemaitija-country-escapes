/** Explicit local-only Stripe sandbox smoke test. Never imported by the test suite. */
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import Stripe from 'stripe';
import { quoteStay } from '../src/server/quote';
import { acceptBooking } from '../src/server/booking-acceptance';
import { dispatchSessionCreate } from '../src/server/checkout-worker';
import { reconcileInitialAttempt } from '../src/server/payment-reconciliation';
import { StripeSdkGateway, stripeConfig, STRIPE_API_VERSION } from '../src/server/stripe-adapter';
import { processWebhookInbox } from '../src/server/stripe-webhooks';

type State = { version: 1; guestId: string; operationKey: string; unitKey: 'forest-cottage'; arrivalDate: string; departureDate: string; bookingId?: string; holdId?: string; attemptId?: string; commandId?: string };
const directory = path.resolve('.local/stripe-smoke');
const stateFile = path.join(directory, 'state.json');
const lockFile = path.join(directory, 'runner.lock');
const accountPattern = /^acct_[A-Za-z0-9]+$/;
class LocalSmokeError extends Error {}
function fail(message: string): never { throw new LocalSmokeError(message); }
function safeError(error: unknown): string {
  if (error instanceof LocalSmokeError) return error.message;
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') return `code ${error.code}`;
  return error instanceof Error ? error.name : 'unknown error';
}
async function save(state: State) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(state, null, 2)); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, stateFile);
}
async function load(): Promise<State | null> {
  try {
    const state = JSON.parse(await readFile(stateFile, 'utf8')) as State;
    if (state.version !== 1 || !/^[0-9a-f-]{36}$/i.test(state.guestId) || !/^stripe-smoke:[0-9a-f-]{36}$/i.test(state.operationKey) || state.unitKey !== 'forest-cottage' || !/^2027-\d\d-\d\d$/.test(state.arrivalDate) || !/^2027-\d\d-\d\d$/.test(state.departureDate)) fail('Invalid local smoke state');
    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
async function preflight() {
  if (process.env.NODE_ENV === 'production') fail('Production environment rejected');
  const urlText = process.env.DATABASE_URL;
  const migrationUrlText = process.env.MIGRATION_DATABASE_URL;
  if (!urlText || !migrationUrlText) fail('DATABASE_URL and MIGRATION_DATABASE_URL are required');
  const url = new URL(urlText);
  const migrationUrl = new URL(migrationUrlText);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (url.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !/^[a-zA-Z0-9_]+_dev$/.test(databaseName)) fail('Requires a localhost PostgreSQL *_dev database');
  if (migrationUrl.protocol !== 'postgresql:' || !['localhost', '127.0.0.1', '[::1]'].includes(migrationUrl.hostname) ||
      migrationUrl.hostname !== url.hostname ||
      (migrationUrl.port || '5432') !== (url.port || '5432') ||
      decodeURIComponent(migrationUrl.pathname.slice(1)) !== databaseName ||
      decodeURIComponent(migrationUrl.username) !== 'zemaitija_migrator') fail('Migration connection must use the migrator role on the same localhost *_dev database');
  const expectedAccount = process.env.SMOKE_EXPECTED_STRIPE_ACCOUNT_ID;
  if (!expectedAccount || !accountPattern.test(expectedAccount)) fail('Set SMOKE_EXPECTED_STRIPE_ACCOUNT_ID to the intended sandbox account');
  const config = stripeConfig();
  if (config.STRIPE_ACCOUNT_ID !== expectedAccount || !config.STRIPE_SECRET_KEY.startsWith('sk_test_')) fail('Sandbox account or key mismatch');
  for (const value of [config.STRIPE_SUCCESS_URL, config.STRIPE_CANCEL_URL]) {
    const target = new URL(value);
    if (target.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(target.hostname) || target.port !== '3000') fail('Return URLs must point to localhost:3000');
  }
  const pool = new pg.Pool({ connectionString: urlText, max: 3 });
  try {
    const db = await pool.query<{ name: string; address: string | null; port: number | null; recovery: boolean }>('SELECT current_database() name, inet_server_addr()::text address, inet_server_port() port, pg_is_in_recovery() recovery');
    const row = db.rows[0];
    const address = row?.address?.split('/')[0] ?? null;
    const privateBridge = address !== null && (/^10\./.test(address) || /^192\.168\./.test(address) || /^172\.(1[6-9]|2\d|3[01])\./.test(address));
    if (row?.name !== databaseName || row.recovery || !(address === null || ['127.0.0.1', '::1'].includes(address) || privateBridge)) fail('Database server is not local development PostgreSQL');
    const stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION, maxNetworkRetries: 0, timeout: 10_000 });
    const account = await stripe.accounts.retrieve(null);
    if (account.id !== expectedAccount) fail('Stripe key belongs to a different account');
    return { pool, gateway: new StripeSdkGateway(config), config, databaseName, databaseAddress: row.address, databasePort: row.port, expectedAccount, migrationUrlText };
  } catch (error) { await pool.end(); throw error; }
}
async function createSyntheticGuest(context: Awaited<ReturnType<typeof preflight>>, guestId: string) {
  const fixture = new pg.Client({ connectionString: context.migrationUrlText });
  try {
    await fixture.connect();
    const target = await fixture.query<{ name: string; role: string; address: string | null; port: number | null; recovery: boolean }>('SELECT current_database() name, current_user role, inet_server_addr()::text address, inet_server_port() port, pg_is_in_recovery() recovery');
    if (target.rows[0]?.name !== context.databaseName || target.rows[0].role !== 'zemaitija_migrator' ||
        target.rows[0].address !== context.databaseAddress || target.rows[0].port !== context.databasePort || target.rows[0].recovery) fail('Migration fixture connection targets the wrong database or role');
    await fixture.query("INSERT INTO guests(id,email_ciphertext,preferred_locale,retention_state) VALUES($1,$2,'en','SYNTHETIC') ON CONFLICT (id) DO NOTHING", [guestId, Buffer.from('synthetic-stripe-smoke')]);
  } finally { await fixture.end(); }
}
async function start(context: Awaited<ReturnType<typeof preflight>>) {
  let state = await load();
  if (!state) {
    const arrivalDate = process.env.SMOKE_ARRIVAL_DATE ?? '2027-04-10';
    const departureDate = process.env.SMOKE_DEPARTURE_DATE ?? '2027-04-12';
    if (!/^2027-\d\d-\d\d$/.test(arrivalDate) || !/^2027-\d\d-\d\d$/.test(departureDate)) fail('Smoke dates must be in 2027');
    state = { version: 1, guestId: randomUUID(), operationKey: `stripe-smoke:${randomUUID()}`, unitKey: 'forest-cottage', arrivalDate, departureDate };
    await save(state);
  }
  const unit = await context.pool.query<{ id: string }>('SELECT id FROM accommodation_units WHERE unit_key=$1 AND enabled=true', [state.unitKey]);
  if (unit.rows.length !== 1) fail('Synthetic reference unit is missing or disabled');
  const quote = await quoteStay(context.pool, { unitId: unit.rows[0].id, arrivalDate: state.arrivalDate, departureDate: state.departureDate, guestCount: 2 });
  if (quote.lines.length === 0 || quote.lines.some(line => !line.localNight.startsWith('2027-'))) fail('Expected existing 2027 rates');
  await createSyntheticGuest(context, state.guestId);
  const accepted = await acceptBooking(context.pool, { operationKey: state.operationKey, guestId: state.guestId, locale: 'en', quote, termsVersion: 'SYNTHETIC_TEST_TERMS_V1', acceptedTerms: true, acknowledgedInitialCents: quote.previewSplit.initialCents, syntheticPortfolioOnly: true });
  if (state.attemptId && (state.attemptId !== accepted.attemptId || state.bookingId !== accepted.bookingId)) fail('Saved acceptance does not match idempotent replay');
  state = { ...state, bookingId: accepted.bookingId, holdId: accepted.holdId, attemptId: accepted.attemptId, commandId: accepted.commandId };
  await save(state);
  const result = await dispatchSessionCreate(context.pool, context.gateway, accepted.attemptId, `local-smoke:${process.pid}`, { successUrl: context.config.STRIPE_SUCCESS_URL, cancelUrl: context.config.STRIPE_CANCEL_URL });
  console.log(JSON.stringify({ stage: 'START', database: context.databaseName, stripeAccount: context.expectedAccount, bookingId: accepted.bookingId, attemptId: accepted.attemptId, holdId: accepted.holdId, replayed: accepted.replayed, initialCents: accepted.initialCents.toString(), checkout: result }, null, 2));
  if (result.status !== 'READY') process.exitCode = 2;
}
async function verify(context: Awaited<ReturnType<typeof preflight>>) {
  const state = await load();
  if (!state?.bookingId || !state.attemptId || !state.holdId) fail('START has not accepted a booking');
  const attempt = await context.pool.query<{ stripe_session_id: string | null; stripe_payment_intent_id: string | null }>('SELECT stripe_session_id,stripe_payment_intent_id FROM payment_attempts WHERE id=$1 AND booking_id=$2', [state.attemptId, state.bookingId]);
  if (attempt.rows.length !== 1) fail('Saved attempt is missing');
  const identities = [attempt.rows[0].stripe_session_id, attempt.rows[0].stripe_payment_intent_id].filter((x): x is string => !!x);
  if (attempt.rows[0].stripe_session_id) {
    const currentSession = await context.gateway.retrieveSession(attempt.rows[0].stripe_session_id);
    if (currentSession.paymentIntentId) identities.push(currentSession.paymentIntentId);
  }
  const events = identities.length ? await context.pool.query<{ id: string }>(`SELECT id FROM stripe_webhook_events WHERE object_id = ANY($1::text[]) AND processing_state IN ('PENDING','RETRY','PROCESSING') ORDER BY received_at`, [identities]) : { rows: [] };
  let processed = 0;
  for (const event of events.rows) processed += await processWebhookInbox(context.pool, context.gateway, 1, event.id);
  const reconciliation = await reconcileInitialAttempt(context.pool, context.gateway, state.attemptId);
  const report = await context.pool.query<{
    booking_state: string; attempt_state: string; hold_state: string; payment_count: string; allocated_count: string; allocation_count: string; correct_allocation_count: string; allocated_cents: string | null; expected_cents: string; claim_count: string; claim_hold_id: string | null; claim_booking_id: string | null; claim_origin_hold_id: string | null; claim_released_at: Date | null; verified_count: string; processed_webhook_count: string;
  }>(`SELECT b.status booking_state,a.state attempt_state,h.state hold_state,a.expected_cents::text,
      (SELECT count(*)::text FROM payment_records p WHERE p.attempt_id=a.id) payment_count,
      (SELECT count(*)::text FROM payment_records p WHERE p.attempt_id=a.id AND p.allocation_state='ALLOCATED') allocated_count,
      (SELECT count(*)::text FROM payment_allocations x JOIN payment_records p ON p.id=x.payment_record_id WHERE p.attempt_id=a.id) allocation_count,
      (SELECT count(*)::text FROM payment_allocations x JOIN payment_records p ON p.id=x.payment_record_id WHERE p.attempt_id=a.id AND x.obligation_id=a.obligation_id AND p.obligation_id=a.obligation_id AND x.amount_cents=a.expected_cents) correct_allocation_count,
      (SELECT sum(x.amount_cents)::text FROM payment_allocations x JOIN payment_records p ON p.id=x.payment_record_id WHERE p.attempt_id=a.id) allocated_cents,
      (SELECT count(*)::text FROM inventory_claims c WHERE c.hold_id=h.id OR c.booking_id=b.id OR c.origin_hold_id=h.id) claim_count,
      (SELECT c.hold_id FROM inventory_claims c WHERE c.origin_hold_id=h.id OR c.hold_id=h.id LIMIT 1) claim_hold_id,
      (SELECT c.booking_id FROM inventory_claims c WHERE c.origin_hold_id=h.id OR c.hold_id=h.id LIMIT 1) claim_booking_id,
      (SELECT c.origin_hold_id FROM inventory_claims c WHERE c.origin_hold_id=h.id OR c.hold_id=h.id LIMIT 1) claim_origin_hold_id,
      (SELECT c.released_at FROM inventory_claims c WHERE c.origin_hold_id=h.id OR c.hold_id=h.id LIMIT 1) claim_released_at,
      (SELECT count(*)::text FROM payment_records p JOIN reconciliation_records r ON r.id=p.reconciliation_id WHERE p.attempt_id=a.id AND p.stripe_charge_id IS NOT NULL AND p.captured_cents=a.expected_cents AND p.currency='EUR' AND r.evidence_kind='STRIPE_CURRENT' AND r.result='VERIFIED_INITIAL') verified_count,
      (SELECT count(*)::text FROM stripe_webhook_events e WHERE e.processing_state='PROCESSED' AND e.stripe_event_id LIKE 'evt_%' AND octet_length(e.payload_digest)=32 AND
        ((e.object_type='checkout.session' AND e.object_id=a.stripe_session_id AND e.event_type IN ('checkout.session.completed','checkout.session.expired')) OR
         (e.object_type='payment_intent' AND e.object_id=a.stripe_payment_intent_id AND e.event_type IN ('payment_intent.succeeded','payment_intent.payment_failed','payment_intent.canceled')))) processed_webhook_count
    FROM bookings b JOIN payment_attempts a ON a.booking_id=b.id JOIN inventory_holds h ON h.id=a.hold_id WHERE b.id=$1 AND a.id=$2`, [state.bookingId, state.attemptId]);
  const row = report.rows[0];
  if (!row) fail('Booking report unavailable');
  const paymentConfirmed = row.booking_state === 'CONFIRMED' && row.attempt_state === 'SUCCEEDED' && row.hold_state === 'CONSUMED' &&
    row.payment_count === '1' && row.allocated_count === '1' && row.allocation_count === '1' && row.correct_allocation_count === '1' &&
    row.verified_count === '1' && row.allocated_cents === row.expected_cents && row.claim_count === '1' &&
    row.claim_hold_id === null && row.claim_booking_id === state.bookingId && row.claim_origin_hold_id === state.holdId && row.claim_released_at === null;
  const signedWebhookProcessed = Number(row.processed_webhook_count) >= 1;
  const unpaidClean = row.payment_count === '0' && row.allocation_count === '0' && row.verified_count === '0';
  const outcome = paymentConfirmed ? (signedWebhookProcessed ? 'PASS' : 'PAYMENT_CONFIRMED_WEBHOOK_MISSING')
    : row.booking_state === 'AWAITING_INITIAL_PAYMENT' && unpaidClean ? 'PENDING'
    : row.booking_state === 'EXPIRED' && unpaidClean ? 'EXPIRED'
    : 'INCONSISTENT';
  console.log(JSON.stringify({ stage: 'VERIFY', bookingId: state.bookingId, attemptId: state.attemptId, processedWebhookCountThisRun: processed, matchingProcessedSignedWebhookCount: Number(row.processed_webhook_count), reconciliation, bookingState: row.booking_state, attemptState: row.attempt_state, holdState: row.hold_state, paymentRecordCount: Number(row.payment_count), initialAllocationCount: Number(row.allocation_count), initialAllocatedCents: row.allocated_cents ?? '0', inventoryClaimCount: Number(row.claim_count), inventoryClaimOwner: row.claim_booking_id ? 'BOOKING' : row.claim_hold_id ? 'HOLD' : 'NONE', paymentConfirmed, signedWebhookProcessed, duplicateAllocation: Number(row.allocation_count) > 1, outcome }, null, 2));
  if (outcome !== 'PASS') process.exitCode = 2;
}
async function main() {
  const stage = process.argv[2];
  if (!['start', 'verify'].includes(stage) || process.argv.length !== 4 || process.argv[3] !== '--local-sandbox-only') fail('Usage: stripe-checkout-smoke.ts <start|verify> --local-sandbox-only');
  process.loadEnvFile('.env.local');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = await open(lockFile, 'wx', 0o600).catch(() => fail('Smoke runner already active; inspect .local/stripe-smoke/runner.lock'));
  try {
    const context = await preflight();
    try { if (stage === 'start') await start(context); else await verify(context); }
    finally { await context.pool.end(); }
  } finally { await lock.close(); await unlink(lockFile); }
}
main().catch(error => { console.error(`Stripe smoke failed (${safeError(error)}). Inspect local state and database; retry uses the same operation key.`); process.exitCode = 1; });
