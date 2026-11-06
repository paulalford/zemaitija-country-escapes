# Stage 2C-3H — Independent acceptance verifier

Source contracts, deterministic tests and documentation only. No genuine acceptance
run is performed. `PASS` describes the supplied evidence under the stated trust
boundary; `evidenceClass:SIMULATED` explicitly identifies synthetic contract tests.
Every report has `operationsEnabled:false`. No result authorises execution.

Exactly five new files belong to this checkpoint:

- `src/server/stripe-acceptance-verifier-evidence.ts`
- `src/server/stripe-acceptance-verifier.ts`
- `tests/helpers/stripe-verifier-fixture.ts`
- `tests/stripe-acceptance-verifier.test.ts`
- `docs/STRIPE_ACCEPTANCE_STAGE_2C_3H.md`

No pre-existing file was edited. The baseline remains `a4f4a22` with the accepted
earlier-stage working tree. Existing design/owner/accommodation work, protected
financial evidence, SQL, constraints, triggers, routes and inactive barriers remain
unchanged. Stage 2C-3I and Milestone 18 are outside this checkpoint.

## Inspected contracts and reuse

AGENTS.md, PRODUCT.md, Stage 2A, booking/payment and state-machine specifications,
Stage 2B review/implementation/PostgreSQL acceptance documentation, Stage 2C-2 and
3B–3G documentation and run/host/forwarding/fixture/status/supervision sources inform
the verifier. Booking acceptance, payment reconciliation, Checkout persistence and
booking/payment/operations schema sources establish the actual identifiers, audit
actions and logical notice key. No external legal or provider research is needed
to implement these existing local contracts.

Reused: the immutable issued run and fixture plan, canonical JSON/SHA-256 functions,
derived fresh resource names, scenario names and existing financial terminology.
The verifier does not call the application status inspector or the supervision
simulator. It independently compares normalized evidence and replays the journal.
The tests additionally confirm journal compatibility with the accepted 3G reader.
No payment, allocation, reconciliation, acceptance or notification engine is created.

## Read-only interface and independent provenance

`verifyAcceptanceEvidence(run, plan, {now, readers})` requires an issued 3B seal and
issued 3F plan for the same run. The manifest must permit all five acceptance
operations. Copying/deserializing an object does not recreate its issuance. The
seal and plan alone do not establish independent authority or artifact provenance.

Each `AcceptanceEvidenceReader` must be a plain object exposing exactly `kind` and
`read(binding)`, with kind `acceptance-verifier-read-only-v1`. No pool-like object,
extra write method, raw SQL callback, transport or credential is accepted. Readers
and their read functions must be distinct, including the authority reader. The
binding fixes run, canonical manifest/source/migration/plan hashes, target digest
and fresh database. Caller target overrides do not exist.

A separately controlled authority reader supplies the strict version-1 review:
exact binding and approval reference; independent reviewer identity; verification
window; complete exclusive resource reservation and foreign-resource inventory;
verified artifacts, target and restricted reader privileges; snapshot-set ID and
common as-of watermark; five producer/record/digest anchors; and a protected durable
journal sequence/head checkpoint. Resources must equal all eight sealed identities,
with no collision. Existing protected databases and foreign target evidence reject.

| Reader | Independently collected data |
| --- | --- |
| bindings | Original accepted runtime IDs, both obligation IDs, original claim, acceptance audit/transaction and operation/fixture provenance |
| database | Complete consistent scoped financial/booking/hold/claim/audit/outbox/inbox/investigation history and all potentially conflicting inventory claims, including operator blocks |
| provider | Retained authenticated Stripe test-account Session/PaymentIntent/captured-charge observations and provider request references |
| webhooks | Raw-byte signature-verification evidence references, account/endpoint, event/object IDs, original/incoming digests, persisted ownership, durable receipts and actual receipt chronology |
| supervision | Entire durable journal plus independent launch/lock/transport/recovery observations, not a runner summary |

Each envelope repeats the exact binding, channel, independent producer and record,
snapshot-set ID, evidence class, observation time, as-of watermark and complete/
settled assertions. The authority pins SHA-256 of its entire canonical envelope.
All five producers and the reviewer must differ. Snapshots are bounded to 4 MiB
each; nested row arrays and journal sizes are bounded. Data is copied before later
readers can mutate it. Missing/malformed/stale sources never receive success credit.
Hash/binding conflicts require investigation; unanchored data cannot prove an
invariant violation. Already independently verified database violations can still
produce FAIL if another required source is missing.

The verification grant must be current and contained in the sealed run window.
Evidence is at most 30 seconds old; observations cannot precede the common watermark
or be in the future. Grant/freshness are checked again after all asynchronous reads.
Future adapters must provide a common consistent capture barrier, not label unrelated
snapshots with an invented watermark. Verification after the run window requires a
separately reviewed retrospective read-authority contract; none is inferred here.

