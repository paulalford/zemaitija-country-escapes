import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdtemp, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';

// Deliberately fixed: no arbitrary input file, repository, role or database options.
const repository = '/home/paul/Portfolio/zemaitija-country-escapes';
const passwords = ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'MIGRATION_DB_PASSWORD'] as const;
const outputs = ['AUTOMATION_PROTECTED_BOOTSTRAP_PASSWORD_SHA256',
  'AUTOMATION_PROTECTED_APP_PASSWORD_SHA256', 'AUTOMATION_PROTECTED_MIGRATION_PASSWORD_SHA256'];
const rejected = () => new Error('FINGERPRINT_PREPARATION_REJECTED');

/** Pure single-line dotenv subset, with no expansion or shell evaluation. Never logs.
 * Reject unsupported syntax rather than guessing the effective protected password. */
export function deriveFingerprintFile(source: string): string {
  try {
    const values: Record<string, string> = Object.create(null);
    for (const line of source.split(/\r?\n/)) {
      if (/^\s*(#.*)?$/.test(line)) continue;
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("[^"\r\n]*"|'[^'\r\n]*'|[^\s'"#][^'"#]*|)(?:\s*#.*)?\s*$/);
      if (!match || Object.hasOwn(values, match[1])) throw rejected();
      // parseEnv also recognizes backtick quoting. Reject it before parsing so
      // unsupported shell-like notation cannot be normalized into a valid secret.
      if (passwords.some(key => key === match[1]) && /\$|`/.test(match[2])) throw rejected();
      const parsed = parseEnv(line);
      const value = parsed[match[1]];
      if (value === undefined || /[\r\n\0]/.test(value)) throw rejected();
      values[match[1]] = value;
    }
    for (const [key, expected] of Object.entries({ POSTGRES_DB: 'zemaitija_dev',
      POSTGRES_USER: 'zemaitija_bootstrap', APP_DB_USER: 'zemaitija_app', MIGRATION_DB_USER: 'zemaitija_migrator' })) {
      if (values[key] !== expected) throw rejected();
    }
    if (values.POSTGRES_PORT !== undefined && values.POSTGRES_PORT !== '5432') throw rejected();
    if (values.NODE_ENV !== undefined && !['development', 'test'].includes(values.NODE_ENV)) throw rejected();
    if (values.STRIPE_AUTOMATION_ENABLED !== undefined && values.STRIPE_AUTOMATION_ENABLED !== 'false') throw rejected();
    const secrets = passwords.map(key => values[key]);
    if (secrets.some(value => !value || value.trim() !== value || /\$|`/.test(value)) || new Set(secrets).size !== 3) throw rejected();
    // If URLs are present, require consistency; never retrieve from URL fallbacks.
    for (const [key, role, password] of [['DATABASE_URL', 'zemaitija_app', secrets[1]],
      ['MIGRATION_DATABASE_URL', 'zemaitija_migrator', secrets[2]]]) {
      if (values[key] === undefined) continue;
      const url = new URL(values[key]);
      if (url.protocol !== 'postgresql:' || !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.port !== '5432' || url.pathname !== '/zemaitija_dev' || url.username !== role ||
        decodeURIComponent(url.password) !== password || url.search || url.hash) throw rejected();
    }
    return secrets.map((value, index) =>
      `${outputs[index]}=${createHash('sha256').update(value, 'utf8').digest('hex')}\n`).join('');
  } catch { throw rejected(); }
}

const inside = (parent: string, child: string) => {
  const path = relative(parent, child);
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`));
};

/** Explicit protected-file read/write entry; imports and pure tests do not invoke it.
 * Output parent must already be private and outside every Git working tree. */
export async function prepareProtectedFingerprints(outputParent: string,
  env: Readonly<Record<string, string | undefined>> = process.env): Promise<void> {
  try {
    if (Object.keys(env).some(key => !['PATH', 'HOME', 'LANG', 'LC_ALL'].includes(key))) throw rejected();
    if (!process.getuid || await realpath(process.cwd()) !== repository ||
      await realpath(fileURLToPath(import.meta.url)) !== join(repository, 'scripts/prepare-protected-db-fingerprints.ts')) throw rejected();
    const uid = process.getuid();
    if (!isAbsolute(outputParent) || resolve(outputParent) !== outputParent ||
      await realpath(outputParent) !== outputParent || inside(repository, outputParent)) throw rejected();
    const parent = await lstat(outputParent);
    if (!parent.isDirectory() || parent.uid !== uid || (parent.mode & 0o777) !== 0o700) throw rejected();
    for (let ancestor = outputParent; ; ancestor = dirname(ancestor)) {
      try { await access(join(ancestor, '.git')); throw rejected(); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw rejected(); }
      if (dirname(ancestor) === ancestor) break;
    }
    const input = await open(join(repository, '.env.local'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let content: string;
    try {
      const stat = await input.stat();
      if (!stat.isFile() || stat.uid !== uid || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
        stat.size < 1 || stat.size > 65536) throw rejected();
      // Read at most 64 KiB even if the file changes after stat().
      const buffer = Buffer.alloc(65537);
      try {
        let length = 0;
        while (length < buffer.length) {
          const read = await input.read(buffer, length, buffer.length - length, null);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length > 65536) throw rejected();
        content = deriveFingerprintFile(buffer.subarray(0, length).toString('utf8'));
      } finally { buffer.fill(0); }
    } finally { await input.close(); }
    const directory = await mkdtemp(join(outputParent, 'protected-fingerprints-'));
    const output = await open(join(directory, 'protected-fingerprints.env'),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = await output.stat();
      if (!stat.isFile() || stat.uid !== uid || (stat.mode & 0o777) !== 0o600) throw rejected();
      await output.writeFile(content, 'utf8');
      await output.sync();
    } finally { await output.close(); }
    // No cleanup-on-error: incomplete private output is retained for inspection.
  } catch { throw rejected(); }
}

// Node's direct-entry check keeps imports side-effect free. No environment loading.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length !== 3 || args[0] !== '--approved-read-protected-credentials' || args[1] !== '--output-parent') {
    process.stderr.write('FINGERPRINT_PREPARATION_REJECTED\n');
    process.exitCode = 1;
  } else {
    prepareProtectedFingerprints(args[2]).then(() => {
      process.stdout.write('Protected credential fingerprint preparation completed.\n');
    }).catch(() => {
      process.stderr.write('FINGERPRINT_PREPARATION_REJECTED\n');
      process.exitCode = 1;
    });
  }
}
