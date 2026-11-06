import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { canonicalRunJson, freshAcceptanceNames, reviewAcceptanceManifest, runManifestDigest,
  type ArtifactFile, type SealedAcceptanceRun } from './stripe-acceptance-run';
import type { ProtectedHostReader, ProtectedHostText, ReviewedHostArtifactReader } from './stripe-acceptance-host';

const hash = z.string().regex(/^[a-f0-9]{64}$/), id = z.uuid();
const time = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reject = (): never => { throw Error('ACCEPTANCE_TRUST_REJECTED'); };
export const acceptanceDigest = (value: unknown) => runManifestDigest(canonicalRunJson(value));
const equal = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);
export const ACCEPTANCE_PROTECTED_ROOT = '/var/lib/zec-acceptance';

/** Descriptor-only port. The provider must open '/' once, never follow a link,
 * and resolve every component relative to the preceding directory descriptor.
 * No default filesystem, credential reader or environment fallback exists. */
export interface ProtectedDescriptor {
  stat(): Promise<{ uid: number; mode: number; type: 'directory' | 'file' | 'other'; links: number;
    identity: string; size: number; change: string }>;
  child(name: string, flags: Readonly<{ noFollow: true; directory: boolean; readOnly: true }>): Promise<ProtectedDescriptor>;
  read(maxBytes: number): Promise<Uint8Array>;
  close(): Promise<void>;
}
export interface ProtectedDescriptorIO { root(): Promise<ProtectedDescriptor> }

/** Walks and validates every parent through held descriptors; rejects symlinks,
 * writable parents, replacement/mutation, hard links and oversized records. */
async function protectedBytes(path: string, io: ProtectedDescriptorIO, limit: number) {
  const handles: ProtectedDescriptor[] = [];
  if (!path.startsWith(`${ACCEPTANCE_PROTECTED_ROOT}/`) || path.split('/').slice(1).some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '.' || p === '..')) return reject();
  try {
    let current = await io.root(); handles.push(current);
    const parts = path.slice(1).split('/');
    for (const [index, part] of parts.entries()) {
      const stat = await current.stat();
      if (stat.uid !== 0 || stat.type !== 'directory' || stat.mode & 0o022) return reject();
      current = await current.child(part, { noFollow: true, directory: index < parts.length - 1, readOnly: true });
      handles.push(current);
    }
    const before = await current.stat();
    if (before.uid !== 0 || before.type !== 'file' || ![0o400, 0o600].includes(before.mode) || before.links !== 1 ||
      before.size < 0 || before.size > limit) return reject();
    const bytes = Uint8Array.from(await current.read(limit)), after = await current.stat();
    if (!equal(before, after) || bytes.byteLength !== before.size) return reject();
    return { bytes, protection: { path, ownerUid: 0 as const, mode: before.mode as 0o400 | 0o600,
      regular: true as const, symlink: false as const, links: 1 as const, parentsProtected: true as const, openedNoFollow: true as const } };
  } catch { return reject(); }
  finally {
    const cleanup = await Promise.allSettled(handles.reverse().map(handle => handle.close()));
    if (cleanup.some(result => result.status === 'rejected')) reject();
  }
}
function canonicalText(bytes: Uint8Array) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (canonicalRunJson(JSON.parse(text)) !== text) return reject();
  return text;
}
export function protectedAcceptanceReader(runId: string, io: ProtectedDescriptorIO): ProtectedHostReader {
  freshAcceptanceNames(runId);
  const allowed = new Set([`${ACCEPTANCE_PROTECTED_ROOT}/approved/${runId}/manifest.json`,
    `${ACCEPTANCE_PROTECTED_ROOT}/reviews/${runId}.json`, `${ACCEPTANCE_PROTECTED_ROOT}/inventory.json`]);
  return { async read(path): Promise<ProtectedHostText> {
    if (!allowed.has(path)) return reject();
    const { bytes, protection } = await protectedBytes(path, io, 1024 * 1024);
    return { protection, settlement: 'SETTLED', text: canonicalText(bytes) };
  } };
}
export function protectedArtifactReader(io: ProtectedDescriptorIO): ReviewedHostArtifactReader {
  return { async read(path) {
    const match = path.match(/^\/var\/lib\/zec-acceptance\/artifacts\/([a-f0-9]{64})\/index\.json$/);
    if (!match) return reject();
    const { bytes, protection } = await protectedBytes(path, io, 1024 * 1024);
    const index = z.object({ version: z.literal(1), sourcePaths: z.array(z.string()).min(1).max(4096),
      migrationPaths: z.array(z.string()).length(38) }).strict().parse(JSON.parse(canonicalText(bytes)));
    let total = bytes.byteLength;
    async function files(kind: 'source' | 'migrations', paths: string[]) {
      let previous = '';
      const result: { path: string; bytes: Uint8Array<ArrayBuffer> }[] = [];
      for (const file of paths) {
        if (file <= previous || !/^[A-Za-z0-9_./-]+$/.test(file) || file.split('/').some(p => p === '.' || p === '..' || p === '' || p === 'node_modules')) return reject();
        previous = file;
        const data = await protectedBytes(`${ACCEPTANCE_PROTECTED_ROOT}/artifacts/${match![1]}/${kind}/${file}`, io, 4 * 1024 * 1024);
        total += data.bytes.byteLength;
        if (total > 32 * 1024 * 1024) return reject();
        result.push({ path: file, bytes: data.bytes });
      }
      return result;
    }
    return { protection, settlement: 'SETTLED', source: await files('source', index.sourcePaths),
      migrations: await files('migrations', index.migrationPaths) };
  } };
}

