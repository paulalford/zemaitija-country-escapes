# Milestone 2 — Booking, payment, and cancellation acceptance scenarios

These are test specifications for [the domain contract](BOOKING_PAYMENT_SPEC.md) and [state machines](BOOKING_STATE_MACHINES.md). All amounts are integer EUR cents, all Stripe objects are **test mode**, and all guest identities are synthetic. Unless stated otherwise, unit `forest-cottage` is free, price `T=40,000` (€400), scheduled arrival is **2027-04-10 15:00 EEST**, `W=2027-03-20 15:00 EET`, `D=2027-03-27 15:00 EET`, and `G=2027-03-28 16:00 EEST`. `H` means one blocking inventory claim; `B` means a confirmed-booking claim. Each scenario asserts unique audit/notification keys as well as state. A sent notice means sandbox transport accepted it; delivery failures are tested separately.

## Payment and deadline scenarios

### 1. Normal 30% advance booking

- **Given** the guest accepts a €400 quote and terms on March 1, and no claim overlaps.
- **When** a card Checkout Session for 12,000 cents succeeds and Session paid/PaymentIntent succeeded are verified within its hold.
- **Then** one payment credit is recorded and the hold transfers atomically to the booking.
- **Expected final state:** hold `CONSUMED`, booking `CONFIRMED`, initial attempt `SUCCEEDED`, payment position `BALANCE_DUE`.
- **Financial result:** paid 12,000; balance 28,000 due at `D`; no refund.
- **Inventory result:** exactly one `B`, no `H` for those dates.
- **Audit/notification result:** one quote acceptance, claim-transfer and payment audit event; one confirmation email containing the exact balance/deadline.

### 2. Short-notice booking requiring full payment

- **Given** the guest accepts the same quote at `D` exactly.
- **When** a 40,000-cent card payment is verified while the hold is owned.
- **Then** the full amount, not an advance, is required for confirmation.
- **Expected final state:** `CONFIRMED`, `PAID_IN_FULL`; attempt `SUCCEEDED`.
- **Financial result:** paid 40,000; balance zero.
- **Inventory result:** one `B`, no `H`.
- **Audit/notification result:** one confirmation and one paid-in-full outbox item; no balance reminder.

### 3. Full balance paid before due date

- **Given** scenario 1 and a 28,000-cent balance Session on March 25.
- **When** provider success is verified on March 26.
- **Then** the balance obligation is satisfied once.
- **Expected final state:** booking `CONFIRMED`, payment `PAID_IN_FULL`, balance attempt `SUCCEEDED`.
- **Financial result:** gross paid 40,000; due zero.
- **Inventory result:** one `B` remains.
- **Audit/notification result:** one balance credit and paid-in-full notice; `D` job later suppresses due notice.

### 4. Seven-day balance warning

- **Given** scenario 1 remains `BALANCE_DUE` at `W`.
- **When** the warning scheduler runs twice at/after `W` while before `D`.
- **Then** it creates one warning for the 28,000-cent balance due at `D`; a run after `W` states the actual remaining time, and no warning is sent at/after `D`.
- **Expected final state:** booking `CONFIRMED`, payment `BALANCE_DUE`.
- **Financial result:** paid 12,000; due 28,000.
- **Inventory result:** one `B`.
- **Audit/notification result:** one `balance-warning:<W>` outbox key and one send; duplicate run is audited/no-op.

### 5. Balance unpaid at deadline

- **Given** scenario 1 has no verified balance success at `D`.
- **When** the due scheduler runs at `D`.
- **Then** it records the due notice; no cancellation occurs at `D`.
- **Expected final state:** booking `CONFIRMED`, payment `OVERDUE` once `t>D`.
- **Financial result:** paid 12,000; outstanding 28,000.
- **Inventory result:** one `B`.
- **Audit/notification result:** one due notice with exact `D`; no cancellation notice.

### 6. Grace period begins

