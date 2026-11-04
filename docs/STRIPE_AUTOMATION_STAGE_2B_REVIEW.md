# Stripe automation — Stage 2B-1 review and approval packet

Status: proposed, awaiting approval before implementation. Prepared 2026-11-02.
Stage 2A is the prerequisite; its inactive execution barrier remains authoritative.
This packet adds documentation only. It does not establish Stage 2B acceptance or
successful automatic Checkout reconciliation; the latter remains Stage 2C.

The supplied Stage 2B request explicitly requires **exact SQL, compatibility analysis,
enrollment contract and rollback limitations before implementation**. The separate
Stage 2B-3 provisioning/migration gate also remains in force. Approval of this packet
would authorize Stage 2B-2 source implementation and deterministic tests only.

## 1. Reviewed contracts and current findings

Reviewed repository sources: `AGENTS.md`, `BOOKING_PAYMENT_SPEC.md`,
`BOOKING_STATE_MACHINES.md`, `MILESTONE_03.md`, `MILESTONE_04.md`, the Stage 2A
foundation, payment/operations schema, role bootstrap, migrations 0000–0034 relevant
to payment/inventory/privileges, and the existing processors and acceptance paths.
This is a source review; actual database privileges, identity and migration state
have not been inspected through a connection.

| Existing behavior | Consequence and proposed correction |
| --- | --- |
| `sweepInitialAttempts` selects oldest creation times and includes expired attempts. | An unresolved old batch can recur indefinitely. Replace with enrolled, leased due work ordered by next attempt and ID. |
| Balance sweep orders by latest reconciliation evidence, but failures can return without evidence. | Provider failures can keep their place ahead of newer work. Persist scheduling after every admitted result, including failed retrieval. |
| Both attempt creation paths already use one transaction. Initial creation inserts its snapshot and obligations before the attempt. Balance creation requires an accepted, confirmed booking and outstanding balance. | Add enrollment to each attempt INSERT; enforce it at database commit. No post-commit enrollment step. |
| Command dispatch selects by creation time and ignores `next_attempt_at`; individual dispatchers also omit its eligibility check. | Enforce due time both during selection and again inside the command lock; persist retry time and isolate each command failure. |
| Command request, key and first submission are persisted and protected by existing triggers. | Retain the exact request, key, first submission and generation guards; never synthesize a replacement for an unknown result. |
| Inbox processing combines payment/refund work; stale processing cleanup has no limit or lane filter. | Add a dedicated payment-only interface whose claim and housekeeping predicates use the same allowlist and independent caps. |
| `zemaitija_app` has table-level UPDATE on attempts from 0006. | New columns would inherit write access automatically. Replace that grant with all pre-0035 column grants and expose scheduling through narrow functions. |
| Stage 2A route imports no database/provider processors and always returns inactive. The existing shared DB client constructs a pool on import. | Preserve the route's import barrier; do not use that shared client in automation. Exercise future orchestration through explicit, injected test dependencies. |

Existing success verification, ledger uniqueness, allocation parent locks, accepted
attempt/booking/hold triggers and the common inventory exclusion remain unchanged.
Neither recovery time nor lease expiry proves success, failure or safe claim release.

## 2. Exact proposed migration and privileges

Review the complete SQL in
[`proposals/0035_payment_recovery_schedule.sql`](proposals/0035_payment_recovery_schedule.sql).
It is deliberately outside `drizzle/` and unregistered. After approval, Stage 2B-2
would copy the reviewed SQL to `drizzle/0035_payment_recovery_schedule.sql`, update
the Drizzle schema/journal/snapshot consistently, and add deterministic source tests.
Executing it remains Stage 2B-3 work requiring separate authorization.

The six proposed columns have the requested names. `recovery_enabled` is immutable
enrollment provenance, **not an execution switch**. An enrolled success can have a
null next time; all other enrolled states must retain a finite next time. Disabled
historical rows retain null times/owner and zero generation/failure count. Failure
count saturates at the maximum PostgreSQL integer rather than wrapping. Lease pairs,
finite timestamps, owner format, nonnegative counters and a positive generation for
leased work are checked in PostgreSQL. Generation exhaustion fails closed; it needs
an investigation, never a reset.

