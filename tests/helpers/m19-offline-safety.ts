import { afterEach, vi } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import dgram from 'node:dgram';
import dns from 'node:dns';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import workerThreads from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';

// Hoisted mocks reject real constructors even when an import itself is inert.
// Individual reviewed suites may replace these with their own in-memory doubles.
vi.mock('pg', () => {
  class Forbidden { constructor() { throw Error('M19_REAL_DATABASE_CONSTRUCTOR_FORBIDDEN'); } }
  return { Pool: Forbidden, Client: Forbidden, default: { Pool: Forbidden, Client: Forbidden } };
});
vi.mock('stripe', async original => {
  const actual = await original<typeof import('stripe')>();
  return { ...actual, default: new Proxy(actual.default, {
    construct() { throw Error('M19_REAL_PROVIDER_CONSTRUCTOR_FORBIDDEN'); },
  }) };
});
vi.mock('../../src/db/client', () => { throw Error('M19_SHARED_CLIENT_FORBIDDEN'); });

const attempts: string[] = [];
function forbidden(kind: string): never {
  attempts.push(kind);
  throw Error(`M19_OFFLINE_${kind}_FORBIDDEN`);
}
function deny(kind: string) { return () => forbidden(kind); }

// Direct assignments survive vi.restoreAllMocks/unstubAllGlobals in incumbent suites.
net.Socket.prototype.connect = deny('NETWORK') as typeof net.Socket.prototype.connect;
net.Server.prototype.listen = deny('LISTENER') as typeof net.Server.prototype.listen;
tls.connect = deny('NETWORK') as typeof tls.connect;
http.request = deny('NETWORK') as typeof http.request;
http.get = deny('NETWORK') as typeof http.get;
https.request = deny('NETWORK') as typeof https.request;
https.get = deny('NETWORK') as typeof https.get;
http2.connect = deny('NETWORK') as typeof http2.connect;
dgram.createSocket = deny('NETWORK') as typeof dgram.createSocket;
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse'] as const)
  Object.defineProperty(dns, key, { value: deny('DNS'), writable: true, configurable: true });
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6', 'reverse'] as const)
  Object.defineProperty(dns.promises, key, { value: deny('DNS'), writable: true, configurable: true });
for (const key of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const)
  Object.defineProperty(childProcess, key, { value: deny('PROCESS'), writable: true, configurable: true });
workerThreads.Worker = new Proxy(workerThreads.Worker, { construct: deny('PROCESS') });
process.loadEnvFile = deny('ENV_FILE');
process.kill = deny('PROCESS') as typeof process.kill;
globalThis.fetch = deny('NETWORK');

/** Permit ordinary reviewed source/asset reads, never private configuration.
 * Synthetic filesystem mocks in the prerequisite suite do not reach these ports. */
export function privatePath(path: unknown): boolean {
  let text = path instanceof URL ? path.pathname : Buffer.isBuffer(path) ? path.toString() : typeof path === 'string' ? path : '';
  try { text = decodeURIComponent(text); } catch { return true; }
  return /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.aws|\.ssh|\.codex|\.git)(?:\/|$)|(?:credential|secret|backup)|\.(?:bak|pem|key)$/i.test(text);
}
for (const key of ['readFileSync', 'readFile', 'openSync', 'open', 'createReadStream'] as const) {
  const original = fs[key] as (...args: unknown[]) => unknown;
  Object.defineProperty(fs, key, { configurable: true, writable: true,
    value: (...args: unknown[]) => {
      if (privatePath(args[0])) forbidden('PRIVATE_FILE');
      if ((key === 'openSync' || key === 'open') && !readOnlyFlag(args[1])) forbidden('FILE_WRITE');
      return original(...args);
    } });
}
for (const key of ['readFile', 'open'] as const) {
  const original = fs.promises[key] as (...args: unknown[]) => unknown;
  Object.defineProperty(fs.promises, key, { configurable: true, writable: true,
    value: (...args: unknown[]) => {
      if (privatePath(args[0])) forbidden('PRIVATE_FILE');
      if (key === 'open' && !readOnlyFlag(args[1])) forbidden('FILE_WRITE');
      return original(...args);
    } });
}
function readOnlyFlag(flag: unknown) { return flag === undefined || flag === 'r' || flag === 'rs' || flag === fs.constants.O_RDONLY; }
for (const key of ['writeFileSync', 'writeFile', 'appendFileSync', 'appendFile', 'createWriteStream',
  'mkdirSync', 'mkdir', 'mkdtempSync', 'mkdtemp', 'rmSync', 'rm', 'unlinkSync', 'unlink', 'renameSync', 'rename',
  'copyFileSync', 'copyFile', 'truncateSync', 'truncate'] as const)
  Object.defineProperty(fs, key, { value: deny('FILE_WRITE'), writable: true, configurable: true });
for (const key of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'rm', 'unlink', 'rename', 'copyFile', 'truncate'] as const)
  Object.defineProperty(fs.promises, key, { value: deny('FILE_WRITE'), writable: true, configurable: true });
syncBuiltinESMExports();

/** Only the safety suite uses this to consume intentionally rejected probes. */
export function rejectedProbe(probe: () => unknown) {
  const start = attempts.length;
  try { probe(); throw Error('M19_SAFETY_PROBE_DID_NOT_REJECT'); }
  catch (error) {
    if (!(error instanceof Error) || !/^M19_OFFLINE_.*_FORBIDDEN$/.test(error.message)) throw error;
  } finally { attempts.splice(start); }
}
afterEach(() => {
  const unexpected = attempts.splice(0);
  if (unexpected.length) throw Error(`M19_UNEXPECTED_RESOURCE_ATTEMPT:${unexpected.join(',')}`);
});