- **Given** scenario 5 and clock is one second after `D`.
- **When** overdue scheduler runs and payment is still outstanding.
- **Then** it sends one final warning stating `G`, without changing the balance or inventory.
- **Expected final state:** `CONFIRMED`, `OVERDUE`.
- **Financial result:** paid 12,000; outstanding 28,000 through grace.
- **Inventory result:** one `B` until a valid cancellation.
- **Audit/notification result:** one `balance-overdue:<D>` notice; repeated run sends none.

### 7. Non-payment cancellation after grace

- **Given** scenario 6 at `G`, and all balance attempts are authoritatively terminal unpaid after provider reconciliation.
- **When** the nonpayment job rechecks under lock and commits cancellation.
- **Then** it releases the booking claim and creates a full 12,000-cent refund obligation under the proposed zero-charge default, whose commercial approval remains pending; it does not retain the advance.
- **Expected final state:** `CANCELLED_NONPAYMENT`; refund `OWED` until provider succeeds.
- **Financial result:** 12,000 captured, 12,000 owed back, zero charge under the proposed, commercially unapproved default; no nonpayment fee is approved.
- **Inventory result:** no claim; dates available.
- **Audit/notification result:** reconciliation evidence, one cancellation event, one guest/operations cancellation notice each, refund confirmation only after provider success.

### 8. Payment completed before deadline, webhook delayed

- **Given** scenario 1, provider evidence shows balance success at `D−1 second`, but webhook arrives at `G+1 hour`.
- **When** nonpayment job runs at `G` and retrieves provider state before cancellation.
- **Then** it credits the balance using provider success time and does not cancel.
- **Expected final state:** `CONFIRMED`, `PAID_IN_FULL`; balance attempt `SUCCEEDED`.
- **Financial result:** paid 40,000, refund zero.
- **Inventory result:** one `B` remains.
- **Audit/notification result:** reconciliation and delayed-event audit; one paid-in-full notice, no cancellation notice. If provider timing is uncertain, job defers instead of canceling.

## Cancellation, assessment, and refund scenarios

### 9. Guest cancellation before free cutoff

- **Given** scenario 1 and guest's scoped token is valid at `D−1 second`.
- **When** guest cancellation commits then.
- **Then** charge is zero and all captured funds are owed back.
- **Expected final state:** `CANCELLED_GUEST`, assessment `NOT_REQUIRED`, refund `OWED` then `SUCCEEDED` on provider confirmation.
- **Financial result:** 12,000 captured; 12,000 refund; net zero.
- **Inventory result:** claim released in cancellation transaction.
- **Audit/notification result:** decisive instant, zero-charge reason, cancellation notice and later refund confirmation.

### 10. Guest cancellation exactly at cutoff

- **Given** scenario 1 and authorized request commits at `D` exactly.
- **When** cancellation is recorded.
- **Then** it enters late assessment; 30% is only the cap, not an automatic charge.
- **Expected final state:** `CANCELLED_GUEST`, assessment `PENDING`.
- **Financial result:** 12,000 captured; final refund/charge undecided until evidence review.
- **Inventory result:** claim released.
- **Audit/notification result:** exact timestamp and one cancellation/review notice; no refund-confirmed notice yet.

### 11. Late cancellation with maximum justified charge

- **Given** scenario 1 is canceled after `D`; reviewer documents supportable net loss of at least 12,000 cents after mitigation.
- **When** authorized reviewer finalizes charge at 12,000 cents.
- **Then** the cap is met and no refund is due from the 12,000 paid.
- **Expected final state:** `CANCELLED_GUEST`, assessment `FINAL`, no refund obligation.
- **Financial result:** paid 12,000; charge 12,000; refund zero.
- **Inventory result:** released.
- **Audit/notification result:** evidence and reviewer ID on assessment revision; guest receives finalized-charge notice, no refund confirmation.

### 12. Late cancellation with reduced charge

- **Given** scenario 1 is canceled late; documented supportable loss after avoided costs is 5,000 cents.
- **When** reviewer finalizes charge at 5,000.
- **Then** a 7,000-cent refund is owed and initiated idempotently.
- **Expected final state:** `CANCELLED_GUEST`, assessment `FINAL`; refund `SUCCEEDED` after provider confirmation.
- **Financial result:** paid 12,000; charge 5,000; confirmed refund 7,000.
- **Inventory result:** released.
- **Audit/notification result:** evidence, assessment notice and one refund-confirmed notice.