The SQL contains no backfill, historical UPDATE, inventory modification, payment
transition, refund operation, role creation or database-target override. The two
`SECURITY DEFINER` functions may change only the six operational fields. They use a
fixed search path, fully qualified relations, validated parameters, no dynamic SQL,
and no PUBLIC execute grant. The migration identity must own them. Trigger functions
are invoker functions and also have PUBLIC execute revoked.

The claim function accepts only INITIAL/BALANCE, a bounded worker identifier and
1–25 items. It joins accepted snapshots, the matching obligation and the unique
Session-create command. It retains initial/balance hold shape and the command lease
restriction. Quarantined commands are excluded from provider recovery and reported
separately. Success rows with outstanding scheduling receive metadata cleanup only.

The finish function requires owner, generation and an unexpired lease. Invalid or
stale completion returns false without changing metadata; malformed input raises a
controlled parameter error. COMPLETE is allowed only after the separate financial
state is already SUCCEEDED. POLL resets recoverable-failure count; RETRY increments
it. Both require a bounded nonzero delay. Functions do not trust a caller to declare
payment success, release inventory or alter a command.

The application retains its preexisting SELECT/INSERT rights. UPDATE is granted on
every existing attempt column, preserving the existing application capability and
its financial trigger restrictions; no direct scheduling UPDATE is granted. New
attempt INSERTs may explicitly supply pristine enrollment. The deferred insert
constraint rejects omitted enrollment for accepted INITIAL/BALANCE attempts, and
rejects enrollment of unsupported attempts. Ordinary UPDATE cannot enroll history.

This is not a new least-privileged worker role: it retains Stage 2A's approved
`zemaitija_app` identity and that role's existing financial capabilities. Worker
authority still depends on authenticated service code, isolation and provider
verification. Another inherited/table/column grant could defeat the intended direct
write restriction, so Stage 2B-3 must verify **effective** ACLs, role memberships,
function ownership and schema CREATE permissions, including PUBLIC, before writes.

## 3. Atomic enrollment and compatibility contract

For both `acceptQuote` and `requestBalanceCheckout`, insert the attempt with:

```sql
-- Columns added to the existing INSERT, in the same transaction:
recovery_enabled, recovery_next_attempt_at
-- Corresponding values:
true, clock_timestamp() + interval '30 seconds'
```

The transaction also retains the existing booking/snapshot/obligation, hold/claim
where applicable, provider command and audit writes. Failure of enrollment, an ACL
check, deferred constraint, command INSERT or audit INSERT rolls back the entire
transaction. No Stripe call occurs until that transaction commits. Retrying by the
existing accepted operation key returns the same attempt, rather than creating a
second one. Existing unenrolled attempts returned by an idempotent replay remain
unenrolled; replay is not permission to backfill history.

The deferred INSERT-only guard sees a snapshot created anywhere in the same
transaction. The supported creation paths create that snapshot before the attempt.
Attaching a new accepted snapshot to an already committed legacy attempt is not an
approved enrollment lifecycle. No UPDATE-based enrollment or automatic historical
enrollment is proposed; any future exception requires separate review and audit.

Compatibility and rollout consequences:

- Existing rows satisfy the new defaults without being scheduled. Ordinary old-row
  financial updates preserve the new metadata and remain possible.
- **Old application writers are incompatible with 0035 for new accepted attempts:**
  omission of enrollment deliberately fails at commit. This prevents a deployment
  gap from committing invisible work. Coordinate the new application and migration
  with booking writes paused; do not claim rolling backwards compatibility.
- New Stage 2B source requires 0035. Stage 2B-2 must run only fakes and pure tests;
  it must not run booking flows against the protected database or old schema.
