# Stripe automation — Stage 2B-2 implementation and deterministic verification

Prepared 2026-11-02. Status: source implementation for independent review.
**Stage 2B is not complete. Stage 2B-3 and Stage 2C remain unauthorised.**

Authority is limited to source changes and deterministic tests against the approved
[review packet](STRIPE_AUTOMATION_STAGE_2B_REVIEW.md) and
[SQL proposal](proposals/0035_payment_recovery_schedule.sql). Neither governing
proposal was edited. No database, Docker resource or external service was accessed,
provisioned, migrated, seeded or deleted. No worker, scheduler, public deployment,
refund or external notification delivery was activated. No Git staging/commit/push,
reset or clean was performed. Milestone 18, design files and `.env.local` are untouched.

## 1. Implementation

- Registered migration 0035 as source only, with all six recovery fields, historical
  defaults, consistency constraints, due index, insert enrollment guard, privilege
  restriction and metadata-only claim/finish functions from the reviewed proposal.
- Enrolled both supported attempt writers within their existing transactions.
- Added a common recovery processor using due claims, database-owned leases and
  bigint generation fencing; it distinguishes provider failure, uncertain evidence,
  missing locator, verified open, terminal unpaid and committed success.
- Routed scheduled initial and balance recovery through that contract without
  changing the authoritative payment/capture/allocation/inventory routines.
- Added command due checks under existing domain locks, durable retry scheduling,
  per-command isolation, lease-expiry checks and a database-clock submission gate.
  Requests, keys, first-submission chronology and generations are preserved.
- Added a separate payment-only webhook processor with a shared exact event/object
  allowlist before claim or housekeeping, bounded cleanup, fresh per-claim ownership,
  retry counters and expiry/attempt fencing at completion.
- Added explicit recovery wiring and a source-only verification runner, using injected
  clients, processors, transport and clock. There is no production/default factory
  or route connection to the runner. Added bounded database/fetch adapters and an
  explicit provider account-verification capability.
- Preserved the Stage 2A HTTP endpoint byte-for-byte. Even valid configuration and
  bearer authentication return `503 STAGE_2A_INACTIVE`, with no execution dependencies.

## 2. Exact files changed in this stage

Files that already existed as untracked Stage 2A work are identified below. They
remain untracked; being listed here does not imply a new commit or ownership of the
other preexisting work in the workspace.

```text
docs/STRIPE_AUTOMATION_STAGE_2B_2.md
drizzle/0035_payment_recovery_schedule.sql
drizzle/meta/0035_snapshot.json
drizzle/meta/_journal.json
src/db/schema/payments.ts
src/server/balance-payment.ts
src/server/booking-acceptance.ts
src/server/checkout-command-scheduling.ts
src/server/checkout-worker.ts
src/server/payment-locks.ts
src/server/payment-reconciliation.ts
src/server/payment-recovery.ts
src/server/stripe-adapter.ts
src/server/stripe-automation.ts                    (preexisting untracked Stage 2A file)
src/server/stripe-automation-config.ts             (preexisting untracked Stage 2A file)
src/server/stripe-automation-recovery.ts
src/server/stripe-automation-runner.ts
src/server/stripe-automation-runtime.ts
src/server/stripe-webhooks.ts
tests/stripe-adapter.test.ts
tests/stripe-automation-foundation.test.ts         (preexisting untracked Stage 2A file)
tests/stripe-automation-runtime.test.ts
tests/stripe-recovery-domain.test.ts
tests/stripe-recovery-enrollment.test.ts
tests/stripe-recovery-scheduling.test.ts
```

No historical migration or snapshot was modified. The preexisting `next-env.d.ts`
change and unrelated untracked design/management/Stage 2A files were preserved.

## 3. Migration and metadata consistency

The executable SQL body starting at the first `ALTER TABLE` is byte-identical to the
reviewed proposal. Only the leading source-status comment differs. The migration is
registered as journal index/tag `35 / 0035_payment_recovery_schedule`, with an increasing
timestamp and statement breakpoints. The new snapshot points to the 0034 snapshot ID.

The TypeScript table and snapshot include the same six columns/defaults, partial due
index and CHECK expression. Tests compare the CHECK text, journal tail, snapshot
parent, old columns, unchanged other tables and the UPDATE grant against all 15 old
attempt columns. These are source consistency checks, not SQL execution evidence.
Custom functions/triggers/ACLs remain represented in the SQL, as in earlier custom
migrations; a Drizzle snapshot is not an attestation of effective PostgreSQL privileges.

No Drizzle CLI was invoked. In particular, `drizzle.config.ts` was not evaluated or
used to load `.env.local`. Migration execution remains a separate Stage 2B-3 gate.