### 13. Full-payment refund after late cancellation

- **Given** a 40,000-cent fully paid booking is canceled after `D`; supportable charge is 8,000.
- **When** assessment is finalized and allocated refund succeeds.
- **Then** the refund uses total paid, not just the advance or balance.
- **Expected final state:** `CANCELLED_GUEST`, assessment `FINAL`, refund `SUCCEEDED`.
- **Financial result:** paid 40,000; charge 8,000; refund 32,000; net 8,000.
- **Inventory result:** released.
- **Audit/notification result:** full capture allocation, assessment and refund audit; one refund confirmation.

### 14. Cancellation followed by successful rebooking

- **Given** scenario 11 was finalized at 12,000 and dates released; a new guest later books the same interval, and evidence shows original supportable loss now only 2,000.
- **When** reviewer documents attributable recovered revenue and approves lower charge 2,000.
- **Then** the original guest receives an incremental 10,000-cent refund after provider success; the new booking is untouched.
- **Expected final state:** original `CANCELLED_GUEST`, assessment new `FINAL` revision, refund `SUCCEEDED`; new booking `CONFIRMED`.
- **Financial result:** original paid 12,000, final charge 2,000, refund 10,000; new booking payment accounted separately.
- **Inventory result:** exactly one `B` belonging to new guest.
- **Audit/notification result:** linked rebooking evidence and assessment revision, adjustment notice, one refund confirmation.

### 15. Provider cancellation

- **Given** a fully paid 40,000-cent booking and authorized operator records an attributable reason.
- **When** provider cancellation commits and refund later succeeds.
- **Then** all 40,000 cents are refunded; no automatic additional compensation is calculated.
- **Expected final state:** `CANCELLED_PROVIDER`, assessment `NOT_REQUIRED`, refund `SUCCEEDED`.
- **Financial result:** paid 40,000; refund 40,000; net zero.
- **Inventory result:** released at cancellation.
- **Audit/notification result:** operator/reason, cancellation notices, provider-confirmed refund notice; compensation review remains separate.

## Inventory, checkout, and webhook scenarios

### 16. Two guests simultaneously book the same cottage

- **Given** two valid requests for overlapping dates on the same unit arrive concurrently.
- **When** both try to acquire inventory claims in separate transactions.
- **Then** exactly one succeeds; the losing request receives unavailable and no usable Checkout Session.
- **Expected final state:** one `CREATING`/`ACTIVE` hold or one `CONFIRMED` booking; losing draft absent/closed.
- **Financial result:** losing guest charged zero; winner charged only if separately verified.
- **Inventory result:** exactly one blocking claim, never overlapping `H`/`B`.
- **Audit/notification result:** conflict audit for loser; no loser confirmation email.

### 17. Checkout abandoned

- **Given** an `ACTIVE` hold and open Session; guest leaves Checkout.
- **When** no payment occurs and expiry worker confirms provider terminal expired/unpaid.
- **Then** hold is released and pending booking expires.
- **Expected final state:** hold `RELEASED`, booking `EXPIRED`, attempt `EXPIRED`.
- **Financial result:** captured zero, refund zero.
- **Inventory result:** dates available after reconciliation, not merely browser departure.
- **Audit/notification result:** provider expiry and release audit; no booking confirmation.

### 18. Checkout Session expires

- **Given** Stripe returns Session expiry `2027-03-01 12:30:00 UTC` for a Session created at 12:00; the blocking claim may have begun before 12:00.
- **When** expiry job runs at/after 12:30 and provider authoritatively reports `expired`, unpaid, with no successful or processing PaymentIntent.
- **Then** it releases the blocking hold exactly once after reconciliation, not merely when the clock reaches 12:30.
- **Expected final state:** `RELEASED`, `EXPIRED` booking/attempt.
- **Financial result:** zero paid.
- **Inventory result:** free after terminal reconciliation.
- **Audit/notification result:** one expiry/release audit; no confirmation email.

### 19. Successful payment received after hold expiry

