# Accommodation Management — Owner Calendar and Inventory Blocks

**Status:** Approved product requirement: an authorized accommodation operator must be able to reserve nights for private/family use and maintenance, manage those blocks, and see a reliable accommodation calendar. This document is the implementation contract for the later administration milestone, not a claim that the owner UI currently exists. Detailed UX, identity-provider and optional schema choices remain implementation decisions.

**Authority and precedence:** Read with [Milestone 2 booking rules](BOOKING_PAYMENT_SPEC.md), [booking state machines](BOOKING_STATE_MACHINES.md), [Milestone 3 database contract](MILESTONE_03.md), [Milestone 4 security architecture](MILESTONE_04.md), and [Milestone 7 availability contract](MILESTONE_07.md). Those documents control bookings, payment, inventory protection, and authorization. This specification does not change any booking, refund, cancellation, hold or financial policy. If a conflict appears, stop and document it; do not silently change an authoritative invariant.

## 1. Product objective and boundaries

The operator needs one place to understand and administer the availability of the three fictional cottages, including occasions when the accommodation is **not offered to paying guests**. For example, the operator may reserve Family Cottage for relatives from **10 August through 16 August 2027**, with departure/reopening on **17 August 2027**. That is a **private-use inventory block**, not a commercial booking, and requires no price, guest account, Checkout Session, payment obligation, or revenue entry.

An operator may similarly close accommodation for maintenance or other legitimate operational reasons. These dates must be unavailable to public booking and must never displace an existing booking or an uncertain, still-blocking payment hold.

The owner calendar is an **authenticated administration surface**, separate from the public accommodation and booking calendar. Public guests see only **unavailable**, not private reasons, family names, internal notes, or booking identities.

## 2. Existing data model — reuse, do not duplicate

Use the existing **28-table model**; do not add a new booking or calendar-reservation table merely to implement private use:

| Existing table | Required use |
| --- | --- |
| `accommodation_units` | Unit identity, capacity, enabled status and configuration version. |
| `operator_blocks` | Internal noncommercial block: `id`, `unit_id`, `arrival_date`, `departure_date`, `reason_code`, `created_by_admin_id`, `released_at`, `created_at`. |
| `inventory_claims` | Authoritative inventory ownership. A block acquires one active row with `operator_block_id` as its **only current owner**, matching unit/dates and `released_at IS NULL`. |
| `admin_users` | Identity mapping, `enabled` status and approved roles `operations`, `finance`, `administrator`. “Owner” is a product persona, **not** a new database role. |
| `audit_events` | Immutable, redacted record of authorized/denied actions, actor, reason, target, prior/new state, and operation identity. |
| `bookings` / `inventory_holds` | Read-only context for calendar display; they are not edited as a side effect of blocking. |
| `rate_schedule_versions` / `seasonal_rates` | Separate, governed pricing configuration; no change to activated rates through a calendar action. |

The single PostgreSQL `inventory_claims_no_overlap` partial GiST exclusion constraint, using `(unit_id WITH =, stay WITH &&)` where `released_at IS NULL`, is the final authority for guest holds, confirmed bookings and operator blocks. It must not be replaced by UI checks or a separate block-only exclusion. The generated `stay` is the half-open local-date range `[arrival_date, departure_date)`.

`operator_blocks.released_at` and its associated `inventory_claims.released_at` must be changed together during an authorized release. Preserve both rows as history; never delete them merely to make dates free. Existing deferred owner/date consistency protections apply; add a reviewed **forward** migration only if a necessary safeguard is missing in the implementation milestone.

### Reason classification

The administrative workflow must distinguish at least:

- `PRIVATE_USE` — owner/family/friends using the accommodation without a commercial guest reservation.
- `MAINTENANCE` — repairs, cleaning beyond turnover, or safety-related closure.
- `OTHER` — a legitimate operational closure requiring a reason.