- Old sweep functions are unsafe as an automation fallback. The Stage 2B scheduled
  interfaces must require enrollment for attempt and command recovery. Explicit
  existing domain reconciliation used by cancellation retains its separate scope;
  identify callers before changing any shared sweep signature.
- Metadata writes still fire existing attempt triggers, including deferred booking
  and financial checks. Do not suppress those checks. They can add work or reject
  already-inconsistent accepted data; the isolated tests must measure this.
- ALTER TABLE, constraint validation, grant changes and the ordinary index require
  locks. Apply transactionally to the isolated dataset, with lock/statement timeouts
  and preflight, not as an online production migration. No index timing is claimed.

## 4. Recovery claims, fencing and fairness

Claim one item just before admission (the SQL supports larger bounded claims for
tests), commit the lease, and do provider work outside that transaction. Order is
`recovery_next_attempt_at, id`. `FOR UPDATE OF a SKIP LOCKED` and one UPDATE atomically
assign an owner, a two-minute lease and an incremented bigint generation. A second
worker skips leased rows; after expiration it can reclaim with a newer generation.
Never convert bigint generations to JavaScript numbers.

Claim/finish transactions touch attempt metadata only and end before acquiring the
existing domain locks. Preserve the existing unit/guest context → booking → hold →
claim → attempt → command lock order for initial operations, and the existing
balance order. Never retain an attempt-only claim lock while trying to acquire its
booking lock. Allocation parent locking remains obligation → capture. Handle lock
timeouts as durable retryable work, without automatic repetition of provider POSTs.

Finish scheduling conditionally after every admitted result, even when reconciliation
catches a provider exception and currently returns RECONCILING. A typed internal
observation must distinguish a verified open result, terminal unpaid, missing locator,
provider failure, uncertain evidence, and verified success. Preserve existing public
domain outcomes for their callers; do not infer provider success from a resolved
Promise or from the absence of an exception.

Proposed fixed operational delays (not guest policy or an SLA):

| Observation | Durable next step |
| --- | --- |
| Verified open/unpaid | POLL after 60 seconds, with 0–15 seconds injected jitter. |
| Provider retrieval failure or recoverable uncertain result, consecutive count n = 1–4 | RETRY after `min(3600, 30 * 2^(n-1))` seconds plus 0–25% jitter, capped at 3600 seconds. |
| Five or more consecutive failures/uncertain outcomes | Investigation-required summary plus continued slower RETRY at 6 hours plus 0–1 hour jitter; retain blocking inventory. |
| Verified EXPIRED/FAILED unpaid attempt with known Session | Slower POLL surveillance at 6 hours plus 0–1 hour jitter, permitting detection of a later capture. |
| No Session/Intent locator | No create POST from the attempt lane. Back off with RETRY, expose command/investigation ownership; continue slower surveillance after repeated uncertainty. |
| Already ledger-verified SUCCEEDED | COMPLETE clears next time under the recovery fence; no provider call is needed for metadata cleanup. |
| Quarantined Session-create command | Exclude from automatic provider work; keep enrollment and durable due state, surface investigation. No unquarantine. |

The SQL permits 30 seconds through 24 hours for POLL/RETRY; the reviewed TypeScript
policy narrows those bounds as above. Inject clock/randomness for deterministic tests;
use the database clock to determine due/lease/next instants. Repeated uncertain
outcomes must not be treated as a healthy POLL that resets the failure counter.
Terminal surveillance is a distinct classification with a slower cadence, not a
financial state transition. No terminal attempt is removed merely because it is old.

If a webhook records success before scheduler completion, COMPLETE rechecks the
committed SUCCEEDED state. If a worker crashes after recording success, a later claim
does metadata cleanup. If completion fails, the lease stays durable and is reclaimable.
If budget expires before starting an item, do not claim it. A process lost after
claiming leaves work eligible after lease expiry. Stale workers cannot reschedule;
any late domain observation still uses existing current-object and ledger guards,
never recovery ownership as financial authority.

