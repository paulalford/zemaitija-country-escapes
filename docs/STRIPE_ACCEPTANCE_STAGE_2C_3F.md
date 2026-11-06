# Stage 2C-3F — Synthetic fixture plans and read-only progress

Source contracts only. No SQL, fixture writer, booking acceptance, Checkout dispatch,
provider call, listener or worker is invoked or installed.

## Source-verified state contracts, before adaptation

`quoteStay` opens a repeatable-read read-only transaction and validates availability,
capacity and tariff coverage. `acceptBooking` re-quotes under domain locks, requires
a SYNTHETIC guest and explicit terms/amount acknowledgement, and generates its own
booking/snapshot/obligation/hold/claim/attempt/command UUIDs. Stable operation keys
replay the prior result. It records INITIAL and BALANCE obligations, one CREATING
hold/attempt, one inventory claim, an enrolled recovery schedule and a PENDING
SESSION_CREATE command. Logical key is `session-create:OPERATION_KEY`; the provider
key is `session-create:ATTEMPT_ID`. The acceptance API does not accept predetermined
financial UUIDs, so plans must use runtime-bound symbolic slots for those rows.

`dispatchSessionCreate` leases and persists the exact request/key before POST.
UNKNOWN results retain the original request/key; unsafe first-submission age is
quarantined. The bounded automation runner owns command dispatch/recovery; the
fixture planner and status reader must never call it. Existing payment allocation
and reconciliation remain the only financial engines.

Existing states:

- Booking: AWAITING_INITIAL_PAYMENT, CONFIRMED, EXPIRED, CANCELLED_GUEST,
  CANCELLED_NONPAYMENT, CANCELLED_PROVIDER, COMPLETED.
- Hold: CREATING, ACTIVE, RECONCILING, CONSUMED, RELEASED.
- Attempt: CREATING, OPEN, RECONCILING, SUCCEEDED, FAILED, EXPIRED.
- Command: PENDING, SUBMITTED, UNKNOWN, QUARANTINED, RESOLVED. A PENDING command can
  already have a lease; lease expiry does not prove provider failure.

Initial success requires verified Session/PaymentIntent/captured-charge evidence.
The same transaction records one credit/allocation, transfers the original claim,
consumes the hold, confirms booking, writes an audit and BOOKING_CONFIRMED outbox
key. FULL payment can additionally produce PAID_IN_FULL: one booking-confirmation
notice does not mean one total outbox row. Success timestamps are not assumed to be
stored in provider_succeeded_at by the current initial capture implementation.

`publicBookingStatus` reads scoped booking/snapshot fields but is not a complete
financial verifier. `inspectHold` has an optional locking mode and its module also
contains writers; neither is imported as the new status adapter. Existing safe URL
policy is HTTPS checkout.stripe.com without credentials/ports. Public routes remain
unchanged; no shared pool is imported.

## Planning contract

`planAcceptanceFixtures(run, request, {now, authority})` accepts an issued immutable
Stage 2C-3B seal and a strict request: unique scenario names, base arrival date and
integer nightly EUR cents. No namespace, guest, database, currency or mode override
is accepted. The result is a deeply frozen, in-process issued plan or a fixed rejection.
It is data only, writesEnabled=false: there is no writer or execution method.

| Scenario | Planned evidence |
| --- | --- |
| SIGNED_WEBHOOK | Signed inbox evidence plus governed provider reconciliation |
| DUPLICATE_DELIVERY | Duplicate and out-of-order observations; one financial effect |
| MISSING_WEBHOOK | Established polling recovery confirms without inbox dependence |
| DELAYED_COMMAND | Delayed processing retains exact original command/request/key |
| INVESTIGATION | Durable investigation evidence, distinguishable from confirmation |

At most five one-night bookings share the manifest's synthetic unit on nonoverlapping
dates. Each scenario's date/IDs stay stable even when other scenarios are omitted.
The normal scenario uses the manifest guest anchor; additional guest/fixture UUIDs
are deterministically derived from run/manifest anchors and labels. They are markers,
not access secrets. Guests contain SYNTHETIC retention and locale only; no contact
information or real identity is supplied. The approved complete prior namespace/guest
inventory rejects reuse. Source planning reads/reserves nothing atomically.