These are **proposed controlled values** for the existing `reason_code` text field, not a claim that a database enum/check already exists. Verify existing code and migrations before enforcing them. They must not be transformed into booking statuses or price components. Additional reasons require an explicit reviewed contract change.

An optional internal note is desirable but is **not in the current `operator_blocks` schema**. Do not pretend it is persisted, store it in guest-visible fields, or repurpose `audit_events.details` as a business-note database. If the note is required for the initial UI, propose a small forward migration, retention/redaction rules and tests before implementing. Family names or sensitive personal details are unnecessary.

## 3. Authorization and audit

- The operator must authenticate using the approved administrative mechanism. An enabled `admin_users` identity with `operations` or `administrator` authorization may create, view internal reasons, and release blocks, subject to any later unit-level restriction. The `finance` role alone may not manage inventory. No public guest may do so.
- Perform role, account-enabled and target-unit authorization **on every read and mutation** on the server, not merely by hiding buttons. Scope queries to permitted units. No unreviewed public mutation endpoint.
- Protect cookie-authenticated write actions against CSRF; validate origin/session, rate-limit requests, validate input, and use narrowly scoped database write privileges, never migration credentials. Use an idempotency/operation key for mutating commands.
- Record successful block creation, release/replacement and denied attempts in append-only `audit_events`, without leaking credentials, guest contact details or unnecessarily personal notes. Audit entries must identify the acting admin and target block/unit. Do not expose internal audit records to public guests.
- An `administrator` may administer role assignments through the separate identity workflow. A general operator cannot grant themselves privileges or perform financial refunds through calendar management.

## 4. Owner calendar — screen and interaction contract

Implement an **Accommodation / Availability Calendar** in authenticated administration during **Milestone 14 (Guest self-service and administration)**. Use the mandatory Impeccable workflow for actual frontend design. Do not implement it prematurely in Milestone 9, and do not confuse it with the public guest availability UI of Milestone 16.

### Calendar view

- Switch between individual cottages and an **all-units overview**. Provide month/week navigation, a clear today marker, and useful keyboard/mobile access; dates are rendered according to the property-local **Europe/Vilnius** calendar.
- Show distinct, clearly labelled statuses: **confirmed booking**, **pending/unresolved checkout hold**, **owner private use**, **maintenance closure**, **other operator block**, and **available**. Avoid color-only distinctions. An aged/unresolved hold remains visibly blocking, not “free.”
- For guest-originated occupancy, show only the minimum operational details the authorized role needs; ordinary calendar users do not automatically receive guest contact, payment or refund privileges.
- Booked and blocked nights remain visibly unavailable. A departing guest or ending block does not occupy the departure night; a new guest can arrive that date if no other claim conflicts.
- Provide a textual list/table alternative or accessible calendar grid for date selection and status, with logical focus order and understandable errors. Localize visible UI strings to Lithuanian, English and German in the relevant localization milestone.

### Create a block

1. Select one existing unit and a local arrival/start date and departure/end date (departure is **exclusive**); date labels should show the nights actually blocked.
2. Select `PRIVATE_USE`, `MAINTENANCE` or `OTHER`. Display a confirmation summary, for example **Family Cottage · 10–16 Aug 2027 · available again 17 Aug**.
3. Revalidate server-side unit, date syntax, nonempty interval, identity and authorization. An advisory availability read may help the user, but cannot authorize creation.
4. Insert `operator_blocks`, its **one** active `inventory_claims` row and the audit event in **one PostgreSQL transaction**, observing the global unit-first lock order and any defined later owner checks. Commit all or roll back all.
5. Return success only after commit; requery the authoritative calendar. Handle exclusion SQLSTATE `23P01` with an intelligible **dates already unavailable** conflict. Keep timeouts/DB outages distinct from conflicts. Never force or override an active booking/hold or trigger Stripe on a losing attempt.
6. A retry with the same stable operation identity and identical normalized input returns the prior result; reuse with different input fails as an idempotency conflict. Concurrent duplicate submissions must not create two active block records.

### Release/unblock