## 5. Checkout command lane

Use an enrolled-attempt JOIN so historical commands remain outside Stage 2B scans.
Select only SESSION_CREATE in PENDING/UNKNOWN/SUBMITTED, due by `next_attempt_at`
(null means initially due), with no active lease. Order by
`COALESCE(next_attempt_at, created_at), id`. Recheck due/lease/state inside each existing
dispatch lock so concurrent scanners and direct resume cannot bypass backoff.

Keep the existing command generation, persisted request, immutable idempotency key
and first-submission timestamp. A completion/failure must match owner and generation,
also require an unexpired lease, and preserve request/chronology. Record UNKNOWN and
next retry on uncertain create outcomes, including validation failures. Catch each
command separately; a failed command must not abort later admitted work. Do not reset
the key's age when recovering a lease or handling a database error.

At/after 24 hours from first submission, or when chronology is missing for a submitted
operation, quarantine using the existing contract. Recheck the boundary immediately
before provider submission after database waits; an item whose remaining safe replay
window cannot accommodate the bounded call is deferred to investigation. Preserve the
original request even if its stored expiry is past; do not invent new expiry/URLs/key
to obtain a replacement Session. An unknown response does not authorize a new command,
attempt or Session. A known Session is reconciled by retrieval, not re-created.

## 6. Payment inbox and deferred refunds

Use a dedicated payment-lane processor rather than invoking the current mixed refund
processor unchanged. Approved `(event_type, object_type)` pairs are:

- `checkout.session.completed`, `checkout.session.expired` → `checkout.session`;
- `payment_intent.succeeded`, `payment_intent.payment_failed`,
  `payment_intent.canceled` → `payment_intent`.

Apply this exact pair allowlist **before** claiming and before stale-lease cleanup.
Do not change ingestion/deduplication behavior for refund or charge deliveries.
`refund.*`, `charge.*`, asynchronous Checkout events, INVESTIGATE and QUARANTINED
events remain durable and unmodified by this lane, even when requested by Event ID.

Bound stale PROCESSING→INVESTIGATE cleanup to two rows per invocation, using a
separate SKIP LOCKED selection and the same payment-only allowlist. The existing
five-attempt boundary remains. Claim at most two payment events per invocation, one
at a time; each claim increments processing_attempts, preserves identity/digest/
delivery history, and uses a new per-claim random owner. Reclamation must never reuse
an old owner. Completion/retry requires owner, processing-attempt number, PROCESSING
state and unexpired lease. Keep retries due and ordered by durable eligible time.

All payment event outcomes retrieve current provider state. Duplicate and older
events cannot regress paid state, reallocate money or duplicate a logical outbox
notice. Exceptions and uncertain results must advance retry history without being
reported as processed. A stale completion is deferred, not successful processing.

The operational summary must expose deferred refund/charge inbox work and open refund
liability without invoking refund APIs or changing those rows. Use bounded sample
queries (for example, cap at 25 per category with an explicit truncated/lower-bound
indicator) and server-side statement timeouts. Report unknown if observation fails;
zero execution is not evidence that deferred liabilities or queues are empty.
Notification outbox writes that already accompany authoritative reconciliation remain
atomic; external notification delivery and automatic refunds are excluded.

## 7. Stage 2A orchestration and bounded runtime

Production entry remains the accepted hard-inactive Stage 2A route: configuration,
dedicated bearer authentication, empty-request validation, then inactive response.
Environment switches alone must never select an executing implementation. Development
and verification keep `STRIPE_AUTOMATION_ENABLED=false` outside explicit synthetic
configuration fixtures. Tests exercise the future core directly through injected fakes;
neither denied nor authorized inactive requests may access factories or processors.

The future core's order, tested with injected dependencies, is authentication authority
→ admission → construct isolated DB client → read-only actual identity/permissions/
migration checks → construct sandbox provider → verify account identity → admit lanes.
No provider operation precedes database validation. Do not treat matching configured
account strings or a test-key prefix as proof of account identity; expose an explicit
bounded account-verification capability before processing, retaining all per-object
test-mode/identity checks. No real provider verification is authorized in Stage 2B-2.