- **Given** original hold was released after terminal-unpaid reconciliation and another guest now owns an overlapping `B`; provider later reports a successful 12,000-cent payment on the old attempt.
- **When** signed event is processed and current provider object verifies that success.
- **Then** old booking is not confirmed; money is classified unallocatable and full refund is requested.
- **Expected final state:** old booking `EXPIRED`, attempt `SUCCEEDED`, incident open, refund `OWED`/`PROCESSING` then `SUCCEEDED`.
- **Financial result:** 12,000 captured, 12,000 refund owed; net zero after confirmation.
- **Inventory result:** new guest's `B` remains the only claim.
- **Audit/notification result:** late-success incident, operations alert, guest status update and eventual refund confirmation.

### 20. Duplicate payment webhook

- **Given** scenario 1's `payment_intent.succeeded` Event ID has already been processed.
- **When** the same signed Event ID is delivered twice more.
- **Then** inbox deduplication and unique credit key prevent any repeat transition.
- **Expected final state:** one `SUCCEEDED` attempt, one `CONFIRMED` booking.
- **Financial result:** one 12,000-cent credit, no extra payment/refund.
- **Inventory result:** one `B`.
- **Audit/notification result:** duplicate receipts logged; only one confirmation outbox item.

### 21. Out-of-order webhook

- **Given** provider has a paid Session and succeeded PaymentIntent, but `payment_intent.succeeded` arrives before `checkout.session.completed`; an older failure event arrives last.
- **When** each signed event triggers current-object reconciliation.
- **Then** success is recorded once and the stale failure cannot regress it.
- **Expected final state:** attempt `SUCCEEDED`, booking `CONFIRMED`.
- **Financial result:** one 12,000-cent credit.
- **Inventory result:** one `B`.
- **Audit/notification result:** all Event IDs logged; one confirmation notice, stale event no-op.

### 22. Duplicate scheduler execution

- **Given** two workers select the same balance-warning and expiry jobs concurrently.
- **When** they use leases and stable notification/transition keys.
- **Then** only one notice and one terminal expiry transition can commit for each eligible object.
- **Expected final state:** booking/hold states match single execution.
- **Financial result:** no duplicate charge/refund.
- **Inventory result:** at most one release, no overlap.
- **Audit/notification result:** one domain event and one outbox key; extra run audited as no-op.

## Failures, time, arithmetic, and authorization

### 23. Refund fails

- **Given** scenario 12 has 7,000 cents owed and Stripe reports refund failure.
- **When** failure webhook/reconciliation is processed.
- **Then** obligation stays outstanding and operations is alerted; a retry first reconciles the failed operation.
- **Expected final state:** booking `CANCELLED_GUEST`, refund attempt `FAILED`, obligation `OWED`.
- **Financial result:** 12,000 captured; zero confirmed refunded; 7,000 still owed.
- **Inventory result:** released.
- **Audit/notification result:** failure reason/attempt logged, operations alert; no false refund-success email.

### 24. Email fails

- **Given** booking confirmation has committed and sandbox email transport times out.
- **When** outbox worker records the uncertain send outcome.
- **Then** it enters `RETRY_WAIT`, reconciles provider result if possible, retries with same logical key, and alerts after exhaustion.
- **Expected final state:** booking `CONFIRMED`, payment `BALANCE_DUE`, notice `RETRY_WAIT` or `FAILED` until accepted.
- **Financial result:** 12,000 paid, 28,000 due; unchanged by mail.
- **Inventory result:** one `B`.
- **Audit/notification result:** attempt/error history and alert; no duplicate financial event.

### 25. Booking dates across daylight saving

- **Given** April arrival and November arrival examples from the specification, both with local 15:00 check-in.
- **When** `W`, `D`, `G` and free-cancellation cutoffs are calculated using `Europe/Vilnius`.
- **Then** April `D=2027-03-27 13:00 UTC`, `G=2027-03-28 13:00 UTC` (16:00 local); November `D=2027-10-30 12:00 UTC`, `G=2027-10-31 12:00 UTC` (14:00 local). At `D−1 second` cancellation is free; at `D` it is late for both.
- **Expected final state:** no booking mutation from calculation alone.
- **Financial result:** no charge from calculation; selected cancellation branch follows exact boundary.
- **Inventory result:** unchanged until a cancellation commits.
- **Audit/notification result:** generated schedules store UTC instants and local zone labels; one key per scheduled event.