- An authorized operator can choose an active block and explicitly **Release block / Reopen dates**, with a confirmation identifying the unit and date range. This is not guest cancellation.
- In one transaction, lock the unit and relevant block/claim, confirm block ownership, current active state and authority, set `operator_blocks.released_at` and the associated `inventory_claims.released_at`, record a meaningful release reason and append an audit event. Keep historical data; do not delete or resurrect released claims.
- A repeat release is idempotent. Concurrency with a new booking claim is governed by the same exclusion constraint/transaction serialization; reopening never guarantees the dates remain available after commit.
- There is **no Stripe or payment-provider reconciliation requirement for a genuine operator-owned block release**, because no provider operation exists. Do not generalize this exception to guest-held or booking-owned claims: those still require the approved booking/payment transitions and provider evidence.
- To change a block's unit or date range, use a reviewed **atomic replace** operation (release existing block and acquire replacement in one transaction with full rollback if the replacement conflicts), or explicit release and create with confirmation of the resulting availability gap. Do not silently mutate historical date ranges or reason codes in place.
- Do not create a timer that automatically releases an owner block at its end date or after a default duration. The range naturally stops blocking *future* dates at its exclusive end while the historic block remains auditable.

## 5. Unit and pricing management — related but separate

The administration area may subsequently present a **Units** section with identity, capacity and enabled/disabled status, and a **Pricing** section with rate-version governance. The following principles are mandatory when those features are implemented:

- Disabling a unit prevents **new** acceptance/quotes as defined by the unit service; it does not cancel, modify, refund or release existing bookings or inventory claims. Show affected future occupancy and require a deliberate booking-resolution workflow if needed.
- Capacity/configuration changes use `config_version` and invalidate stale quotes; do not rewrite accepted price snapshots or previously accepted booking terms.
- Rate changes create/activate governed new tariff versions, observing existing active-tariff immutability and overlap constraints. Do not rewrite an activated tariff or use an operator block as a price override.
- Names, descriptions, amenities, photos, facilities and accessibility attributes are **not fully modeled in the current unit table** and D17 is unresolved. Present additions as separate proposed schema/content work with verifiable claims, rather than improvising fields, fake amenities or real-world certifications.
- No private-use block contributes revenue, guest count, payment obligation, confirmed occupancy sales or financial performance figures. Reporting may count it separately as blocked nights.

## 6. Data, failure and race guarantees

| Situation | Required behavior |
| --- | --- |
| Guest booking overlaps private-use block | PostgreSQL rejects the competing active claim; no guest hold/command/payment created by the losing transaction. |
| Private-use block overlaps confirmed booking | Block creation fails as conflict; no existing booking changed. |
| Private-use block overlaps old or reconciling hold | Block creation fails; hold age/session expiry alone never releases the hold. |
| Two operators create overlapping blocks | At most one succeeds. |
| Two operators create the same block operation/key | At most one logical block, one active claim and one successful creation audit event. |
| Separate units, identical dates | Both blocks can exist. |
| Adjacent date ranges | Both can exist, because end date is exclusive. |
| Database error during creation | Entire transaction rolls back, including audit, block and claim. No false “unavailable” result. |
| Release races guest claim acquisition | The exclusion constraint and transaction commit determine ownership; no double allocation. |
| Operator tries to release a guest hold | Denied; owner release routine accepts only operator-owned claims. |
| Finance-only or unauthenticated user mutates block | Denied and redacted audit record; no inventory change. |
| Existing block reaches end date | Future nights beyond end are not claimed; no clock-based record deletion. |

Do not cache calendar availability as the authority for writes. Use stable request operation IDs and database uniqueness/locking; treat unexpected SQL errors as operational failures. Include accessible error messages for conflicts and retries without revealing private booking data.

## 7. Acceptance tests — must be implemented before milestone approval