export const integrationApprovalSchema = z.object({ kind: z.literal('fresh-integration-review-v1'), runId: id,
  manifestDigest: hash, sourceDigest: hash, migrationDigest: hash, supplementalDigest: hash,
  approvalReference: z.string().regex(/^review:stage-2c:[a-z0-9][a-z0-9-]{15,79}$/),
  sourcePaths: z.array(z.string()).min(1).max(4096), dependencyClosureReviewed: z.literal(true),
  profileId: z.literal('stage-2c-fresh-pg17-v1'), supplementalProfile: z.literal('stage2c-evidence-v1-proposal'),
  reviewer: z.string().min(1).max(120), notBefore: time, expiresAt: time,
  scope: z.enum(['SOURCE_REVIEW', 'G2_PREFLIGHT', 'G3_EXECUTION']),
  bootstrapRequests: z.literal(1), bootstrapIncludedInTotal: z.literal(true),
}).strict();
export type IntegrationApproval = z.infer<typeof integrationApprovalSchema>;
export type ReviewedFreshIntegration = Readonly<{ manifest: SealedAcceptanceRun; approval: Readonly<IntegrationApproval> }>;
const issued = new WeakSet<object>();
/** Complete exact paths AND bytes must be independently reviewed. The closure
 * boolean is an attributable reviewer assertion, not import-graph discovery. */
export function reviewFreshIntegration(text: string, raw: unknown, source: readonly ArtifactFile[],
  migrations: readonly ArtifactFile[], supplemental: Uint8Array): ReviewedFreshIntegration {
  try {
    const approval = integrationApprovalSchema.parse(raw);
    if (createHash('sha256').update(supplemental).digest('hex') !== approval.supplementalDigest ||
      approval.expiresAt <= approval.notBefore) return reject();
    const manifest = reviewAcceptanceManifest(text, { issuer: 'protected-host-review-v1',
      runId: approval.runId, approvalReference: approval.approvalReference, manifestDigest: approval.manifestDigest,
      sourceDigest: approval.sourceDigest, migrationDigest: approval.migrationDigest, sourcePaths: approval.sourcePaths }, source, migrations);
    if (approval.notBefore < Date.parse(manifest.notBefore) || approval.expiresAt > Date.parse(manifest.expiresAt)) return reject();
    Object.freeze(approval.sourcePaths); Object.freeze(approval);
    const result = Object.freeze({ manifest, approval }); issued.add(result); return result;
  } catch { return reject(); }
}
export function requireReviewedFreshIntegration(value: ReviewedFreshIntegration, now: number,
  scope?: 'G2_PREFLIGHT' | 'G3_EXECUTION'): void {
  if (!issued.has(value) || !Number.isSafeInteger(now) || now < value.approval.notBefore || now >= value.approval.expiresAt ||
    scope && value.approval.scope !== scope) return reject();
}
/** Only fixed protected records enter review. No HTTP/env paths or credential
 * files are accepted, and no operational dependency is constructed. */
