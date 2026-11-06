import 'server-only';
import { witnessSchema } from './stripe-acceptance-handoff-evidence';
import { canonicalRunJson, freshAcceptanceNames, requireSealedAcceptanceRun, runManifestDigest,
  type SealedAcceptanceRun } from './stripe-acceptance-run';
import { ACCEPTANCE_SCENARIOS, requireAcceptanceFixturePlan, type AcceptanceFixturePlan } from './stripe-acceptance-fixtures';
import { EVIDENCE_CHANNELS, envelopeSchema, payloadSchemas, reviewSchema,
  type AcceptanceEvidenceReader, type AcceptanceEvidenceReaders, type DatabaseEvidence, type EvidenceChannel,
  type ProviderEvidence, type RuntimeMapping, type SupervisionEvidence, type VerifierBinding,
  retainedReviewSchema, type VerifierReview, type WebhookEvidence } from './stripe-acceptance-verifier-evidence';

import { FINANCIAL_EFFECTS, financialTransactionEvidenceSchema, inspectOriginalFinancialEvidence,
  type FinancialEvidenceBinding } from './stripe-acceptance-financial-evidence';

export type AcceptanceVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE' | 'INVESTIGATION_REQUIRED';
export const VERIFIER_DIAGNOSTICS = ['INVALID_RUN_OR_PLAN', 'TARGET_REJECTED', 'AUTHORITY_UNAVAILABLE',
  'READER_REJECTED', 'EVIDENCE_UNAVAILABLE', 'EVIDENCE_INVALID', 'EVIDENCE_STALE', 'PROVENANCE_CONFLICT',
  'INDEPENDENCE_UNVERIFIED', 'SCENARIO_MISSING', 'FOREIGN_FIXTURE', 'BINDING_CONFLICT', 'PAYMENT_EVIDENCE_MISSING',
  'PROVIDER_UNCERTAIN', 'PROVIDER_IDENTITY', 'AMOUNT_OR_CURRENCY', 'DUPLICATE_FINANCIAL_EFFECT',
  'INVENTORY_TRANSFER_MISSING', 'INVENTORY_VIOLATION', 'STATE_MACHINE_VIOLATION', 'AUDIT_MISSING',
  'NOTIFICATION_MISSING', 'DUPLICATE_NOTIFICATION', 'NOTIFICATION_IDEMPOTENCY', 'COMMAND_CHANGED',
  'COMMAND_EVIDENCE_MISSING', 'WEBHOOK_EVIDENCE_MISSING', 'WEBHOOK_CONFLICT', 'DUPLICATE_SCENARIO_UNPROVEN',
  'RECOVERY_UNPROVEN', 'DELAY_UNPROVEN', 'INVESTIGATION_EVIDENCE_MISSING', 'FALSE_CONFIRMATION',
  'JOURNAL_CORRUPT', 'SUPERVISION_UNPROVEN', 'LOCK_LOST', 'BUDGET_OVERRUN', 'ACCOUNTING_UNCERTAIN',
  'DEADLINE_VIOLATION', 'CLEANUP_UNCERTAIN', 'WORKER_FAILED', 'ORIGINAL_TRANSACTION_MISSING',
  'ORIGINAL_TRANSACTION_CONFLICT', 'FINANCIAL_TRANSACTION_UNCERTAIN', 'FINANCIAL_TRANSACTION_REJECTED', 'ORIGINAL_CAPTURE_INCOMPLETE'] as const;
export type VerifierDiagnostic = typeof VERIFIER_DIAGNOSTICS[number];
type Issue = Readonly<{ verdict: Exclude<AcceptanceVerdict, 'PASS'>; code: VerifierDiagnostic }>;
type Scenario = typeof ACCEPTANCE_SCENARIOS[number];
const rank: Record<AcceptanceVerdict, number> = { PASS: 0, INCOMPLETE: 1, INVESTIGATION_REQUIRED: 2, FAIL: 3 };
const verdict = (issues: readonly Issue[]): AcceptanceVerdict => issues.reduce<AcceptanceVerdict>((v, i) => rank[i.verdict] > rank[v] ? i.verdict : v, 'PASS');
const same = (a: unknown, b: unknown) => canonicalRunJson(a) === canonicalRunJson(b);
const digest = (value: unknown) => runManifestDigest(canonicalRunJson(value));
const unique = (values: readonly string[]) => new Set(values).size === values.length;
function reader(value: AcceptanceEvidenceReader | undefined): value is AcceptanceEvidenceReader {
  return !!value && Object.getPrototypeOf(value) === Object.prototype && value.kind === 'acceptance-verifier-read-only-v1' &&
    typeof value.read === 'function' && Reflect.ownKeys(value).length === 2 && Reflect.ownKeys(value).every(k => k === 'kind' || k === 'read');
}
export type VerifierReport = Readonly<{ stage: '2C-3H'; verdict: AcceptanceVerdict; operationsEnabled: false;
  verificationMode: 'IN_WINDOW_V1' | 'RETAINED_READ_ONLY_V2';
  evidenceClass: 'SIMULATED' | 'RECORDED' | 'UNVERIFIED'; diagnostics: readonly VerifierDiagnostic[];
  scenarios: readonly Readonly<{ scenario: Scenario; verdict: AcceptanceVerdict; paidBookingVerified: boolean;
    expectedInvestigationSafe: boolean; diagnostics: readonly VerifierDiagnostic[] }>[];
  provenance?: Readonly<{ runId: string; manifestDigest: string; planDigest: string; snapshotSetId: string;
    evidenceDigests: Readonly<Partial<Record<EvidenceChannel, string>>>; reportDigest: string }> }>;
type Add = (v: Exclude<AcceptanceVerdict, 'PASS'>, code: VerifierDiagnostic) => void;
type Invocation = { opened: number; deadline: number; authority: boolean; host: boolean; database: boolean;
  started: number | null; worker: string | null; cleanup: boolean; finished: boolean; requests: number;
  uncertain: boolean; cancelled: boolean; ended: number | null };
type Reservation = { invocationId: string; at: number; operation: string; outcome: string | null; resultAt: number | null };
type VerifiedSupervision = { invocations: Map<string, Invocation>; reservations: Map<string, Reservation> };

/** Independent replay of v1 supervision records, never calls the source simulator
 * or accepts its computed success flag. Protected checkpoint + execution receipts
 * are required in addition to a structurally correct hash chain. */