The namespace and immutable plan digest bind the run, manifest/source/migration
digests, scenarios, operation keys, relationships, amounts and proposed write intents.
Financial row identifiers remain symbolic slots until existing acceptBooking returns
actual IDs. A future binding recorder must also capture both obligation IDs and the
original claim ID through reviewed read queries/audit evidence. Never assign invented
UUIDs to acceptBooking, recreate its SQL or derive an original claim from a later
replacement row. A copied/foreign plan cannot enter the status interface.

Proposed writes are explicit data: one synthetic unit, schedule and two tariff rows;
one synthetic guest per scenario; then existing acceptance's ten inserts per one-night
booking and hold-attempt link update. Domain-generated financial IDs and locks stay
owned by acceptBooking. No INSERT, SQL callback or fixture writer is implemented.

Pure existing addCalendarDays/quoteDeadlines/splitPayment calculations are reused.
Dates begin 30–365 days after the manifest start; their balance deadlines remain after
run expiry. They use the provisional EUR/Vilnius advance policy. Zero-cent initial
obligations reject. The tariff amount is a planning expectation, not a trusted quote:
future execution must call quoteStay and acceptBooking, revalidate acknowledgement
and compare returned amounts against the approved plan. Changed pricing needs review.

The existing manifest has processing/request budgets but **no monetary ceiling**.
It is unchanged. Therefore independent source-plan approval must bind the canonical
request hash and manifest hash, validity window, maximum fixture count, maximum
total cents and maximum initial cents. Hard fixture-only ceilings are five fixtures,
100,000 cents each and 500,000 cents total; reviewed limits can be lower. These are
synthetic exposure limits, not changes to application commercial pricing.

Plans reserve one invocation and 3–4 work items per scenario, with at most twelve
provider requests per reserved item, bounded by manifest totals. This is source
budget accounting, not active enforcement. Later launchers must enforce durable
aggregate counters; the existing runner still resets provider counters per scope.
Plans grant no fixture insertion, provider request or worker authority.

## Read-only status contract

`inspectAcceptanceStatus(run, plan, fixtureId, {now, authority, query})` requires the
issued run/plan, verify-read-only permission and an independent current host grant
binding their hashes, fixture and exact fresh target/reservation. Stage 2C-3D's pending
result is insufficient. No authority is accepted from HTTP, and there is no route.

The only query adapter shape is a plain object with kind
acceptance-status-read-only-v1 and read(binding). Pool-like, write-capable and extra
methods are rejected. There is no raw SQL, query callback, environment fallback,
shared pool or provider dependency. A future trusted adapter must use a separately
approved `zec_acceptance_status_reader` role with no mutating capability/membership,
fixed bounded SELECTs and a REPEATABLE READ READ ONLY transaction. No role/DDL/adapter
is created here. A JS marker cannot prove that malicious injected code is read-only;
actual database permissions and reviewed adapter construction remain trust gates.

The normalized snapshot requires a complete settled consistent read, <=30-second
age, run/manifest/plan/fixture bindings, original runtime mapping and linked domain
records. The adapter must detect ambiguous joins or omitted rows rather than claim
complete=true. Monetary values are integer cents; fencing generations remain decimal
strings within PostgreSQL bigint range. The snapshot is a derived read model, not
new database columns. Authority is rechecked after the query. Missing, failed, stale,
uncertain, foreign or contradictory data returns UNKNOWN without success flags.

