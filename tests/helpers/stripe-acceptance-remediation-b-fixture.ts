import { vi } from 'vitest';
import pinned from '../../scripts/stripe-automation-migration-manifest.json';
import { financialEvidenceBinding, financialEvidenceDigest } from '../../src/server/stripe-acceptance-financial-evidence';
import { captureSubjects, CAPTURE_SOURCES, type CollectorReview } from '../../src/server/stripe-acceptance-collectors';
import { FRESH_RUNNER_DEPENDENCIES, RUNNER_OBSERVATIONS, type RunnerReview, type RunnerObservation } from '../../src/server/stripe-acceptance-fresh-runner';
import type { CapturePacket, CapturePin, IndependentCaptureReader } from '../../src/server/stripe-acceptance-capture-provenance';
import { supervisionBinding, SUPERVISION_POLICY } from '../../src/server/stripe-acceptance-supervision';
import { EVIDENCE_CHANNELS } from '../../src/server/stripe-acceptance-verifier-evidence';
import { verifierFixture, syntheticId } from './stripe-verifier-fixture';
import { integrationFixture } from './stripe-acceptance-integration-fixture';

export const captureReader = (read: IndependentCaptureReader['read']): IndependentCaptureReader => ({ kind: 'acceptance-capture-read-only-v1', read });
const pin = (p: CapturePacket): CapturePin => ({ sourceSystem: p.sourceSystem, readerId: p.readerId, recordId: p.recordId, digest: financialEvidenceDigest(p) });
export async function remediationBFixture() {
  const f = await verifierFixture();
  for (const [index, m] of f.mappings.entries()) {
    const old = m.transactionId; m.transactionId = `pg-xid8:${3000 + index}`;
    const d = f.database.fixtures[index];
    for (const h of d.claimHistory) if (h.transactionId === old) h.transactionId = m.transactionId;
    for (const a of d.audits) if (a.transactionId === old) a.transactionId = m.transactionId;
  }
  f.reanchor();
  const binding = financialEvidenceBinding(f.run);
  const packets = Object.fromEntries(EVIDENCE_CHANNELS.map(channel => {
    const p: CapturePacket = { kind: 'independent-acceptance-capture-v1', binding,
      sourceSystem: CAPTURE_SOURCES[channel], readerId: f.review.anchors[channel].producer, recordId: `capture-${channel}`,
      evidenceClass: 'SIMULATED', windowStart: f.review.notBefore, windowEnd: f.review.expiresAt, capturedAt: f.now(),
      completeness: 'COMPLETE', uncertainty: 'SETTLED', diagnostics: [], data: f.envelopes[channel],
      items: captureSubjects(channel, f.envelopes[channel].data).map((s, index) => ({ key: s.key, digest: financialEvidenceDigest(s.value),
        capturedAt: f.now(), origin: s.original ? 'ORIGINAL_TRANSACTION' : 'INDEPENDENT_OBSERVATION',
        transaction: s.transaction ?? (s.transactionId === null ? null : { mechanism: 'POSTGRES_XID8', xid8: s.transactionId.slice(8), backendPid: 80 + index, transactionId: s.transactionId }),
        commitEvidenceRef: s.commitEvidenceRef ?? (s.original ? `original-booking-commit-${index}` : null),
        completeness: 'COMPLETE', uncertainty: 'SETTLED', diagnostics: [] })) };
    return [channel, p];
  })) as Record<typeof EVIDENCE_CHANNELS[number], CapturePacket>;
  const authorityRecord: CollectorReview = { kind: 'independent-capture-review-v1', review: f.review,
    pins: Object.fromEntries(EVIDENCE_CHANNELS.map(c => [c, pin(packets[c])])) as CollectorReview['pins'] };
  const sources = Object.fromEntries(EVIDENCE_CHANNELS.map(c => [c, captureReader(vi.fn(async () => structuredClone(packets[c])))]));
  const authority = captureReader(vi.fn(async () => structuredClone(authorityRecord)));
  // Deliberate simulated producer rebuild + independent re-review for negative
  // tests only. Collection code never calls this or invents capture provenance.
  const reapprove = (rebuildItems = true) => {
    f.reanchor();
    for (const c of EVIDENCE_CHANNELS) {
      packets[c].data = f.envelopes[c];
      if (rebuildItems) {
        const old = new Map(packets[c].items.map(i => [i.key, i]));
        packets[c].items = captureSubjects(c, f.envelopes[c].data).map(s => ({ ...old.get(s.key)!, digest: financialEvidenceDigest(s.value) }));
      }
      authorityRecord.pins[c] = pin(packets[c]);
    }
  };
  return { ...f, packets, authorityRecord, sources, authority, reapprove };
}

