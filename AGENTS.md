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

## Mandatory Design Workflow — Impeccable

- For every task involving UI/UX design, visual design, page layout, typography, colors, spacing, components, animation, responsive presentation, or frontend visual refinement, Codex **MUST actively invoke the installed `$impeccable` skill**. Knowing its guidelines or mentioning it does not satisfy this requirement. Do not bypass this workflow to accelerate implementation.
- Use Impeccable to inform design decisions before implementation, then review and refine completed UI work with it. Complete design review before presenting a UI-related milestone for approval.
- Follow the approved **image-composition-first** workflow for landing pages, accommodation showcase pages, and other visually expressive marketing surfaces. Functional booking interfaces, administration screens, and other application screens may be designed directly in code, but still require Impeccable for direction, review, and refinement.
- Avoid generic AI-generated aesthetics, predictable SaaS layouts, excessive rounded cards, gratuitous gradients, arbitrary decorative elements, generic stock imagery, and repetitive template-like compositions. Establish a distinctive hospitality identity grounded in Žemaitija's regional landscape, architecture, and character without fabricating property features or geographic claims.
- Maintain excellent typography, visual hierarchy, spacing, responsive behavior, accessibility, usability, and performance. Keep the guest booking journey as the primary product priority.
- Once `DESIGN.md` exists, treat it as the authoritative visual design reference and maintain consistency with it.
- Do not invoke Impeccable unnecessarily for backend-only work, database migrations, tests, or documentation unrelated to design.

## Owner/operator accommodation management

For authenticated owner accommodation calendar, private/family-use inventory blocks, maintenance closures and authorized release/replacement, read `docs/ACCOMMODATION_MANAGEMENT_SPEC.md` together with the booking, inventory and security contracts. Milestone 9 must preserve the common inventory exclusion constraint; implement owner controls in Milestone 14, LT/EN/DE localization in Milestone 15, and security/concurrency acceptance tests in Milestone 19. Do not implement the administration UI prematurely.