## 4. Enrollment coverage and compatibility

| Supported path | Writer and enrollment behavior |
| --- | --- |
| Public synthetic quote acceptance (`public-booking.ts`) | Calls `acceptBooking`; its attempt INSERT sets `recovery_enabled=true` and database-clock next time +30 seconds in the same booking/hold/claim/command/audit transaction. |
| Initial acceptance replay | The existing operation-key/fingerprint path returns the original attempt before INSERT. It neither creates another attempt nor enrolls an old row. |
| Authorized balance request (`access-http.ts`) | Calls `requestBalanceCheckout`, retaining its access recheck, confirmed booking, obligation and allocation checks; the attempt is enrolled in the same command/audit transaction. |
| Balance request replay | Existing active attempt/command is returned without touching enrollment. |
| Checkout/balance/refund smoke tooling | Calls those same writers; no separate attempt INSERT was found. The tooling was read only and not executed. |

A recursive source test and repository search identify exactly the two production
attempt INSERT writers. The actual writers are exercised with fake transaction clients
on success, enrollment INSERT failure, command INSERT failure and commit failure.
Each failure takes the existing rollback/release path. No post-commit enrollment step
was added. Fake replay tests preserve the original identifiers and issue no insert or
enrollment update.

In PostgreSQL, the reviewed deferred INSERT guard is intended to reject an accepted
new attempt omitted from enrollment. The immutable flag and new defaults prevent
ordinary updates/scheduled functions from enrolling history. These trigger/rollback
claims still need actual PostgreSQL proof.

**Compatibility limitation:** new source requires 0035, and old writers that omit
enrollment cannot create accepted attempts after 0035. Coordinate application and
migration rollout with booking writes paused. Do not run the new application or
integration fixtures against `zemaitija_dev` or the pre-0035 schema. Historical raw-SQL
test fixtures may require separately reviewed adaptation before broader future tests;
they were not silently enrolled or edited here.

## 5. Fairness, fencing and financial separation

Scheduled attempts claim one due item at a time through the reviewed SQL capability,
ordered by next eligible time and ID. Historical rows, live recovery leases and
ineligible command states are excluded by SQL. Provider work begins after the claim
transaction commits; the existing financial lock order is retained. No attempt-only
claim transaction is held while acquiring a booking/hold/claim lock.

Generation values are selected as text and converted to bigint, then serialized as
decimal strings for completion. Tests cover values above `Number.MAX_SAFE_INTEGER`,
competing workers, expiry/reclaim and stale completion. The database function must
match owner, generation and an unexpired lease after acquiring the row lock. Metadata
functions cannot declare payment success, alter ledger evidence or release claims.

Active open results poll after 60–75 seconds. Recoverable provider/uncertain/missing
locator outcomes retry after exponential delay plus bounded jitter. On the fifth
consecutive unresolved outcome, recovery remains durable with investigation reporting
and 6–7 hour surveillance. Verified terminal-unpaid attempts also use 6–7 hour
surveillance. Success schedules retire only when the attempt's own state is SUCCEEDED;
a crash/webhook-completed success receives metadata-only cleanup on a later claim.
An unknown create never causes an attempt lane to perform a create POST.

Command selection and locked rechecks respect persisted due time on the database
clock. A final database-clock gate requires the full 10-second provider window plus
a one-second reserve inside both the lease and original 24-hour replay boundary.
Missing persisted requests/unsafe chronology quarantine; stored parameters and keys
are never refreshed to manufacture a replacement Session. Provider-unknown results
advance retry time; an independent command failure yields its place without changing
a live lease. Stale command results cannot finish after takeover or lease expiry.

Payment inbox housekeeping changes at most two allowed payment records; claiming
obeys its separate invocation/item budget. Refunds, charges, wrong event/object pairs,
async events, INVESTIGATE and QUARANTINED rows are excluded before either operation.
Duplicate and older payment events still retrieve current objects and use the
existing idempotent financial routines. Ownership, attempt number, processing state
and live expiry are rechecked for completion. Failed claims/finishes retain partial
counters and do not imply a processed event.

Tests exercise the actual reconciliation functions with synthetic provider evidence:
one capture/allocation under repeated delivery, wrong capture evidence, provider
errors, uncertain outcomes, verified terminal unpaid and late unallocatable money.
Late captures retain refund obligations without restoring released inventory or
calling refund APIs. Balance recovery never releases confirmed accommodation.

## 6. Runtime and inactive-execution guarantees