Distinct labels/functions and matching hashes cannot prove independence against a
malicious capability provider. Protected authority control, authenticated provenance,
complete immutable evidence capture, OS/database privileges and reviewed adapter
construction are mandatory external trust requirements. The authority must never
derive independent approval simply from the same application's supplied status JSON.
No real reader, protected-file adapter, SQL role/grant, cryptographic signature
verification or provider connection is implemented. A RECORDED label cannot upgrade
SIMULATED provider/signature attestations: their stricter recorded proof classes
are required too. Synthetic fakes do not prove any of those real properties.

## Verdict rules and diagnostics

Precedence is **FAIL > INVESTIGATION_REQUIRED > INCOMPLETE > PASS**. All established
issues are retained with sorted/deduplicated fixed codes. Shared provenance,
supervision or cross-fixture integrity issues affect every scenario; a local
scenario issue affects that scenario and the overall verdict. Other scenarios
retain their own findings. Unknown evidence is never interpreted as a failed payment.

| Verdict | Meaning and representative codes |
| --- | --- |
| FAIL | Independently established acceptance violation: TARGET_REJECTED, DUPLICATE_FINANCIAL_EFFECT, AMOUNT_OR_CURRENCY, INVENTORY_VIOLATION, STATE_MACHINE_VIOLATION, DUPLICATE_NOTIFICATION, NOTIFICATION_IDEMPOTENCY, COMMAND_CHANGED, FALSE_CONFIRMATION, BUDGET_OVERRUN, DEADLINE_VIOLATION |
| INVESTIGATION_REQUIRED | Conflicting/suspicious/financially uncertain evidence: PROVENANCE_CONFLICT, PROVIDER_UNCERTAIN, WEBHOOK_CONFLICT, JOURNAL_CORRUPT, ACCOUNTING_UNCERTAIN, CLEANUP_UNCERTAIN |
| INCOMPLETE | Missing/stale/unestablished evidence: INVALID_RUN_OR_PLAN, AUTHORITY_UNAVAILABLE, READER_REJECTED, EVIDENCE_UNAVAILABLE, EVIDENCE_INVALID, EVIDENCE_STALE, INDEPENDENCE_UNVERIFIED, SCENARIO_MISSING, PAYMENT_EVIDENCE_MISSING, INVENTORY_TRANSFER_MISSING, AUDIT_MISSING, NOTIFICATION_MISSING, WEBHOOK_EVIDENCE_MISSING, RECOVERY_UNPROVEN, DELAY_UNPROVEN |
| PASS | Every required shared and scenario-specific condition is established |

The complete fixed vocabulary is exported as `VERIFIER_DIAGNOSTICS`; some codes
such as BINDING_CONFLICT, LOCK_LOST, WORKER_FAILED and SUPERVISION_UNPROVEN have
different verdicts depending on whether evidence proves a violation or only an
unknown/conflicting outcome. Reports contain no raw exceptions, payloads, guests,
credentials, database URLs or signing secrets. Provenance includes consumed anchor
digests, run/manifest/plan/snapshot-set IDs and a reproducible report digest.

## Financial, inventory and notification checks

The approved 3F scenarios concern INITIAL obligations; both INITIAL and BALANCE
obligations must match the original accepted snapshot. Allocations to another
obligation, extra payment records or duplicate PaymentIntent/charge/record/allocation
IDs fail. No new balance-payment scenario or commercial policy is introduced.

For normal completion, require exactly one matched payment record and allocation,
exact integer EUR cents, correct run/account/test mode, Session/PaymentIntent/charge
IDs, persisted command ownership and expected card/payment mode. Metadata alone
cannot prove ownership. Session paid, intent succeeded and exact captured/paid charge
are all required. Amount/currency/account violations fail; conflicting independently
observed provider IDs require investigation. Processing/uncertain/conflicting provider
outcomes remain financially unresolved. Provider observation references must map to
an accounted request for that attempt.

Booking/obligation/hold/claim/attempt/command/snapshot IDs must match the independent
original runtime mapping. Original request digest and `session-create:ATTEMPT_ID`
key must survive every dispatch. Logical command key is the existing planned key.
Persisted request must precede dispatch, and each dispatch must retain the reviewed
lease, bigint generation and original submission-age bounds, with a matching
budgeted CHECKOUT_DISPATCH receipt. No retry, reconciliation or dispatch is performed.

Normal confirmation requires accepted pending state then the existing
`payment-reconciliation` transition, reason VERIFIED_INITIAL_CAPTURE, one
STRIPE_CURRENT/VERIFIED_INITIAL reconciliation, consumed original hold and transfer
of the original claim to that same booking. The normalized ownership history has
exactly the acquisition and transfer observations, with no release/reacquisition or
regression. Unit/dates remain fixed and no duplicate/overlapping active claim remains.
Confirmation, reconciliation, payment, allocation, hold transition, claim transfer
and outbox must have matching captured commit provenance. A matching paid state
without inventory/audit/notice evidence cannot pass.

Exactly one logical BOOKING_CONFIRMED notice must reference the confirmation audit,
guest, locale and existing `booking-confirmed:BOOKING_ID` key. Other notice types are
not counted as duplicate confirmations. All observed notice keys/IDs and retry
numbers must remain unique and retries must retain the logical key. Notification
transport delivery is not required and is never attempted.

