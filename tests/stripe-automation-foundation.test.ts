import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutomationError, authorizeStripeAutomation, stripeAutomationConfig,
  validateAutomationRequest, verifyAutomationDatabaseIdentity,
  type DatabaseIdentity } from '../src/server/stripe-automation-config';
import { AUTOMATION_BUDGET, AUTOMATION_LANES, classifyAutomationFailure,
  runStripeAutomationFoundation } from '../src/server/stripe-automation';

// Import traps, not provider mocks: touching these modules makes this suite fail.
vi.mock('pg', () => { throw new Error('Database module forbidden'); });
vi.mock('stripe', () => { throw new Error('Stripe module forbidden'); });
vi.mock('../src/db/client', () => { throw new Error('Runtime pool forbidden'); });
vi.mock('../src/server/stripe-webhooks', () => { throw new Error('Inbox forbidden'); });
vi.mock('../src/server/payment-reconciliation', () => { throw new Error('Initial processor forbidden'); });
vi.mock('../src/server/balance-payment', () => { throw new Error('Balance processor forbidden'); });
vi.mock('../src/server/checkout-worker', () => { throw new Error('Checkout processor forbidden'); });
vi.mock('../src/server/stripe-automation-runner', () => { throw new Error('Executing core forbidden'); });
vi.mock('../src/server/stripe-automation-runtime', () => { throw new Error('Worker resources forbidden'); });
vi.mock('../src/server/stripe-automation-recovery', () => { throw new Error('Recovery wiring forbidden'); });