export async function loadProtectedFreshIntegration(runId: string, io: ProtectedDescriptorIO, now: () => number) {
  const records = protectedAcceptanceReader(runId, io);
  const approval = integrationApprovalSchema.parse(JSON.parse((await records.read(`${ACCEPTANCE_PROTECTED_ROOT}/reviews/${runId}.json`)).text));
  if (approval.runId !== runId) return reject();
  const manifest = await records.read(`${ACCEPTANCE_PROTECTED_ROOT}/approved/${runId}/manifest.json`);
  const artifact = await protectedArtifactReader(io).read(`${ACCEPTANCE_PROTECTED_ROOT}/artifacts/${approval.sourceDigest}/index.json`);
  const supplement = await protectedBytes(`${ACCEPTANCE_PROTECTED_ROOT}/supplemental/${approval.supplementalDigest}.sql`, io, 4 * 1024 * 1024);
  const result = reviewFreshIntegration(manifest.text, approval, artifact.source, artifact.migrations, supplement.bytes);
  requireReviewedFreshIntegration(result, now());
  return result;
}
export function integrationResources(value: ReviewedFreshIntegration): readonly string[] {
  const t = value.manifest.target;
  return Object.freeze([t.project, t.container, t.network, t.volume, t.database, t.containerId, t.networkId, t.volumeIdentity]);
}

const inventorySchema = z.object({ revision: z.number().int().nonnegative(), complete: z.literal(true),
  reservations: z.array(z.object({ runId: id, manifestDigest: hash, resources: z.array(z.string()).length(8),
    state: z.enum(['RESERVED', 'RETIRED']) }).strict()).max(4096) }).strict();
export type ResourceInventory = z.infer<typeof inventorySchema>;
/** This belongs to an independent host controller, never the fresh database whose
 * creation it authorises. CAS must fsync the record and directory before DURABLE. */
export interface AtomicInventoryPort {
  read(): Promise<unknown>;
  compareAndSwap(expectedRevision: number, next: ResourceInventory): Promise<'DURABLE' | 'CONFLICT' | 'UNKNOWN'>;
  fence(runId: string): Promise<void>;
}
export async function reserveFreshResources(value: ReviewedFreshIntegration, port: AtomicInventoryPort, now: () => number) {
  const runId = value.manifest.runId;
  try {
    requireReviewedFreshIntegration(value, now(), 'G2_PREFLIGHT');
    const current = inventorySchema.parse(await port.read()), resources = [...integrationResources(value)];
    const historical = current.reservations.flatMap(r => r.resources);
    if (new Set(current.reservations.map(r => r.runId)).size !== current.reservations.length ||
      new Set(historical).size !== historical.length) throw Error('INVENTORY_AMBIGUOUS');
    if (current.reservations.some(r => r.runId === runId || r.resources.some(x => resources.includes(x)))) return 'COLLISION' as const;
    requireReviewedFreshIntegration(value, now(), 'G2_PREFLIGHT');
    const next = inventorySchema.parse({ ...current, revision: current.revision + 1,
      reservations: [...current.reservations, { runId, manifestDigest: value.approval.manifestDigest, resources, state: 'RESERVED' }] });
    const ack = await port.compareAndSwap(current.revision, next);
    if (ack === 'UNKNOWN') { await port.fence(runId); return 'UNKNOWN' as const; }
    return ack === 'DURABLE' ? 'RESERVED' as const : 'CONFLICT' as const;
  } catch { await port.fence(runId); return 'UNKNOWN' as const; }
}
