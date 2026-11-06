# Stage 2C-3E — Signed webhook forwarding source contract

Source and deterministic tests only. No endpoint, listener, tunnel, proxy, queue,
worker or scheduler is mounted or activated. No genuine Stripe webhook is used.

## Reviewed existing behavior

The public webhook uses the shared database pool; Stage 2C-2 pins the old isolated
target and requires its own bearer. Neither is a fresh-run destination. The existing
ingestStripeWebhook verifies signatures and account/test mode, hashes raw bytes and
increments delivery_count on an event-ID conflict. It does **not** compare conflicting
digests. Its relevant set includes refunds; only processPaymentWebhookInbox uses the
five exact payment event/object pairs. The generic legacy processor can process
refunds and must not be used here. Existing attempt fallback lookup also lacks
acceptance-run ownership admission. None of those shared mechanisms is changed.

Reused: the unchanged fresh profile/seal and canonical manifest digest, the existing
AutomationScope and boundedAutomationFetch, and the StripeGateway.verifyEvent
interface (type only). No provider SDK or shared client is imported by this boundary.

## Fixed routing and separate authority

createAcceptanceWebhookForwarder accepts an issued SealedAcceptanceRun and trusted
injected dependencies. The manifest must permit ingest-payment-webhook. The new
reviewed mapping `fresh-loopback-webhook-v1` fixes:

- Incoming method/path: POST `/stripe/acceptance/RUN_ID/webhook`.
- Destination: `http://127.0.0.1:3101/api/acceptance/runs/RUN_ID/stripe/webhook`.
- Fresh database identity: only the sealed manifest target, never an HTTP field,
  environment fallback or the PostgreSQL address interpreted as an HTTP endpoint.

The new mapping is a source contract; port 3101 is not reserved or listening. It
does not modify the Stage 2C-3B profile or mount the Stage 2C-2 adapter. Future trusted
host verification must prove that this listener belongs to the exact fresh run,
uses its attested database and has the required durable admission schema/capabilities.

A separate authority.verify capability must independently verify protected approval,
exclusive reservation, actual target, account and durable admission capability. Its
strict short-lived grant binds run ID, canonical manifest hash, forwarding profile,
operation and a validity window contained within the manifest window. It is checked
before reading the body and again before transmission. An in-process seal alone
is insufficient. Stage 2C-3D always returns pending and cannot grant this authority.
No real authority adapter is implemented or installed; tests inject synthetic grants.

Authority and credential dependencies belong to a separately reviewed launcher,
never HTTP input. As in earlier checkpoints, trusted injection is not protection
against hostile code that fabricates evidence or ignores transport arguments.

## Request bytes and authentication

The input carries raw header tuples, preserving duplicate-header detection before
Headers/framework normalization. A future HTTP adapter must supply original tuples
and untouched stream bytes. Strict input fields reject URL/database/run/auth overrides.
Incoming Authorization is rejected; routing/internal/unknown headers are rejected.
Ordinary Host/User-Agent/Accept/Connection/content headers are ignored, never trusted
or copied as authority. Encoded/compressed bodies are not accepted through headers.

Exactly one Stripe-Signature header is required. The version-1 grammar permits one
timestamp and up to four v1 digests, with comma whitespace preserved in forwarding.
Missing, repeated, malformed, stale or excessively future timestamps reject. The
300-second header freshness check is not cryptographic verification. The downstream
must still use the correct registered endpoint secret and normal SDK signature
verification; never disable replay/timestamp checks or substitute a CLI endpoint secret.

Raw bytes are copied/concatenated without UTF-8 decoding, JSON parsing, normalization
or reserialization. Only Content-Type, original Stripe-Signature and the privately
injected Authorization bearer are sent. The host credential source is separate from
approval and receives no request credentials. No secret, payload or private URL is
included in result diagnostics.

## Bounds, acknowledgement and uncertainty

Fixed reviewed limits: 1 MiB inbound body; 2-second body scope; 5-second overall scope;
one downstream attempt. The reused transport bounds headers/body to 1 second and
1 MiB. A successful acknowledgement additionally requires a JSON receipt <=4 KiB.
Manifest and authority expiry can shorten these limits. Redirect mode is manual;
3xx, redirected responses and changed response URLs are rejected. There is no retry.

Already-aborted input or expired authority rejects before fetch. NOT_SENT means the
injected downstream fetch was never invoked. Once invoked, even a synchronous error
is conservatively UNCERTAIN: cancellation cannot prove no request or commit occurred.
Scopes abort supported reads/transport. Reader/transport cleanup is cooperative and
awaited; a dependency ignoring cancellation or stalling cleanup still needs external
supervision. No strict wall-clock settlement guarantee or rollback claim is made.

