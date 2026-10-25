# Milestone 13 — Cancellation, refunds and mitigation

Implemented for the fictional, synthetic-data, Stripe test-mode portfolio. No public cancellation, assessment or refund endpoint is installed. These services run only when explicitly invoked by trusted internal code. Starting Next.js does not run financial jobs.

## Cancellation and authorization

`cancelBooking(pool, gateway, bookingId, authority, input)` supports `GUEST` and attributable `PROVIDER` cancellation. It reconciles every known payment attempt outside transactions, expires open unpaid Checkout Sessions, then rechecks the attempt set under the established unit/guest → booking → claim → attempt lock order. Unknown creation, processing payment, mismatched evidence or unresolved provider commands prevent cancellation. A concurrently created attempt makes the final check fail; a concurrent cancellation becomes an idempotent no-op.

The decisive instant is read from PostgreSQL under the final booking lock. A clock override is accepted only in tests. Cancellation strictly before the accepted `balance_due_at` instant is free. Equality is late. The existing immutable deadline is local 15:00, fourteen calendar days before arrival in `Europe/Vilnius`; spring and autumn boundaries have integration coverage.

Early guest cancellation atomically records `CANCELLED_GUEST`, a zero-charge `NOT_REQUIRED` assessment, full per-capture refund obligations, inventory release, actor/authorization reference, reason, decisive instant, prior/new state and both guest/operations outbox messages. Provider cancellation records `CANCELLED_PROVIDER` with the same full-capture refund principle. Additional provider compensation is not calculated.

Late guest cancellation records `CANCELLED_GUEST` with the schema's existing assessment state `PENDING`; the service result and financial projection call this `ASSESSMENT_PENDING`. Funds remain unsettled while evidence is reviewed. The guest message explains the maximum and documented review; it does not forfeit the advance or promise an unapproved review/refund deadline. The common inventory exclusion constraint and consumed-hold history remain intact.

`InternalAuthority` is an assertion supplied by a **trusted internal authentication adapter**, never data accepted from HTTP/request JSON. It carries a service identity, authorization reference and expiry of at most fifteen minutes. Guest authority additionally binds guest, booking and cancellation scope. Operator authority is checked against an enabled database administrator identity: operations/finance/administrator for provider cancellation, finance/administrator for assessment approval and refund initiation. Denials are audited without disclosing another booking. No token issuer, authentication adapter, guest manage-booking interface or administration UI is implemented here; Milestone 14 must authenticate credentials before constructing this context. TypeScript objects alone are not authentication.

## Assessments and mitigation

`approveCancellationAssessment(pool, bookingId, authority, evidence)` requires explicit finance approval and the expected revision number. Evidence includes gross documented loss, actual avoided costs, attributed replacement-booking dates and revenue, provenance, controlled evidence reference, legal/contractual constraints, reviewer and rationale.

All money uses integer EUR cents. The approved charge must satisfy both:

- `charge <= floor(accepted_total * 30 / 100)`;
- `charge <= max(0, documented_loss - avoided_costs - attributed_replacement_revenue)`.

Gross documented accommodation loss cannot exceed the accepted total. Replacement bookings must be for the same unit and the specified overlap dates, have confirmed/completed state and sufficient captured revenue after confirmed refunds. Duplicate replacement IDs in a revision are rejected. Revenue already attributed to another current assessment counts against available recovery; each revision is a complete evidence calculation, not an additive copy of old mitigation. Attribution is an explicit reviewer decision; the service does not infer a fixed nightly recovery formula.

Approval appends an immutable numbered revision, records the finance reviewer and updates the current pointer. A subsequent final revision can preserve or lower the charge; an increase is rejected. Replayed approval keys return the same revision only for matching evidence. Concurrent or stale approvals cannot create a second liability. In-flight refunds must be reconciled before a revision is approved.

