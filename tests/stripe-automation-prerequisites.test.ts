import { createHash } from 'node:crypto';
import { constants, readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveFingerprintFile, prepareProtectedFingerprints } from '../scripts/prepare-protected-db-fingerprints';

// No real protected-file IO, output files, subprocesses, databases or transports.
const filesystem = vi.hoisted(() => ({
  access: vi.fn(), lstat: vi.fn(), mkdtemp: vi.fn(), open: vi.fn(), realpath: vi.fn(),
}));
vi.mock('node:fs/promises', () => filesystem);
const repository = '/home/paul/Portfolio/zemaitija-country-escapes';
const parent = '/private/synthetic-review';
const synthetic = () => [
  'POSTGRES_DB=zemaitija_dev', 'POSTGRES_USER=zemaitija_bootstrap',
  'APP_DB_USER=zemaitija_app', 'MIGRATION_DB_USER=zemaitija_migrator',
  'POSTGRES_PASSWORD=synthetic-bootstrap-only', 'APP_DB_PASSWORD=synthetic-app-only',
  'MIGRATION_DB_PASSWORD=synthetic-migration-only',
].join('\n');
const denied = 'FINGERPRINT_PREPARATION_REJECTED';

describe('pure protected credential fingerprint derivation using synthetic strings only', () => {
  it('emits only the three fingerprint variables with exact SHA-256 values', () => {
    const text = deriveFingerprintFile(synthetic());
    const rows = text.trim().split('\n');
    expect(rows).toHaveLength(3);
    for (const [index, value] of ['bootstrap', 'app', 'migration'].entries()) {
      const expected = createHash('sha256').update(`synthetic-${value}-only`).digest('hex');
      expect(rows[index].endsWith(`=${expected}`)).toBe(true);
      expect(/^AUTOMATION_PROTECTED_(BOOTSTRAP|APP|MIGRATION)_PASSWORD_SHA256=[0-9a-f]{64}$/.test(rows[index])).toBe(true);
    }
    expect(text.includes('synthetic-')).toBe(false);
  });
  it('handles single-line quotes, export, comments and CRLF without evaluation', () => {
    const source = synthetic().replace('POSTGRES_PASSWORD=synthetic-bootstrap-only',
      'export POSTGRES_PASSWORD="synthetic-bootstrap-only" # local comment');
    expect(deriveFingerprintFile(source.replaceAll('\n', '\r\n')) === deriveFingerprintFile(synthetic())).toBe(true);
  });
  it.each([
    ['missing password', () => synthetic().replace('APP_DB_PASSWORD=synthetic-app-only', '')],
    ['empty password', () => synthetic().replace('synthetic-app-only', '')],
    ['duplicate password value', () => synthetic().replace('synthetic-app-only', 'synthetic-bootstrap-only')],
    ['duplicate assignment', () => `${synthetic()}\nAPP_DB_PASSWORD=another-synthetic-value`],
    ['wrong database', () => synthetic().replace('POSTGRES_DB=zemaitija_dev', 'POSTGRES_DB=other_dev')],
    ['missing identity', () => synthetic().replace('APP_DB_USER=zemaitija_app', '')],
    ['production', () => `${synthetic()}\nNODE_ENV=production`],
    ['worker enabled', () => `${synthetic()}\nSTRIPE_AUTOMATION_ENABLED=true`],
    ['wrong port', () => `${synthetic()}\nPOSTGRES_PORT=55433`],
    ['shell expansion', () => synthetic().replace('synthetic-app-only', '${OTHER_PASSWORD}')],
    ['command substitution', () => synthetic().replace('synthetic-app-only', '`synthetic-command`')],
    ['multiline value', () => synthetic().replace('synthetic-app-only', '"synthetic\nmultiline"')],
    ['URL mismatch', () => `${synthetic()}\nDATABASE_URL=postgresql://zemaitija_app:synthetic-app-only@127.0.0.1:55433/zemaitija_dev`],
    ['encoded newline', () => synthetic().replace('synthetic-app-only', '"synthetic\\napp"')],
  ] as const)('rejects %s with a fixed non-sensitive error', (_name, source) => {
    expect(() => deriveFingerprintFile(source())).toThrow(denied);
  });
});