| Downstream result | Forwarding result |
| --- | --- |
| 200 + validated durable receipt | 200, DURABLE |
| 200 without receipt, wrong binding/digest, malformed or oversized receipt | 503, UNCERTAIN |
| 400 invalid signature/event | 400, rejected |
| 401 invalid internal authority | 401, rejected |
| 413 excessive payload | 413, rejected |
| 503 target/storage/commit uncertainty | 503, UNCERTAIN |
| Any other status, redirect or transport failure | 503, UNCERTAIN |

There is no acknowledgement queue or cached-body retry. A receipt means durable
ingestion/investigation, never booking payment success. Provider redelivery with a
fresh valid signature is the retry mechanism; do not reuse expired signed requests.

## Separate downstream admission contract — no database implementation

createAcceptanceWebhookIngestion is unmounted source orchestration. It independently
checks host authority and private bearer, then calls the injected existing-compatible
verifyEvent on exact raw bytes. It checks account/test mode and verified event shape
before handing metadata/digest to an AtomicAcceptanceAdmission capability.

There is deliberately **no default admission store**. Missing capability returns
503/DURABLE_STORE_REQUIRED. It does not call the existing unscoped ingester as a
fallback. No actual SQL, migration, financial reconciliation or fixture is introduced.

The future admission transaction must atomically:

1. Recheck actual fresh target and run ownership through known persisted booking,
   attempt, provider command, Session and PaymentIntent relationships. Verify
   immutable request/correlation bindings; a metadata run ID alone cannot prove it.
   For a not-yet-bound provider object, retain investigation evidence unless a
   separately reviewed persisted-command correlation procedure establishes ownership.
2. Serialize event-ID admission and compare the raw payload digest with the original.
   Keep original identity, digest and financial processing history immutable.
3. Admit only owned checkout.session.completed/expired or payment_intent.succeeded,
   payment_failed/canceled events with their exact object types to the payment lane.
4. Durably record unknown/conflicting ownership, unsupported/refund/dispute/chargeback
   events and conflicting event-ID digests outside that lane. Do not trigger refunds,
   reconcile money or reset previously committed processing from the HTTP path.
5. Commit inbox/delivery/incident evidence before returning a receipt. On lost commit
   acknowledgement return uncertainty, not a success inferred from an attempted write.

The receipt binds run, manifest, incoming and original payload digests, verified event
ID/type/object, disposition, ownership and lane. Ordinary duplicates require identical
original/incoming digests. A different original digest requires DIGEST_CONFLICT and
INVESTIGATION/NONE, never ordinary duplicate acknowledgement. Unknown ownership and
unsupported events similarly require durable investigation. A 200 investigation
receipt acknowledges preserved evidence, not payment processing. Consumers must
retain the distinction in nonsecret operational evidence.

Additional separately authorised DDL/capabilities are required for append-only
delivery/incident evidence, immutable original digest comparison, atomic ownership
admission and restricted grants. Their exact schema and concurrency behavior need
independent source review and later disposable-PostgreSQL acceptance. This checkpoint
provides only the fail-closed capability contract and synthetic in-memory model.

## Outstanding gates and preservation

Still required: real independent host authority, protected credential source, reviewed
fresh-run listener, atomic store/DDL, raw-header HTTP adapter, endpoint-secret/account
binding, public HTTPS tunnel and separately approved signed delivery. Stage 2C-3D
remains pending; no operational readiness or activation is inferred from these tests.
Existing routes, shared client, Stage 2C-2/3B/3C/3D source and financial engines remain
unchanged. Neither existing database, history, credentials nor infrastructure is used.

## Verification record

432 deterministic tests passed across acceptance-forwarding, acceptance-host,
acceptance-run, acceptance-transport, acceptance, automation-foundation,
automation-runtime and recovery-domain. Nonincremental TypeScript, targeted ESLint
with zero warnings and tracked/scoped new-file whitespace checks passed.
Fake verifiers and in-memory responses prove source contracts, not cryptographic
verification of genuine deliveries, PostgreSQL durability or live target identity.

Only four files were added: src/server/stripe-acceptance-forwarding.ts,
tests/stripe-acceptance-forwarding.test.ts,
tests/helpers/stripe-acceptance-forwarding-fixture.ts and this document. The helper
uses synthetic configuration and migration source bytes, not database fixtures.
No database, credential, Stripe, Docker, listener/tunnel, worker/scheduler,
migration, fixture execution, deployment, Git staging, commit or push operation ran.
