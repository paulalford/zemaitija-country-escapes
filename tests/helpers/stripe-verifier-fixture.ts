import type { AtomicHandoffOwnership, AtomicHandoffPlan, HandoffCommitObservation } from '../../src/server/stripe-acceptance-handoff-evidence';
import { readFileSync } from 'node:fs';
import pinned from '../../scripts/stripe-automation-migration-manifest.json';
import { canonicalRunJson, runManifestDigest, sealAcceptanceRun } from '../../src/server/stripe-acceptance-run';
import { ACCEPTANCE_SCENARIOS, planAcceptanceFixtures } from '../../src/server/stripe-acceptance-fixtures';
import { supervisionBinding, type SupervisionEvent } from '../../src/server/stripe-acceptance-supervision';
import { EVIDENCE_CHANNELS, type AcceptanceEvidenceReader, type AcceptanceEvidenceReaders, type DatabaseEvidence,
  type EvidenceEnvelope, type ProviderEvidence, type RuntimeMapping, type SupervisionEvidence, type VerifierReview,
  type WebhookEvidence } from '../../src/server/stripe-acceptance-verifier-evidence';
import { verifyAcceptanceEvidence } from '../../src/server/stripe-acceptance-verifier';
import { FINANCIAL_EFFECTS, financialEvidenceBinding, financialEvidenceDigest, type FinancialTransactionEvidence } from '../../src/server/stripe-acceptance-financial-evidence';
import { scenarioRun } from './stripe-acceptance-scenario-fixture';