function verifySupervision(run: SealedAcceptanceRun, s: SupervisionEvidence, review: VerifierReview, add: Add): VerifiedSupervision {
  const invocations = new Map<string, Invocation>(), reservations = new Map<string, Reservation>();
  const controlKey = runManifestDigest(`zec-supervisor-v1:${run.profileId}:${run.runId}`).slice(0, 16);
  const { planDigest: unused, ...base } = review.binding; void unused;
  const binding = { ...base, approvalReference: run.approvalReference, controlLockKey: controlKey };
  const journal = s.journal; let previous = '0'.repeat(64), sequence = 0, at = 0, current: string | undefined;
  const corrupt = () => add('INVESTIGATION_REQUIRED', 'JOURNAL_CORRUPT');
  if (journal.sequence !== review.journalCheckpoint.sequence || journal.headDigest !== review.journalCheckpoint.headDigest) corrupt();
  for (const entry of journal.entries) {
    const { digest: observed, ...core } = entry;
    if (++sequence !== entry.sequence || previous !== entry.previousDigest || digest(core) !== observed ||
      !same(entry.binding, binding) || entry.at < at || entry.at > review.asOf) corrupt();
    previous = observed; at = entry.at; const e = entry.event;
    if (e.kind === 'OPEN') {
      const prior = current ? invocations.get(current) : undefined;
      if (invocations.has(entry.invocationId) || prior && (!prior.finished || prior.uncertain)) corrupt();
      if (entry.at < Date.parse(run.notBefore) || e.deadline <= entry.at ||
        e.deadline > Math.min(entry.at + 60_000, Date.parse(run.expiresAt))) add('FAIL', 'DEADLINE_VIOLATION');
      current = entry.invocationId;
      invocations.set(current, { opened: at, deadline: e.deadline, authority: false, host: false, database: false,
        started: null, worker: null, cleanup: false, finished: false, requests: 0, uncertain: false, cancelled: false, ended: null });
      continue;
    }
    const i = invocations.get(entry.invocationId);
    if (!i || current !== entry.invocationId || i.finished) { corrupt(); continue; }
    if (['AUTHORITY', 'START', 'RESERVE'].includes(e.kind) || e.kind === 'LOCK' && e.observation === 'ACQUIRED') {
      if (at >= i.deadline || at >= Date.parse(run.expiresAt)) add('FAIL', 'DEADLINE_VIOLATION');
      if (i.cancelled || i.uncertain || i.cleanup) corrupt();
    }
    if (e.kind === 'AUTHORITY') {
      if (i.authority || i.started !== null || e.database !== binding.database || e.targetDigest !== binding.targetDigest) corrupt();
      i.authority = true;
    } else if (e.kind === 'LOCK') {
      const key = e.layer === 'HOST' ? 'host' : 'database';
      if (e.observation === 'ACQUIRED') {
        if (!i.authority || i[key] || i.started !== null || e.layer === 'DATABASE' && !i.host) corrupt();
        i[key] = true;
      } else if (e.observation === 'RELEASED') {
        if (!i[key] || !i.cleanup || i.started !== null && i.worker === null) corrupt(); i[key] = false;
      } else {
        i.uncertain = true; add(e.observation === 'LOST' ? 'FAIL' : 'INVESTIGATION_REQUIRED', 'LOCK_LOST');
      }
    } else if (e.kind === 'START') {
      if (!i.authority || !i.host || !i.database || i.started !== null) corrupt(); i.started = at;
    } else if (e.kind === 'RESERVE') {
      if (!i.host || !i.database || !i.authority || i.worker || reservations.has(e.requestId)) corrupt();
      reservations.set(e.requestId, { invocationId: entry.invocationId, at, operation: e.operation, outcome: null, resultAt: null });
      i.requests++;
    } else if (e.kind === 'PROVIDER_RESULT') {
      const r = reservations.get(e.requestId);
      if (!r || r.invocationId !== entry.invocationId || r.outcome !== null) corrupt();
      else { r.outcome = e.outcome; r.resultAt = at; }
      if (['UNCERTAIN', 'CANCELLED', 'TIMEOUT'].includes(e.outcome)) { i.uncertain = true; add('INVESTIGATION_REQUIRED', 'ACCOUNTING_UNCERTAIN'); }
    } else if (e.kind === 'CANCEL') {
      i.cancelled = true; add('INCOMPLETE', 'SUPERVISION_UNPROVEN');
      if (e.reason === 'DEADLINE' && at < i.deadline) corrupt();
    } else if (e.kind === 'WORKER') {
      if (i.started === null || i.worker) corrupt(); i.worker = e.outcome;
      if (e.outcome !== 'SUCCEEDED') add(e.outcome === 'FAILED' ? 'FAIL' : 'INVESTIGATION_REQUIRED', 'WORKER_FAILED');
    } else if (e.kind === 'CLEANUP') {
      if (i.cleanup || i.started !== null && !i.worker) corrupt(); i.cleanup = e.outcome === 'SETTLED';
      if (!i.cleanup) { i.uncertain = true; add('INVESTIGATION_REQUIRED', 'CLEANUP_UNCERTAIN'); }
    } else if (e.kind === 'FINISH') {
      i.finished = true; i.ended = at;
      if (e.state !== 'COMPLETED') add('INVESTIGATION_REQUIRED', 'SUPERVISION_UNPROVEN');
      if (!i.cleanup || i.host || i.database || i.worker !== 'SUCCEEDED' || i.uncertain || i.cancelled) corrupt();
      if (e.state === 'COMPLETED' && at >= i.deadline) add('FAIL', 'DEADLINE_VIOLATION');
    }
  }
  if (sequence !== journal.sequence || previous !== journal.headDigest) corrupt();
  if (!invocations.size) add('INCOMPLETE', 'SUPERVISION_UNPROVEN');
  if (invocations.size > run.budgets.invocations || reservations.size > run.budgets.providerRequests) add('FAIL', 'BUDGET_OVERRUN');
  if (!unique(s.executions.map(x => x.invocationId)) || !unique(s.requests.map(x => x.requestId))) corrupt();
  if (s.executions.some(x => !invocations.has(x.invocationId)) || s.requests.some(x => !reservations.has(x.requestId))) corrupt();
  for (const [invocationId, i] of invocations) {
    if (!i.finished) add('INVESTIGATION_REQUIRED', 'SUPERVISION_UNPROVEN');
    if (i.requests > run.budgets.providerPerInvocation) add('FAIL', 'BUDGET_OVERRUN');
    const x = s.executions.find(x => x.invocationId === invocationId);
    if (!x) { add('INCOMPLETE', 'SUPERVISION_UNPROVEN'); continue; }
    if (x.hostLockPath !== '/run/lock/zec-acceptance/invocation.lock' || x.controlLockKey !== controlKey ||
      x.lockContinuity === 'LOST') add('FAIL', 'LOCK_LOST');
    if (x.lockContinuity === 'UNKNOWN') add('INCOMPLETE', 'SUPERVISION_UNPROVEN');
    if (x.cleanup !== 'SETTLED') add('INVESTIGATION_REQUIRED', 'CLEANUP_UNCERTAIN');
    const lockEvents = journal.entries.filter(e => e.invocationId === invocationId && e.event.kind === 'LOCK');
    for (const [layer, acquired, released] of [['HOST', x.hostAcquiredAt, x.hostReleasedAt],
      ['DATABASE', x.databaseAcquiredAt, x.databaseReleasedAt]] as const) {
      const a = lockEvents.filter(e => e.event.kind === 'LOCK' && e.event.layer === layer && e.event.observation === 'ACQUIRED');
      const r = lockEvents.filter(e => e.event.kind === 'LOCK' && e.event.layer === layer && e.event.observation === 'RELEASED');
      if (a.length !== 1 || r.length !== 1 || a[0].at !== acquired || r[0].at !== released) corrupt();
    }
    if (x.hostAcquiredAt < i.opened || x.databaseAcquiredAt < x.hostAcquiredAt || i.started === null ||
      x.databaseAcquiredAt > i.started || x.databaseReleasedAt === null || x.hostReleasedAt === null ||
      x.databaseReleasedAt > x.hostReleasedAt || x.hostReleasedAt > (i.ended ?? -1)) add('INVESTIGATION_REQUIRED', 'SUPERVISION_UNPROVEN');
    if (!s.requests.some(r => r.invocationId === invocationId && r.operation === 'STARTUP_ACCOUNT' && r.outcome === 'KNOWN' &&
      r.dispatchedAt !== null && r.settledAt <= (i.started ?? -1)) ||
      !s.requests.some(r => r.invocationId === invocationId && r.operation === 'WORKER_ACCOUNT' && r.outcome === 'KNOWN' &&
        r.dispatchedAt !== null && r.dispatchedAt >= (i.started ?? Infinity))) add('INCOMPLETE', 'SUPERVISION_UNPROVEN');
  }
  for (const [requestId, r] of reservations) {
    const receipt = s.requests.find(x => x.requestId === requestId), i = invocations.get(r.invocationId)!;
    if (!receipt || r.outcome === null) { add('INVESTIGATION_REQUIRED', 'ACCOUNTING_UNCERTAIN'); continue; }
    if (receipt.invocationId !== r.invocationId || receipt.operation !== r.operation || receipt.outcome !== r.outcome ||
      receipt.settledAt > (r.resultAt ?? -1) || receipt.settledAt < r.at) corrupt();
    if (receipt.dispatchedAt === null) {
      if (r.outcome !== 'NOT_STARTED') add('INVESTIGATION_REQUIRED', 'ACCOUNTING_UNCERTAIN');
    } else {
      if (r.outcome === 'NOT_STARTED' || !receipt.providerRequestId) corrupt();
      if (receipt.dispatchedAt < r.at || receipt.dispatchedAt >= i.deadline || receipt.settledAt < receipt.dispatchedAt ||
        receipt.settledAt - receipt.dispatchedAt > 1000) add('FAIL', 'DEADLINE_VIOLATION');
    }
  }
  return { invocations, reservations };
}