`refund_target = max(0, verified_captures - final_charge)`. New liability is the target minus the total of all existing booking refund obligations, floored at zero. That total already includes confirmed refunds and every unpaid residual, including unsent, reserved and failed operations, exactly once. For a target increase of €30, the new obligation is €30 even if the earlier obligation has not yet been submitted. Confirmed refund records are never subtracted twice, overwritten or removed.

`additional_charge_review = max(0, final_charge - verified_captures)` is an audit/projection item. No post-cancellation collection command is created. Database guards tie final revisions to the current assessment and enforce the total cancellation liability against the approved entitlement.

## Refund lifecycle

- `requestRefund(pool, obligationId, authority)` requires finance authority. It locks booking (when known), eligible captures and the refund obligation; reserves the same exact cents on both budget parents; then persists a `REQUESTED` attempt and `REFUND_CREATE` command. A replay returns the active attempt. A confirmed failed attempt can have a linked replacement after fresh authoritative reconciliation. An obligation spanning multiple captures uses sequential attempts, preserving the existing one-active-attempt-per-obligation constraint.
- `dispatchRefund(pool, gateway, attemptId)` leases the durable command, records first submission, checks the canonical request fingerprint and exact original capture, and performs the Stripe POST outside the transaction. All retries use the original immutable request and key. Capture/obligation reservations prevent duplicate or excess refunds. The returned refund identity and request correlation ID are attached before current-object retrieval.
- `reconcileRefund(pool, gateway, attemptId, { refundId, webhookEventId })` retrieves current provider evidence and matches account, test environment, original Charge/PaymentIntent, amount, currency and internal operation metadata. Only `succeeded` creates an immutable refund ledger debit and guest confirmation. `pending`/`requires_action` remain `PROCESSING`. A provider-confirmed `failed`/`canceled` result releases the reservation but retains the original obligation. Failure, unknown outcomes, action requirements and prolonged pending refunds queue operations and guest status updates.