Retain independent item budgets of inbox 2, commands 1, initial 1 and balance 1,
with concurrency 1 and no borrowing. Retain the 15-second admission window. Add a
separate 60-second hard run bound and a 10-second cleanup reserve; an item must have
enough remaining time for its maximum work before admission. A window is an admission
limit, not a promise that every lane runs. Unadmitted lanes report deferred budget,
not completed or empty. Inbox housekeeping has its own two-row budget.

Budget real operations, including hidden adapter calls: connection acquisition and
identity queries, account lookup, Session retrieval, Intent/Charge retrieval,
possible Session expiration and re-retrieval, financial lock/commit and scheduling
completion. Introduce a dedicated lazy worker connection/gateway adapter if necessary;
existing pool construction and fixed SDK timeout are insufficient for a run deadline.
Use bounded connection acquisition, PostgreSQL statement/lock/transaction timeouts,
and SDK/HTTP timeouts clamped to the remaining item/run deadline, with network retries
disabled. Count internal provider requests, not just gateway method calls. A
`Promise.race` timeout alone does not cancel a query, transaction or provider request
and cannot satisfy this contract. Dispose of unusable connections and do not leave
background mutations running after reporting a timeout. An ambiguous timed-out POST
remains UNKNOWN; schedule or quarantine it under the existing replay contract.

Detailed millisecond sublimits and abort/connection-cleanup mechanisms must be reviewed
with their Stage 2B-2 tests before integration acceptance. No new public scheduler,
deployment, provider calls, cancellation jobs, refund execution or sender is activated.

Use distinct lane accounting: claimed/attempted, processed, deferred, retried, failed,
and investigation-required, plus lane status and observation availability. Define
processed as completed domain handling **and owned completion committed**; where a
financial commit succeeded but schedule completion failed, report that fact as partial
failure rather than losing the evidence or claiming the lane fully processed it.
Investigation-required may annotate deferred/retried work and must not be summed as
an extra processed item. Report bounded/truncated observations accurately. A lane
exception produces a PARTIAL/FAILED core summary; later independent lanes may run if
identity and time budgets remain valid. A failed global identity check admits no lane.
The public inactive summary retains zero counters and NOT_EXECUTED regardless of the
future core's internal result types. Redact all credentials and raw provider errors.

## 8. Verification and subsequent approval gates

Stage 2B-1 evidence is source review and the existing deterministic Stage 2A regression
suite only. Proposed SQL has not been executed or proved against PostgreSQL. Do not
run `npm test` indiscriminately: several repository suites load environment files,
connect to PostgreSQL, migrate, or seed. Do not invoke Drizzle config/CLI here; its
module loads `.env.local`. No Docker, database listener or network call is needed.

Local verification on 2026-11-02: with `STRIPE_AUTOMATION_ENABLED=false`,
`./node_modules/.bin/vitest run tests/stripe-automation-foundation.test.ts` passed
all 79 tests (one file). Those tests use synthetic configuration and fake identity
rows, and trap database/provider imports on the inactive path. Whitespace checks
passed. No application, active migration, environment or dependency file was changed.

Stage 2B-2 must add deterministic tests exercising the actual new processors via
fake repositories/clients, provider, clock and jitter. In-memory models and SQL-text
assertions do not prove PostgreSQL concurrency; keep that distinction explicit.

