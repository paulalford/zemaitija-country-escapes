# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Approved project direction: TypeScript with Next.js and PostgreSQL. Stripe Checkout is test-mode only for the portfolio. No PHP in any project component. The application has not been scaffolded yet; supporting services and hosting are still subject to milestone decisions.

## Users

The primary user is a guest choosing and booking a fictional countryside stay. They need to compare three units, check dates and price, understand payment and cancellation terms, pay in test mode, and manage the reservation. Lithuanian travellers, families, couples, and English- or German-speaking visitors are intended guest groups. Operators need secure occupancy, payment, cancellation, refund, and notification workflows. Portfolio reviewers evaluate the demonstrated engineering and user experience. The guest booking journey takes priority when product decisions conflict, as confirmed during `/impeccable init`.

## Product Purpose

Žemaitija Country Escapes is a fictional, three-language rural accommodation booking platform set in the Plateliai area of Lithuania. It is a portfolio demonstration of an executable booking lifecycle, from availability and quoted price through test payment, balance collection, guest self-service, cancellation, refund, and operational review. Success means a test guest can complete the journey while inventory, money, timing, access, and notifications remain correct under retries and concurrency.

## Positioning

The project presents an independent rural-stay booking experience with three differentiated fictional units and a rigorously specified transaction lifecycle. Its portfolio evidence is working software, auditable business logic, accessibility, internationalized UX, and reproducible tests. It does not claim real guests, revenue, reviews, certifications, or operating permission.

## Operating Context

- Public discovery and booking, a secure emailed manage-booking link, and authenticated administration are distinct access contexts.
- Lithuanian is the default language; English and German must carry equivalent navigation, forms, payment terms, and transactional notices.
- The three working units are Forest Cottage (capacity 2), Lakeside Cabin (capacity 2), and Family Cottage (capacity 6). Their names and attributes are fictional assumptions.
- The locality is approximate: Plateliai, Plungė District. No real property address, precise property pin, distance, lake frontage, or planning permission is claimed.
- The portfolio uses synthetic guest data and Stripe test payments only. It must not accept live money or live bookings.
- Development proceeds one milestone at a time. Milestone 2 currently contains booking/payment documentation, not application code.

## Capabilities and Constraints

- Server-authoritative quotes and PostgreSQL-protected availability prevent overlapping confirmed inventory. Arrival is inclusive and departure exclusive.
- The approved commercial design uses a 30% ordinary advance for bookings more than 14 days before arrival, with the balance due at T–14; short-notice bookings require full payment. Monetary calculations use integer EUR cents.
- Payment confirmation comes from verified provider state, never a return page. Holds, payment attempts, booking status, refunds, and notices are separate, idempotent lifecycles.
- T–21 warning, T–14 due notice, a 24-hour grace period, and deadline calculations use `Europe/Vilnius`.
- Guest cancellation before T–14 is free. At or after T–14, any charge must be supportable and no more than 30% of the total, considering avoided costs and rebooking. The advance is not automatically forfeited. Provider-attributable cancellation refunds all guest payments; additional compensation requires separate legal review.
- Guests may inspect and act only on their own booking through scoped authorization. Administrative inventory and financial actions require authenticated roles and audit trails.
- The scheduled check-in time of 15:00 is provisional. Detailed rates, amenities, fees, taxes, arrival-notice timing, and live legal/operational approval remain open decisions in `docs/DECISIONS.md` and the Milestone 2 specification.
- No PHP code, tooling, runtime, CMS, or dependency is permitted.

## Brand Commitments

The working name is Žemaitija Country Escapes. The operator and accommodations are explicitly fictional. The project brief calls for calm, readable, honest presentation and truthful illustrative imagery disclosure. It does not authorize invented testimonials, occupancy figures, ratings, partnerships, or an exact property location. Visual identity decisions belong to later design work.

## Evidence on Hand

- Approved project scope and constraints: `docs/PROJECT_BRIEF.md` and `docs/DECISIONS.md`.
- Milestone 1 identity and locality research: `docs/MILESTONE_01.md`.
- Booking, payment, state, and acceptance contracts: `docs/BOOKING_PAYMENT_SPEC.md`, `docs/BOOKING_STATE_MACHINES.md`, and `docs/BOOKING_ACCEPTANCE_SCENARIOS.md`.
- No application UI, genuine property photography, real guest data, testimonials, or performance claims are present.

## Product Principles

1. Make the guest's price, payment obligation, deadlines, and cancellation consequences understandable before checkout.
2. Keep inventory and money correct even when guests, schedulers, and provider events race or retry.
3. Give Lithuanian, English, and German guests equivalent contractual meaning and usable self-service.
4. Treat fictional demonstration and legal limits honestly in every public claim.
5. Make operator interventions authorized, traceable, and recoverable.

## Design Methodology

Visual excellence is a core product requirement. The installed Impeccable skill is mandatory for frontend design direction, review, and refinement. Design serves guests booking accommodation first, then operators managing reservations and portfolio reviewers evaluating the work. Landing pages and accommodation showcase surfaces follow the approved image-composition-first workflow; functional application screens may start in code while still receiving Impeccable design review. Usability, accessibility, and booking clarity take priority over decorative effects. Avoid generic AI-generated visual patterns and ground the hospitality identity in Žemaitija without inventing property or geographic claims.

## Accessibility & Inclusion

The public booking journey, secure guest area, administration, and notices must be usable across mobile and desktop. The project brief requires accessibility testing and equivalent LT/EN/DE content; no specific conformance certification has been claimed.