The adapter uses the [original-charge refund API](https://docs.stripe.com/api/refunds/create) and current [Refund object status](https://docs.stripe.com/api/refunds/object). It retrieves complete paginated refund history for recovery and detects untracked/ambiguous provider refunds. Refund creation age is fenced by Stripe's [API v1 idempotency retention boundary](https://docs.stripe.com/api/idempotent_requests): at or beyond 24 hours from first submission, or when the submission age is unknown, the service does not resubmit an unresolved POST. It quarantines the command, retains `PROCESSING` and both reservations, audits the reason and alerts operations. Missing history alone does not prove noncreation.

Quarantined operations can still recover when a matching provider refund is identified and current evidence is reconciled. This milestone does not provide a generic override that asserts noncreation and releases an unknown reservation. An unresolved negative-evidence case remains quarantined for documented operational investigation; an administration interface must not bypass these guards.

The signed webhook inbox now accepts `refund.created`, `refund.updated`, `refund.failed` and `charge.refunded`. It locates a unique internal attempt, retrieves current Refund objects and invokes the same reconciliation path. Duplicate, delayed and out-of-order events cannot regress terminal history, duplicate a debit or send a second refund confirmation. Unmatched events retain inbox retries/investigation state. Provider evidence that conflicts with terminal history creates an operational intervention while retaining historical ledger facts.

## Notifications and financial position

The existing sandbox worker supports guest/provider cancellation, assessment, confirmed refund, pending guest money updates and refund intervention in LT/EN/DE. These notices survive cancellation and are not suppressed as obsolete balance reminders. The synthetic-recipient checks, delivery leases, recovery and retries remain in use. Refund amounts come from the triggering immutable audit event; success wording is queued only after verified provider success.

The Milestone 12 guest incident-notification gap is closed with a deferred outbox producer in the same incident transaction. It derives a guest from internal booking, attempt and audit relationships, never provider metadata alone. `backfillGuestFinancialUpdates(pool, limit, onlyNotificationId?)` repairs historical notices without duplicate guest messages. Unverified associations receive an immutable investigation record and can be reconsidered after association is established. Backfill is explicit, bounded and can be scoped to one notice.

`paymentPosition` preserves gross captured allocations and adds assessment pending, refund due, partial/full refund and settled-cancellation projections. Cancelled bookings have zero collectible scheduled balance; any additional assessed amount is separately labelled for review. Refund ledger records and capture credits remain independent.

## Applied migrations and safety

All three migrations were applied to the existing local `zemaitija_dev` database; none resets the database or rewrites bookings, captures or existing refund records.

| Migration | Effect |
| --- | --- |
| `0026_cancellation_refunds` | Nullable JSON evidence on assessment revisions; cancellation/hold state compatibility; assessment/refund identity, terminal evidence and reservation budget guards; narrow new runtime privileges; deferred guest incident updates. |
| `0027_cancellation_financial_guards` | Cancellation entitlement/obligation totals, exact refund-command identity, owner serialization, immutable capture evidence and refund-command transition guard. |
| `0028_cancellation_trigger_row_shape` | Function-only correction found by integration tests: isolate refund-obligation-specific `NEW` fields from assessment/revision trigger branches. |

The additional nullable evidence field leaves historical rows unchanged. New revisions require evidence. The Drizzle snapshot/journal includes the new column; schema generation reports no pending changes. Earlier applied migration files remain unchanged.

Runtime grants permit inserts/selects for assessment revisions and refund attempts/records, assessment state/revision-pointer updates, refund attempt outcome fields and **only** `refund_encumbered_cents` updates on capture/obligation budget parents. They do not grant capture-amount edits, liability-amount edits, ledger deletes, administrator creation or broad finance-table update access. Deferred guards compare reservations with successful plus in-flight attempts and require authoritative reconciliation evidence for terminal refunds. PostgreSQL enforces local evidence relationships; the application verifies provider authenticity and current state.

## Verification

Final verification commands:

```sh
npm run typecheck
npm run lint
npm run db:check
npm run db:generate
npm test
```

Results: TypeScript, ESLint and Drizzle checks passed; schema generation reported no changes. **174/174 tests passed across 11 files**, including **35 Milestone 13 tests**. All provider calls in automated tests use fakes; notification delivery uses a sandbox transport. No genuine Stripe API requests, live transactions or production mail sends were made.

Coverage includes strict cutoff/equality and both DST transitions, inventory reuse, payment uncertainty, zero/full refund liability, late review, cap/net-loss/mitigation calculations, verified replacement attribution, immutable/stale/concurrent revisions, incremental obligations before and after confirmed refunds, provider cancellation, multiple captures, duplicate/concurrent refund requests, failed/pending/action-required outcomes, unknown responses and ages, 24-hour quarantine, history recovery, ambiguous/untracked refunds, signed inbox replay/order, false-debit rejection, restricted permissions, localized notices and association investigation.

A separate read-only scan of stored rows found **0 capture reservation discrepancies, 0 obligation reservation discrepancies and 0 refund ledger discrepancies**. It also confirmed the runtime role cannot edit capture amounts or delete refund records. This is evidence for the local synthetic database, not a claim of external security review or real Stripe refund execution.

Two Milestone 12 test expectations were updated for the new refund execution permission and the additional guest incident notice. The fixed Stripe balance smoke fixture now includes the new financial projection fields; no smoke-test command or state file was run or changed.

## Changed files

Created:

- `src/server/cancellation-authority.ts`
- `src/server/cancellation.ts`
- `src/server/cancellation-assessment.ts`
- `src/server/refund-worker.ts`
- `src/server/financial-notifications.ts`
- `drizzle/0026_cancellation_refunds.sql`
- `drizzle/0027_cancellation_financial_guards.sql`
- `drizzle/0028_cancellation_trigger_row_shape.sql`
- `drizzle/meta/0028_snapshot.json`
- `tests/milestone13.test.ts`
- `docs/MILESTONE_13.md`

Modified:

- `src/db/schema/refunds.ts`
- `src/server/payment-position.ts`
- `src/server/sandbox-notification-worker.ts`
- `src/server/stripe-adapter.ts`
- `src/server/stripe-webhooks.ts`
- `drizzle/meta/_journal.json`
- `tests/milestone12.test.ts`
- `tests/stripe-balance-smoke.test.ts`
- `docs/MILESTONE_12.md` (completion pointer)

The pre-existing `next-env.d.ts` modification and the three unrelated root documentation/patch files were preserved. Nothing was staged, committed or pushed. Review with `git status --short` and `git diff --check`; new files remain untracked for independent review.

## Outstanding gates and limits

The commercially unapproved zero-charge nonpayment cancellation policy retains its explicit approval gate. Lithuanian legal review remains required for live cancellation terms, evidence practice, refund timing and additional provider remedies. The 15:00 check-in setting is still provisional. Authentication, scoped token verification/issuance and guest/administrator interfaces remain Milestone 14 work. No UI or unrelated design change was made.

Real Stripe refund sandbox verification requires separate explicit approval. These tests exercise the adapter contract and durable lifecycle using fake provider evidence. Unknown operations without identifiable provider objects remain quarantined; no generic administrative escape hatch is supplied. Assessment evidence is supplied and approved by an authorized reviewer; the software does not establish the legal sufficiency of loss evidence or automatically approve mitigation/disputed amounts.


## Independent review follow-up

The authorization-denial audit defect was confirmed and corrected in `cancellation-authority.ts` and the cancellation/refund transaction wrappers. `AuthorizationDeniedError` carries one event ID and the original denial time. Each wrapper first completes `ROLLBACK`, then writes the same redacted denial event through the checked-out connection in autocommit mode, and rethrows the denial. A primary-key conflict is a no-op, preventing duplicate records. No second pool connection, denied domain commit, authentication endpoint, migration or additional permission is required. Assessment approval uses the cancellation wrapper and receives the same correction.

Three regressions commit synthetic operator revocation after the initial authorization lookup but before transactional revalidation, covering cancellation, assessment approval and refund request. They verify rejection, rollback before durable audit insertion, exactly one surviving event with the original ID/time, no commit of the denied transaction and unchanged inventory/financial state.

The installed `public.lock_acceptance_context(uuid,uuid)` was inspected through `pg_get_functiondef`: it is owned by `zemaitija_migrator`, is `SECURITY DEFINER`, and locks the accommodation unit `FOR UPDATE`, the guest `FOR SHARE`, and the active rate schedule `FOR SHARE`. The assessment service invokes this function before locking its booking and before reading replacement attribution. Under the installed `READ COMMITTED` isolation, the unit row lock serializes different cancelled bookings on the same unit until commit or rollback; the later attribution query sees the earlier committed revision. The existing assessment code and lock order therefore required no change.

A deterministic regression creates two cancellations for different guests on one synthetic unit and one confirmed shared replacement booking. Each assessment proposes more than half of that replacement's verified captured revenue. Worker A pauses after reading zero prior attribution while retaining its unit lock. `pg_blocking_pids` proves worker B is blocked by A before B can read attribution. After A commits, B reads the committed attribution and rejects the excess. Exactly one revision attributes the proposed amount, total attribution remains within recovered revenue, and the rejected assessment remains pending without a refund obligation. Synchronization uses observed SQL barriers and database blocking evidence, rather than an assumed scheduling delay.

Review verification: **174/174 tests passed in 11 files**, including **35 Milestone 13 tests**; typecheck, lint and Drizzle consistency checks passed. A read-only financial scan found zero capture reservation, obligation reservation or refund ledger discrepancies. The existing €200 sandbox booking remains `CONFIRMED`, with 20,000 cents captured, zero cents refunded and one active inventory claim. The four unrelated working-tree files retain their pre-review hashes. No Stripe API request, database reset, fixture deletion, migration, permission change, nonpayment-policy activation, commit or push occurred during this follow-up.