/** Original same-transaction capture is required in addition to the current
 * financial rows. A later SELECT snapshot's own transactionId proves no atomicity. */
function verifyOriginalTransaction(d: DatabaseEvidence['fixtures'][number], m: RuntimeMapping,
  binding: FinancialEvidenceBinding, asOf: number, accountId: string, add: Add) {
  const records = d.originalTransactions ?? [];
  if (records.length !== 1) {
    add(records.length > 1 ? 'INVESTIGATION_REQUIRED' : 'INCOMPLETE',
      records.length > 1 ? 'ORIGINAL_TRANSACTION_CONFLICT' : 'ORIGINAL_TRANSACTION_MISSING');
    return;
  }
  for (const issue of inspectOriginalFinancialEvidence(records[0], binding, asOf)) add(issue.verdict, issue.code);
  const parsed = financialTransactionEvidenceSchema.safeParse(records[0]);
  if (!parsed.success) return;
  const c = parsed.data.capture, payment = d.payments[0], allocation = d.allocations[0];
  const rec = d.reconciliations.find(r => r.id === payment?.reconciliationId);
  const audit = d.audits.find(a => a.action === 'booking.confirmed');
  const notice = d.notices.find(n => n.event === 'BOOKING_CONFIRMED');
  if (c.fixtureId !== d.fixtureId || c.bookingId !== m.bookingId || c.obligationId !== m.initialObligationId ||
    c.commandId !== m.commandId || c.attemptId !== m.attemptId || c.holdId !== m.holdId || c.claimId !== m.claimId ||
    c.sessionId !== d.attempt.sessionId || c.paymentIntentId !== d.attempt.paymentIntentId ||
    c.accountId !== accountId || c.amountCents !== d.initialCents || c.currency !== d.currency ||
    payment && (c.paymentIntentId !== payment.paymentIntentId || c.chargeId !== payment.chargeId))
    add('INVESTIGATION_REQUIRED', 'ORIGINAL_TRANSACTION_CONFLICT');
  const expected = [rec?.id, payment?.id, allocation?.id, m.claimId, m.holdId, m.bookingId, audit?.id, notice?.id];
  if (expected.some(v => !v)) add('INCOMPLETE', 'ORIGINAL_CAPTURE_INCOMPLETE');
  if (c.effects.some(e => expected[FINANCIAL_EFFECTS.indexOf(e.kind)] && e.rowId !== expected[FINANCIAL_EFFECTS.indexOf(e.kind)])) add('INVESTIGATION_REQUIRED', 'ORIGINAL_TRANSACTION_CONFLICT');
  const tx = c.transaction.transactionId;
  if ([rec?.transactionId, payment?.transactionId, allocation?.transactionId, d.hold.transitionTransactionId,
    audit?.transactionId, notice?.transactionId, d.claimHistory.at(-1)?.transactionId].filter(Boolean).some(v => v !== tx))
    add('INVESTIGATION_REQUIRED', 'ORIGINAL_TRANSACTION_CONFLICT');
  for (const [kind, actual] of [['RECONCILIATION', rec?.at], ['HOLD_CONSUMED', d.hold.terminalAt], ['CONFIRMATION_AUDIT', audit?.at]] as const) {
    const effect = c.effects.find(e => e.kind === kind);
    if (!effect || effect.at === null) add('INCOMPLETE', 'ORIGINAL_CAPTURE_INCOMPLETE');
    else if (actual !== undefined && actual !== null && effect.at !== actual) add('INVESTIGATION_REQUIRED', 'ORIGINAL_TRANSACTION_CONFLICT');
  }
}

/** Replay independently observed immutable handoff rows. A forwarding ACK alone
 * is never evidence of either durable admission path. */