| Required case | Stage 2B-2 evidence | Separately approved Stage 2B-3 evidence |
| --- | --- | --- |
| New enrollment and failure atomicity | Actual creator INSERT and rollback/commit-failure paths; no post-commit enrollment or provider call | Both creators commit pristine enrollment; omitted enrollment and forced failure roll back all new rows |
| Historical exclusion | Actual selection predicates and explicit replay preserve false enrollment | Seed old false rows and prove all scheduled scans exclude them; UPDATE cannot enroll |
| Fair selection | Clock advances through repeated failed/uncertain and healthy work; newer due work proceeds | Due index/query and next times survive connections/restarts |
| Concurrent claim and lease reclaim | Competing fake workers, equal-time boundaries, monotonic bigint tokens | Two real connections, SKIP LOCKED, expiry and reclaim; no shared claim |
| Stale worker fencing | Late success/failure cannot finish metadata or command/inbox lease | Old owner/token/expired lease changes zero rows; direct app metadata UPDATE denied |
| Retrieval errors and repeated uncertainty | Distinct internal observations; exact bounded backoff/jitter, failure saturation and slower surveillance | Persisted schedule advances across provider fake failures and transactions |
| Unknown creation and unsafe replay | Same stored request/key/chronology, unknown response, ≥24h/missing age, pre-call deadline | Command locks/generations and uncertainty survive interruption |
| Duplicate/out-of-order webhooks | Approved pairs, duplicate and stale deliveries retrieve current objects; completion ownership | One financial record/allocation/logical notice under races |
| Inactive authorization/isolation | Existing route import/factory traps plus identity/account ordering in the future core | Identity/ACL/schema guards reject wrong actual target before writes |
| Budget exhaustion and lane failure | Fake deadlines, individual call timeouts/cancellation, independent caps, no false success | Real DB statement/lock timeouts and rolled-back/released connection behavior |
| Payment/refund separation | Refund/charge/async/INVESTIGATE/QUARANTINED rows never claimed or cleaned; bounded observations | Excluded rows, counters, leases and history unchanged after payment runs |
| Financial invariants | Existing authority/amount/identity, unique keys, no timeout-based release, no replacement Session | Actual overlap exclusion, unique capture/allocation, lock order, concurrent financial recovery |

Stage 2B-3 requires separate approval before provisioning **or** migration. Only the
standalone PostgreSQL 17.6 Docker project, independent volume, localhost 55433 and
`zemaitija_stripe_automation_dev` are permitted. Verify actual database, session/current
role, server identity/version, owner, membership/effective privileges and migration
state before every mutating phase. Use separate migration/app credentials, the complete
approved chain through 0035 and minimal synthetic reference fixtures. Never connect
to or modify `zemaitija_dev`, copy its historical data or use its tests as a fallback.

Acceptance requires independent source/migration/evidence review after all separately
authorized tests. This packet does not authorize delegating review to sub-agents;
no independent review is claimed. Stage 2C still needs its own approval and actual
sandbox Checkout/webhook/scheduled-path evidence.

## 9. Rollback limitations and requested decision

Before application of 0035, rollback is removal of these proposal documents only;
there is no database change to undo. Preserve unrelated Stage 2A and working-tree
changes. No commits are requested or made.

After 0035 is applied, keep automation disabled and stop new admission first. Prefer
leaving the additive schema, enrollment guards, grants and due data intact while
fixing forward. An old application binary cannot create accepted attempts under this
migration; do not recommend rolling it back alone. Removing the enrollment guard
while allowing old writers reintroduces an invisible-attempt gap.

A physical down migration would require separate review, booking-write suspension,
worker quiescence and handling of all live leases. Dropping scheduling columns loses
due work, failure history and fencing tokens. Dropping the functions/grants before
stopping workers breaks completion. Restoring table-wide UPDATE broadens privileges
again. Existing ledger, reconciliation records, inbox history, audit, outbox and claims
must remain untouched. Database rollback cannot undo a provider call; an unknown
external outcome still needs authoritative reconciliation. Do not reset generation,
delete attempts or discard the dedicated volume as a rollback shortcut.

Requested decision: approve or amend this exact migration/enrollment/privilege and
recovery contract for **Stage 2B-2 implementation plus deterministic tests only**.
Provisioning, migration execution, actual Stripe calls, activation, public scheduling,
automatic refunds, external notification delivery and Milestone 18 remain excluded.
