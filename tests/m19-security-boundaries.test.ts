import type { Pool } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccessDenied, requireSession, requireUnit, requireFinance, consumeAction, type Session } from '../src/server/access';
import { accessRequest, cookieName, privateHeaders, sameOrigin } from '../src/server/access-http';
import { localePath } from '../src/i18n/routing';
import { publicMetadata, publicSitemap, type PublicPath } from '../src/i18n/publication';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const raw = 'a'.repeat(43);
function config() { vi.stubEnv('APP_ORIGIN', 'https://demo.example'); vi.stubEnv('ACCESS_SECRET', 'ab'.repeat(32)); }
const session = (changes: Partial<Session> = {}): Session => ({ id: 'synthetic-session', admin_user_id: null,
  guest_token_id: 'synthetic-token', booking_id: 'booking-a', guest_id: 'synthetic-guest', role: null,
  scopes: ['booking:view'], expires_at: new Date(Date.now() + 60_000), authenticated_at: new Date(), ...changes });
function fake(row?: Session, allowedUnit = false, currentRole = row?.role) {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT s.id')) return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    if (sql.includes('SELECT a.role')) return { rows: [{ role: currentRole }], rowCount: 1 };
    if (sql.includes('SELECT u.id')) return { rows: allowedUnit ? [{ id: 'unit-a' }] : [], rowCount: allowedUnit ? 1 : 0 };
    if (sql.includes('RETURNING attempts')) return { rows: [{ attempts: 1 }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  return { query, pool: { query } as unknown as Pool };
}

describe('M19 real authorization functions with synthetic query results', () => {
  it.each([
    { kind: 'admin' as const, scope: undefined, booking: undefined },
    { kind: 'guest' as const, scope: 'booking:cancel' as const, booking: undefined },
    { kind: 'guest' as const, scope: 'booking:view' as const, booking: 'booking-b' },
  ])('denies workspace/scope/object substitution %# without touching the session', async ({ kind, scope, booking }) => {
    const f = fake(session());
    await expect(requireSession(f.pool, raw, kind, scope, booking)).rejects.toBeInstanceOf(AccessDenied);
    expect(f.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE access_sessions'))).toBe(false);
  });
  it('fails closed on absent expired/revoked/disabled session result; retains database predicates', async () => {
    const f = fake(); await expect(requireSession(f.pool, raw, 'admin')).rejects.toBeInstanceOf(AccessDenied);
    const sql = f.query.mock.calls.find(([sql]) => sql.includes('SELECT s.id'))![0];
    for (const predicate of ['s.revoked_at IS NULL', 's.expires_at>clock_timestamp()', 't.revoked_at IS NULL', 'a.enabled', 'a.auth_version=s.admin_version']) expect(sql).toContain(predicate);
    // Predicate inspection plus injected absence is not a PostgreSQL expiry/race test.
  });
  it.each(['historical-role', null])('rejects a current nonallowlisted administrator role %s', async role => {
    const f = fake(session({ admin_user_id: 'admin-a', role: 'operations' }), false, role as Session['role']);
    await expect(requireSession(f.pool, raw, 'admin')).rejects.toBeInstanceOf(AccessDenied);
  });
  it('denies cross-unit operations and finance inventory authority', async () => {
    const f = fake();
    await expect(requireUnit(f.pool, session({ admin_user_id: 'admin-a', role: 'operations' }), 'unit-b')).rejects.toBeInstanceOf(AccessDenied);
    await expect(requireUnit(f.pool, session({ admin_user_id: 'admin-a', role: 'finance' }), 'unit-a')).rejects.toBeInstanceOf(AccessDenied);
  });
  it('requires a finance role and recent MFA; rejects absent/consumed actions', async () => {
    const f = fake();
    for (const s of [session({ admin_user_id: 'admin-a', role: 'operations' }), session({ admin_user_id: 'admin-a', role: 'finance', authenticated_at: new Date(Date.now() - 600_001) })])
      await expect(requireFinance(f.pool, s)).rejects.toBeInstanceOf(AccessDenied);
    await expect(consumeAction(f.pool, session(), raw, 'booking:cancel', 'booking-a')).rejects.toBeInstanceOf(AccessDenied);
    const sql = f.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE access_actions'))![0];
    for (const part of ['session_id=$2', 'operation=$3', 'booking_id IS NOT DISTINCT FROM', 'consumed_at IS NULL', 'expires_at>clock_timestamp()']) expect(sql).toContain(part);
  });
});

describe('M19 HTTP, cookie and diagnostic boundaries', () => {
  it.each([undefined, 'https://evil.example', 'null'])('denies Origin %s before authenticated processing', async origin => {
    config(); const f = fake();
    const request = new Request('https://demo.example/api/access/guest/logout', { method: 'POST', headers: origin ? { origin } : {}, body: '{}' });
    const response = await accessRequest(f.pool, request, 'guest/logout');
    expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toContain('no-store');
    expect(f.query.mock.calls.some(([sql]) => sql.includes('SELECT s.id'))).toBe(false);
    expect(await response.text()).not.toContain(raw);
  });
  it('rejects cross-site fetch metadata even with matching Origin', async () => {
    config(); const f = fake();
    await expect(sameOrigin(f.pool, new Request('https://demo.example', { headers: { origin: 'https://demo.example', 'sec-fetch-site': 'cross-site' } }))).rejects.toBeInstanceOf(AccessDenied);
  });
  it('sets host-only Secure HttpOnly SameSite session cookies and private response headers', async () => {
    config(); const f = fake(session({ admin_user_id: 'admin-a', role: 'administrator' }));
    const response = await accessRequest(f.pool, new Request('https://demo.example/api/access/admin/logout', {
      method: 'POST', headers: { origin: 'https://demo.example', 'content-type': 'application/json', cookie: `${cookieName('admin')}=${raw}` }, body: '{}',
    }), 'admin/logout');
    expect(response.status).toBe(303);
    const cookie = response.headers.get('set-cookie')!;
    for (const flag of ['__Host-zce_admin=', 'Path=/', 'Max-Age=0', 'Secure', 'HttpOnly', 'SameSite=lax']) expect(cookie).toContain(flag);
    expect(cookie).not.toContain('Domain=');
    for (const [name, value] of Object.entries(privateHeaders)) expect(response.headers.get(name)).toBe(value);
    expect(response.headers.get('location')).toBe('https://demo.example/lt/admin/signin');
  });
  it.each(['oversize', 'wrong-type', 'duplicate-form', 'unexpected-field'])('rejects %s input before token/session access', async kind => {
    config(); const f = fake();
    const form = kind === 'duplicate-form';
    const body = kind === 'oversize' ? 'x'.repeat(16385) : form ? 'token=a&token=b' : '{"unexpected":"value"}';
    const response = await accessRequest(f.pool, new Request('https://demo.example/api/access/guest/exchange', { method: 'POST',
      headers: { origin: 'https://demo.example', 'content-type': form ? 'application/x-www-form-urlencoded' : kind === 'wrong-type' ? 'text/plain' : 'application/json' }, body }), 'guest/exchange');
    expect(response.status).toBe(400); expect(f.query.mock.calls.some(([sql]) => sql.includes('SELECT s.id') || sql.includes('UPDATE guest_access_tokens'))).toBe(false);
  });
  it('excludes synthetic credentials from locale destinations and public output', () => {
    for (const locale of ['lt', 'en', 'de'] as const) {
      expect(localePath(locale, `/manage?token=${raw}&session=${raw}&receipt=${raw}`)).toBe(`/${locale}/manage`);
      expect(() => publicMetadata(locale, `/privacy?token=${raw}` as PublicPath)).toThrow();
      expect(JSON.stringify(publicMetadata(locale, '/privacy'))).not.toContain(raw);
    }
    expect(publicSitemap()).toEqual([]);
  });
  it('does not expose diagnostic details when the existing guard query fails', async () => {
    config(); const log = vi.spyOn(console, 'log'), error = vi.spyOn(console, 'error');
    const query = vi.fn(async () => { throw Error('synthetic-private-diagnostic'); });
    const response = await accessRequest({ query } as unknown as Pool, new Request('https://demo.example/api/access/guest/exchange', {
      method: 'POST', headers: { origin: 'https://demo.example', 'content-type': 'application/json' }, body: JSON.stringify({ token: raw }),
    }), 'guest/exchange');
    expect(response.status).toBe(503); expect(await response.text()).not.toMatch(/synthetic-private-diagnostic|aaaaa/);
    expect(log).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
  });
});
