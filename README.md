# Žemaitija Country Escapes

**Status:** Milestone 5 foundation: minimal Next.js placeholder and PostgreSQL schema. Booking and payment workflows are not implemented.

A three-language, full-stack **fictional Lithuanian countryside accommodation booking platform**, demonstrating inventory concurrency, secure test payments, two-stage payment scheduling, guest self-service, cancellation/refund handling and operational workflows.

**Portfolio disclosure:** This is an independently developed case study. The operator, accommodations, inventory and bookings are fictional. No real reservation or payment is accepted, and no operating or regulatory permission is implied.

## Technology constraint

**No PHP anywhere.** The public site, administration, APIs, webhooks and scheduled application logic will be built with TypeScript/Next.js and PostgreSQL, without PHP-based CMSs, plugins, dependencies or runtimes.

## Project documentation

- [Approved project scope](docs/PROJECT_BRIEF.md)
- [Milestone 1: business and location](docs/MILESTONE_01.md)
- [Implementation sequence](docs/IMPLEMENTATION_PLAN.md)
- [Decisions and unresolved gates](docs/DECISIONS.md)

## Current scope

- Three accommodations near **Plateliai, Plungė District, Lithuania** (illustrative locality; no fictitious real-world property address)
- Lithuanian, English and German interfaces
- PostgreSQL-backed availability, no double booking
- Stripe **test-mode** advance/full payments and reconciliation
- 30% advance; 70% due 14 days before arrival; 100% for short-notice bookings
- T–21 payment warning, T–14 due notification, 24-hour grace, then governed non-payment cancellation
- Free guest cancellation before the 14-day cutoff; proportionate late charge **up to 30%**, subject to review/mitigation
- Guest self-service, notification logs, auditable administrative workflows

## Local foundation

See [Milestone 5 setup and verification](docs/MILESTONE_05.md). Run `npm ci`, start the localhost PostgreSQL service, apply versioned migrations, and run the database tests before later milestones. The placeholder does not accept bookings or payments.