export async function freshRunnerFixture(scope: 'SOURCE_REVIEW' | 'G3_EXECUTION' = 'SOURCE_REVIEW') {
  const base = await remediationBFixture(), { run } = base, integration = integrationFixture(scope, run), now = base.now;
  const binding = financialEvidenceBinding(run), t = run.target, invocationId = syntheticId(9010), bootstrapId = syntheticId(9011), startupId = syntheticId(9012);
  const journal = { sequence: 0, headDigest: '0'.repeat(64), protectedHeadId: 'protected-journal-head', independentHeadDigest: '0'.repeat(64), interrupted: false, fenced: false };
  const data: Record<RunnerObservation, unknown> = {
    APPROVAL: { scope: 'G3_EXECUTION', approvalReference: run.approvalReference, hostAuthority: 'INDEPENDENT_PROTECTED_CONTROLLER', revoked: false },
    RESERVATION: { reservationId: syntheticId(9013), revision: 1, resources: [t.project, t.container, t.network, t.volume, t.database, t.containerId, t.networkId, t.volumeIdentity], commitEvidenceRef: 'independent-reservation-commit', exclusive: true, state: 'RESERVED' },
    DOCKER: { ...t, running: true, privileged: false, addedCapabilities: 0, internal: true, driver: 'bridge', soleNetwork: true, soleContainer: true, dedicatedVolume: true, unexpectedMounts: false, publishedPorts: 0, independentCredentials: true },
    POSTGRES: { database_name: t.database, role_name: t.role, session_role: t.role, database_owner: t.owner, server_address: t.address, server_port: 5432, server_version: 170006,
      in_recovery: false, superuser: false, create_database: false, create_role: false, replication: false, bypass_rls: false, has_memberships: false, database_create: false, schema_create: false,
      recoveryMetadataUpdate: false, publicRecoveryExecute: false, recoveryDefinerOwner: t.owner, recoverySearchPath: 'pg_catalog, public', recoveryGuardsValid: true,
      inventoryExclusionValid: true, financialConstraintsValid: true, readerMutationPrivileges: false, migrationDigest: run.migrationDigest, ledger: pinned.entries.map(e => ({ hash: e.sha256, createdAt: e.when })) },
    STRIPE: { identity: { ...run.stripe, livemode: false }, bootstrapRequestId: bootstrapId, startupRequestId: startupId },
    JOURNAL: journal,
    BUDGET: { protectedHeadId: journal.protectedHeadId, headDigest: journal.headDigest, bootstrapIncludedInTotal: true, fenced: false,
      requests: [bootstrapId, startupId].map((id, i) => ({ id, invocationId, operation: i ? 'STARTUP_ACCOUNT' : 'BOOTSTRAP_ACCOUNT', reservedAt: now() - 200 + i * 50,
        dispatchedAt: now() - 190 + i * 50, settledAt: now() - 180 + i * 50, outcome: 'KNOWN', providerRequestId: `req_synthetic${i}`, authorityScope: i ? 'G3_EXECUTION' : 'G2_PREFLIGHT', authorityEvidenceRef: `protected-approval-${i}`, reservationEvidenceRef: `protected-budget-${i}` })) },
    HOST_LOCK: { invocationId, observation: 'HELD', continuousSince: now() - 1000, validUntil: now() + 59000, lockKey: SUPERVISION_POLICY.hostLock, backendPid: null, sessionId: null },
    DATABASE_LOCK: { invocationId, observation: 'HELD', continuousSince: now() - 990, validUntil: now() + 59000, lockKey: supervisionBinding(run).controlLockKey, backendPid: 77, sessionId: 'pg-session-77' },
    DEPENDENCIES: { sourceDigest: run.sourceDigest, targetDigest: binding.targetDigest, database: t.database, host: t.address, port: 5432, role: t.role, max: 1, pipeline: false,
      connectionTimeoutMillis: 1000, statement_timeout: 1000, lock_timeout: 500, idle_in_transaction_session_timeout: 1000, transaction_timeout: 10000,
      sharedPoolFallback: false, contracts: FRESH_RUNNER_DEPENDENCIES },
  };
  // Exact outer fact shape used by anchoredEvidence/durableProviderBudget.
  const budget = data.BUDGET as { requests: { id: string; invocationId: string; operation: string; reservedAt: number; dispatchedAt: number; settledAt: number; outcome: string; providerRequestId: string; reservationEvidenceRef: string }[] };
  const ledgerEntries: unknown[] = []; let previous = '0'.repeat(64);
  for (const r of budget.requests) {
    const facts = [
      { at: r.reservedAt, data: { kind: 'RESERVE', requestId: r.id, invocationId: r.invocationId, operation: r.operation, deadline: r.reservedAt + 1000 } },
      { at: r.dispatchedAt, data: { kind: 'DISPATCH_INTENT', requestId: r.id } },
      { at: r.settledAt, data: { kind: 'RESULT', requestId: r.id, outcome: r.outcome, providerRequestId: r.providerRequestId } },
    ];
    for (const fact of facts) {
      const core = { sequence: ledgerEntries.length + 1, previous, runId: run.runId, manifestDigest: binding.manifestDigest, ...fact };
      previous = financialEvidenceDigest(core); ledgerEntries.push({ ...core, digest: previous });
      if (fact.at === r.reservedAt) r.reservationEvidenceRef = previous;
    }
  }
  Object.assign(data.BUDGET as object, { ledgerEntries, sequence: ledgerEntries.length, headDigest: previous, independentHeadDigest: previous, protectedHeadId: 'protected-budget-head' });
  const packets = Object.fromEntries(RUNNER_OBSERVATIONS.map((kind): [RunnerObservation, CapturePacket] => [kind, { kind: 'independent-acceptance-capture-v1', binding,
    sourceSystem: `FRESH_RUNNER_${kind}`, readerId: `independent-${kind}`, recordId: `record-${kind}`, evidenceClass: 'SIMULATED',
    windowStart: Date.parse(run.notBefore), windowEnd: Date.parse(run.expiresAt), capturedAt: now(), completeness: 'COMPLETE', uncertainty: 'SETTLED', diagnostics: [],
    items: [{ key: kind, digest: financialEvidenceDigest(data[kind]), capturedAt: now(), origin: 'INDEPENDENT_OBSERVATION', transaction: null, commitEvidenceRef: null,
      completeness: 'COMPLETE', uncertainty: 'SETTLED', diagnostics: [] }], data: data[kind] }])) as Record<RunnerObservation, CapturePacket>;
  const authorityRecord: RunnerReview = { kind: 'independent-fresh-runner-review-v1', binding, reviewer: 'independent-host-controller', approvalReference: run.approvalReference,
    evidenceClass: 'SIMULATED', notBefore: integration.approval.notBefore, expiresAt: integration.approval.expiresAt,
    pins: Object.fromEntries(RUNNER_OBSERVATIONS.map(k => [k, pin(packets[k])])) as RunnerReview['pins'] };
  const sources = Object.fromEntries(RUNNER_OBSERVATIONS.map(k => [k, captureReader(vi.fn(async () => structuredClone(packets[k])))]));
  const authority = captureReader(vi.fn(async () => structuredClone(authorityRecord)));
  const reapprove = () => { for (const k of RUNNER_OBSERVATIONS) { packets[k].items[0].digest = financialEvidenceDigest(packets[k].data); authorityRecord.pins[k] = pin(packets[k]); } };
  const request = { mode: 'source-only', profileId: run.profileId, runId: run.runId };
  return { ...base, integration, packets, sources, authority, authorityRecord, request, reapprove };
}