The unchanged Stage 2A endpoint remains the only HTTP automation entry. Its module
imports no executable runner, resource adapters, financial processors, pool or SDK
gateway. Extended import traps and authenticated/denied endpoint tests enforce this.
Configuration variables alone cannot activate processing. All test commands explicitly
set `STRIPE_AUTOMATION_ENABLED=false`; enabled configurations occur only as synthetic
test inputs. No environment file or deployment configuration was changed.

The disconnected verification runner requires explicit injected resources. It checks
configuration and bearer before reading a factory, then actual database/session role,
server/owner and recovery capabilities/ACLs before provider construction or account
lookup. It requires PostgreSQL 17.6 features/identity, no migration-role membership,
no schema/database CREATE, no direct scheduling UPDATE, reviewed function ownership/
search path/execute permissions, and the new validated constraint/enabled triggers.
Matching account strings alone do not authorize lanes: explicit provider identity must
also match, followed by the existing per-object test-mode/evidence checks.

Configured cooperative budgets (not a strict wall-clock completion guarantee):

| Boundary | Implemented limit |
| --- | --- |
| Admission | 15 seconds; concurrency 1; require 20 seconds remaining for an item plus cleanup |
| Overall cancellation budget / reserve | 60 seconds / 10 seconds reserved before final cleanup; settlement can exceed this budget |
| Item/guard scope | 10 seconds, linked to overall abort; individual items check admission |
| Independent lane items | Inbox 2, commands 1, initial 1, balance 1; no borrowing |
| Database | Dedicated pool max 1; non-pipelined; acquisition 1 second; statements 1 second; locks 500 ms; transaction 10 seconds; idle transaction 1 second |
| Provider | 1 second per underlying HTTP request, including body consumption; at most 12 HTTP requests per scope; SDK network retries 0; buffered response cap 1 MiB |
| Deferred observations | 26 rows per category to expose sample ≤25 plus a has-more flag; four-second observation scope |

Database timeouts destructively release the affected connection, await the real query
settlement and prevent reuse. Domain helpers cannot relax the shorter worker SQL
timeouts. Scope-cancelled/open connections are discarded at release/cleanup. Late
acquisitions are discarded. Provider timeouts abort the supplied transport signal,
keep abort active through the body read, cancel/release the reader and clear timers.
Hidden SDK HTTP calls count toward the cap. Neither implementation uses a
`Promise.race` to abandon a still-running operation.

Factories must honor the supplied pool options, and the provider factory must use
the supplied fetch transport; the updated SDK adapter supports this explicitly.
Injected processors must use those bounded capabilities. Arbitrary JavaScript that
ignores all injected capabilities cannot be forcibly terminated by an AbortSignal;
no production activation of such a processor is supplied or approved here. Actual
socket destruction, server timeout/transaction behavior and SDK abort propagation
remain Stage 2B-3/2C verification obligations. A timed-out COMMIT or POST can remain
ambiguous; no timeout establishes payment failure or permission for replacement.

**Corrective review limitation:** `boundedAutomationPool.close()` discards active
clients, prevents new acquisitions, and awaits `raw.end()`. There is no cancellable
deadline for `end()` in the supplied pool contract. A stalled `end()` can keep the
invocation pending indefinitely, including after the 60-second budget. Query rejection,
transport cancellation/body cleanup and arbitrary injected processors likewise depend
on actual settlement. No strict overall execution deadline is established by this
implementation. Racing cleanup would abandon a pending operation, so it is retained.
Once settlement occurs the runner reports `deadlineExceeded`; an overrun produces
PARTIAL (or FAILED for a guard failure). BOUNDED means the configured cooperative
checks completed without a reported failure, not proof of forcible termination.

Lane failures retain known completed counters, distinguish retries/deferred work and
do not prevent independent lanes within the remaining budget. Partial failures are
reported as PARTIAL/FAILED. Deferred refund inbox events, remaining refund liabilities
and investigation records have separate bounded observations; observation failures
report unavailable, never an asserted empty queue. Summaries omit raw errors/secrets.

## 7. Deterministic verification

Scoped test command (all PostgreSQL/Stripe interfaces are fake; no listener/service):

```sh
STRIPE_AUTOMATION_ENABLED=false ./node_modules/.bin/vitest run \
  tests/stripe-automation-foundation.test.ts \
  tests/stripe-recovery-enrollment.test.ts \
  tests/stripe-recovery-scheduling.test.ts \
  tests/stripe-recovery-domain.test.ts \
  tests/stripe-automation-runtime.test.ts \
  tests/stripe-adapter.test.ts
```

