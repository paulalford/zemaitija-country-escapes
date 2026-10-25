# Local Stripe sandbox cancellation/refund smoke test

`scripts/stripe-refund-smoke.ts` is an explicit, terminal-only runner for **one new synthetic booking**. Its five stages use the existing booking, cancellation, refund and signed-webhook services. It does not change financial business logic, migrations or permissions. It is outside the normal automated test suite.

Preparation has not executed any smoke stage or made any Stripe request. Executing the stages below is a separate manual action after independent inspection and approval.

## Configuration and local listener

Run from the repository root with Node 24 and the installed locked development dependencies (`tsx` is supplied by the existing tooling). Keep the existing restricted `DATABASE_URL` and test Stripe configuration in `.env.local`:

- `DATABASE_URL`: `zemaitija_app`, loopback host, database ending `_dev`.
- `MIGRATION_DATABASE_URL`: `zemaitija_migrator` on exactly the same local host, port and database. The runner uses this role for **read-only migration/hash inspection**, and for narrowly scoped synthetic guest/finance identity inserts only. All booking, inventory and refund work uses the application role.
- `STRIPE_SECRET_KEY`: `sk_test_...`; `STRIPE_ACCOUNT_ID`; `STRIPE_WEBHOOK_SECRET`: `whsec_...`.
- `STRIPE_SUCCESS_URL` and `STRIPE_CANCEL_URL`: loopback HTTP on port 3000.

Independently set the expected sandbox account and choose available dates covered by the existing synthetic 2027 tariff. These dates are examples, not a claim of availability; PREFLIGHT checks the requested interval. No rate seeding or inventory cleanup is performed.

```bash
export SMOKE_EXPECTED_STRIPE_ACCOUNT_ID='acct_YOUR_SANDBOX_ACCOUNT'
export SMOKE_REFUND_ARRIVAL_DATE='2027-05-17'
export SMOKE_REFUND_DEPARTURE_DATE='2027-05-19'
```

PREFLIGHT displays the server quote's initial amount. Before START, pin that exact integer amount independently:

```bash
export SMOKE_REFUND_EXPECTED_INITIAL_CENTS='INITIAL_CENTS_FROM_PREFLIGHT'
```

The runner imposes a technical safety limit of EUR 100 on the initial amount. The quote must use the advance split and have more than 24 hours remaining before its T–14 cutoff. CANCEL additionally requires a one-hour margin before that cutoff; the service still records and enforces the actual cancellation instant. No clock override or new cancellation policy is used.

For real signed event ingestion, run the existing development application and Stripe CLI listener in separate local terminals, authenticated to the same sandbox account:

```bash
npm run dev -- --hostname 127.0.0.1
stripe listen --forward-to http://127.0.0.1:3000/api/stripe/webhook
```

Use the listener's signing secret in `.env.local`, and restart the application after changing it. Include the events `checkout.session.completed`, `payment_intent.succeeded`, `refund.created`, `refund.updated`, `refund.failed` and `charge.refunded`; the default unfiltered listener forwards supported events. No new endpoint or public tunnel is needed. The existing route verifies the raw-body Stripe signature before writing the durable inbox. Return-page navigation never confirms payment.

## Five explicit stages

### PREFLIGHT — read-only

```bash
node --conditions=react-server --import=tsx scripts/stripe-refund-smoke.ts preflight --local-sandbox-only
```

Checks loopback `_dev` database/role identity, every installed migration timestamp/hash through `0028`, required refund guards, test credentials, the account returned by a Stripe **GET**, and synthetic date availability/pricing. It reads the protected EUR 200 booking and requires it to remain confirmed, fully captured, unrefunded and inventory-owning. It never selects that booking for action. No directory, state, lock, fixture, booking or provider object is created. For an existing run it checks account/database/date/amount bindings and the protected fingerprint rather than claiming its occupied dates are available.

### START — one new guest, booking and original Checkout

```bash
node --conditions=react-server --import=tsx scripts/stripe-refund-smoke.ts start --local-sandbox-only
```

Persists run/guest/admin/operation identities and the protected booking fingerprint **before any database write**. Creates only its marked synthetic guest, accepts the booking through the existing service, saves the original booking/hold/claim/attempt/command IDs, and dispatches genuine **test-mode** Checkout for the pinned initial amount. The Checkout URL is displayed only in the interactive terminal and is not saved in state. Complete that payment manually with Stripe test details.

A retry discovers acceptance by the saved operation key if the database commit preceded the local ID save. It resumes only that original attempt and durable Session command, using the service's idempotency and quarantine protections. It does not replace expired/failed attempts or initiate another collection after the booking advances. Missing state with an existing runner-marked guest stops the runner rather than creating another booking.

### CANCEL — authoritative payment plus signed event, then early cancellation

```bash
node --conditions=react-server --import=tsx scripts/stripe-refund-smoke.ts cancel --local-sandbox-only
```

Retrieves the owned current Session and PaymentIntent/Charge, reconciles the original initial attempt, and processes only matching signed success inbox records. It also retrieves each matching Event from the expected Stripe account to check the genuine event's identity, type, object and test environment. Missing payment returns `PENDING_PAYMENT`; paid money without the successfully processed signed success event returns `PAYMENT_CONFIRMED_WEBHOOK_MISSING` and **does not cancel**.

After saving the immutable capture fingerprint, constructs a ten-minute local test authority bound to this synthetic guest/booking and `booking:cancel` scope. Invokes the existing early guest-cancellation service without a test clock. Requires `CANCELLED_GUEST`, a zero-charge `NOT_REQUIRED/GUEST_EARLY` assessment, the original claim released at the decisive cancellation instant, and a full original-capture refund obligation. No refund is requested or submitted in this stage. Success is `CANCELLED_REFUND_OWED`.