export const syntheticId = (n: number) => `80000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const evidenceHash = (value: unknown) => runManifestDigest(canonicalRunJson(value));
export const readOnly = (read: AcceptanceEvidenceReader['read']): AcceptanceEvidenceReader => ({ kind: 'acceptance-verifier-read-only-v1', read });

/** Synthetic source/migration bytes only. Never constructs resources or domain writers. */
function verifierRun() {
  const base = scenarioRun(), m = { ...base, operations: ['dispatch-checkout', 'ingest-payment-webhook', 'prepare-booking', 'reconcile-payment', 'verify-read-only'] };
  const text = canonicalRunJson(m), manifestDigest = runManifestDigest(text);
  const source = [{ path: 'src/server/synthetic.ts', bytes: Buffer.from('synthetic source\n') }];
  const migrations = ['scripts/stripe-automation-migration-manifest.json', 'drizzle/meta/_journal.json',
    ...pinned.entries.map(e => `drizzle/${e.tag}.sql`)].sort().map(path => ({ path, bytes: readFileSync(path) }));
  return sealAcceptanceRun(text, { now: '2035-01-01T00:01:00.000Z', authority: { issuer: 'protected-host-review-v1',
    runId: m.runId, approvalReference: m.approvalReference, manifestDigest, sourceDigest: m.sourceDigest,
    migrationDigest: m.migrationDigest, sourcePaths: source.map(f => f.path) }, history: { complete: true, runIds: [], resourceIdentities: [] },
    docker: { ...m.target, running: true, privileged: false, addedCapabilities: 0, internal: true, driver: 'bridge', soleNetwork: true,
      soleContainer: true, dedicatedVolume: true, unexpectedMounts: false, publishedPorts: 0, independentCredentials: true },
    database: { database_name: m.target.database, role_name: m.target.role, session_role: m.target.role, database_owner: m.target.owner,
      server_address: m.target.address, server_port: 5432, server_version: 170006, in_recovery: false, superuser: false, create_database: false,
      create_role: false, replication: false, bypass_rls: false, has_memberships: false, database_create: false, schema_create: false,
      recoveryMetadataUpdate: false, publicRecoveryExecute: false, recoveryDefinerOwner: m.target.owner, recoverySearchPath: 'pg_catalog, public',
      recoveryGuardsValid: true, inventoryExclusionValid: true, financialConstraintsValid: true, migrationCount: 36, migrationDigest: m.migrationDigest },
    stripe: { ...m.stripe, livemode: false } }, source, migrations);
}

export async function verifierFixture() {
  const run = verifierRun(), start = Date.parse(run.notBefore) + 60_000;
  const result = await planAcceptanceFixtures(run, { scenarios: [...ACCEPTANCE_SCENARIOS], baseArrivalDate: '2035-02-10', nightlyCents: 10000 },
    { now: () => start, authority: { verify: async b => ({ status: 'SOURCE_PLAN_VERIFIED', runId: b.runId,
      manifestDigest: b.manifestDigest, requestDigest: b.requestDigest,
      notBefore: run.notBefore, expiresAt: run.expiresAt, maxFixtures: 5, maxTotalCents: 500000, maxInitialCents: 150000,
      inventoryComplete: true, previousNamespaces: [], previousGuestIds: [] }) } });
  if (result.status !== 'PLANNED') throw Error('Synthetic plan rejected');
  const plan = result.plan, mappings: RuntimeMapping[] = [];
  const database: DatabaseEvidence = { role: 'zec_acceptance_verifier_reader', isolation: 'REPEATABLE READ READ ONLY', transactionId: 'read-1', fixtures: [], claims: [] };
  const provider: ProviderEvidence = { accountId: run.stripe.accountId, livemode: false, authenticity: 'SIMULATED_TEST_READ', payments: [] };
  const webhooks: WebhookEvidence = { accountId: run.stripe.accountId, endpointId: run.stripe.webhookEndpointId, livemode: false, deliveries: [] };
  const supervision: SupervisionEvidence = { journal: { complete: true, durable: true, sequence: 0, headDigest: '0'.repeat(64), entries: [] }, executions: [], requests: [], recovery: [] };
  for (const [index, f] of plan.fixtures.entries()) {
    const id = (n: number) => syntheticId(index * 100 + n), invocationId = id(90), begin = start + index * 61_000;
    const accepted = begin - 500, dispatched = begin + 200, confirmed = begin + 600, tx = `pg-xid8:${1000 + index}`;
    const m: RuntimeMapping = { fixtureId: f.fixtureId, bookingId: id(1), snapshotId: id(2), initialObligationId: id(3), balanceObligationId: id(4),
      holdId: id(5), claimId: id(6), attemptId: id(7), commandId: id(8), guestId: f.guest.id, unitId: f.stay.unitId,
      namespace: f.namespace, operationKey: f.operationKey, acceptedAt: accepted, acceptanceAuditId: id(9), transactionId: `accept-${index}` };
    mappings.push(m);
    const investigation = f.name === 'INVESTIGATION', missing = f.name === 'MISSING_WEBHOOK';
    const d: DatabaseEvidence['fixtures'][number] = { fixtureId: f.fixtureId, bookingId: m.bookingId, guestId: m.guestId, unitId: m.unitId,
      retention: 'SYNTHETIC', arrival: f.stay.arrivalDate, departure: f.stay.departureDate, zone: 'Europe/Vilnius',
      bookingState: investigation ? 'AWAITING_INITIAL_PAYMENT' : 'CONFIRMED', snapshotId: m.snapshotId, totalCents: f.expected.totalCents,
      currency: 'EUR', initialCents: f.expected.initialCents, balanceCents: f.expected.balanceCents,
      obligations: [{ id: m.initialObligationId, bookingId: m.bookingId, kind: 'INITIAL', amountCents: f.expected.initialCents, currency: 'EUR' },
        { id: m.balanceObligationId, bookingId: m.bookingId, kind: 'BALANCE', amountCents: f.expected.balanceCents, currency: 'EUR' }],
      hold: { id: m.holdId, bookingId: m.bookingId, attemptId: m.attemptId, state: investigation ? 'ACTIVE' : 'CONSUMED',
        terminalAt: investigation ? null : confirmed, transitionTransactionId: investigation ? null : tx },
      claimHistory: [{ claimId: m.claimId, holdId: m.holdId, bookingId: null, originHoldId: null, at: accepted, transactionId: m.transactionId, released: false }],
      attempt: { id: m.attemptId, bookingId: m.bookingId, obligationId: m.initialObligationId, holdId: m.holdId,
        state: investigation ? 'OPEN' : 'SUCCEEDED', amountCents: f.expected.initialCents, currency: 'EUR', sessionId: `cs_test_${index}`, paymentIntentId: investigation ? null : `pi_${index}` },
      command: { id: m.commandId, attemptId: m.attemptId, kind: 'SESSION_CREATE', logicalKey: f.expected.logicalKey,
        originalKey: `session-create:${m.attemptId}`, currentKey: `session-create:${m.attemptId}`, originalRequestDigest: 'a'.repeat(64), currentRequestDigest: 'a'.repeat(64),
        persistedAt: accepted, firstSubmittedAt: dispatched, state: 'RESOLVED', dispatches: [{ at: dispatched, requestId: id(32), invocationId,
          requestDigest: 'a'.repeat(64), idempotencyKey: `session-create:${m.attemptId}`, leaseValidUntil: begin + 30000, generation: '9007199254740993' }] },
      reconciliations: investigation ? [] : [{ id: id(10), attemptId: m.attemptId, sessionId: `cs_test_${index}`, paymentIntentId: `pi_${index}`,
        amountCents: f.expected.initialCents, currency: 'EUR', kind: 'STRIPE_CURRENT', result: 'VERIFIED_INITIAL', at: confirmed,
        transactionId: tx, webhookEventId: missing ? null : id(20), recoveryId: missing ? id(40) : null }],
      payments: investigation ? [] : [{ id: id(11), attemptId: m.attemptId, bookingId: m.bookingId, obligationId: m.initialObligationId,
        paymentIntentId: `pi_${index}`, chargeId: `ch_${index}`, reconciliationId: id(10), amountCents: f.expected.initialCents, currency: 'EUR', allocationState: 'ALLOCATED', transactionId: tx }],
      allocations: investigation ? [] : [{ id: id(12), paymentId: id(11), obligationId: m.initialObligationId, amountCents: f.expected.initialCents, transactionId: tx }],
      audits: [{ id: m.acceptanceAuditId, action: 'quote.accepted', prior: null, next: 'AWAITING_INITIAL_PAYMENT', at: accepted,
        transactionId: m.transactionId, reason: 'SYNTHETIC_PORTFOLIO', service: 'booking-acceptance' }],
      notices: investigation ? [] : [{ id: id(14), bookingId: m.bookingId, auditId: id(13), event: 'BOOKING_CONFIRMED', key: `booking-confirmed:${m.bookingId}`,
        recipientId: m.guestId, locale: f.guest.locale, transactionId: tx }], notificationAttempts: [], inbox: [], investigations: [], unresolvedRefundLiabilities: 0 };
    if (!investigation) {
      d.claimHistory.push({ claimId: m.claimId, holdId: null, bookingId: m.bookingId, originHoldId: m.holdId, at: confirmed, transactionId: tx, released: false });
      d.audits.push({ id: id(13), action: 'booking.confirmed', prior: 'AWAITING_INITIAL_PAYMENT', next: 'CONFIRMED', at: confirmed,
        transactionId: tx, reason: 'VERIFIED_INITIAL_CAPTURE', service: 'payment-reconciliation' });
    }
    if (!investigation) {
      const transaction = { mechanism: 'POSTGRES_XID8' as const, xid8: String(1000 + index), backendPid: 42 + index, transactionId: tx };
      const rowIds = [d.reconciliations[0].id, d.payments[0].id, d.allocations[0].id, m.claimId, m.holdId, m.bookingId, d.audits[1].id, d.notices[0].id];
      const capture: FinancialTransactionEvidence['capture'] = { kind: 'original-financial-capture-v1', captureId: id(50),
        binding: financialEvidenceBinding(run), fixtureId: f.fixtureId, origin: 'ORIGINAL_DOMAIN_TRANSACTION', transaction,
        collectorId: 'synthetic-original-transaction-collector', collectorSourceDigest: run.sourceDigest,
        bookingId: m.bookingId, obligationId: m.initialObligationId, commandId: m.commandId, attemptId: m.attemptId,
        holdId: m.holdId, claimId: m.claimId, sessionId: `cs_test_${index}`, paymentIntentId: `pi_${index}`, chargeId: `ch_${index}`,
        accountId: run.stripe.accountId, currency: 'EUR', amountCents: f.expected.initialCents, reconciliationResult: 'VERIFIED_INITIAL',
        effects: FINANCIAL_EFFECTS.map((kind, i) => ({ kind, ordinal: i + 1, rowId: rowIds[i], transactionId: tx,
          at: ['RECONCILIATION', 'HOLD_CONSUMED', 'CONFIRMATION_AUDIT'].includes(kind) ? confirmed : null })) };
      const captureDigest = financialEvidenceDigest(capture);
      d.originalTransactions = [{ capture, captureDigest, outcome: 'COMMITTED', settlement: {
        mechanism: 'INDEPENDENT_TRANSACTION_OBSERVATION', binding: capture.binding, transaction, observerId: 'synthetic-independent-commit-reader',
        evidenceRef: `synthetic-commit-${index}`, captureId: capture.captureId, captureDigest, observedAt: confirmed + 5,
        outcome: 'COMMITTED', visibility: 'CAPTURE_ROW_VISIBLE' } } satisfies FinancialTransactionEvidence];
    }
    database.fixtures.push(d); database.claims.push({ id: m.claimId, unitId: m.unitId, arrival: d.arrival, departure: d.departure,
      holdId: investigation ? m.holdId : null, bookingId: investigation ? null : m.bookingId, originHoldId: investigation ? null : m.holdId,
      operatorBlockId: null, released: false });
    provider.payments.push({ attemptId: m.attemptId, bookingId: m.bookingId, holdId: m.holdId, commandId: m.commandId,
      sessionId: `cs_test_${index}`, paymentIntentId: investigation ? null : `pi_${index}`, chargeId: investigation ? null : `ch_${index}`,
      requestId: `req_${index}_33`, accountId: run.stripe.accountId, livemode: false,
      ownership: 'PERSISTED_COMMAND', outcome: investigation ? 'NONE' : 'CAPTURED', currency: 'eur',
      sessionCents: f.expected.initialCents, receivedCents: investigation ? 0 : f.expected.initialCents, chargeCents: investigation ? 0 : f.expected.initialCents,
      mode: 'payment', methods: ['card'], sessionStatus: investigation ? 'open' : 'complete', paymentStatus: investigation ? 'unpaid' : 'paid',
      intentStatus: investigation ? 'none' : 'succeeded', chargePaid: !investigation, chargeCaptured: !investigation, createdAt: dispatched, expiresAt: dispatched + 1800000 });
    if (!missing) {
      const h: WebhookEvidence['deliveries'][number] = { deliveryId: id(21), fixtureId: f.fixtureId, inboxId: investigation ? null : id(20), eventId: `evt_${index}`,
        type: investigation ? 'customer.created' : 'checkout.session.completed', objectType: investigation ? 'customer' : 'checkout.session',
        objectId: investigation ? `cus_${index}` : `cs_test_${index}`, createdAt: begin, receivedAt: begin + 450, digest: 'b'.repeat(64), originalDigest: 'b'.repeat(64),
        signature: 'SIMULATED', signatureEvidenceRef: `signature-${index}`, ownership: investigation ? 'UNSUPPORTED' : 'PERSISTED_RELATIONSHIPS',
        disposition: investigation ? 'INVESTIGATION' : 'INGESTED', lane: investigation ? 'NONE' : 'PAYMENT', receiptId: `receipt-${index}`,
        bookingId: m.bookingId, attemptId: m.attemptId, commandId: m.commandId };
      webhooks.deliveries.push(h); if (h.inboxId) d.inbox.push({ id: h.inboxId, eventId: h.eventId, digest: h.digest, objectId: h.objectId, state: investigation ? 'INVESTIGATE' : 'PROCESSED' });
      if (investigation) d.investigations.push({ id: id(22), eventId: h.eventId, digest: h.digest, reason: 'UNSUPPORTED', durableReceiptId: h.receiptId, financiallyUncertain: false });
      if (f.name === 'DUPLICATE_DELIVERY') {
        webhooks.deliveries.push({ ...h, deliveryId: id(23), receivedAt: begin + 470, disposition: 'DUPLICATE' },
          { ...h, deliveryId: id(24), inboxId: id(25), eventId: `evt_${index}older`, type: 'payment_intent.payment_failed', objectType: 'payment_intent', objectId: `pi_${index}`, createdAt: begin - 1000, receivedAt: begin + 480 });
        d.inbox.push({ id: id(25), eventId: `evt_${index}older`, digest: h.digest, objectId: `pi_${index}`, state: 'PROCESSED' });
      }
    }
    function append(at: number, event: SupervisionEvent) {
      const j = supervision.journal, core = { sequence: j.sequence + 1, previousDigest: j.headDigest, binding: supervisionBinding(run), invocationId, at, event };
      const entry = { ...core, digest: evidenceHash(core) }; j.entries.push(entry); j.sequence = entry.sequence; j.headDigest = entry.digest;
    }
    append(begin, { kind: 'OPEN', deadline: begin + 60_000 });
    append(begin, { kind: 'AUTHORITY', verified: { manifest: true, approval: true, reservation: true, docker: true, postgres: true, stripeTestAccount: true, journal: true, budgetStore: true }, database: run.target.database, targetDigest: evidenceHash(run.target) });
    append(begin, { kind: 'LOCK', layer: 'HOST', observation: 'ACQUIRED' }); append(begin, { kind: 'LOCK', layer: 'DATABASE', observation: 'ACQUIRED' });
    function request(number: number, operation: SupervisionEvidence['requests'][number]['operation'], at: number) {
      append(at, { kind: 'RESERVE', requestId: id(number), operation });
      append(at + 10, { kind: 'PROVIDER_RESULT', requestId: id(number), outcome: 'KNOWN' });
      supervision.requests.push({ requestId: id(number), invocationId, operation, dispatchedAt: at, settledAt: at + 10, outcome: 'KNOWN',
        providerRequestId: `req_${index}_${number}`, attemptId: number >= 32 ? m.attemptId : null, commandId: number === 32 ? m.commandId : null });
    }
    request(30, 'STARTUP_ACCOUNT', begin + 20); append(begin + 50, { kind: 'START' }); request(31, 'WORKER_ACCOUNT', begin + 60);
    request(32, 'CHECKOUT_DISPATCH', dispatched); request(33, missing ? 'PAYMENT_STATUS_RECOVERY' : 'PROVIDER_RECONCILIATION', begin + 500);
    append(begin + 700, { kind: 'WORKER', outcome: 'SUCCEEDED' }); append(begin + 710, { kind: 'CLEANUP', outcome: 'SETTLED' });
    append(begin + 720, { kind: 'LOCK', layer: 'DATABASE', observation: 'RELEASED' }); append(begin + 730, { kind: 'LOCK', layer: 'HOST', observation: 'RELEASED' });
    append(begin + 740, { kind: 'FINISH', state: 'COMPLETED' });
    supervision.executions.push({ invocationId, origin: 'SCHEDULED', launchRecordId: `launch-${index}`, owner: `worker-${index}`,
      hostLockPath: '/run/lock/zec-acceptance/invocation.lock', controlLockKey: supervisionBinding(run).controlLockKey,
      hostAcquiredAt: begin, databaseAcquiredAt: begin, databaseReleasedAt: begin + 720, hostReleasedAt: begin + 730, lockContinuity: 'VERIFIED', cleanup: 'SETTLED' });
    if (missing) supervision.recovery.push({ id: id(40), invocationId, attemptId: m.attemptId, reconciliationId: id(10), at: confirmed,
      lane: 'INITIAL_RECONCILIATION', generation: '9007199254740993', leaseOwner: `worker-${index}`, leaseUntil: begin + 30000, finishAccepted: true });
  }
  // Capture original handoff plans once. Reanchoring never fabricates missing rows.
  const handoffObservations: HandoffCommitObservation[] = [];
  webhooks.handoffObservations = handoffObservations;
  for (const [index, h] of webhooks.deliveries.entries()) {
    const m = mappings.find(m => m.fixtureId === h.fixtureId)!, d = database.fixtures.find(d => d.fixtureId === h.fixtureId)!;
    const transaction = { mechanism: 'POSTGRES_XID8' as const, xid8: String(2000 + index), backendPid: 60 + index, transactionId: `pg-xid8:${2000 + index}` };
    const owner: AtomicHandoffOwnership = { binding: financialEvidenceBinding(run), fixtureId: m.fixtureId,
      bookingId: m.bookingId, obligationId: m.initialObligationId, commandId: m.commandId, attemptId: m.attemptId, holdId: m.holdId,
      commandAttemptId: m.attemptId, attemptBookingId: m.bookingId, attemptObligationId: m.initialObligationId, attemptHoldId: m.holdId,
      sessionId: d.attempt.sessionId, paymentIntentId: d.attempt.paymentIntentId,
      originalRequestDigest: d.command.originalRequestDigest, currentRequestDigest: d.command.currentRequestDigest,
      originalKey: d.command.originalKey, currentKey: d.command.currentKey };
    const event = { id: h.eventId, type: h.type, objectId: h.objectId, objectType: h.objectType, created: h.createdAt / 1000,
      accountId: run.stripe.accountId, livemode: false as const };
    const incident = d.investigations.find(x => x.eventId === h.eventId);
    const inbox = h.inboxId === null ? null : { id: h.inboxId, stripeEventId: h.eventId, eventType: h.type,
      objectType: h.objectType, objectId: h.objectId, payloadDigest: h.digest, providerCreated: event.created, processingState: 'PROCESSED' as const };
    const prior = handoffObservations.find(x => x.plan.event.id === h.eventId);
    const original = prior?.plan.original ?? { id: syntheticId(30000 + index), binding: owner.binding, transaction, event,
      payloadDigest: h.digest, ownership: incident ? null : owner, disposition: incident ? 'INVESTIGATION' as const : 'PAYMENT' as const,
      inbox, investigationId: incident?.id ?? null };
    const plan: AtomicHandoffPlan = { kind: 'atomic-payment-inbox-handoff-v1', binding: owner.binding, transaction,
      deliveryId: h.deliveryId, event, incomingDigest: h.digest, signature: { kind: 'SIMULATED_RAW_BYTES',
        accountId: run.stripe.accountId, endpointId: run.stripe.webhookEndpointId, payloadDigest: h.digest, evidenceRef: h.signatureEvidenceRef! },
      original, ownershipObservation: incident ? null : owner, originalAction: prior ? 'PRESERVE' : 'INSERT',
      inboxAction: incident ? 'NONE' : prior ? 'PRESERVE' : 'INSERT_PENDING', investigationId: incident?.id ?? null,
      reason: incident ? 'UNSUPPORTED' : 'OWNED', result: h.disposition };
    handoffObservations.push({ kind: 'INDEPENDENT_COMMITTED_HANDOFF', readerId: 'independent-handoff-reader', evidenceRef: `handoff-${index}`,
      binding: owner.binding, transaction, plan, planDigest: evidenceHash(plan), outcome: 'COMMITTED', inbox, investigationId: incident?.id ?? null });
  }
  let now = start + 5 * 61_000;
  const binding = { runId: run.runId, manifestDigest: evidenceHash(run), sourceDigest: run.sourceDigest, migrationDigest: run.migrationDigest,
    planDigest: plan.planDigest, targetDigest: evidenceHash(run.target), database: run.target.database };
  const envelopes = Object.fromEntries(EVIDENCE_CHANNELS.map(channel => [channel, { binding, channel, producer: `independent-${channel}`,
    recordId: `record-${channel}`, snapshotSetId: syntheticId(9999), observedAt: now, asOf: now, evidenceClass: 'SIMULATED', complete: true, settled: true,
    data: { bindings: { mappings }, database, provider, webhooks, supervision }[channel] }])) as Record<typeof EVIDENCE_CHANNELS[number], EvidenceEnvelope>;
  const review: VerifierReview = { kind: 'independent-verifier-review-v1', binding, reviewer: 'independent-reviewer', approvalReference: run.approvalReference,
    snapshotSetId: syntheticId(9999), notBefore: Date.parse(run.notBefore), expiresAt: Date.parse(run.expiresAt), asOf: now, evidenceClass: 'SIMULATED',
    artifactsVerified: true, targetVerified: true, restrictedReadersVerified: true, inventory: { complete: true, reservedResources: [run.target.project, run.target.container,
      run.target.network, run.target.volume, run.target.database, run.target.containerId, run.target.networkId, run.target.volumeIdentity], foreignResources: [], reservationId: syntheticId(9998), exclusive: true },
    anchors: Object.fromEntries(EVIDENCE_CHANNELS.map(c => [c, { producer: envelopes[c].producer, recordId: envelopes[c].recordId, digest: evidenceHash(envelopes[c]) }])) as VerifierReview['anchors'],
    journalCheckpoint: { sequence: supervision.journal.sequence, headDigest: supervision.journal.headDigest, protectedRecordId: 'checkpoint-1' } };
  const readers: AcceptanceEvidenceReaders = { authority: readOnly(async () => structuredClone(review)),
    ...Object.fromEntries(EVIDENCE_CHANNELS.map(c => [c, readOnly(async () => structuredClone(envelopes[c]))])) };
  const reanchor = () => {
    for (const c of EVIDENCE_CHANNELS) review.anchors[c].digest = evidenceHash(envelopes[c]);
    review.journalCheckpoint.sequence = supervision.journal.sequence; review.journalCheckpoint.headDigest = supervision.journal.headDigest;
  };
  const rechain = () => {
    let previous = '0'.repeat(64);
    for (const [index, entry] of supervision.journal.entries.entries()) {
      entry.sequence = index + 1; entry.previousDigest = previous;
      const { digest: ignored, ...core } = entry; void ignored; entry.digest = evidenceHash(core); previous = entry.digest;
    }
    supervision.journal.sequence = supervision.journal.entries.length; supervision.journal.headDigest = previous; reanchor();
  };
  return { run, plan, mappings, database, provider, webhooks, handoffObservations, supervision, envelopes, review, readers, reanchor, rechain,
    advance: (ms: number) => { now += ms; }, verify: () => verifyAcceptanceEvidence(run, plan, { now: () => now, readers }), now: () => now };
}
