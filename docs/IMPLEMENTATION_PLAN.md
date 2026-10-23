# Implementation Plan — 21 Milestones

**Rule:** Review and validate each milestone independently. No jump straight to UI and no Codex full-project implementation prompt. No commits unless explicitly instructed.

| # | Milestone | Acceptance evidence |
|---:|---|---|
| 1 | Business brief, brand and reference location | Scope, fictional disclosure, verified location, decision log |
| 2 | Booking and cancellation domain specification | Payment terms, cancellation/refund arithmetic, time boundaries, notification lifecycle |
| 3 | Database schema and state machines | Entity/grain/key definitions; allowed transitions; overlap invariants |
| 4 | Architecture and threat model | Data flow, webhook model, auth, retries, idempotency, deployment and backup strategy |
| 5 | Next.js/PostgreSQL foundation | Reproducible setup, migrations, lint/tests |
| 6 | Accommodation and pricing reference data | Validated units, rate rules, examples and seeding |
| 7 | Availability and concurrency protection | Concurrent reservation integration tests |
| 8 | Server-side quote and pricing engine | Monetary and edge-case tests |
| 9 | Holds and pending booking lifecycle | Expiry, race recovery and idempotency tests |
| 10 | Stripe test-mode payment and webhook handling | Signature verification, duplicate/out-of-order/late event tests |
| 11 | Advance/full balance payment model | Amount arithmetic and reconciliation tests |
| 12 | Reminder, overdue and governed cancellation jobs | T–21/T–14/DST/grace/retry tests |
| 13 | Cancellation, refund and mitigation process | Free cancellation, ≤30% cap, final adjustment and refund-event tests |
| 14 | Guest self-service and administration | Secure links, roles and audit authorization tests |
| 15 | LT/EN/DE routing and content model | Locale-switch and equivalent-policy tests |
| 16 | Accommodation pages and booking UX | Mobile and E2E booking journeys |
| 17 | Experiences, map and genuine destination content | Official-source fact checks and honest illustrative property marker |
| 18 | SEO, accessibility, privacy and terms | Metadata, WCAG-oriented QA, privacy and legal review gate |
| 19 | Integration, security and concurrency QA | Full suite and fault-injection report |
| 20 | Test-mode public deployment and monitoring | End-to-end test payments, cron/outbox health, no live checkout |
| 21 | Portfolio packaging | README, screenshots, architecture, case study, disclosures |

### Milestone workflow

For each milestone:
1. Read only the relevant specifications.
2. Author a focused implementation prompt, explicitly **no commit**.
3. Run local tests/lint/build from the Linux Mint terminal.
4. Review file diffs and outputs.
5. Approve a small named commit and push.
6. Record decisions and update documentation when implementations differ.

Do not call a stage complete because the UI looks correct. Database, money, state and notification contracts are first-class.