Result: **148 passed, six files**. This includes the unchanged 79 Stage 2A cases,
expanded import barriers, creator rollback/replay, due fairness for both lanes,
historical/future/live-lease exclusion, bigint takeover fences, failure/uncertainty
classification, surveillance, original request replay, unsafe/missing chronology,
database-clock skew, duplicate/out-of-order inbox work, excluded event preservation,
two-row housekeeping, timeout transport/reader/connection cleanup, admission budgets,
partial counters, identity ordering, refund/investigation observations and actual
recovery wiring against an empty fake queue.

TypeScript command:

```sh
STRIPE_AUTOMATION_ENABLED=false ./node_modules/.bin/tsc --noEmit --incremental false
```

Targeted lint command (no full repository lint or integration suite):

```sh
STRIPE_AUTOMATION_ENABLED=false ./node_modules/.bin/eslint \
  src/db/schema/payments.ts \
  src/server/booking-acceptance.ts src/server/payment-locks.ts \
  src/server/payment-reconciliation.ts src/server/balance-payment.ts \
  src/server/checkout-worker.ts src/server/checkout-command-scheduling.ts \
  src/server/payment-recovery.ts src/server/stripe-webhooks.ts \
  src/server/stripe-adapter.ts src/server/stripe-automation.ts \
  src/server/stripe-automation-config.ts src/server/stripe-automation-runtime.ts \
  src/server/stripe-automation-runner.ts src/server/stripe-automation-recovery.ts \
  tests/stripe-automation-foundation.test.ts tests/stripe-recovery-enrollment.test.ts \
  tests/stripe-recovery-scheduling.test.ts tests/stripe-recovery-domain.test.ts \
  tests/stripe-automation-runtime.test.ts tests/stripe-adapter.test.ts
```

TypeScript and targeted lint both exited 0 with no errors or warnings. Tracked diff
and stage-owned file whitespace checks passed. Final Git status is recorded below.
No build, full integration test command, Drizzle CLI, seed, smoke script, Docker
command or actual PostgreSQL/Stripe operation was run.

## 8. Unverified assumptions and review boundaries

PostgreSQL has not parsed or executed 0035. Real row locking/SKIP LOCKED, concurrent
workers, deferred trigger enforcement, source grants versus inherited/effective ACLs,
function ownership/search path, rollback atomicity, ledger uniqueness, inventory
exclusion, lock ordering, timeout/disconnect behavior and index cost remain unverified.
Fake models demonstrate application handling and serialization, not PostgreSQL proof.

The runtime read-only capability guard verifies required schema features and ACLs;
it does not read the Drizzle migration ledger using newly broadened app privileges.
No such privilege was added to the reviewed SQL. Full chain/ledger attestation and
all actual target/server/role checks before mutating phases remain migration-role
preflight duties under separately approved Stage 2B-3. The independently verified
server address is still required; IP/name checks do not cryptographically identify a
container volume or attest isolation after recreation.

Compatibility retained deliberately: the existing explicit `sweepBalanceAttempts`
booking-ID overload continues its booking-scoped domain reconciliation behavior,
and the existing explicit mixed refund inbox processor is preserved for old tooling.
Neither is wired into Stage 2B automation. Scheduled/default recovery uses the new
enrolled, leased interfaces exclusively. Searches found no production caller of the
booking-ID sweep overload; preserving it avoids silently changing existing test/tool
contracts or broadening scheduled authority. Independent review should confirm this
separation before any future activation.

No reviewed SQL/security/financial requirement was relaxed. New source strengthens
command correlation/request/clock checks and adds a separate runner module to preserve
the accepted HTTP import barrier. No independent review or Stage 2B acceptance is
claimed by this implementation report. Stop here for source review. Stage 2B-3
provisioning/migration approval, actual sandbox operations, activation and Stage 2C
Checkout acceptance all remain separate gates.

## 9. Final verification and Git status

Final checks: 148 tests passed across six scoped files; TypeScript exited 0;
all targeted lint checks exited 0 without warnings; whitespace checks passed.
The reviewed migration SQL body and existing-column grants match their source tests.
All work remains unstaged/untracked. This status includes preexisting workspace work;
`next-env.d.ts` and the unrelated files were not edited by this stage.