| Progress | Existing state/evidence mapping |
| --- | --- |
| COMMAND_PENDING | PENDING, without a live lease |
| COMMAND_PROCESSING | PENDING/SUBMITTED with a live lease |
| CHECKOUT_READY | Persisted resolved command, OPEN attempt and unexpired safe URL |
| PAYMENT_PENDING | Persisted Session or recorded processing observation |
| RECOVERY_PENDING | UNKNOWN/submitted-without-live-lease or RECONCILING |
| INVESTIGATION_REQUIRED | Quarantine, unsafe submission chronology, failure threshold, incidents or liabilities |
| PAYMENT_CONFIRMED | Complete capture/allocation/inventory/audit/outbox chain |
| TIMED_OUT | Session time elapsed; hold remains governed by domain reconciliation |
| TERMINAL | Existing terminal booking/attempt/released claim plus never-submitted or verified terminal-unpaid evidence |

Booking, attempt/payment and inventory-hold states are reported separately.
PAYMENT_CONFIRMED requires exactly one matched credit and allocation for the initial
obligation, expected EUR amount, account/test/reconciliation identifiers, original
claim transfer, consumed hold, one booking-confirmed audit and one logical
BOOKING_CONFIRMED notice. A paid flag alone cannot pass. Provider evidence must come
from governed signed-webhook or recovery reconciliation, never return navigation.

Scenario completion additionally checks duplicate/out-of-order evidence, recovery
origin or delayed-command observation as applicable. Unresolved refund liabilities
and investigation remain visible and prevent normal scenario completion. No status
inspection changes a lease, retries a command, repairs a record or sends a notice.

Successful read results carry nonsecret run/plan/manifest/fixture provenance,
transaction/observation markers and a digest of the normalized snapshot for later
independent comparison. Only persisted safe HTTPS checkout.stripe.com URLs are
returned for ready Sessions. This mirrors the existing URL policy without importing
the public HTTP module and its dispatch dependencies. Private guest data, credentials,
database URLs and raw provider payloads are neither accepted nor returned.

## Future integration and evidence gaps

Separate approvals remain necessary for protected planning/status authority readers,
durable fixture/acceptance-result bindings, aggregate budgets, fresh reference/guest
writer, read-only role/grants and actual query implementation. Query/authority
dependencies must impose their own acquisition/statement deadlines; this source
inspector does not construct clients or provide cancellation of hidden adapter IO.
The Stage 2C-2 single-guest boundary is not repurposed for these multi-scenario plans.

Signed-path evidence must reference the verified inbox event. Recovery-path evidence
must reference an independently recorded, authorised runner invocation linked to the
attempt and reconciliation. A null webhook reference alone does not prove scheduled
recovery: public/manual paths could also have no webhook. Durable invocation evidence
and any required DDL remain separately gated; absent linkage cannot pass confirmation.

The future flow remains: fresh attestation and reservation → approved synthetic
writer → quoteStay/acceptBooking → record actual IDs and original key → separately
authorised existing runner → read-only status → existing governed webhook/recovery
pathways. No competing Checkout dispatch, acceptance or reconciliation engine exists.

Synthetic snapshots prove validation behavior only. Genuine test-mode capture,
PostgreSQL atomicity/constraints, signed HTTP evidence, duplicate/out-of-order effects,
missed-webhook recovery and real read-only role enforcement remain unverified.
The final independent verifier must read evidence without confirming its own booking.
All existing protected history and Stage 2C-3B through 3E contracts remain untouched.

## Verification record

479 deterministic tests passed across acceptance-scenarios (47 new cases),
acceptance-forwarding, acceptance-host, acceptance-run, acceptance-transport,
acceptance, automation-foundation, automation-runtime and recovery-domain.
Nonincremental TypeScript, targeted ESLint with zero warnings and tracked/scoped
new-file whitespace checks passed. Synthetic clocks, records and in-memory adapters
were used; the helper reads migration source bytes solely for the pinned seal.

Exactly five new files belong to this checkpoint: this document,
src/server/stripe-acceptance-fixtures.ts, src/server/stripe-acceptance-status.ts,
tests/stripe-acceptance-scenarios.test.ts and
tests/helpers/stripe-acceptance-scenario-fixture.ts. No existing files were edited.
No database, credentials, Stripe, Docker, genuine webhook, fixture insertion,
booking acceptance, Checkout dispatch, listener, worker, scheduler, migration,
deployment, Git staging, commit or push operation was performed.