function fakeFiles() {
  const uid = process.getuid!();
  const source = Buffer.from(synthetic());
  const input = { stat: vi.fn(async () => ({isFile: (): boolean => true, uid, nlink: 1, mode: 0o600, size: source.length})),
    read: vi.fn(async (buffer: Buffer, offset: number) => {
      if (offset) return {bytesRead: 0};
      source.copy(buffer); return {bytesRead: source.length};
    }), close: vi.fn(async () => {}) };
  const output = {stat: vi.fn(async () => ({isFile: () => true, uid, mode: 0o600})),
    writeFile: vi.fn(async () => {}), sync: vi.fn(async () => {}), close: vi.fn(async () => {})};
  filesystem.realpath.mockImplementation(async (path: string) => path === process.cwd() ? repository : path);
  filesystem.lstat.mockResolvedValue({isDirectory: () => true, uid, mode: 0o700});
  filesystem.access.mockRejectedValue(Object.assign(Error('not found'), {code: 'ENOENT'}));
  filesystem.mkdtemp.mockResolvedValue(`${parent}/protected-fingerprints-synthetic`);
  filesystem.open.mockImplementation(async (path: string) => path.endsWith('.env.local') ? input : output);
  return {input, output};
}

describe('preparation filesystem contract with mocked IO only; CLI never executed', () => {
  beforeEach(() => vi.resetAllMocks());
  it('imports without reading credentials or creating files', () => {
    expect(filesystem.open).not.toHaveBeenCalled();
    expect(filesystem.mkdtemp).not.toHaveBeenCalled();
  });
  it('uses the fixed input, exclusive private output and no log output', async () => {
    const f = fakeFiles();
    const stdout = vi.spyOn(process.stdout, 'write'), stderr = vi.spyOn(process.stderr, 'write');
    try {
      await prepareProtectedFingerprints(parent, {});
      expect(filesystem.open.mock.calls[0][0]).toBe(`${repository}/.env.local`);
      expect(filesystem.open.mock.calls[0][1]).toBe(constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      expect(filesystem.open.mock.calls[1][2]).toBe(0o600);
      expect(filesystem.open.mock.calls[1][1]).toBe(constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW);
      expect(filesystem.mkdtemp).toHaveBeenCalledExactlyOnceWith(`${parent}/protected-fingerprints-`);
      expect(f.output.writeFile).toHaveBeenCalledOnce();
      expect(f.input.close).toHaveBeenCalledOnce();
      expect(f.output.sync).toHaveBeenCalledOnce();expect(f.output.close).toHaveBeenCalledOnce();
      expect(stdout).not.toHaveBeenCalled();expect(stderr).not.toHaveBeenCalled();
    } finally {stdout.mockRestore();stderr.mockRestore();}
  });
  it.each(['PGHOST', 'DATABASE_URL', 'NODE_OPTIONS', 'COMPOSE_FILE', 'NODE_ENV'])(
    'rejects inherited %s before any filesystem operation', async name => {
      fakeFiles();await expect(prepareProtectedFingerprints(parent, {[name]: 'synthetic'})).rejects.toThrow(denied);
      expect(filesystem.realpath).not.toHaveBeenCalled();expect(filesystem.open).not.toHaveBeenCalled();
    });
  it('rejects an unexpected repository before protected-file access', async () => {
    fakeFiles();filesystem.realpath.mockResolvedValue('/unexpected/repository');
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(denied);
    expect(filesystem.open).not.toHaveBeenCalled();
  });
  it.each([repository, `${repository}/private`, 'relative/output', '/private/../synthetic-review'])(
    'rejects unsafe output path %s before protected-file access', async path => {
      fakeFiles();await expect(prepareProtectedFingerprints(path, {})).rejects.toThrow(denied);
      expect(filesystem.open).not.toHaveBeenCalled();
    });
  it('rejects a symlinked output path', async () => {
    fakeFiles();filesystem.realpath.mockImplementation(async (path: string) => path === parent ? '/another/path' : path);
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(denied);
    expect(filesystem.open).not.toHaveBeenCalled();
  });
  it('rejects a permissive output parent', async () => {
    fakeFiles();filesystem.lstat.mockResolvedValue({isDirectory: () => true, uid: process.getuid!(), mode: 0o755});
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(denied);
    expect(filesystem.open).not.toHaveBeenCalled();
  });
  it('rejects output inside another Git working tree', async () => {
    fakeFiles();filesystem.access.mockResolvedValue(undefined);
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(denied);
    expect(filesystem.open).not.toHaveBeenCalled();
  });
  it('rejects permissive protected-file permissions before reading bytes', async () => {
    const f = fakeFiles();f.input.stat.mockResolvedValue({isFile: () => true, uid: process.getuid!(), nlink: 1, mode: 0o644, size: 20});
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(denied);
    expect(f.input.read).not.toHaveBeenCalled();expect(f.input.close).toHaveBeenCalledOnce();
    expect(filesystem.mkdtemp).not.toHaveBeenCalled();
  });
  it.each(['owner', 'hardlink', 'oversize', 'not-file'] as const)('rejects input %s before reading bytes', async condition => {
    const f = fakeFiles();
    f.input.stat.mockResolvedValue({isFile: () => condition !== 'not-file',
      uid: process.getuid!() + (condition === 'owner' ? 1 : 0),
      nlink: condition === 'hardlink' ? 2 : 1, mode: 0o600, size: condition === 'oversize' ? 65537 : 20});
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(denied);
    expect(f.input.read).not.toHaveBeenCalled();expect(filesystem.mkdtemp).not.toHaveBeenCalled();
  });
  it('rejects unsafe output permissions before writing fingerprints', async () => {
    const f = fakeFiles();f.output.stat.mockResolvedValue({isFile: () => true, uid: process.getuid!(), mode: 0o644});
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(denied);
    expect(f.output.writeFile).not.toHaveBeenCalled();expect(f.output.close).toHaveBeenCalledOnce();
  });
  it('redacts a refused symlink input and creates no output', async () => {
    fakeFiles();filesystem.open.mockRejectedValue(Object.assign(Error('synthetic path'), {code: 'ELOOP'}));
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(/^FINGERPRINT_PREPARATION_REJECTED$/);
    expect(filesystem.mkdtemp).not.toHaveBeenCalled();
  });
  it('does not create output when input validation fails', async () => {
    const f = fakeFiles();f.input.read.mockResolvedValue({bytesRead: 0});
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(denied);
    expect(filesystem.mkdtemp).not.toHaveBeenCalled();expect(f.output.writeFile).not.toHaveBeenCalled();
  });
  it('redacts IO errors and retains incomplete private output without retry', async () => {
    const f = fakeFiles();f.output.writeFile.mockRejectedValue(Error('synthetic secret must not escape'));
    await expect(prepareProtectedFingerprints(parent, {})).rejects.toThrow(/^FINGERPRINT_PREPARATION_REJECTED$/);
    expect(f.output.close).toHaveBeenCalledOnce();expect(filesystem.mkdtemp).toHaveBeenCalledOnce();
  });
});

describe('internal network source contract', () => {
  it('attaches only the explicit internal bridge and retains the existing target', () => {
    const compose = readFileSync(new URL('../docker-compose.stripe-automation.yml', import.meta.url), 'utf8');
    expect(compose).toContain('    networks:\n      - stripe_automation_internal');
    expect(compose).toContain('networks:\n  stripe_automation_internal:\n    name: zemaitija-stripe-automation-internal\n    driver: bridge\n    internal: true');
    expect(compose).toContain('image: postgres:17.6');
    expect(compose).toContain('127.0.0.1:55433:5432');
    expect(compose).toContain('name: zemaitija_stripe_automation_data');
    expect(compose).not.toContain('network_mode:');
  });
});