Transaction IDs and ownership/dispatch/lock history in this read model are evidence
capture requirements, **not invented columns in the current schema**. Existing
schema/audit alone does not persist every required original identity, per-request,
transaction or lock observation. Future independently approved recorders/adapters
must establish those facts without modifying historical financial rows or fabricating
transaction provenance. Missing capture produces INCOMPLETE rather than inferred
atomicity. No DDL or recorder is added in this checkpoint.

## Five-scenario coverage

| Scenario | Additional acceptance condition |
| --- | --- |
| SIGNED_WEBHOOK | Independently verified exact-byte signature provenance, correct account/endpoint, persisted ownership and original digest, processed durable inbox, linked reconciliation and expected effects |
| DUPLICATE_DELIVERY | Same event/digest delivered again with a duplicate receipt, a distinct older event actually arriving later, consistent immutable event identity and reconciliation after those observations, with one financial/claim/confirmation effect |
| MISSING_WEBHOOK | No webhook/inbox contribution; persisted reconciliation/recovery link to a protected SCHEDULED launch, completed invocation, known budgeted recovery request and valid accepted generation/lease; MANUAL or a null webhook ID alone cannot pass |
| DELAYED_COMMAND | Dispatch occurs after original persistence, with unchanged original request/key, bounded lease/invocation/request and eventual expected completion |
| INVESTIGATION | Durable receipt/inbox/investigation linkage outside PAYMENT lane; no allocation, capture record, consumed claim, booking confirmation or confirmation notice; original claim remains held |

An expected financially certain unsupported-event investigation can PASS its safety
scenario, reporting `expectedInvestigationSafe:true` and `paidBookingVerified:false`.
Financially uncertain/conflicting/unresolved investigation remains
INVESTIGATION_REQUIRED even if a record was safely preserved. Missing investigation
evidence is INCOMPLETE; false confirmation is FAIL. A supported payment event cannot
be relabelled unsupported to satisfy the safety scenario.

## Independent supervision and aggregate budgets

Replay the complete 3G v1 event stream, checking canonical entry hashes, sequence,
previous digest, exact binding, chronology, protected sequence/head checkpoint and
all prior invocations. OPEN/AUTHORITY/host-lock/database-lock/START precede work;
requests stop after cancellation/uncertainty/cleanup. Outcomes, cleanup and releases
must precede a valid terminal completion. Interrupted or unknown records never
become success. A well-formed chain or simulator success alone is insufficient:
independently anchored launch, owner, both lock intervals, fixed host path, derived
control key and continuity observations must corroborate every invocation.

Count reservations across the entire run and independently per invocation, plus
the invocation cap. Every HTTP attempt needs a unique prior reservation and matching
transport/result receipt, including startup/worker account checks, Checkout and
recovery/reconciliation. Unstarted, cancelled, timed-out and uncertain reservations
are counted without refund. No restart resets counters. Missing accounting is
unknown; uncertain/cancelled/timed-out provider outcomes block PASS. Actual lock loss
and proven budget/deadline violations fail; uncertain lock/cleanup/worker/resource
ownership blocks PASS without inferring financial failure or rollback.

Dispatch must occur after reservation and before the sealed invocation deadline;
individual settlement must fit the 1-second provider bound. Invocation windows are
at most 60 seconds and contained in the sealed run window. Both account checks must
have known dispatched outcomes; startup completes before worker START. Recovery
must be inside its invocation and lease and independently attributed to its owner.

The hard-inactive HTTP automation endpoint remains inactive. A future scheduled
launch must be independently approved and recorded; no existing endpoint currently
supplies that operational pathway. This verifier neither enables that pathway nor
accepts a self-reported `BOUNDED`/success flag as launch evidence.

## Verification and remaining dependencies

Only focused deterministic tests, nonincremental TypeScript, targeted ESLint with
zero warnings, Git whitespace checks and `git status --short` are used. Tests use
synthetic snapshots, in-memory readers and fake clocks; source/migration bytes are
read only to exercise the existing pinned seal. 68 verifier cases and 539 existing
focused cases passed (607 distinct tests across 11 suites). The final verifier
suite passed after the final source refinement. Nonincremental TypeScript, targeted
ESLint with zero warnings, tracked and five scoped new-file whitespace checks
passed. Import/network/timer traps confirm no operational work.

Still required: separately approved independent verifier launcher and protected
authority/checkpoint storage; restricted SELECT-only consistent snapshot readers;
complete original runtime/commit/history capture; authenticated retained provider
and raw-signature evidence; durable webhook admission/investigation records; actual
supervision/transport accounting and independently attested scheduled recovery.
Reader acquisition/statement/IO deadlines must be enforced by those adapters; this
pure evaluator creates no timer and cannot terminate a malicious/stalled reader.
No genuine Stripe, PostgreSQL durability, role enforcement, cryptographic signature,
Docker identity or live concurrency acceptance is established by the tests.

No real PostgreSQL, Stripe, Docker, systemd, credential, private environment, financial
record or infrastructure access occurs. No worker, listener, scheduler, background
task, Checkout, genuine webhook, fixture, booking acceptance, migration or DDL runs.
Nothing is staged, committed or pushed. Stop here for independent source review.
