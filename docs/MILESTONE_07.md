# Milestone 7 — Availability and concurrency protection

**Status:** Server-side, read-only inventory availability plus a real PostgreSQL acquisition test harness. The [Milestone 2 domain specification](BOOKING_PAYMENT_SPEC.md), [Milestone 3 database contract](MILESTONE_03.md), [Milestone 4 architecture](MILESTONE_04.md), [Milestone 5 foundation](MILESTONE_05.md) and [Milestone 6 fixture](MILESTONE_06.md) remain authoritative. No public acquisition endpoint or booking workflow is introduced.

## Service contract

`checkAvailability(pool, { unitId, arrivalDate, departureDate, guestCount })` in `src/server/availability.ts` accepts a UUID, ISO local calendar dates (`YYYY-MM-DD`) and a positive safe integer guest count. It returns `{ available: true, reason: 'AVAILABLE' }` or `{ available: false, reason }`, where the reason is `INVALID_INPUT`, `UNIT_UNAVAILABLE`, `CAPACITY_EXCEEDED` or `INVENTORY_CONFLICT`. The result contains no guest, booking, payment or administrator data. Invalid dates include impossible leap dates, zero-length stays and reversed intervals. A disabled or unknown unit is unavailable; capacity is checked against `accommodation_units`.

The query uses PostgreSQL `daterange(arrival, departure, '[)')` and `&&` against generated `inventory_claims.stay`, restricted to `released_at IS NULL`. A departure date is free for another arrival. Any active hold, confirmed-booking claim or operator block blocks the same unit and overlapping local dates. Hold age and provider Session expiry are deliberately ignored. Database failures propagate as errors; they are never translated to an `INVENTORY_CONFLICT` result. This read does **not** determine quote eligibility: dates outside the provisional 2027 tariff may be inventory-free but have no rate. No missing price is treated as zero.

## Acquisition boundary

An availability read is advisory and can become stale immediately. The test-only harness uses valid synthetic booking, hold and operator-block parents, separate PostgreSQL connections, `READ COMMITTED` transactions, and bounded statement/lock timeouts. Ownership arises only when an active `inventory_claims` insert and its transaction commit succeed. The test harness recognizes SQLSTATE `23P01` as an inventory conflict; it does not mask foreign-key violations or connection failures. A later Milestone 9 hold routine must lock the unit before its booking/claim work, create the full accepted quote and command atomically, and never call Stripe for an exclusion loser.

The database retains one partial GiST exclusion domain, `inventory_claims_no_overlap`, on `(unit_id, stay)` where `released_at IS NULL`, backed by `btree_gist`. The generated range is half-open. Exactly-one-owner, foreign-key and uniqueness constraints remain unchanged. No migration, new lock service, unrestricted runtime write grant or schema change was needed. The read-only application DB role is unchanged.

## Integration evidence

The 29-test PostgreSQL suite passes, including 14 Milestone 7 tests. It checks free/occupied ranges, half-open adjacency, different units, disabled and missing units, capacity, calendar validation, active hold/booking/block claims, released claims, stale reads, old unresolved holds and SQLSTATE classification. Separate-connection acquisition races observed:

| Race | First transaction | Second transaction | Result |
| --- | --- | --- | --- |
| Overlapping hold versus booking | Committed | `23P01`, rolled back after waiting on the first transaction | One owner |
| Adjacent hold versus booking | Committed | Committed | Two non-overlapping owners |
| Overlapping hold versus operator block | Committed | `23P01`, rolled back after waiting | One owner |

The tests verify that conflict contenders actually wait on a PostgreSQL lock before the first commit, with bounded timeouts. Synthetic fixture rows are removed after each acquisition test. Earlier Milestone 5/6 tests remain green.

## Limits and next milestones

This service does not reserve a stay, price a stay, authorize a guest or operator, create a Checkout Session, release a claim, or reconcile provider state. A seemingly expired claim remains blocking until a later provider-reconciled release transaction. Milestone 8 handles pricing quotation; Milestone 9 implements full guest hold creation and lifecycle with approved state/evidence guards. Operational API authorization, rate limiting, monitoring and provider recovery are still required before any public booking flow.

## Local verification

Use a disposable localhost `*_dev` PostgreSQL database with the existing migration chain applied, then run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:check` and `git diff --check`. Do not reset a nonempty database for this suite.