### 26. Financial rounding edge case

- **Given** a valid 10,001-cent quote accepted before `D`.
- **When** initial and balance obligations are calculated.
- **Then** `floor((10,001×30+50)/100)=3,000` and balance is `10,001−3,000=7,001`.
- **Expected final state:** quote accepted; booking only confirms after verified 3,000-cent payment.
- **Financial result:** obligations total exactly 10,001 cents, no fractional cent or independently rounded 70%.
- **Inventory result:** initial hold until payment, then one `B`.
- **Audit/notification result:** snapshot and payment notices display 3,000/7,001 cents consistently.

### 27. Guest attempts another guest's booking

- **Given** guest A has a valid token scoped to booking A and knows booking B's ID.
- **When** A requests B's details, balance Session or cancellation.
- **Then** each request is denied with no existence-revealing detail and no domain mutation.
- **Expected final state:** both bookings and tokens unchanged.
- **Financial result:** no new attempt, charge or refund.
- **Inventory result:** unchanged.
- **Audit/notification result:** authorization failure audited without sensitive B details; no notification sent.

### 28. Unauthorized administration/refund request

- **Given** a guest token or non-finance admin credential submits a provider cancellation, inventory block or refund command.
- **When** server checks role and scope before persisting a command.
- **Then** command is rejected and Stripe is not called.
- **Expected final state:** booking, assessment and refund states unchanged.
- **Financial result:** zero new charges/refunds.
- **Inventory result:** unchanged.
- **Audit/notification result:** denial and actor/scope audited; no guest financial notice.

## Recovery and short-notice scenarios

### 29. Recovered open Session returns to usable states

- **Given** an initial hold and its attempt are `RECONCILING` after a provider timeout, and the original inventory claim remains owned.
- **When** authoritative retrieval identifies the same Session as open, unpaid and unexpired, with no payment processing, and matches the expected EUR amount, attempt and test environment.
- **Then** one transaction returns hold `RECONCILING → ACTIVE` and attempt `RECONCILING → OPEN`, preserving the original Session ID/URL and expiry.
- **Expected final state:** booking `AWAITING_INITIAL_PAYMENT`, hold `ACTIVE`, attempt `OPEN`.
- **Financial result:** zero captured; original 12,000-cent initial obligation unchanged.
- **Inventory result:** one blocking `H`, no extra claim or competing checkout.
- **Audit/notification result:** provider evidence and recovery transition audited; no confirmation or payment notice.

### 30. Unknown Session creation after API v1 key boundary

- **Given** a Session-create POST first submitted at 2027-03-01 12:00 UTC returned no usable result; the hold/attempt are `RECONCILING`, no Session ID is stored, and it is now 2027-03-02 12:00 UTC.
- **When** the worker encounters the old idempotency key and cannot authoritatively determine whether Stripe created a Session.
- **Then** it does not repeat the POST with that key or a new one; it quarantines the command and requests provider-record investigation. A missing search result alone does not close the case.
- **Expected final state:** hold/attempt `RECONCILING`, booking `AWAITING_INITIAL_PAYMENT`, incident open until an existing Session is identified or noncreation is established.
- **Financial result:** no new charge is initiated; any later discovered capture is reconciled once.
- **Inventory result:** original `H` remains blocking while outcome is unresolved; no second hold/Session is created.
- **Audit/notification result:** first submission time, key, request/correlation evidence, quarantine and operations alert recorded; no guest confirmation.

### 31. Unknown refund creation after API v1 key boundary