- **AM01** Authorized operations user creates `PRIVATE_USE` for Family Cottage `[2027-08-10, 2027-08-17)`; the seven nights are unavailable, while 17 August may be booked if otherwise free.
- **AM02** Maintenance and `OTHER` blocks use the same storage and conflict authority; the public calendar reveals only “unavailable.”
- **AM03** Block creation colliding with a confirmed booking is rejected with `23P01` classification; no block, claim or unrelated record persists.
- **AM04** Block creation colliding with a creating, active or reconciling guest hold is rejected; even an apparently expired hold remains blocking.
- **AM05** Two concurrent overlapping block creations on independent connections yield at most one commit, using bounded lock/statement timeouts.
- **AM06** Concurrent block versus guest hold creation yields at most one commit; loser creates no provider command.
- **AM07** Same dates on different units and adjacent half-open ranges can coexist.
- **AM08** Unauthorized, disabled-admin and `finance`-only block mutations fail and are appropriately audited.
- **AM09** Same operation key and same payload retry returns the original block; the same key with changed payload fails explicitly.
- **AM10** A forced failure between block and claim insertion rolls back both; a failed audit insertion also rolls back creation.
- **AM11** Releasing a block atomically marks block and claim released, preserves history and records actor/reason; repeating the release is safe.
- **AM12** Operator release cannot release guest hold/booking-owned claims, whether or not they are overdue.
- **AM13** Release racing with a new booking or operator block cannot produce two active overlapping claims.
- **AM14** Atomic replacement either changes the occupied nights completely or rolls back entirely, preserving the original block on conflict.
- **AM15** Confirmed guests' sensitive information and internal private-use reason never reach public availability or unauthorized admin responses.
- **AM16** Display works with keyboard/accessible status labels and shows departure-date semantics clearly; test LT/EN/DE strings when localized administration is introduced.
- **AM17** Unit disabled/configuration changes do not alter existing claims, financial ledgers or immutable accepted snapshots.
- **AM18** Existing inventory and payment/refund integration suites remain green; no extra exclusion domain or duplicate inventory data store appears.

Use real PostgreSQL for race/constraint tests. Keep test fixtures synthetic and isolated; never reset a nonempty development database without permission. Test negative direct SQL mutations where the owner/block consistency triggers or controlled database functions are introduced.

## 8. Delivery plan and Codex handover

- **Milestone 9 — Holds/pending booking:** Preserve the one-domain conflict between guest inventory and operator claims; include guest-versus-operator race coverage. **Do not** implement the owner calendar, admin identity provider or unreviewed block write permissions here.
- **Milestone 14 — Guest self-service and administration:** Implement authenticated owner operations, unit-scoped permissions, durable block creation/release/replacement, admin calendar, audit and negative authorization/concurrency tests. This is the primary implementation milestone for this specification; invoke Impeccable for the visual interface.
- **Milestone 15 — LT/EN/DE:** Complete localization of owner calendar labels, error messages and equivalent policy text.
- **Milestone 16 — Accommodation pages and booking UX:** Consume the same guest-safe availability projection, not internal block reasons.
- **Milestone 19 — Integration/security/concurrency QA:** Exercise administrative races, CSRF/authorization, database failure, privacy boundaries and accessibility end-to-end.
- **Milestone 20 — Test-mode deployment:** Verify access restrictions, monitoring and recovery in the public portfolio runtime without enabling live payments or real guest data.

**Codex instructions:** Read this document alongside the relevant Milestone 2–4 and Milestone 7 contracts when implementing operator/admin availability features. Preserve exactly one authoritative PostgreSQL inventory exclusion domain. Do not add a second booking type or generate guest/payment records for family use. Record any needed forward-only migration and security gates explicitly; do not silently expand a milestone.

## 9. Outstanding decisions, not silent assumptions

The capability to block dates for private use is an approved product requirement. The exact admin identity provider, optional internal-note persistence, unit-scoped authorizations for multiple owners, precise reason-code constraint, advanced editing UX, editable property content/amenities and D17 commercial configuration remain to be validated in their appropriate milestones. Nothing in this document authorizes real accommodation bookings or live charges.
