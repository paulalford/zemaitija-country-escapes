import { createHash } from 'node:crypto';
import { vi } from 'vitest';
import { createAtomicAcceptanceWebhookIngestion, type AtomicHandoffDriver, type AtomicHandoffTransaction,
  type AtomicHandoffOwnership, type AtomicHandoffPlan, type OriginalHandoffDisposition } from '../../src/server/stripe-acceptance-atomic-handoff';
import { financialEvidenceBinding, financialEvidenceDigest, type OriginalTransactionIdentity } from '../../src/server/stripe-acceptance-financial-evidence';
import type { VerifiedEvent } from '../../src/server/stripe-adapter';
import { forwardingRun } from './stripe-acceptance-forwarding-fixture';
import { syntheticId } from './stripe-verifier-fixture';

/** Simulated atomic database and DISTINCT simulated read-only commit observer.
 * No SQL, provider, OS lock, actual durable store or operational fixture execution. */
export function remediationHandoffFixture() {
  const run = forwardingRun(), binding = financialEvidenceBinding(run), now = () => Date.now();
  const token = 'abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789';
  const raw = Buffer.from('{ "synthetic": "Žemaitija 😀" }\r\n');
  const event: VerifiedEvent = { id: 'evt_synthetic', type: 'checkout.session.completed', objectType: 'checkout.session',
    objectId: 'cs_test_synthetic', created: Math.floor(now() / 1000), accountId: run.stripe.accountId, livemode: false };
  const owner: AtomicHandoffOwnership = { binding, fixtureId: syntheticId(10), bookingId: syntheticId(11), obligationId: syntheticId(12),
    commandId: syntheticId(13), attemptId: syntheticId(14), holdId: syntheticId(15), commandAttemptId: syntheticId(14),
    attemptBookingId: syntheticId(11), attemptObligationId: syntheticId(12), attemptHoldId: syntheticId(15),
    sessionId: event.objectId, paymentIntentId: 'pi_synthetic', originalRequestDigest: 'a'.repeat(64), currentRequestDigest: 'a'.repeat(64),
    originalKey: `session-create:${syntheticId(14)}`, currentKey: `session-create:${syntheticId(14)}` };
  let ownership: unknown = owner, original: OriginalHandoffDisposition | null = null, fenced = false, count = 0, txNumber = 10;
  const inboxes = new Map<string, NonNullable<OriginalHandoffDisposition['inbox']>>(), incidents = new Set<string>();
  const committedPlans = new Map<string, AtomicHandoffPlan>(), trace: string[] = [];
  let failure: 'NONE' | 'BEFORE_COMMIT' | 'AFTER_COMMIT' | 'MISSING_INBOX' | 'MISSING_INCIDENT' | 'CLOSE' = 'NONE';
  let queue = Promise.resolve();
  const driver: AtomicHandoffDriver = { writerId: 'synthetic-admission-writer',
    fence: vi.fn(async () => { fenced = true; trace.push('fenced'); }),
    begin: vi.fn(async () => {
      if (fenced) throw Error('FENCED');
      const identity: OriginalTransactionIdentity = { mechanism: 'POSTGRES_XID8', xid8: String(++txNumber), backendPid: 41,
        transactionId: `pg-xid8:${txNumber}` };
      let staged: AtomicHandoffPlan | undefined, unlock: (() => void) | undefined;
      const tx: AtomicHandoffTransaction = { identity,
        lockEventAndRead: vi.fn(async () => {
          const previous = queue; queue = new Promise<void>(resolve => { unlock = resolve; }); await previous;
          trace.push('locked'); return structuredClone(original);
        }),
        readPersistedOwnership: vi.fn(async () => structuredClone(ownership)),
        stage: vi.fn(async plan => {
          trace.push('staged'); staged = structuredClone(plan);
          return { kind: 'ATOMIC_DISPOSITION_STAGED', transaction: identity, plan: structuredClone(plan), planDigest: financialEvidenceDigest(plan) };
        }),
        commit: vi.fn(async () => {
          trace.push('commit');
          if (!staged || failure === 'BEFORE_COMMIT') return { outcome: 'REJECTED', transaction: identity };
          if (staged.originalAction === 'INSERT') original = structuredClone(staged.original);
          if (staged.inboxAction === 'INSERT_PENDING' && failure !== 'MISSING_INBOX') inboxes.set(staged.original.inbox!.id, structuredClone(staged.original.inbox!));
          if (staged.investigationId && failure !== 'MISSING_INCIDENT') incidents.add(staged.investigationId);
          committedPlans.set(staged.deliveryId, structuredClone(staged));
          trace.push('applied');
          return { outcome: failure === 'AFTER_COMMIT' ? 'UNCERTAIN' : 'COMMITTED', transaction: identity };
        }),
        rollback: vi.fn(async () => { trace.push('rollback'); staged = undefined; return 'REJECTED' as const; }),
        close: vi.fn(async () => { trace.push('closed'); unlock?.(); return failure === 'CLOSE' ? 'UNKNOWN' : 'SETTLED'; }),
      };
      return tx;
    }),
  };
  const commitReader = { readerId: 'synthetic-independent-inbox-reader', observe: vi.fn(async (_binding, deliveryId: string) => {
    trace.push('observe');
    const plan = committedPlans.get(deliveryId);
    if (!plan) throw Error('NOT_COMMITTED');
    return { kind: 'INDEPENDENT_COMMITTED_HANDOFF', readerId: commitReader.readerId, evidenceRef: `commit-${deliveryId}`,
      binding, transaction: plan.transaction, plan: structuredClone(plan), planDigest: financialEvidenceDigest(plan), outcome: 'COMMITTED',
      inbox: plan.original.inbox ? structuredClone(inboxes.get(plan.original.inbox.id) ?? null) : null,
      investigationId: plan.investigationId && incidents.has(plan.investigationId) ? plan.investigationId : null };
  }) };
  const grant = { status: 'VERIFIED', ...{ runId: run.runId, manifestDigest: binding.manifestDigest },
    forwardingProfile: 'fresh-loopback-webhook-v1', operation: 'ingest-payment-webhook',
    notBefore: run.notBefore, expiresAt: run.expiresAt, reservationVerified: true, targetVerified: true,
    accountVerified: true, durableAdmissionVerified: true };
  const proof = { kind: 'SIMULATED_RAW_BYTES', accountId: run.stripe.accountId, endpointId: run.stripe.webhookEndpointId,
    payloadDigest: createHash('sha256').update(raw).digest('hex'), evidenceRef: 'synthetic-raw-signature' };
  const signatureVerifier = { verify: vi.fn(() => ({ event: { ...event }, signature: { ...proof } })) };
  const deps = { now, authority: { verify: vi.fn(async () => ({ ...grant })) }, credentials: { readBearer: vi.fn(async () => token) },
    signatureVerifier, driver, commitReader, nextId: () => syntheticId(100 + count++), evidenceClass: 'SIMULATED' as 'SIMULATED' | 'RECORDED' };
  const input = () => ({ raw, signature: `t=${Math.floor(now() / 1000)},v1=${'a'.repeat(64)}`, authorization: `Bearer ${token}` });
  const ingest = () => createAtomicAcceptanceWebhookIngestion(run, deps)(input());
  return { run, binding, owner, raw, event, proof, deps, driver, commitReader, grant, trace, inboxes, incidents, committedPlans, input, ingest,
    ownership: (o: unknown) => { ownership = o; }, failure: (f: typeof failure) => { failure = f; },
    original: () => original, fenced: () => fenced };
}