- **Given** 7,000 cents are owed, a refund-create POST first submitted at 2027-03-01 12:00 UTC timed out, and no provider refund ID is known at 2027-03-02 12:00 UTC.
- **When** refund worker considers a retry and provider refund history still cannot establish the outcome.
- **Then** it neither repeats the old key nor creates a replacement refund; it keeps the attempt quarantined for authoritative identification or authorized operational investigation.
- **Expected final state:** refund `PROCESSING`, obligation still outstanding, no `SUCCEEDED` ledger debit.
- **Financial result:** 7,000 cents remain owed until provider success is verified; no duplicate refund request is issued.
- **Inventory result:** unchanged from the cancellation that created the obligation.
- **Audit/notification result:** key age, investigation and operations alert recorded; no refund-confirmed guest notice. A new key is permitted only after documented proof the old operation did not succeed.

### 32. Delayed Session creation extends blocking claim

- **Given** an inventory claim enters `CREATING` at 2027-03-01 11:55 UTC and Stripe creates the Session at 12:00 UTC with `expires_at=12:30 UTC`.
- **When** the Session is persisted at 12:01 and expiry reconciliation at 12:30 reports an uncertain payment state until 12:34, then authoritatively confirms terminal unpaid/expired.
- **Then** Checkout's 30-minute window is 12:00–12:30, while the claim remains blocking from 11:55 through reconciliation and releases once at 12:34.
- **Expected final state:** hold `RELEASED`, attempt `EXPIRED`, booking `EXPIRED` after 12:34; at 12:30 they remain `RECONCILING`.
- **Financial result:** zero captured or refunded.
- **Inventory result:** one `H` through 12:34, then no claim; no availability promise at exactly 12:30.
- **Audit/notification result:** provider creation/expiry times, uncertain-state checks and final release audited; no confirmation email.

### 33. Booking confirmed between T–21 and T–14

- **Given** the €400 advance quote is accepted and its 12,000-cent initial payment verified at 2027-03-23 15:00 EET, after `W` but before `D`.
- **When** booking becomes `CONFIRMED` with 28,000 cents due at `D`, and the scheduler runs again before and after `D`.
- **Then** one short-notice balance warning is queued promptly on confirmation with the exact `D` and actual four-calendar-day lead; it must not say it was sent seven days in advance. If unsent at `D`, it becomes `SUPPRESSED` and the due notice takes precedence.
- **Expected final state:** booking `CONFIRMED`, payment `BALANCE_DUE` before `D` and `OVERDUE` after `D` if still unpaid; warning `SENT` or `SUPPRESSED` according to delivery timing.
- **Financial result:** paid 12,000; balance 28,000; no fee or refund from the reminder.
- **Inventory result:** one `B` throughout.
- **Audit/notification result:** one `balance-warning:<W>` key at most, actual-lead wording if sent, audited suppression if obsolete, and one `balance-due:<D>` notice if still unpaid at `D`.

### 34. Recovered open balance Session

- **Given** scenario 1's confirmed booking has a 28,000-cent balance attempt in `RECONCILING` after a timeout; its original balance Session ID is known.
- **When** authoritative retrieval confirms that Session remains open, unpaid and unexpired, with no payment processing and the balance still outstanding.
- **Then** the attempt returns `RECONCILING → OPEN` and reuses the same Session; no hold transition or second payment attempt occurs.
- **Expected final state:** booking `CONFIRMED`, payment `BALANCE_DUE`, balance attempt `OPEN`.
- **Financial result:** 12,000 cents already paid; 28,000 cents still due; no new credit.
- **Inventory result:** the booking's single `B` remains; no `H` is created for balance collection.
- **Audit/notification result:** provider evidence and attempt recovery audited; no paid-in-full notice until verified success.

## Additional boundary assertions

- A Session opened before `D` and paid after `D` retains its disclosed 30% split, then immediately shows balance due; it cannot be represented as fully paid. This is a disclosed edge case, not a new discount.
- A balance paid at exactly `D` is timely; one paid at `D+1 second` but before `G` is accepted during grace and prevents nonpayment cancellation. A provider state that remains uncertain at `G` defers cancellation.
- A same-day turnover `[April 1, April 3)` and `[April 3, April 5)` is allowed; `[April 2, April 4)` conflicts with both. This is asserted at PostgreSQL constraint level in Milestone 3.
- No test may infer success from return-page navigation, `checkout.session.completed` alone, a refund request alone, or a sent email alone.
