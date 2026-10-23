# Milestone 8 — Server-side pricing and quote engine

**Status:** Internal, accommodation-only quote preview. [Milestone 2](BOOKING_PAYMENT_SPEC.md) sets payment rules; [Milestone 3](MILESTONE_03.md) sets tariff/snapshot contracts; [Milestone 6](MILESTONE_06.md) supplies **provisional fictional** 2027 rates. This milestone creates no booking, snapshot, obligation, inventory claim, payment or public API.

## Contract and rate selection

`quoteStay(pool, { unitId, arrivalDate, departureDate, guestCount }, evaluationInstant?)` returns an itemized `QuotePreview`. The instant is injected by a trusted server caller for preview/testing; it must never be accepted as a browser-supplied acceptance timestamp. The result includes unit/config version, active tariff ID/version, one NIGHT line per occupied local date with rate ID, day class, EUR-cent unit and amount, accommodation subtotal, preview payment split and local deadline instants. Monetary values are `bigint` and require decimal-string serialization in any future JSON API. Expected validation/pricing failures use `QuoteError.code`; unexpected PostgreSQL failures propagate separately.

The service validates UUID, real calendar dates, positive guest count, maximum 366-night provisional processing bound, enabled unit and capacity. A read-only `REPEATABLE READ` transaction selects the single ACTIVE tariff and intersecting seasonal bands from one consistent PostgreSQL snapshot. Nights are local calendar dates in `[arrival, departure)`; each must match exactly one rate of its day class. Missing, ambiguous, non-EUR, negative or out-of-range rates fail; no price is inferred outside configured coverage. Each line carries immutable tariff provenance and line sums must equal the accommodation subtotal. The existing tariff exclusion and activated-version guards remain database protections; no migration was needed.

A provisional **Friday/Saturday local night = WEEKEND** rule lives only in `provisionalDayClass`. Sunday through Thursday are WEEKDAY. D17 has not commercially approved this classification. It must become an approved, versioned policy before live quoting. The 2027-12-31 night can be quoted with 2028-01-01 departure; any occupied 2028 night is unpriced and rejected.

## Money, deadlines and acceptance boundary

Pure functions in `quote-math.ts` use `bigint` with PostgreSQL `bigint` bounds. Before the balance deadline, `advance=floor((totalCents*30+50)/100)` and `balance=total-advance`; at/after the deadline the initial amount is the full total. For 10,001 cents, the split is 3,000/7,001 cents. No independently rounded 70% amount exists.

Arrival A uses **provisional** 15:00 `Europe/Vilnius`. Warning W and balance D are 21 and 14 **local calendar days** before arrival at that local time. Grace G is D plus 24 elapsed hours. Calendar-day operations are independent of browser timezone and preserve literal years 0001–0099. Calculations reject dates outside the four-digit year domain; historical Vilnius offsets outside the implementation's supported whole-hour `+02`/`+03` offsets fail explicitly. The 2027 spring and autumn DST examples match Milestone 2. This preview's `evaluatedAt` is not `bookings.accepted_at`.

Milestone 9 must revalidate current tariff/configuration, date/capacity, price lines and the split at the authoritative acceptance instant inside its booking/claim transaction. A preview before D accepted at/after D must become FULL; a stale rate version cannot be silently accepted. Snapshot and obligation writes remain outside this milestone. An inventory-free result from Milestone 7 does not reserve a stay or prove quote eligibility.

## Verification and gates

The real PostgreSQL and pure test suite passes 39 tests, including seasonal boundaries on May 1, July 1, September 1 and November 1; weekday/weekend and mixed-night pricing; each fictional unit; half-open year-end coverage; missing/disabled/over-capacity units; malformed dates and years 0001–0099; missing/draft/retired tariffs; rate provenance and line reconciliation; exact-cent rounding and overflow; T–14 boundary; 2027 DST examples; preview-before/acceptance-at-deadline simulation; and database-error propagation. The disabled-unit test uses and removes its own synthetic unit; shared reference-unit enabled states are untouched. Stable synthetic non-active tariff fixtures remain in the disposable development database because tariff-history deletion is forbidden; activated reference rates are unchanged.

Representative July 2–5, 2027 accommodation-only totals: Forest Cottage €540, Lakeside Cabin €630, Family Cottage €860, based on two weekend nights and one weekday night. These are **illustrative, provisional portfolio calculations**, not approved public prices or legally complete payable totals. D17 still requires approved weekend classification, rates, fees, taxes, extras, minimum stays, disclosure and tariff publication policy. No quote expiry or inventory/booking/payment behavior is claimed.

For independent Linux Mint verification against a migrated, seeded localhost `*_dev` database: run `npm run test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run db:check`, and `git diff --check`.