```text
 M drizzle/meta/_journal.json
 M next-env.d.ts
 M src/db/schema/payments.ts
 M src/server/balance-payment.ts
 M src/server/booking-acceptance.ts
 M src/server/checkout-worker.ts
 M src/server/payment-locks.ts
 M src/server/payment-reconciliation.ts
 M src/server/stripe-adapter.ts
 M src/server/stripe-webhooks.ts
 M tests/stripe-adapter.test.ts
?? .impeccable/build/
?? .impeccable/mocks/
?? ACCOMMODATION_MANAGEMENT_SPEC.md
?? docker-compose.stripe-automation.yml
?? docs/STRIPE_AUTOMATION_STAGE_2A.md
?? docs/STRIPE_AUTOMATION_STAGE_2B_2.md
?? docs/STRIPE_AUTOMATION_STAGE_2B_REVIEW.md
?? docs/proposals/
?? drizzle/0035_payment_recovery_schedule.sql
?? drizzle/meta/0035_snapshot.json
?? owner-accommodation-management-docs-fixed.patch
?? owner-accommodation-management-docs.patch
?? src/app/api/internal/
?? src/server/checkout-command-scheduling.ts
?? src/server/payment-recovery.ts
?? src/server/stripe-automation-config.ts
?? src/server/stripe-automation-recovery.ts
?? src/server/stripe-automation-runner.ts
?? src/server/stripe-automation-runtime.ts
?? src/server/stripe-automation.ts
?? tests/stripe-automation-foundation.test.ts
?? tests/stripe-automation-runtime.test.ts
?? tests/stripe-recovery-domain.test.ts
?? tests/stripe-recovery-enrollment.test.ts
?? tests/stripe-recovery-scheduling.test.ts
```


## 9. Focused corrective review checkpoint — 2026-11-02

This checkpoint supersedes the earlier verification totals above. Stage 2B-3 has
not begun; no database, Docker, migration execution, Stripe request, activation,
payment, Git staging/commit/push or Milestone 18 work was performed.

Corrections:

- The disconnected verification runner sets `processingEnabled=true` immediately
  before invoking its first processor, including an empty batch or a throwing
  processor. It remains false when guards fail or every lane is deferred. This
  describes execution in this invocation; the HTTP endpoint remains hard inactive.
- Cleanup still awaits real pool settlement after destructive client release.
  The limitation in section 6 replaces any unsupported strict 60-second completion
  claim. A settled invocation reports `deadlineExceeded` and cannot report BOUNDED
  after exceeding its cancellation budget. A permanently stalled cleanup cannot
  return a summary; the implementation does not abandon it to manufacture one.
- Attempt recovery adds `financialSucceeded` to the shared counts and passes it
  through orchestration. It counts observed committed SUCCEEDED attempts, including
  metadata-only cleanup of prior success; it is not new capture volume. Other lanes
  leave it zero. `processed` still requires owned metadata completion. A thrown
  completion or false (stale/expired) completion reports failed + deferred while
  retaining financial success and investigation evidence. Metadata never authorizes
  a payment or a replacement Session.

Deterministic tests cover processor execution/guard rejection/all-lane deferral,
stalled cleanup beyond 60 seconds, destructive release before cleanup, prevention
of new acquisitions, overrun reporting, and retention of financial/metadata counters.
For both initial and balance attempts, actual authoritative reconciliation commits
one capture/allocation before thrown or stale completion. A later claim performs
metadata-only cleanup with no provider retrieval; direct financial replay returns
ALREADY_RECORDED and command dispatch does not create a Checkout Session. Original
request/key, inventory effects and one capture/allocation are preserved. These fakes
do not establish PostgreSQL concurrency, rollback, socket behavior or effective ACLs.
The reviewed SQL, financial authority, guards and endpoint were not modified.

Files changed by this focused checkpoint only:

```text
src/server/stripe-automation-runner.ts
src/server/stripe-automation-runtime.ts
src/server/payment-recovery.ts
src/server/stripe-automation-recovery.ts
tests/stripe-automation-runtime.test.ts
tests/stripe-recovery-domain.test.ts
docs/STRIPE_AUTOMATION_STAGE_2B_2.md
```

Checks executed:

```sh
STRIPE_AUTOMATION_ENABLED=false ./node_modules/.bin/vitest run tests/stripe-automation-runtime.test.ts tests/stripe-recovery-domain.test.ts tests/stripe-recovery-scheduling.test.ts tests/stripe-automation-foundation.test.ts tests/stripe-recovery-enrollment.test.ts
./node_modules/.bin/tsc --noEmit
STRIPE_AUTOMATION_ENABLED=false ./node_modules/.bin/eslint src/server/payment-recovery.ts src/server/stripe-automation-runner.ts src/server/stripe-automation-runtime.ts src/server/stripe-automation-recovery.ts tests/stripe-automation-runtime.test.ts tests/stripe-recovery-domain.test.ts
git diff --check
```

Results: 149 tests passed across five focused files; TypeScript and targeted lint
passed. Tracked diff and all seven checkpoint files passed whitespace checks.
Stop here pending independent review. No independent review is claimed.