function verifyHandoff(h: WebhookEvidence['deliveries'][number], hooks: WebhookEvidence,
  d: DatabaseEvidence['fixtures'][number], m: RuntimeMapping, review: VerifierReview, add: Add,
  observations: readonly ReturnType<typeof witnessSchema.safeParse>[]) {
  const found = observations.filter(x => x.success && x.data.plan.deliveryId === h.deliveryId);
  if (found.length !== 1 || !found[0].success) {
    add(found.length > 1 ? 'INVESTIGATION_REQUIRED' : 'INCOMPLETE', 'WEBHOOK_EVIDENCE_MISSING'); return;
  }
  const w = found[0].data, p = w.plan, o = p.original;
  const conflict = (ok: boolean) => { if (!ok) add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT'); };
  const { planDigest: unused, ...binding } = review.binding; void unused;
  conflict(same(w.binding, binding) && same(p.binding, binding) && same(o.binding, binding) &&
    same(w.transaction, p.transaction) && w.planDigest === digest(p));
  conflict(p.event.id === h.eventId && p.event.type === h.type && p.event.objectType === h.objectType &&
    p.event.objectId === h.objectId && p.event.created * 1000 === h.createdAt &&
    p.event.accountId === hooks.accountId && o.event.accountId === hooks.accountId &&
    p.incomingDigest === h.digest && o.payloadDigest === h.originalDigest && o.event.id === h.eventId &&
    p.result === h.disposition && p.signature.accountId === hooks.accountId &&
    p.signature.endpointId === hooks.endpointId && p.signature.payloadDigest === h.digest &&
    (!h.signatureEvidenceRef || p.signature.evidenceRef === h.signatureEvidenceRef));
  if (p.signature.kind !== (h.signature === 'VERIFIED_RAW_BYTES' ? 'VERIFIED_RAW_BYTES' : 'SIMULATED_RAW_BYTES'))
    add('INCOMPLETE', 'WEBHOOK_EVIDENCE_MISSING');
  const first = observations.find(x => x.success && x.data.plan.original.event.id === o.event.id && x.data.plan.originalAction === 'INSERT');
  if (p.incomingDigest === o.payloadDigest) conflict(same(p.event, o.event));
  if (!first?.success) add('INCOMPLETE', 'WEBHOOK_EVIDENCE_MISSING');
  else {
    const original = first.data.plan.original;
    // Processing state may evolve; original identity, digest and owner may not.
    conflict(same({ ...original, inbox: original.inbox && { ...original.inbox, processingState: 'PENDING' } },
      { ...o, inbox: o.inbox && { ...o.inbox, processingState: 'PENDING' } }));
    conflict(same(first.data.plan.transaction, o.transaction) && first.data.plan.incomingDigest === o.payloadDigest &&
      same(first.data.plan.event, o.event));
    if (!hooks.deliveries.some(x => x.deliveryId === first.data.plan.deliveryId)) add('INCOMPLETE', 'WEBHOOK_EVIDENCE_MISSING');
  }
  const owned = (owner: typeof o.ownership) => !!owner && same(owner.binding, binding) &&
    owner.fixtureId === m.fixtureId && owner.bookingId === m.bookingId && owner.obligationId === m.initialObligationId &&
    owner.attemptId === m.attemptId && owner.commandId === m.commandId && owner.holdId === m.holdId &&
    owner.commandAttemptId === m.attemptId && owner.attemptBookingId === m.bookingId &&
    owner.attemptObligationId === m.initialObligationId && owner.attemptHoldId === m.holdId &&
    owner.sessionId === d.attempt.sessionId && (owner.paymentIntentId === null || owner.paymentIntentId === d.attempt.paymentIntentId) &&
    owner.originalKey === d.command.originalKey && owner.currentKey === d.command.currentKey &&
    owner.originalRequestDigest === d.command.originalRequestDigest && owner.currentRequestDigest === d.command.currentRequestDigest;
  const objectOwned = (event: typeof p.event, owner: typeof o.ownership) => owned(owner) && !!owner &&
    ((event.objectType === 'checkout.session' && ['checkout.session.completed', 'checkout.session.expired'].includes(event.type) && event.objectId === owner.sessionId) ||
      (event.objectType === 'payment_intent' && ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'].includes(event.type) && event.objectId === owner.paymentIntentId));
  if (o.disposition === 'PAYMENT') {
    const inbox = d.inbox.find(x => x.id === o.inbox?.id);
    conflict(objectOwned(o.event, o.ownership) && !!o.inbox && !o.investigationId && !!inbox &&
      h.inboxId === o.inbox.id && inbox.eventId === o.event.id && inbox.digest === o.payloadDigest &&
      inbox.objectId === o.event.objectId && o.inbox.stripeEventId === o.event.id &&
      o.inbox.payloadDigest === o.payloadDigest && o.inbox.eventType === o.event.type &&
      o.inbox.objectType === o.event.objectType && o.inbox.objectId === o.event.objectId &&
      o.inbox.providerCreated === o.event.created && !!w.inbox && w.inbox.id === o.inbox.id &&
      w.inbox.stripeEventId === o.event.id && w.inbox.payloadDigest === o.payloadDigest &&
      w.inbox.objectId === o.event.objectId && w.inbox.eventType === o.event.type &&
      w.inbox.objectType === o.event.objectType && w.inbox.providerCreated === o.event.created);
  } else conflict(o.inbox === null && h.inboxId === null && w.inbox === null && !!o.investigationId);
  if (h.disposition === 'INVESTIGATION') {
    const incident = d.investigations.find(x => x.id === p.investigationId);
    if (!incident || !p.investigationId || !w.investigationId) add('INCOMPLETE', 'INVESTIGATION_EVIDENCE_MISSING');
    else conflict(w.investigationId === p.investigationId && incident.eventId === h.eventId && incident.digest === h.digest &&
      incident.durableReceiptId === h.receiptId && (p.reason === 'DIGEST_CONFLICT' ? incident.reason === 'DIGEST_CONFLICT' :
        p.reason === 'UNSUPPORTED' ? incident.reason === 'UNSUPPORTED' : incident.reason === 'UNRESOLVED'));
    conflict(h.lane === 'NONE' && p.reason !== 'OWNED' && p.inboxAction !== 'INSERT_PENDING');
    if (o.disposition === 'INVESTIGATION') conflict(o.investigationId === p.investigationId || p.originalAction === 'PRESERVE');
    if (p.reason === 'DIGEST_CONFLICT') conflict(h.digest !== o.payloadDigest && p.originalAction === 'PRESERVE' && h.ownership === 'DIGEST_CONFLICT');
    else conflict(h.digest === o.payloadDigest);
    if (p.reason !== 'UNSUPPORTED' || p.ownershipObservation !== null && !owned(p.ownershipObservation))
      add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT');
  } else {
    conflict(o.disposition === 'PAYMENT' && h.lane === 'PAYMENT' && h.digest === o.payloadDigest &&
      p.reason === 'OWNED' && h.ownership !== 'UNKNOWN' && h.ownership !== 'UNSUPPORTED' && h.ownership !== 'DIGEST_CONFLICT' &&
      objectOwned(p.event, p.ownershipObservation) && !p.investigationId && !w.investigationId &&
      p.inboxAction === (p.originalAction === 'INSERT' ? 'INSERT_PENDING' : 'PRESERVE') &&
      h.disposition === (p.originalAction === 'INSERT' ? 'INGESTED' : 'DUPLICATE') &&
      ((h.objectType === 'checkout.session' && ['checkout.session.completed', 'checkout.session.expired'].includes(h.type) && h.objectId === d.attempt.sessionId) ||
        (h.objectType === 'payment_intent' && ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'].includes(h.type) && h.objectId === d.attempt.paymentIntentId)));
  }
}

function evaluateFixture(f: AcceptanceFixturePlan['fixtures'][number], mapping: RuntimeMapping | undefined,
  db: DatabaseEvidence | undefined, provider: ProviderEvidence | undefined, hooks: WebhookEvidence | undefined,
  supervision: SupervisionEvidence | undefined, checked: VerifiedSupervision | undefined, review: VerifierReview,
  executionStart: number, executionAccountId: string, add: Add): boolean {
  const d = db?.fixtures.find(x => x.fixtureId === f.fixtureId);
  // These independently established violations do not depend on a missing runtime
  // mapping or provider reader, and therefore retain FAIL precedence.
  if (d) {
    if (d.payments.length > 1 || d.allocations.length > 1) add('FAIL', 'DUPLICATE_FINANCIAL_EFFECT');
    if (d.notices.filter(n => n.event === 'BOOKING_CONFIRMED').length > 1) add('FAIL', 'DUPLICATE_NOTIFICATION');
    if (!unique(d.obligations.map(o => o.id)) || !unique(d.reconciliations.map(r => r.id))) add('FAIL', 'BINDING_CONFLICT');
  }
  if (!mapping || !db) { add('INCOMPLETE', 'EVIDENCE_UNAVAILABLE'); return false; }
  const m = mapping;
  if (!d) { add('INCOMPLETE', 'SCENARIO_MISSING'); return false; }
  const match = (condition: boolean, code: VerifierDiagnostic = 'BINDING_CONFLICT') => { if (!condition) add('FAIL', code); };
  match(m.acceptedAt >= executionStart && m.acceptedAt <= review.asOf, 'DEADLINE_VIOLATION');
  match(m.guestId === f.guest.id && m.unitId === f.stay.unitId && m.namespace === f.namespace && m.operationKey === f.operationKey &&
    d.bookingId === m.bookingId && d.guestId === m.guestId && d.unitId === m.unitId && d.snapshotId === m.snapshotId &&
    d.arrival === f.stay.arrivalDate && d.departure === f.stay.departureDate);
  match(d.totalCents === f.expected.totalCents && d.initialCents === f.expected.initialCents && d.balanceCents === f.expected.balanceCents &&
    d.currency === 'EUR', 'AMOUNT_OR_CURRENCY');
  match(d.obligations.length === 2 && d.obligations.every(o => o.bookingId === m.bookingId && o.currency === 'EUR') &&
    d.obligations.some(o => o.id === m.initialObligationId && o.kind === 'INITIAL' && o.amountCents === d.initialCents) &&
    d.obligations.some(o => o.id === m.balanceObligationId && o.kind === 'BALANCE' && o.amountCents === d.balanceCents));
  const a = d.attempt, c = d.command;
  match(d.hold.id === m.holdId && d.hold.bookingId === m.bookingId && d.hold.attemptId === m.attemptId &&
    a.id === m.attemptId && a.bookingId === m.bookingId && a.holdId === m.holdId && a.obligationId === m.initialObligationId &&
    a.amountCents === d.initialCents && a.currency === 'EUR' && c.id === m.commandId && c.attemptId === m.attemptId);
  match(c.logicalKey === f.expected.logicalKey && c.originalKey === `session-create:${m.attemptId}` &&
    c.originalKey === c.currentKey && c.originalRequestDigest === c.currentRequestDigest &&
    c.dispatches.every(x => x.idempotencyKey === c.originalKey && x.requestDigest === c.originalRequestDigest), 'COMMAND_CHANGED');
  if (!c.dispatches.length || c.firstSubmittedAt === null) add('INCOMPLETE', 'COMMAND_EVIDENCE_MISSING');
  for (const dispatch of c.dispatches) {
    match(dispatch.at >= c.persistedAt && dispatch.at >= (c.firstSubmittedAt ?? Infinity) &&
      dispatch.at + 11_000 < (c.firstSubmittedAt ?? -Infinity) + 86_400_000 && dispatch.at + 11_000 <= dispatch.leaseValidUntil &&
      BigInt(dispatch.generation) <= 9223372036854775807n, 'DEADLINE_VIOLATION');
    const request = supervision?.requests.find(r => r.requestId === dispatch.requestId);
    if (!request || request.invocationId !== dispatch.invocationId || request.attemptId !== a.id || request.commandId !== c.id ||
      request.operation !== 'CHECKOUT_DISPATCH' || request.dispatchedAt !== dispatch.at || !checked?.reservations.has(request.requestId))
      add('INCOMPLETE', 'COMMAND_EVIDENCE_MISSING');
  }
  const acceptance = d.audits.filter(x => x.action === 'quote.accepted');
  if (!acceptance.length) add('INCOMPLETE', 'AUDIT_MISSING');
  else match(acceptance.length === 1 && acceptance[0].id === m.acceptanceAuditId && acceptance[0].at === m.acceptedAt &&
    acceptance[0].transactionId === m.transactionId && acceptance[0].next === 'AWAITING_INITIAL_PAYMENT' &&
    acceptance[0].reason === 'SYNTHETIC_PORTFOLIO', 'STATE_MACHINE_VIOLATION');
  if (d.payments.length > 1 || d.allocations.length > 1) add('FAIL', 'DUPLICATE_FINANCIAL_EFFECT');
  const confirmations = d.audits.filter(x => x.action === 'booking.confirmed');
  const notices = d.notices.filter(x => x.event === 'BOOKING_CONFIRMED');
  if (confirmations.length > 1) add('FAIL', 'STATE_MACHINE_VIOLATION');
  if (notices.length > 1) add('FAIL', 'DUPLICATE_NOTIFICATION');
  match(unique(d.notices.map(n => n.key)) && unique(d.notices.map(n => n.id)), 'NOTIFICATION_IDEMPOTENCY');
  if (!unique(d.inbox.map(x => x.id)) || !unique(d.inbox.map(x => x.eventId))) add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT');
  for (const notice of d.notices) {
    const attempts = d.notificationAttempts.filter(x => x.notificationId === notice.id);
    match(attempts.every(x => x.logicalKey === notice.key) && unique(attempts.map(x => String(x.attempt))), 'NOTIFICATION_IDEMPOTENCY');
  }
  if (d.notificationAttempts.some(x => !d.notices.some(n => n.id === x.notificationId))) add('FAIL', 'NOTIFICATION_IDEMPOTENCY');
  if (d.unresolvedRefundLiabilities || d.investigations.some(x => x.financiallyUncertain)) add('INVESTIGATION_REQUIRED', 'PROVIDER_UNCERTAIN');
  const p = provider?.payments.find(x => x.attemptId === a.id);
  if (!p) add('INCOMPLETE', 'PAYMENT_EVIDENCE_MISSING');
  else {
    if (p.bookingId !== m.bookingId || p.commandId !== m.commandId || p.holdId !== m.holdId || p.sessionId !== a.sessionId ||
      p.paymentIntentId !== a.paymentIntentId) add('INVESTIGATION_REQUIRED', 'BINDING_CONFLICT');
    if (p.ownership !== 'PERSISTED_COMMAND') add('INCOMPLETE', 'INDEPENDENCE_UNVERIFIED');
    match(p.accountId === provider?.accountId && !p.livemode && p.sessionId.startsWith('cs_test_') &&
      (p.paymentIntentId === null || p.paymentIntentId.startsWith('pi_')) && (p.chargeId === null || p.chargeId.startsWith('ch_')), 'PROVIDER_IDENTITY');
    const observation = supervision?.requests.find(x => x.providerRequestId === p.requestId && x.attemptId === m.attemptId &&
      ['PAYMENT_STATUS_RECOVERY', 'PROVIDER_RECONCILIATION'].includes(x.operation));
    if (!observation || observation.outcome !== 'KNOWN') add('INCOMPLETE', 'PAYMENT_EVIDENCE_MISSING');
    if (['UNCERTAIN', 'PROCESSING', 'CONFLICT'].includes(p.outcome)) add('INVESTIGATION_REQUIRED', 'PROVIDER_UNCERTAIN');
    match(p.currency === 'eur' && p.sessionCents === d.initialCents && p.mode === 'payment' && same(p.methods, ['card']) &&
      p.expiresAt - p.createdAt >= 29 * 60_000 && p.expiresAt - p.createdAt <= 31 * 60_000, 'AMOUNT_OR_CURRENCY');
  }
  const deliveries = hooks?.deliveries.filter(x => x.fixtureId === f.fixtureId) ?? [];
  const observations = (hooks?.handoffObservations ?? []).map(value => witnessSchema.safeParse(value));
  for (const h of deliveries) {
    match(h.bookingId === m.bookingId && h.attemptId === m.attemptId && h.commandId === m.commandId);
    if (hooks) verifyHandoff(h, hooks, d, m, review, add, observations);
    if (h.signature === 'UNVERIFIED' || !h.signatureEvidenceRef || review.evidenceClass === 'RECORDED' && h.signature !== 'VERIFIED_RAW_BYTES')
      add('INCOMPLETE', 'WEBHOOK_EVIDENCE_MISSING');
    if (h.receivedAt > review.asOf || h.createdAt > h.receivedAt) add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT');
    if (h.ownership === 'UNSUPPORTED' && ((h.objectType === 'checkout.session' && ['checkout.session.completed', 'checkout.session.expired'].includes(h.type)) ||
      (h.objectType === 'payment_intent' && ['payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_intent.canceled'].includes(h.type))))
      add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT');
  }
  if (f.name === 'INVESTIGATION') {
    match(d.bookingState !== 'CONFIRMED' && d.hold.state !== 'CONSUMED' && d.allocations.length === 0 &&
      d.payments.length === 0 && confirmations.length === 0 && notices.length === 0, 'FALSE_CONFIRMATION');
    if (!d.investigations.length || !deliveries.length) add('INCOMPLETE', 'INVESTIGATION_EVIDENCE_MISSING');
    for (const incident of d.investigations) {
      const h = deliveries.find(x => x.eventId === incident.eventId && x.digest === incident.digest && x.receiptId === incident.durableReceiptId);
      if (!h || h.disposition !== 'INVESTIGATION' || h.lane !== 'NONE' || h.ownership === 'PERSISTED_RELATIONSHIPS')
        add('INCOMPLETE', 'INVESTIGATION_EVIDENCE_MISSING');
      if (incident.reason !== 'UNSUPPORTED' || incident.financiallyUncertain || p && p.outcome !== 'NONE')
        add('INVESTIGATION_REQUIRED', 'PROVIDER_UNCERTAIN');
    }
    const claim = db.claims.find(x => x.id === m.claimId);
    match(!!claim && !claim.released && claim.holdId === m.holdId && claim.bookingId === null &&
      d.bookingState === 'AWAITING_INITIAL_PAYMENT', 'INVENTORY_VIOLATION');
    return false;
  }
  const { planDigest: unusedPlan, ...bindingBase } = review.binding; void unusedPlan;
  verifyOriginalTransaction(d, m, bindingBase, review.asOf, executionAccountId, add);
  if (d.investigations.length || deliveries.some(h => h.digest !== h.originalDigest || h.disposition === 'INVESTIGATION'))
    add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT');
  if (!d.payments.length || !d.allocations.length) add('INCOMPLETE', 'PAYMENT_EVIDENCE_MISSING');
  if (p?.outcome !== 'CAPTURED') add('INCOMPLETE', 'PAYMENT_EVIDENCE_MISSING');
  else match(p.receivedCents === d.initialCents && p.chargeCents === d.initialCents && p.chargePaid && p.chargeCaptured &&
    p.sessionStatus === 'complete' && p.paymentStatus === 'paid' && p.intentStatus === 'succeeded' && !!p.chargeId && !!p.paymentIntentId,
    'AMOUNT_OR_CURRENCY');
  const pay = d.payments[0], allocation = d.allocations[0], rec = d.reconciliations.find(x => x.id === pay?.reconciliationId);
  if (pay && allocation) match(pay.attemptId === a.id && pay.bookingId === m.bookingId && pay.obligationId === m.initialObligationId &&
    pay.currency === 'EUR' && pay.amountCents === d.initialCents && pay.allocationState === 'ALLOCATED' &&
    allocation.paymentId === pay.id &&
    allocation.obligationId === pay.obligationId && allocation.amountCents === pay.amountCents, 'BINDING_CONFLICT');
  if (pay && p && (pay.paymentIntentId !== p.paymentIntentId || pay.chargeId !== p.chargeId)) add('INVESTIGATION_REQUIRED', 'BINDING_CONFLICT');
  if (!rec) add('INCOMPLETE', 'PAYMENT_EVIDENCE_MISSING');
  else match(rec.attemptId === a.id && rec.sessionId === a.sessionId && rec.paymentIntentId === a.paymentIntentId &&
    rec.amountCents === d.initialCents && rec.currency === 'EUR' && rec.kind === 'STRIPE_CURRENT' && rec.result === 'VERIFIED_INITIAL');
  if (!confirmations.length) add('INCOMPLETE', 'AUDIT_MISSING');
  const confirmation = confirmations[0];
  if (confirmation) match(confirmation.prior === 'AWAITING_INITIAL_PAYMENT' && confirmation.next === 'CONFIRMED' &&
    confirmation.service === 'payment-reconciliation' && confirmation.reason === 'VERIFIED_INITIAL_CAPTURE' &&
    !!rec && rec.at >= m.acceptedAt && d.hold.terminalAt !== null &&
    rec.at <= d.hold.terminalAt && d.hold.terminalAt <= confirmation.at && confirmation.at <= review.asOf &&
    d.hold.transitionTransactionId === confirmation.transactionId && confirmation.transactionId === pay?.transactionId &&
    confirmation.transactionId === allocation?.transactionId && confirmation.transactionId === rec?.transactionId,
    'STATE_MACHINE_VIOLATION');
  match(d.bookingState === 'CONFIRMED' && d.hold.state === 'CONSUMED' && a.state === 'SUCCEEDED', 'STATE_MACHINE_VIOLATION');
  if (!notices.length) add('INCOMPLETE', 'NOTIFICATION_MISSING');
  else match(notices[0].key === `booking-confirmed:${m.bookingId}` && notices[0].auditId === confirmation?.id &&
    notices[0].bookingId === m.bookingId && notices[0].recipientId === m.guestId && notices[0].locale === f.guest.locale &&
    notices[0].transactionId === confirmation?.transactionId, 'NOTIFICATION_IDEMPOTENCY');
  const history = d.claimHistory, first = history[0], last = history.at(-1), claim = db.claims.find(x => x.id === m.claimId);
  if (history.length < 2 || !claim) add('INCOMPLETE', 'INVENTORY_TRANSFER_MISSING');
  else match(first.claimId === m.claimId && first.holdId === m.holdId && first.bookingId === null &&
    first.originHoldId === null && history.length === 2 && first.transactionId === m.transactionId && first.at === m.acceptedAt && history.every((h, i) => h.claimId === m.claimId && !h.released &&
      (i === 0 || h.at >= history[i - 1].at)) && last!.holdId === null && last!.bookingId === m.bookingId &&
    last!.originHoldId === m.holdId && last!.transactionId === confirmation?.transactionId &&
    !!rec && last!.at >= rec.at && d.hold.terminalAt !== null && last!.at <= d.hold.terminalAt &&
    claim.holdId === null && claim.bookingId === m.bookingId && claim.originHoldId === m.holdId && !claim.released &&
    claim.unitId === m.unitId && claim.arrival === f.stay.arrivalDate && claim.departure === f.stay.departureDate &&
    !db.claims.some(x => !x.released && x.id !== m.claimId && (x.bookingId === m.bookingId || x.holdId === m.holdId)), 'INVENTORY_VIOLATION');
  const signed = deliveries.filter(h => h.ownership === 'PERSISTED_RELATIONSHIPS' && h.disposition !== 'INVESTIGATION' &&
    d.inbox.some(x => x.id === h.inboxId && x.state === 'PROCESSED') &&
    h.lane === 'PAYMENT' && h.digest === h.originalDigest && ((h.type === 'checkout.session.completed' && h.objectType === 'checkout.session' && h.objectId === a.sessionId) ||
      (h.type === 'payment_intent.succeeded' && h.objectType === 'payment_intent' && h.objectId === a.paymentIntentId)));
  if (f.name === 'MISSING_WEBHOOK') {
    const recovery = supervision?.recovery.find(x => x.id === rec?.recoveryId && x.attemptId === a.id && x.reconciliationId === rec?.id);
    const invocation = recovery ? checked?.invocations.get(recovery.invocationId) : undefined;
    const execution = supervision?.executions.find(x => x.invocationId === recovery?.invocationId);
    const request = supervision?.requests.find(x => x.invocationId === recovery?.invocationId && x.attemptId === a.id &&
      x.operation === 'PAYMENT_STATUS_RECOVERY' && x.outcome === 'KNOWN');
    if (deliveries.length || d.inbox.length || rec?.webhookEventId || !recovery || !invocation?.finished || execution?.origin !== 'SCHEDULED' ||
      !request || !recovery.finishAccepted || recovery.at < (invocation.started ?? Infinity) || recovery.at >= invocation.deadline ||
      recovery.at >= recovery.leaseUntil || !rec || recovery.at < rec.at || recovery.at > (invocation.ended ?? -1) || recovery.leaseOwner !== execution.owner ||
      BigInt(recovery.generation) > 9223372036854775807n) add('INCOMPLETE', 'RECOVERY_UNPROVEN');
  } else {
    if (!signed.some(h => h.inboxId === rec?.webhookEventId)) add('INCOMPLETE', 'WEBHOOK_EVIDENCE_MISSING');
    if (rec && deliveries.some(h => h.receivedAt > rec.at)) add('INCOMPLETE', 'DUPLICATE_SCENARIO_UNPROVEN');
  }
  if (f.name === 'DUPLICATE_DELIVERY') {
    const duplicate = signed.some((h, i) => signed.some((j, k) => k !== i && j.eventId === h.eventId && j.digest === h.digest &&
      j.disposition === 'DUPLICATE' && j.deliveryId !== h.deliveryId));
    const ordered = [...deliveries].sort((a, b) => a.receivedAt - b.receivedAt);
    const reordered = ordered.some((h, i) => ordered.slice(0, i).some(j => j.createdAt > h.createdAt && j.eventId !== h.eventId));
    if (!duplicate || !reordered) add('INCOMPLETE', 'DUPLICATE_SCENARIO_UNPROVEN');
  }
  if (f.name === 'DELAYED_COMMAND' && (!c.dispatches.length || c.dispatches[0].at <= c.persistedAt || c.state !== 'RESOLVED'))
    add('INCOMPLETE', 'DELAY_UNPROVEN');
  return !!p && p.outcome === 'CAPTURED' && !!pay && !!allocation;
}

/** Read-only, source-only evaluation. No routes, operational factories, credentials,
 * SQL, worker, provider calls or journal writes. Readers must supply detached data. */
async function evaluateEvidence(run: SealedAcceptanceRun, plan: AcceptanceFixturePlan,
  deps: { now: () => number; readers: AcceptanceEvidenceReaders }, retained: boolean): Promise<VerifierReport> {
  const global: Issue[] = [], local = new Map<Scenario, Issue[]>(ACCEPTANCE_SCENARIOS.map(s => [s, []]));
  const add: Add = (v, code) => { global.push({ verdict: v, code }); };
  let review: VerifierReview | undefined, binding: VerifierBinding | undefined;
  const anchors: Partial<Record<EvidenceChannel, string>> = {}, paid = new Set<Scenario>();
  const data: { bindings?: { mappings: RuntimeMapping[] }; database?: DatabaseEvidence; provider?: ProviderEvidence;
    webhooks?: WebhookEvidence; supervision?: SupervisionEvidence } = {};
  function finish(): VerifierReport {
    const scenarios = ACCEPTANCE_SCENARIOS.map(s => {
      const issues = [...global, ...local.get(s)!], v = verdict(issues);
      return Object.freeze({ scenario: s, verdict: v, paidBookingVerified: v === 'PASS' && paid.has(s),
        expectedInvestigationSafe: s === 'INVESTIGATION' && v === 'PASS',
        diagnostics: Object.freeze([...new Set(issues.map(i => i.code))].sort()) });
    });
    const all = [...global, ...[...local.values()].flat()];
    const base = { stage: '2C-3H' as const, verdict: verdict(all), operationsEnabled: false as const,
      verificationMode: retained ? 'RETAINED_READ_ONLY_V2' as const : 'IN_WINDOW_V1' as const,
      evidenceClass: review?.evidenceClass ?? 'UNVERIFIED' as const, diagnostics: Object.freeze([...new Set(all.map(i => i.code))].sort()),
      scenarios: Object.freeze(scenarios) };
    return Object.freeze({ ...base, ...(binding && review ? { provenance: Object.freeze({ runId: binding.runId,
      manifestDigest: binding.manifestDigest, planDigest: binding.planDigest, snapshotSetId: review.snapshotSetId,
      evidenceDigests: Object.freeze({ ...anchors }), reportDigest: digest({ ...base, binding, anchors }) }) } : {}) });
  }
  try {
    try {
      requireSealedAcceptanceRun(run); requireAcceptanceFixturePlan(run, plan);
      if (['prepare-booking', 'dispatch-checkout', 'ingest-payment-webhook', 'reconcile-payment', 'verify-read-only']
        .some(op => !run.operations.some(allowed => allowed === op))) throw Error('UNAPPROVED');
      binding = Object.freeze({ runId: run.runId, manifestDigest: digest(run), sourceDigest: run.sourceDigest,
        migrationDigest: run.migrationDigest, planDigest: plan.planDigest, targetDigest: digest(run.target), database: run.target.database });
    } catch { add('INCOMPLETE', 'INVALID_RUN_OR_PLAN'); return finish(); }
    const readers = deps.readers;
    if (!reader(readers.authority)) { add('INCOMPLETE', 'READER_REJECTED'); return finish(); }
    let frozenAt: number | undefined;
    try {
      const raw = await readers.authority.read(binding);
      if (retained) {
        const archive = retainedReviewSchema.parse(raw);
        frozenAt = archive.frozenAt;
        review = { ...archive, kind: 'independent-verifier-review-v1' };
      } else review = reviewSchema.parse(raw);
    }
    catch { add('INCOMPLETE', 'AUTHORITY_UNAVAILABLE'); return finish(); }
    if (!same(review.binding, binding) || review.approvalReference !== run.approvalReference) {
      add('INVESTIGATION_REQUIRED', 'PROVENANCE_CONFLICT'); return finish();
    }
    const resources = [run.target.project, run.target.container, run.target.network, run.target.volume, run.target.database,
      run.target.containerId, run.target.networkId, run.target.volumeIdentity];
    if (run.target.database !== freshAcceptanceNames(run.runId).database || !same([...review.inventory.reservedResources].sort(), [...resources].sort()) ||
      resources.some(r => review!.inventory.foreignResources.includes(r))) { add('FAIL', 'TARGET_REJECTED'); return finish(); }
    const validTime = () => { const now = deps.now(); return Number.isSafeInteger(now) && now >= review!.notBefore && now < review!.expiresAt &&
      now >= review!.asOf && (retained ? frozenAt! <= now && frozenAt! >= review!.asOf &&
        frozenAt! - review!.asOf <= 30_000 && frozenAt! <= Date.parse(run.expiresAt) &&
        review!.asOf >= Date.parse(run.notBefore) && review!.notBefore >= frozenAt! : now - review!.asOf <= 30_000); };
    if (!validTime() || !retained && (review.notBefore < Date.parse(run.notBefore) || review.expiresAt > Date.parse(run.expiresAt))) {
      add('INCOMPLETE', 'EVIDENCE_STALE'); return finish();
    }
    const producers = EVIDENCE_CHANNELS.map(c => review!.anchors[c].producer);
    const capabilities = [readers.authority, ...EVIDENCE_CHANNELS.map(c => readers[c]).filter((r): r is AcceptanceEvidenceReader => !!r)];
    if (!unique([...producers, review.reviewer]) || new Set(capabilities).size !== capabilities.length ||
      new Set(capabilities.map(r => r.read)).size !== capabilities.length) {
      add('INCOMPLETE', 'INDEPENDENCE_UNVERIFIED'); return finish();
    }
    for (const channel of EVIDENCE_CHANNELS) {
      const source = readers[channel];
      if (!reader(source)) { add('INCOMPLETE', source ? 'READER_REJECTED' : 'EVIDENCE_UNAVAILABLE'); continue; }
      let raw: unknown;
      try { raw = await source.read(binding); } catch { add('INCOMPLETE', 'EVIDENCE_UNAVAILABLE'); continue; }
      try {
        // Copy before later readers can mutate an already checked snapshot.
        const encoded = canonicalRunJson(raw);
        if (Buffer.byteLength(encoded) > 4 * 1024 * 1024) throw Error('BOUNDED');
        const e = envelopeSchema.parse(JSON.parse(encoded)), anchor = review.anchors[channel];
        if (!same(e.binding, binding) || e.channel !== channel || e.snapshotSetId !== review.snapshotSetId ||
          e.producer !== anchor.producer || e.recordId !== anchor.recordId || digest(e) !== anchor.digest ||
          e.evidenceClass !== review.evidenceClass || e.asOf !== review.asOf) {
          add('INVESTIGATION_REQUIRED', 'PROVENANCE_CONFLICT'); continue;
        }
        const captureLimit = retained ? frozenAt! : deps.now();
        if (e.observedAt < e.asOf || e.observedAt > captureLimit || captureLimit - e.observedAt > 30_000) {
          add('INCOMPLETE', 'EVIDENCE_STALE'); continue;
        }
        const parsed = payloadSchemas[channel].parse(e.data);
        Object.assign(data, { [channel]: parsed }); anchors[channel] = anchor.digest;
      } catch { add('INCOMPLETE', 'EVIDENCE_INVALID'); }
    }
    if (!validTime()) { add('INCOMPLETE', 'EVIDENCE_STALE'); return finish(); }
    const expected = plan.fixtures.map(f => f.fixtureId), mappings = data.bindings?.mappings ?? [];
    if (data.bindings && (!unique(mappings.map(m => m.fixtureId)) || mappings.some(m => !expected.includes(m.fixtureId)))) add('FAIL', 'FOREIGN_FIXTURE');
    for (const key of ['bookingId', 'snapshotId', 'initialObligationId', 'balanceObligationId', 'holdId', 'claimId', 'attemptId', 'commandId'] as const)
      if (!unique(mappings.map(m => m[key]))) add('FAIL', 'BINDING_CONFLICT');
    if (data.database) {
      const db = data.database;
      if (!unique(db.fixtures.map(f => f.fixtureId)) || db.fixtures.some(f => !expected.includes(f.fixtureId))) add('FAIL', 'FOREIGN_FIXTURE');
      for (const ids of [db.fixtures.flatMap(f => f.payments.map(p => p.paymentIntentId)), db.fixtures.flatMap(f => f.payments.map(p => p.chargeId)),
        db.fixtures.flatMap(f => f.payments.map(p => p.id)), db.fixtures.flatMap(f => f.allocations.map(p => p.id))])
        if (!unique(ids)) add('FAIL', 'DUPLICATE_FINANCIAL_EFFECT');
      if (!unique(db.claims.map(c => c.id))) add('FAIL', 'INVENTORY_VIOLATION');
      for (const [i, claim] of db.claims.entries()) {
        if (claim.arrival >= claim.departure || [claim.holdId, claim.bookingId, claim.operatorBlockId].filter(Boolean).length !== 1) add('FAIL', 'INVENTORY_VIOLATION');
        if (!claim.released && db.claims.slice(i + 1).some(c => !c.released && c.unitId === claim.unitId && c.arrival < claim.departure && claim.arrival < c.departure))
          add('FAIL', 'INVENTORY_VIOLATION');
      }
    }
    if (data.provider) {
      const p = data.provider;
      if (p.accountId !== run.stripe.accountId || p.livemode) add('FAIL', 'PROVIDER_IDENTITY');
      if (p.authenticity === 'UNVERIFIED' || review.evidenceClass === 'RECORDED' && p.authenticity !== 'AUTHENTICATED_STRIPE_TEST_READ') add('INCOMPLETE', 'INDEPENDENCE_UNVERIFIED');
      if (!unique(p.payments.map(p => p.attemptId)) || data.bindings && p.payments.some(p => !mappings.some(m => m.attemptId === p.attemptId))) add('INVESTIGATION_REQUIRED', 'PROVENANCE_CONFLICT');
    }
    if (data.webhooks) {
      const h = data.webhooks;
      if (h.accountId !== run.stripe.accountId || h.endpointId !== run.stripe.webhookEndpointId || h.livemode) add('FAIL', 'PROVIDER_IDENTITY');
      if (!unique(h.deliveries.map(h => h.deliveryId)) || h.deliveries.some(h => !expected.includes(h.fixtureId))) add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT');
      for (const raw of h.handoffObservations ?? []) {
        const observation = witnessSchema.safeParse(raw);
        if (!observation.success) add('INCOMPLETE', 'WEBHOOK_EVIDENCE_MISSING');
        else if (!h.deliveries.some(d => d.deliveryId === observation.data.plan.deliveryId)) add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT');
      }
      for (const [index, delivery] of h.deliveries.entries()) {
        if (h.deliveries.slice(0, index).some(prior => prior.eventId === delivery.eventId &&
          (prior.originalDigest !== delivery.originalDigest || prior.type !== delivery.type || prior.objectId !== delivery.objectId ||
            prior.objectType !== delivery.objectType || prior.inboxId !== delivery.inboxId))) add('INVESTIGATION_REQUIRED', 'WEBHOOK_CONFLICT');
      }
    }
    const checked = data.supervision ? verifySupervision(run, data.supervision, review, add) : undefined;
    for (const scenario of ACCEPTANCE_SCENARIOS) {
      const issues = local.get(scenario)!, append: Add = (v, code) => { issues.push({ verdict: v, code }); };
      const f = plan.fixtures.find(f => f.name === scenario);
      if (!f) { append('INCOMPLETE', 'SCENARIO_MISSING'); continue; }
      if (evaluateFixture(f, mappings.find(m => m.fixtureId === f.fixtureId), data.database, data.provider, data.webhooks,
        data.supervision, checked, review, Date.parse(run.notBefore), run.stripe.accountId, append)) paid.add(scenario);
    }
  } catch { add('INCOMPLETE', 'EVIDENCE_INVALID'); }
  return finish();
}

/** Existing v1 in-window contract remains the default. */
export function verifyAcceptanceEvidence(run: SealedAcceptanceRun, plan: AcceptanceFixturePlan,
  deps: { now: () => number; readers: AcceptanceEvidenceReaders }): Promise<VerifierReport> {
  return evaluateEvidence(run, plan, deps, false);
}

/** Explicit v2 archive review only; never authorises execution or reconstructs
 * an expired/copy-issued run or plan. Protected reconstruction is still required. */
export function verifyRetainedAcceptanceEvidence(run: SealedAcceptanceRun, plan: AcceptanceFixturePlan,
  deps: { now: () => number; readers: AcceptanceEvidenceReaders }): Promise<VerifierReport> {
  return evaluateEvidence(run, plan, deps, true);
}
