# Decision Register

Dates are recorded in ISO format. `Approved` = user-approved project scope or preserved decision; `Provisional` = technical design choice awaiting validation; `Gate` = must be resolved before commercial launch or a dependent milestone.

| ID | Decision | Status | Notes |
|---|---|---|---|
| D01 | Three cottages near Plateliai, Plungė District | Approved working brief | Exact property coordinates not invented |
| D02 | Lithuanian, English and German | Approved | Lithuanian default |
| D03 | Direct online booking and payment | Approved | Stripe **test mode** only for portfolio |
| D04 | 30% advance and 70% balance at T–14 | Approved business rule | Not statutory Lithuanian percentages |
| D05 | Full payment for arrivals within 14 days | Approved business rule | Final checkout terms explicit |
| D06 | Reminder T–21, due T–14, then overdue notice | Approved | Property timezone Europe/Vilnius |
| D07 | 24-hour late-payment grace period | Approved design choice | Reconcile provider payment before cancelling |
| D08 | Early cancellation free; late charge up to 30% | Approved business direction | Must account for mitigation/rebooking/actual supportable loss |
| D09 | No automatic forfeiture or 100% no-show charge | Approved | No-show rule requires later review |
| D10 | Provider cancellation refunds full paid amount | Approved principle | Extra compensation is **not** yet a contractual obligation |
| D11 | Booking payments labelled `avansas`, not `rankpinigiai` | Approved | Legal review before commercial launch |
| D12 | Fixed `Europe/Vilnius` property-local deadlines | Approved | Check-in time 15:00 is **provisional** until business configuration is fixed |
| D13 | PostgreSQL-backed concurrency and idempotent webhooks | Approved principle | Exact SQL model at Milestone 3 |
| D14 | Checkout inventory hold **30 minutes** | Provisional technical correction | Stripe configured checkout session expiry minimum 30 min; supersedes earlier 15-min proposal; source below |
| D15 | Working brand `Žemaitija Country Escapes` | Provisional | Trademark and business-name clearance not yet done |
| D16 | Property locality but no exact address/claimed park location | Approved integrity constraint | Approximate regional map marker only |
| D17 | Detailed rates, amenities, pets, fees and taxes | Gate for pricing/data milestone | Business assumptions to be authored, not presented as real claims |
| D18 | Cancellation legal text and operation registration | Gate before live paid bookings | Lithuanian legal professional and operator compliance review |
| D19 | Delayed/asynchronous payment methods | Gate for payment milestone | Either restrict to synchronously settled test payment methods or implement a safe pending lifecycle |
| D20 | e.turistas reporting method | Gate before live paid bookings | No claimed official API integration without documentation |
| D21 | No PHP in any project component | Approved, non-negotiable | TypeScript/Next.js and PostgreSQL; no PHP CMS, plugins, runtimes, scripts or endpoints |

### Authoritative technical note — Stripe Checkout expiry

Stripe Checkout Session creation currently documents `expires_at` from **30 minutes to 24 hours** after creation, defaulting to 24 hours. The earlier 15-minute hold would not be aligned with a normal configured Stripe-hosted checkout session; use a synchronized provisional 30-minute inventory hold and session expiry, and test late-event reconciliation.

Source: https://docs.stripe.com/api/checkout/sessions/create

### First next approval

Milestone 2 must formalize state machine, payment and cancellation arithmetic, T–14 timestamp semantics and incomplete/refunded states. Do not write booking code against this high-level document alone.