const workerSecret = 'abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
const databasePassword = '0123456789abcdef0123456789ABCDEF01';
const key = 'sk_test_SyntheticFoundationKeyOnly123456';
function environment(): NodeJS.ProcessEnv {
  return { NODE_ENV: 'test', STRIPE_AUTOMATION_ENABLED: 'true',
    STRIPE_AUTOMATION_ENVIRONMENT: 'isolated-development', STRIPE_AUTOMATION_DEPLOYMENT: 'local',
    STRIPE_AUTOMATION_SECRET: workerSecret, STRIPE_AUTOMATION_DB_NAME: 'zemaitija_stripe_automation_dev',
    STRIPE_AUTOMATION_DB_HOST: '127.0.0.1', STRIPE_AUTOMATION_DB_PORT: '55433',
    STRIPE_AUTOMATION_DB_ROLE: 'zemaitija_app', STRIPE_AUTOMATION_DB_SERVER_ADDRESS: '172.29.0.2',
    DATABASE_URL: `postgresql://zemaitija_app:${databasePassword}@127.0.0.1:55433/zemaitija_stripe_automation_dev`,
    STRIPE_MODE: 'test', STRIPE_SECRET_KEY: key, STRIPE_ACCOUNT_ID: 'acct_synthetic',
    STRIPE_AUTOMATION_EXPECTED_ACCOUNT_ID: 'acct_synthetic' };
}
function identity(): DatabaseIdentity {
  return { database_name: 'zemaitija_stripe_automation_dev', role_name: 'zemaitija_app',
    session_role: 'zemaitija_app', server_address: '172.29.0.2', server_port: 5432,
    server_version: 170006, in_recovery: false, database_owner: 'zemaitija_migrator',
    superuser: false, create_database: false, create_role: false, bypass_rls: false };
}
const originalEnvironment = process.env;
afterEach(() => { process.env = originalEnvironment; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Stripe automation Stage 2A foundation (no external operations)', () => {
  it.each([undefined, 'false'])('is disabled for enablement %s', enabled => {
    expect(() => stripeAutomationConfig({ STRIPE_AUTOMATION_ENABLED: enabled })).toThrow('DISABLED');
  });
  it('validates syntax without dependency construction and omits raw credentials', () => {
    const config = stripeAutomationConfig(environment());
    expect(config.database.port).toBe(55433);
    expect(JSON.stringify(config)).not.toContain(workerSecret);
    expect(JSON.stringify(config)).not.toContain(databasePassword);
    expect(JSON.stringify(config)).not.toContain(key);
  });
  it.each([undefined, '', 'short', 'a'.repeat(64), `${workerSecret} `, 'x'.repeat(129)])(
    'rejects missing/weak/malformed secrets (%#)', secret => {
      expect(() => stripeAutomationConfig({ ...environment(), STRIPE_AUTOMATION_SECRET: secret })).toThrow('CONFIGURATION');
    });
  it.each([
    ['STRIPE_AUTOMATION_ENABLED', '1'], ['STRIPE_AUTOMATION_DB_NAME', 'zemaitija_dev'],
    ['STRIPE_AUTOMATION_DB_NAME', 'other_dev'], ['STRIPE_AUTOMATION_DB_HOST', 'localhost'],
    ['STRIPE_AUTOMATION_DB_PORT', '5432'], ['STRIPE_AUTOMATION_DB_ROLE', 'zemaitija_migrator'],
    ['STRIPE_AUTOMATION_DB_SERVER_ADDRESS', 'some-host'], ['STRIPE_AUTOMATION_DB_SERVER_ADDRESS', undefined],
    ['NODE_ENV', 'production'], ['NODE_ENV', undefined], ['STRIPE_AUTOMATION_ENVIRONMENT', 'production'],
    ['STRIPE_AUTOMATION_DEPLOYMENT', 'vercel'], ['VERCEL', '1'], ['VERCEL_ENV', 'preview'],
    ['VERCEL_TARGET_ENV', 'production'], ['STRIPE_SECRET_KEY', 'sk_live_rejected'],
    ['STRIPE_SECRET_KEY', 'rk_live_rejected'], ['STRIPE_SECRET_KEY', undefined],
    ['STRIPE_MODE', 'live'], ['STRIPE_LIVEMODE', 'true'], ['STRIPE_MODE', undefined],
    ['STRIPE_ACCOUNT_ID', 'acct_other'], ['STRIPE_AUTOMATION_EXPECTED_ACCOUNT_ID', undefined],
    ['STRIPE_AUTOMATION_BATCH_SIZE', '25'], ['STRIPE_AUTOMATION_ACTIVE', 'true'],
    ['PGHOST', 'protected-host'], ['PGOPTIONS', '-c role=zemaitija_migrator'],
    ['MIGRATION_DATABASE_URL', 'not-a-runtime-credential'], ['MIGRATION_DB_PASSWORD', 'not-permitted'],
    ['AUTOMATION_BOOTSTRAP_PASSWORD', 'not-permitted'], ['GUEST_TOKEN_SECRET', workerSecret],
  ])('rejects invalid configuration %s (%#)', (name, value) => {
    expect(() => stripeAutomationConfig({ ...environment(), [name]: value })).toThrow('CONFIGURATION');
  });
  it.each([
    environment().DATABASE_URL!.replace('/zemaitija_stripe_automation_dev', '/zemaitija_dev'),
    environment().DATABASE_URL!.replace('127.0.0.1', 'localhost'),
    environment().DATABASE_URL!.replace(':55433/', ':5432/'),
    environment().DATABASE_URL!.replace('zemaitija_app:', 'zemaitija_migrator:'),
    `${environment().DATABASE_URL}?options=unsafe`, `${environment().DATABASE_URL}#fragment`,
    'not-a-url', undefined,
  ])('rejects connection target mismatch or ambiguity (%#)', url => {
    expect(() => stripeAutomationConfig({ ...environment(), DATABASE_URL: url })).toThrow('CONFIGURATION');
  });
  it.each([null, '', `Bearer ${'z'.repeat(64)}`, `bearer ${workerSecret}`, `Bearer ${workerSecret},Bearer bad`])(
    'rejects incorrect bearer credentials (%#)', header => {
      expect(() => authorizeStripeAutomation(header, stripeAutomationConfig(environment()))).toThrow('UNAUTHORIZED');
    });
  it('accepts only the dedicated bearer, without granting processing authority', () => {
    expect(() => authorizeStripeAutomation(`Bearer ${workerSecret}`, stripeAutomationConfig(environment()))).not.toThrow();
  });
  it.each([
    new Request('http://localhost/api/internal/stripe-automation?limit=1', { method: 'POST' }),
    new Request('http://localhost/api/internal/stripe-automation', { method: 'POST', body: '{}' }),
    new Request('http://localhost/api/internal/stripe-automation', { method: 'POST', headers: { 'content-length': '1' } }),
    new Request('http://localhost/api/internal/stripe-automation', { method: 'POST', headers: { 'transfer-encoding': 'chunked' } }),
  ])('rejects runtime parameter channels (%#)', request => {
    expect(() => validateAutomationRequest(request)).toThrow('REQUEST_PARAMETERS');
  });
  it('returns redacted inactive lane accounting without accessing injected dependencies', () => {
    const sideEffect = vi.fn(() => { throw new Error(workerSecret); });
    const summary = runStripeAutomationFoundation(stripeAutomationConfig(environment()), {
      constructDatabase: sideEffect, constructStripe: sideEffect,
      processors: Object.fromEntries(AUTOMATION_LANES.map(lane => [lane, sideEffect])),
    });
    expect(sideEffect).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ status: 'INACTIVE', processingEnabled: false });
    expect(summary.lanes).toHaveLength(5);
    expect(summary.lanes.every(lane => lane.attempted === 0 && lane.completed === 0 && lane.state === 'NOT_EXECUTED')).toBe(true);
    for (const secret of [workerSecret, databasePassword, key, environment().DATABASE_URL!])
      expect(JSON.stringify(summary)).not.toContain(secret);
    expect(Object.isFrozen(AUTOMATION_BUDGET.perLane)).toBe(true);
    expect(classifyAutomationFailure(new Error(workerSecret))).toBe('INTERNAL');
    expect(classifyAutomationFailure(new AutomationError('UNAUTHORIZED'))).toBe('UNAUTHORIZED');
  });
  it('checks actual identity using a fake reader only', async () => {
    const reader = { query: vi.fn(async () => ({ rows: [identity()] })) };
    await expect(verifyAutomationDatabaseIdentity(reader, stripeAutomationConfig(environment()), environment())).resolves.toBeUndefined();
    expect(reader.query).toHaveBeenCalledOnce();
    expect(reader.query.mock.calls[0]).toBeDefined();
  });
  it.each([
    { database_name: 'zemaitija_dev' }, { role_name: 'zemaitija_migrator' }, { session_role: 'zemaitija_bootstrap' },
    { server_address: null }, { server_address: '172.29.0.3' }, { server_port: 55433 },
    { server_version: 160006 }, { in_recovery: true }, { database_owner: 'zemaitija_bootstrap' },
    { superuser: true }, { create_database: true }, { create_role: true }, { bypass_rls: true },
  ])('fails closed on actual identity mismatch (%#)', async change => {
    const reader = { query: vi.fn(async () => ({ rows: [{ ...identity(), ...change }] })) };
    await expect(verifyAutomationDatabaseIdentity(reader, stripeAutomationConfig(environment()), environment())).rejects.toThrow('DATABASE_IDENTITY');
  });
  it('rejects environment drift before asking the reader', async () => {
    const reader = { query: vi.fn(async () => ({ rows: [identity()] })) };
    await expect(verifyAutomationDatabaseIdentity(reader, stripeAutomationConfig(environment()),
      { ...environment(), VERCEL_ENV: 'preview' })).rejects.toThrow('CONFIGURATION');
    expect(reader.query).not.toHaveBeenCalled();
  });
  it('redacts read failures and rejects empty or ambiguous results', async () => {
    for (const rows of [[], [identity(), identity()]])
      await expect(verifyAutomationDatabaseIdentity({ query: async () => ({ rows }) },
        stripeAutomationConfig(environment()), environment())).rejects.toThrow('DATABASE_IDENTITY');
    await expect(verifyAutomationDatabaseIdentity({ query: async () => { throw new Error(workerSecret); } },
      stripeAutomationConfig(environment()), environment())).rejects.toThrow('DATABASE_UNAVAILABLE');
  });
  it('imports the route with no configuration, network calls, or forbidden dependencies', async () => {
    process.env = { NODE_ENV: 'test' };
    const fetch = vi.fn(() => { throw new Error('Network forbidden'); });
    vi.stubGlobal('fetch', fetch);
    vi.resetModules();
    const { POST } = await import('../src/app/api/internal/stripe-automation/route');
    expect(fetch).not.toHaveBeenCalled();
    const result = await POST(new Request('http://localhost/api/internal/stripe-automation', { method: 'POST' }));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ status: 'UNAVAILABLE', code: 'DISABLED' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails authorization before any dependencies; even valid authentication stays unavailable', async () => {
    process.env = environment();
    const { POST } = await import('../src/app/api/internal/stripe-automation/route');
    const request = (authorization?: string, suffix = '') => new Request(`http://localhost/api/internal/stripe-automation${suffix}`,
      { method: 'POST', headers: authorization ? { authorization } : {} });
    expect((await POST(request())).status).toBe(401);
    expect((await POST(request(`Bearer ${'x'.repeat(64)}`))).status).toBe(401);
    expect((await POST(request(`Bearer ${workerSecret}`, '?account=acct_other'))).status).toBe(400);
    const result = await POST(request(`Bearer ${workerSecret}`));
    expect(result.status).toBe(503);
    expect(result.headers.get('cache-control')).toBe('no-store');
    expect(await result.json()).toEqual({ status: 'UNAVAILABLE', code: 'STAGE_2A_INACTIVE' });
  });
  it('returns generic configuration errors without disclosing invalid input', async () => {
    process.env = { ...environment(), DATABASE_URL: workerSecret };
    const { POST } = await import('../src/app/api/internal/stripe-automation/route');
    const result = await POST(new Request('http://localhost/api/internal/stripe-automation', { method: 'POST' }));
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(workerSecret);
  });
  it('keeps the standalone template separate and requires independent credentials (static inspection)', () => {
    const compose = readFileSync(new URL('../docker-compose.stripe-automation.yml', import.meta.url), 'utf8');
    expect(compose).toContain('image: postgres:17.6');
    expect(compose).toContain('127.0.0.1:55433:5432');
    expect(compose).toContain('name: zemaitija_stripe_automation_data');
    expect(compose).not.toContain('postgres_data:');
    expect(compose).toContain('AUTOMATION_APP_PASSWORD:?');
    expect(compose).toContain('AUTOMATION_PROTECTED_APP_PASSWORD_SHA256:?');
    expect(compose).not.toContain('${APP_DB_PASSWORD');
    expect(compose).toContain('"$$isolated_hash" != "$$protected"');
    expect(compose).toContain('"$$POSTGRES_PASSWORD" != "$$APP_DB_PASSWORD"');
  });
});
