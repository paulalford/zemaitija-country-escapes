# Milestone 9 — Holds and pending booking lifecycle

**Status:** Internal synthetic portfolio workflow. No public endpoint, Stripe call, verified payment, confirmation, email or live booking authority. D12 check-in at 15:00, Friday/Saturday weekend pricing, accommodation-only rates, D17 fees/taxes and test terms remain provisional. Lithuanian legal and commercial gates remain open.

## Acceptance contract

`acceptBooking(pool, request)` in `src/server/booking-acceptance.ts` takes a trusted server-generated `QuotePreview`, synthetic guest ID, locale, explicit synthetic terms acceptance, stable operation key and acknowledged initial cents. It returns the booking, snapshot, hold, attempt and command IDs, authoritative acceptance instant, split and replay flag. `AcceptanceError.code` distinguishes invalid input, untrusted guest, stale quote, changed payment terms, idempotency conflict and inventory conflict. Unexpected PostgreSQL errors propagate. The optional test instant and failure injection exist only for Vitest; the production path gets `clock_timestamp()` from PostgreSQL after locks and repricing. The service is internal and has no route or guest authentication.

The transaction sets bounded lock and statement timeouts. It locks **unit → booking/hold/claim → obligation/attempt → audit**. The narrowly granted `lock_acceptance_context` function takes the unit, guest and active tariff row locks without giving the runtime role catalog UPDATE. A transaction-scoped operation-key advisory lock serializes same-key requests after the unit lock. Activated rate bands are immutable. The shared quote implementation reruns unit, capacity, tariff and every nightly rate lookup inside the write transaction. Its read-only preview still uses `REPEATABLE READ READ ONLY`. The accepted total and nightly lines must match the preview exactly. The snapshot is the accepted financial record and keeps schedule/rate provenance, locale, provisional policy version, synthetic terms version, total and split.

At the database acceptance instant `t`, the split is 30%/70% when `t < D`, using `floor((totalCents × 30 + 50) / 100)`. At `t >= D`, initial is 100% and balance is zero. If a preview disclosed 30% but acceptance reaches D, `TERMS_CHANGED` requires a new acknowledged initial amount. Dates are local Europe/Vilnius calendar dates and the stored arrival, warning, due and grace instants follow `BOOKING_PAYMENT_SPEC.md`.

One commit inserts the pending booking, immutable snapshot and nightly lines, `INITIAL` and `BALANCE` obligations (including zero balance), `CREATING` hold, one blocking hold-owned claim, `CREATING` initial attempt, `PENDING` `SESSION_CREATE` command and redacted quote-accepted audit event. The command has a stable logical key, Stripe idempotency identity and request fingerprint, but no provider operation occurs. Failure rolls back everything. The single `inventory_claims_no_overlap` PostgreSQL exclusion constraint arbitrates guest holds, confirmed booking claims and operator blocks; only SQLSTATE `23P01` becomes `INVENTORY_CONFLICT`.

## Idempotency and pending work

The operation key is unique in the accepted snapshot and provider command. The normalized request fingerprint includes guest, dates, unit, quote provenance, nightly lines, locale, terms and acknowledged amount. Same-key, same-request retries return the original IDs; conflicting parameters fail explicitly. The transaction lock and database uniqueness handle concurrent retries. Deadlock retry is bounded to three database attempts with the same business operation key. A database retry never authorizes a provider POST retry.

`inspectHold` and `agedCreatingHolds` report state. `leaseSessionCommand` durably increments a generation and records an owner before a future worker can dispatch. `markHoldReconciling` keeps the claim blocking when outcome is unknown. `abandonBeforeDispatch` releases and expires a draft only if the command is still `PENDING`, has never been leased or submitted, has no provider request ID, and its claim is still held. It updates the command, attempt, claim, hold, booking and audit atomically. Retry returns `ALREADY_ABANDONED`. An aged, leased, possibly submitted or unknown command cannot take that path. Elapsed 30 minutes alone never releases inventory.

Provider-confirmed Session creation, expiry, recovery, payment, claim transfer, capture, 24-hour idempotency quarantine and provider-based release are Milestone 10 work. A future worker must fence its results by command generation and reconcile any unknown POST outcome before changing inventory. No synthetic response is treated as provider evidence here.

## Database protection and limits

Forward migrations `0006`–`0013` add accepted booking field immutability, provisional transition guards, deferred accepted snapshot-line/obligation reconciliation, booking/hold/claim/attempt state and ownership checks, command evidence monotonicity, scoped runtime read/write grants and the narrow row-lock function. Forward migration `0014` closes the accepted-ownership detachment path: BEFORE UPDATE guards inspect both OLD and NEW hold/claim owners and reject reassignment of an accepted hold or claim. Deferred checks inspect both relationships and require an accepted pending booking to retain its blocking hold-owned claim. The sole Milestone 9 release path retains that ownership history and requires a released claim, expired attempt and booking, and one resolved `SESSION_CREATE` command with `ABANDONED_BEFORE_DISPATCH` evidence, no provider request ID, no first submission, no lease history, no attempts and no current lease. A recorded provider request ID cannot be cleared or rewritten; a unique index allows only one `SESSION_CREATE` command per attempt. Forward migration `0015` prevents an uncertain, submitted or quarantined command from reverting to `PENDING` or being recast as a never-dispatched resolution. Forward migration `0016` prevents deletion of an accepted Session-create command, so a possibly dispatched command cannot be replaced with fresh non-dispatch evidence. Uncertain or potentially submitted provider work cannot authorize this release. A future verified hold-to-booking claim transfer requires a reviewed Milestone 10 transition and guard update.

The existing 28 tables and single inventory exclusion domain are unchanged. Older schema fixtures without accepted snapshots remain outside accepted aggregate guards and can still make legitimate ownership updates. The application role has only table-specific writes for this pending workflow; immutable snapshots, lines, obligations and audit events have no runtime UPDATE grant. Migration DDL remains with the migration role.

Database triggers cannot establish guest authority, genuine terms approval or Stripe truth. Accepted rows are protected against the direct SQL mutations tested here, but complete future booking-state and provider-evidence enforcement requires Milestone 10 migrations and tests. The current transition guards intentionally block provider-confirmed states until that work. The runtime role can still issue SQL on its granted tables, so deployed access must remain server-side and scoped.

## Verification

The existing local development database migrated forward through `0016`; a separate empty `zemaitija_m9_integrity_20261024_dev` database replayed the full `0000`–`0016` chain. The full PostgreSQL suite passed on both databases (53/53 each). Tests use separate connections and bounded transaction timeouts to prove before/at-D splitting, cent reconciliation, changed-term acknowledgment, stale configuration/tariff rejection, atomic record creation, interruption rollback/retry, concurrent overlapping claims, same-key concurrency/conflict, adjacent ranges, operator-block conflict, aged and uncertain blocking holds, pre-dispatch release, restricted runtime-role execution and direct SQL rejection. New direct-SQL regressions use the migration and runtime roles to reject accepted claim/hold reassignment, combined ownership change and release, leased/provider-identified release, uncertain-command recasting or deletion, provider request ID clearing or rewriting, and duplicate Session-create commands. They also retain legitimate historical-fixture ownership updates and both directions of operator-block/guest-hold conflict. The three reference units were not altered. Tests create synthetic units and guests; the separate database can be removed after inspection.

Linux Mint verification after starting the repository PostgreSQL service and applying migrations:

```sh
npm run db:migrate
npm run test
npm run typecheck
npm run lint
npm run build
npm run db:check
git diff --check
```
