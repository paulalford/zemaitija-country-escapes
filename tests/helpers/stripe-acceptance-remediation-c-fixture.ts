import { vi } from 'vitest';
import { canonicalRunJson } from '../../src/server/stripe-acceptance-run';
import { financialEvidenceBinding, financialEvidenceDigest } from '../../src/server/stripe-acceptance-financial-evidence';
import { MONITOR_SOURCES, type AcceptanceMonitorReaders, type MonitorReview, type LockHistory } from '../../src/server/stripe-acceptance-monitoring';
import type { ShutdownTimeline } from '../../src/server/stripe-acceptance-shutdown';
import type { CapturePacket } from '../../src/server/stripe-acceptance-capture-provenance';
import { SUPERVISION_POLICY, supervisionBinding } from '../../src/server/stripe-acceptance-supervision';
import { captureReader, freshRunnerFixture, remediationBFixture } from './stripe-acceptance-remediation-b-fixture';
import { descriptorFixture } from './stripe-acceptance-integration-fixture';
import { syntheticId } from './stripe-verifier-fixture';

/** Detached in-memory records only. Existing helpers read explicitly named public
 * migration/proposal source bytes; no credential, OS lock, service or DB adapter. */
export async function remediationCFixture() {
  const runner = await freshRunnerFixture(), collector = await remediationBFixture(), { run, plan } = runner, now = runner.now;
  const binding = financialEvidenceBinding(run), integration = runner.integration;
  const root = '/var/lib/zec-acceptance', artifactRoot = `${root}/artifacts/${run.sourceDigest}`;
  const files: Record<string, string | Uint8Array> = {
    [`${root}/reviews/${run.runId}.json`]: canonicalRunJson(integration.approval),
    [`${root}/approved/${run.runId}/manifest.json`]: integration.manifestText,
    [`${root}/supplemental/${integration.approval.supplementalDigest}.sql`]: integration.supplemental,
    [`${artifactRoot}/index.json`]: canonicalRunJson({ version: 1, sourcePaths: integration.source.map(f => f.path), migrationPaths: integration.migrations.map(f => f.path) }),
  };
  for (const f of integration.source) files[`${artifactRoot}/source/${f.path}`] = f.bytes;
  for (const f of integration.migrations) files[`${artifactRoot}/migrations/${f.path}`] = f.bytes;
  // C joins the formerly separate B fixtures: one aggregate ledger includes
  // every supervised request plus bootstrap and the current controller account
  // check. Never sum the two overlapping sources or omit bootstrap charges.
  const budget = runner.packets.BUDGET.data as { requests: {
    id: string; invocationId: string; operation: string; reservedAt: number; dispatchedAt: number | null;
    settledAt: number | null; outcome: string; providerRequestId: string | null; authorityScope: string;
    authorityEvidenceRef: string; reservationEvidenceRef: string;
  }[] };
  for (const r of collector.supervision.requests) {
    const reserve = collector.supervision.journal.entries.find(e => e.event.kind === 'RESERVE' && e.event.requestId === r.requestId)!;
    budget.requests.push({ id: r.requestId, invocationId: r.invocationId, operation: r.operation, reservedAt: reserve.at,
      dispatchedAt: r.dispatchedAt, settledAt: r.settledAt, outcome: r.outcome, providerRequestId: r.providerRequestId,
      authorityScope: 'G3_EXECUTION', authorityEvidenceRef: 'synthetic-prior-execution-grant', reservationEvidenceRef: 'unbuilt' });
  }
  const earliest = Math.min(...budget.requests.filter(r => r.operation !== 'BOOTSTRAP_ACCOUNT').map(r => r.reservedAt));
  Object.assign(budget.requests.find(r => r.operation === 'BOOTSTRAP_ACCOUNT')!, { reservedAt: earliest - 10, dispatchedAt: earliest - 9, settledAt: earliest - 8 });
  const rebuildBudget = () => {
    const facts: { at: number; data: Record<string, unknown>; request: typeof budget.requests[number] }[] = [];
    for (const r of budget.requests) {
      facts.push({ at: r.reservedAt, data: { kind: 'RESERVE', requestId: r.id, invocationId: r.invocationId, operation: r.operation, deadline: r.reservedAt + 1000 }, request: r });
      if (r.dispatchedAt !== null) facts.push({ at: r.dispatchedAt, data: { kind: 'DISPATCH_INTENT', requestId: r.id }, request: r });
      if (r.settledAt !== null) facts.push({ at: r.settledAt, data: { kind: 'RESULT', requestId: r.id, outcome: r.outcome, providerRequestId: r.providerRequestId }, request: r });
    }
    let previous = '0'.repeat(64);
    const ledgerEntries = facts.sort((a, b) => a.at - b.at).map((f, i) => {
      const core = { sequence: i + 1, previous, runId: run.runId, manifestDigest: binding.manifestDigest, at: f.at, data: f.data };
      previous = financialEvidenceDigest(core);
      if (f.data.kind === 'RESERVE') f.request.reservationEvidenceRef = previous;
      return { ...core, digest: previous };
    });
    Object.assign(budget, { ledgerEntries, sequence: ledgerEntries.length, headDigest: previous, independentHeadDigest: previous });
    Object.assign(runner.packets.JOURNAL.data as object, { sequence: collector.supervision.journal.sequence,
      headDigest: collector.supervision.journal.headDigest, independentHeadDigest: collector.supervision.journal.headDigest });
  };
  rebuildBudget(); runner.reapprove();
  const descriptor = descriptorFixture(files);
  const timeline: ShutdownTimeline = { invocationId: null, deadline: null, complete: true, observations: [] };
  const locks: LockHistory = { invocationId: syntheticId(9010), observations: [
    { layer: 'HOST', observation: 'ACQUIRED', at: now() - 1000, ownerId: 'synthetic-host-controller', lockKey: SUPERVISION_POLICY.hostLock, backendPid: null, sessionId: null, validUntil: now() + 59000 },
    { layer: 'DATABASE', observation: 'ACQUIRED', at: now() - 990, ownerId: 'synthetic-host-controller', lockKey: supervisionBinding(run).controlLockKey, backendPid: 77, sessionId: 'pg-session-77', validUntil: now() + 59000 },
  ] };
  const data = { SERVICE: { identity: SUPERVISION_POLICY.serviceIdentity, uid: 1001, group: SUPERVISION_POLICY.serviceIdentity, gid: 1001, privileged: false, credentialMode: 'TEST_ONLY', serviceEnabled: false, timerEnabled: false, cleanup: 'SETTLED', resources: 'KNOWN' },
    PROCESS: timeline, LOCK_HISTORY: locks };
  const packets = Object.fromEntries(MONITOR_SOURCES.map((k): [typeof MONITOR_SOURCES[number], CapturePacket] => [k, {
    kind: 'independent-acceptance-capture-v1', binding, sourceSystem: `ACCEPTANCE_MONITOR_${k}`, readerId: `independent-monitor-${k}`,
    recordId: `monitor-record-${k}`, evidenceClass: 'SIMULATED', windowStart: Date.parse(run.notBefore), windowEnd: Date.parse(run.expiresAt), capturedAt: now(),
    completeness: 'COMPLETE', uncertainty: 'SETTLED', diagnostics: [], items: [{ key: k, digest: financialEvidenceDigest(data[k]), capturedAt: now(),
      origin: 'INDEPENDENT_OBSERVATION', transaction: null, commitEvidenceRef: null, completeness: 'COMPLETE', uncertainty: 'SETTLED', diagnostics: [] }], data: data[k],
  }])) as Record<typeof MONITOR_SOURCES[number], CapturePacket>;
  const authorityRecord: MonitorReview = { kind: 'independent-acceptance-monitor-review-v1', binding, planDigest: plan.planDigest,
    reviewer: 'independent-monitor-controller', evidenceClass: 'SIMULATED', notBefore: Date.parse(run.notBefore), expiresAt: Date.parse(run.expiresAt),
    runnerReviewDigest: financialEvidenceDigest(runner.authorityRecord), collectorReviewDigest: financialEvidenceDigest(collector.authorityRecord),
    pins: Object.fromEntries(MONITOR_SOURCES.map(k => [k, { sourceSystem: packets[k].sourceSystem, readerId: packets[k].readerId, recordId: packets[k].recordId, digest: financialEvidenceDigest(packets[k]) }])) as MonitorReview['pins'] };
  const controller = new AbortController();
  const readers: AcceptanceMonitorReaders = { runner: { authority: runner.authority, sources: runner.sources }, collectors: { authority: collector.authority, sources: collector.sources },
    authority: captureReader(vi.fn(async () => structuredClone(authorityRecord))),
    sources: Object.fromEntries(MONITOR_SOURCES.map(k => [k, captureReader(vi.fn(async () => structuredClone(packets[k])))])), now, signal: controller.signal };
  const reapprove = () => {
    rebuildBudget(); runner.reapprove(); collector.reapprove();
    authorityRecord.runnerReviewDigest = financialEvidenceDigest(runner.authorityRecord);
    authorityRecord.collectorReviewDigest = financialEvidenceDigest(collector.authorityRecord);
    for (const k of MONITOR_SOURCES) {
      packets[k].items[0].digest = financialEvidenceDigest(packets[k].data);
      authorityRecord.pins[k].digest = financialEvidenceDigest(packets[k]);
    }
  };
  return { run, plan, runner, collector, integration, files, descriptor, readers, authorityRecord, packets, timeline, locks, data, reapprove, controller,
    now, advance: (ms: number) => { runner.advance(ms); collector.advance(ms); }, request: { mode: 'source-only', profileId: run.profileId, runId: run.runId } };
}