### REFUND — one finance-authorized original operation

```bash
node --conditions=react-server --import=tsx scripts/stripe-refund-smoke.ts refund --local-sandbox-only
```

Requires the completed early-cancellation evidence and the signed initial payment confirmation. Establishes a new marked synthetic finance identity through the development fixture role, then supplies a ten-minute local finance authority to the existing `requestRefund` service. It never enables an existing disabled administrator or accepts a different external subject/role.

The refund intent, attempt and command are durable before dispatch. The request must match the saved capture, original PaymentIntent and Charge, exact full captured amount and stable operation key. Only the first untouched `REQUESTED/PENDING` operation may submit a POST. Core refund services retain all original budget, lease, provider-evidence and idempotency safeguards.

**A repeated REFUND invocation reconciles the original operation only.** It does not blindly retry an unknown POST, even within the ordinary 24-hour key window. At/after that boundary, or when submission age is unknown, it allows the existing service to investigate/quarantine while the runner's POST guard remains disabled. No failed attempt gets an automatic replacement. If Stripe success is found, the stage reports `PENDING_FINAL_VERIFICATION`; only VERIFY can return PASS.

A request committed immediately before the local ID save can be adopted only when it is the single owned operation, was created after the saved intent, and its finance audit references this run's exact synthetic authority. Any identity or amount disagreement stops the runner.

### VERIFY — existing objects and final evidence

```bash
node --conditions=react-server --import=tsx scripts/stripe-refund-smoke.ts verify --local-sandbox-only
```

Never creates Checkout, cancels a booking or submits a refund. It validates saved refund IDs against owned database rows **before** invoking reconciliation, retrieves current provider evidence and complete original-capture refund history, and processes only matching genuine signed refund inbox events. It requires a refund reconciliation record tied to a successfully processed signed event and current `REFUND_SUCCEEDED` evidence.

PASS requires all of the following:

- Exactly one intended original capture, exact allocation, verified initial reconciliation and unchanged historical capture fingerprint.
- Exactly one original refund attempt/command, one provider refund and one immutable ledger debit, all for the full original captured amount and matching identities.
- Authoritative provider `succeeded` state, exact refund-ledger reconciliation evidence, satisfied refund obligation/reservation counters, and `REFUNDED_FULL` with zero refund/collection balance.
- The original booking remains guest-cancelled strictly before T–14, with a zero-charge assessment and its exact original claim released and not reclaimed.
- Processed genuine signed payment success and refund-success reconciliation evidence. Ledger/provider success alone cannot pass without the webhook evidence.
- Exactly one source-linked acceptance, confirmation, guest cancellation, refund request and refund success audit event, including the synthetic guest and finance authority references.
- Appropriate guest confirmation, guest/operations cancellation and guest refund outbox records. These may remain queued; no production email is sent or delivery claimed. Failed/suppressed required notices prevent PASS.
- The original EUR 200 booking's stored financial, inventory, attempt/command, audit, notification and commercial-record fingerprint remains unchanged.

Otherwise the runner reports a precise pending, missing-webhook, quarantine or failure result. For example: `PENDING_CANCELLATION`, `PENDING_REFUND`, `REFUND_CONFIRMED_WEBHOOK_MISSING`, or `QUARANTINED`. Retry VERIFY after a delayed signed webhook is ingested. Exit codes are 0 for PASS/PREFLIGHT_OK/READY/CANCELLED_REFUND_OWED, 2 for pending/missing-webhook/quarantine, and 1 for failure.

## State and safety boundary

State is private, atomically written and directory-synced under ignored `.local/stripe-refund-smoke/`. Directory mode is 0700, files 0600; unsafe permissions/ownership and symlinks are rejected. The state contains operation/provider identities and fingerprints, never API keys, signing secrets, raw guest addresses, credentials or Checkout URLs. No previous smoke state directory is changed.

A private `runner.lock` prevents overlapping invocations. A crash may leave this lock. Inspect its PID and confirm the process has stopped before removing **only that lock**; preserve `state.json` and all financial records. Do not delete state to force another booking or refund. No database reset, fixture deletion, migration execution, broad finance grant, public authentication route or nonpayment-policy activation is supplied.

Every invocation verifies the independent expected Stripe account with a GET. A runner-local gateway rejects foreign/protected Sessions, PaymentIntents, Charges and refund metadata, limits POSTs to the explicit stage, and rejects a second refund submission. Saved IDs are checked against owned database rows before services are called. The existing inbox worker's global expired-lease housekeeping is narrowed to the selected event through the existing smoke-runner facade; no unrelated inbox event is processed.

The trusted internal authorities exist only inside this explicit local smoke process. They do not implement production guest authentication or replace Milestone 14's scoped credential and operator authentication requirements.

## Preparation validation — no payment or smoke stage

```bash
npm run typecheck
npm run lint
npx --no-install eslint scripts/stripe-refund-smoke.ts scripts/validate-stripe-refund-smoke.ts
npm run db:check
node --conditions=react-server --import=tsx scripts/validate-stripe-refund-smoke.ts
git diff --check
git check-ignore .local/stripe-refund-smoke/state.json
```

The explicit validator uses synthetic in-memory snapshots and blocks network socket connections. It checks argument/configuration fences, protected-booking rejection, exact refund identity/amount/key matching, the first-submission-only rule, pending/quarantine states, duplicate-provider/debit rejection, immutable capture/inventory evidence, source-linked audits/notices and both webhook gates. It imports pure helpers and does not execute any stage, connect to PostgreSQL, create local state or call Stripe. It is intentionally outside `npm test`.
