# Working Instructions for Codex

Read the relevant repository specifications before changing code. Keep work strictly scoped to the requested milestone. Do not implement the entire platform at once.

## Integrity

- Fictional operator, property, inventory and bookings. Never claim real clients, authorizations, certification, revenue or guest feedback.
- Stripe test-mode and synthetic guest information only in portfolio demo.
- Do not invent real property address, building permissions, exact distances or lake frontage.
- Legal research informs design; it is not approval for taking live bookings.

## Non-negotiable technology constraint — no PHP

- **Do not use PHP anywhere in this project**, including public pages, APIs, webhooks, administration, scheduled jobs, scripts, tools, templates, or dependencies that require a PHP runtime.
- Do not adopt PHP-based CMS or booking components (including WordPress, WooCommerce or PHP reservation plugins).
- Implement front end and server-side application logic in **TypeScript with Next.js**, backed by **PostgreSQL**. Other necessary non-PHP infrastructure and tooling may be used if documented.
- Do not introduce `.php` files, `composer.json`, PHP packages, PHP servers or PHP deployment requirements.

## Financial and booking invariants

- Never mark a booking paid based on return-page navigation.
- No overlapping confirmed inventory; enforce in PostgreSQL.
- No non-idempotent payment, refund or notification actions.
- No automatic forfeiture of booking advance; cancellation charge needs policy logic and possible later adjustment.
- Use integer EUR cents and property time zone `Europe/Vilnius`.

## Workflow

- Implement one milestone at a time; no commits unless specifically requested.
- Present test results and files changed, plus any deviations/risks.
- Preserve approved policies and copy; ask or raise an explicit gate if unresolved issues make the change unsafe.
- Prefer focused requests and normal CLI verification to conserve Codex usage.
