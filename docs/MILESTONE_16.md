# Milestone 16 Phase B — implementation handover

Date: 2026-10-26. Baseline and final HEAD: `main` at `aebe24b`. **Implemented and locally verified; awaiting the user's independent ChatGPT architectural, security, functional and design review. No commit, push or deployment.**

## A. Specification requirements

Authoritative inputs:

- `AGENTS.md`: integrity, no PHP, server/financial invariants, milestone scope and mandatory Impeccable workflow.
- `PRODUCT.md`: guest-first purpose, fictional catalog, synthetic data, localization and provisional commercial limits.
- `DESIGN.md`: preserved workspace rules plus the implemented public Timber Index extension.
- `docs/IMPLEMENTATION_PLAN.md`: row 16, accommodation pages and booking UX, mobile/E2E evidence. There was no separate detailed Milestone 16 specification before this implementation; the user's Phase B prompt supplies the detailed authorized scope.
- `docs/PROJECT_BRIEF.md` §§2–7, 9–11: accommodation truth, public journey, server authority, payment disclosure, localization and portfolio restrictions.
- `docs/BOOKING_PAYMENT_SPEC.md` §§2–7, 9–10 and `BOOKING_STATE_MACHINES.md`: inventory, date/money, acceptance, verified payment, cancellation and trust boundaries.
- `docs/MILESTONE_04.md` §§1–2: public request boundary, durable provider dispatch, guest authority and CSRF/rate limits.
- `docs/MILESTONE_06.md`, catalog and provisional tariff sections; `MILESTONE_08.md`, quote/rounding/deadline contracts; `MILESTONE_09.md`, acceptance/idempotency; `MILESTONE_10.md`, dispatch/provider confirmation; `MILESTONE_14_SECURITY_REVIEW.md`, revocation protections; `MILESTONE_15.md`, routing/content extension contract and equivalent policy presentation.
- `docs/design/MILESTONE_16_PHASE_A.md`, the three approved B boards, `.impeccable/surfaces/src-app-page-tsx.md` and existing Impeccable context/configuration.
- The user's explicit Concept B selection and Phase B authorization supersede the historical “awaiting approval” text in Phase A. Those records and assets were preserved, not rewritten.

## B. Implemented work

### Pages and guest journey

All routes use the existing `/{lt,en,de}` proxy rewrite convention, with Lithuanian default:

| Route | Behavior |
| --- | --- |
| `/` | Timber Index landing: semantic three-stay index, DB capacities, early availability anchor, labelled search and illustrative regional compositions. |
| `/accommodations` | Comparison with distinct framing, factual capacities, direct date and detail links. |
| `/accommodations/{forest-cottage,lakeside-cabin,family-cottage}` | Authoritative enabled catalog record, explicit unspecified facts, readable illustration caption, early date link and native search. |
| `/booking` | Dates/guests → availability → server quote → review → explicit terms/payment acknowledgement → existing acceptance and sandbox Checkout dispatch. |
| `/booking/return`, `/booking/cancel` | Read-only booking status from a browser-bound receipt; explicit POST resumes only the same initial attempt. Neither GET nor return navigation credits payment. |
| `/api/booking/{quote,accept,resume}` | Bounded same-origin POST boundary; existing global/browser rate limits, encrypted server quote, strict inputs, idempotent acceptance and persisted Checkout URL validation. |

Known invalid detail slugs are rejected by the route allowlist; unavailable catalog records fail closed. Catalog outages produce honest unavailability, not fixture facts. No facilities, bedrooms, water access, extras, tax/fee assumptions, testimonials or property coordinates were added.

The browser formats server EUR-cent strings and dates with the existing presentation helpers. It does not count nights, select tariffs, calculate splits/deadlines, acquire inventory or confirm payment. Acceptance receives the original trusted quote, synthetic guest and stable operation key; the existing transaction reprices and handles inventory/terms conflicts. Repeated submissions preserve that operation. The existing worker owns dispatch, provider idempotency, unknown outcomes and Session persistence.

### Security and persistence

Quote tickets use domain-separated AES-256-GCM, a random HttpOnly browser binding, 15-minute expiry and server-selected operation/guest identities. No credential enters URLs or persistent browser storage. A 24-hour encrypted receipt grants only status/resumption for its original initial attempt, never management scopes or replacement payments. It checks the existing guest-access generation; revocation denies both status and resume, including a later quote replay. Secure production cookies retain host-only naming, SameSite=Lax for top-level Stripe return, and HttpOnly. CSP/noindex/no-referrer/no-store coverage extends to public booking/discovery routes.

**One necessary migration:** `0034_public_synthetic_guest.sql` adds a restricted security-definer function. The runtime could accept an existing guest but could not create the synthetic record required by the public entry point. The function inserts only a fixed synthetic marker and a validated locale, refuses a conflicting existing identity, and grants no general guest INSERT/UPDATE privilege. No table, booking contract, inventory constraint or financial policy changed. A generated snapshot/journal entry accompanies it. The migration was applied only to the fresh disposable verification database; the existing development database is unchanged and requires normal migration application before exercising acceptance there.

The UI uses the fixed synthetic label `guest@example.test`; no personal-data field is offered. The database stores the established sandbox-style synthetic marker, not a real email. Guest management remains the existing secure sandbox-notification-link workflow. No direct manage session is minted from the receipt.

### Localization, imagery and design

Added 52 complete LT/EN/DE messages in the existing typed catalog. Stable route/unit keys remain untranslated machine identifiers; selected locale and allowlisted stay context survive equivalent-route links. Approved shared policy text is unchanged and available through native details; cancellation consequences remain visible before acceptance.

Three new imagegen plates are shipped as WebP: woodland whole-house, close timber elevation and wider meadow. They are separately generated illustrations, not board crops or property photography. Exact prompts, original paths, hashes and limitations are in `public/images/timber-index/*.webp.json`; see [asset record](design/MILESTONE_16_ASSETS.md). Local Cormorant Garamond WOFF2 Latin/Latin Extended subsets and their SIL license are included; browsers load no external font assets.

The Impeccable workflow informed implementation, rendered critique, correction and documentation. The finish reviewer first returned `fix`; its verdict pass scored all four material fixes resolved and returned **`ship` at the scope of those fixes only**. This is not the user's independent architectural/security review or measured pixel-fidelity approval.

The original Phase A build state remains open and unchanged. Fidelity used direct comparison with the approved B boards and rendered captures; automated measured region-map/comp-diff/build-phase gates were not performed or claimed. The user's required mobile search ordering, factual server state and readable disclosures take priority over raster geometry/text. [Phase B direction and fidelity record](design/MILESTONE_16_PHASE_B_DIRECTION.md) states this limitation explicitly.

### File inventory

Modified tracked files (excluding the preserved pre-existing `next-env.d.ts` change):

- `DESIGN.md` — public tokens/components, preserving incumbent workspace lines/rules.
- `next.config.ts` — public/API security-header coverage.
- `src/app/page.tsx` — public landing implementation.
- `src/i18n/{catalog,routing}.ts` — catalog merge and allowlisted public routes/stay context.
- `drizzle/meta/_journal.json` — forward migration registration.

Added:

- `src/app/public-ui/{arrow.tsx,shell.tsx,timber.css}`.
- `src/app/accommodations/{page.tsx,error.tsx,[slug]/page.tsx}`.
- `src/app/booking/{page.tsx,stay-form.tsx,error.tsx,return/page.tsx,cancel/page.tsx}`.
- `src/app/api/booking/[action]/route.ts`, `src/app/not-found.tsx`.
- `src/server/{public-catalog,public-booking,public-booking-token,public-booking-http}.ts`.
- `src/i18n/content/public.ts`.
- `tests/milestone16.test.ts`, `tests/milestone16-postgres.test.ts`.
- `drizzle/0034_public_synthetic_guest.sql`, `drizzle/meta/0034_snapshot.json`.
- `public/images/timber-index/{forest,lakeside,family}.webp` and their JSON sidecars.
- `public/fonts/{cormorant-garamond-latin.woff2,cormorant-garamond-latin-ext.woff2,OFL-CormorantGaramond.txt}`.
- `.impeccable/public-design.json` — public extension sidecar; original stale workspace sidecar preserved.
- This report, `docs/design/MILESTONE_16_PHASE_B_DIRECTION.md`, `docs/design/MILESTONE_16_ASSETS.md`.
- Local ignored screenshots and JSON check records under `.impeccable/review/m16/`.

## C. Independently reviewable evidence

### Automated checks

| Command/check | Actual result |
| --- | --- |
| `npm test -- --reporter=dot` | **322 passed, 16 files** on final source. 281 inherited tests plus 41 new tests. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed, zero warnings. |
| `npm run db:check` | Passed. |
| `npm run build` | Passed on final shipping sources in isolated `/tmp/zemaitija-m16-build`; 11 build workers; public/dynamic routes listed successfully. Preview-only configuration removed before build. |
| `git diff --check` | Passed. |
| Protected-file SHA-256 comparison | All four byte-identical to Phase B starting contents. |
| Impeccable raster provenance scan | Three shipping rasters, zero missing provenance records. |

The test wrapper `/tmp/m16-run-db.cjs` loads local configuration and changes both database URLs to `zemaitija_m16_phase_b_20261026_dev` before spawning npm. Existing migrations were replayed on that fresh localhost database, then 0034 applied. Existing tests use their established synthetic fixtures/mock providers; new tests use the restricted runtime role for quote, acceptance, concurrent replay, unknown/capacity/date failures, fixed-marker provisioning, privilege checks and revocation. No existing database was reset, cleaned or destructively tested. The disposable database remains for inspection.

The public-boundary suite covers encrypted quote integrity, expiry/browser binding, purpose separation, exact bigint/Date round-trip, strict inputs, CSRF/rate limiting, missing configuration, required acknowledgements, safe redirect destinations, bounded bodies, original-operation reuse, acceptance failures preventing dispatch and receipt preservation after uncertain dispatch. Inherited tests continue to cover the underlying financial/payment/inventory machinery. Automated provider responses are test fixtures, not a claimed Stripe browser round trip.

Restricted build attempts initially failed because Next could not read its TypeScript subprocess output; the isolated build passed with required worker permissions. Restricted localhost PostgreSQL access similarly required the normal sandbox allowance. Neither environment failure was treated as an application pass.

### Browser and design evidence

Headless Edge with a fresh temporary profile inspected actual Next pages against the disposable database. Browser flow stopped before accepting a booking or opening Checkout. Preview configuration used a temporary in-memory secret and canonical localhost origin; no credentials/sessions were persisted for preview.

- [Desktop landing](../.impeccable/review/m16/en-home-1440.png), [mobile landing](../.impeccable/review/m16/en-home-390.png).
- [Desktop comparison](../.impeccable/review/m16/en--accommodations-1440.png), [detail](../.impeccable/review/m16/en--accommodations-forest-cottage-1440.png).
- [Mobile quote](../.impeccable/review/m16/en-quote-390.png), [mobile review](../.impeccable/review/m16/en-review-390.png), [German review](../.impeccable/review/m16/de-review-390.png).
- [Capacity error](../.impeccable/review/m16/en-capacity-error-390.png), [German 200% text quote](../.impeccable/review/m16/de-quote-200-percent.png).
- `.impeccable/review/m16/browser-checks.json`: 45 discovery/detail/entry/return page × locale × 390/768/1440 checks, no document overflow or sub-16px editable controls; all inspected images loaded.
- `.impeccable/review/m16/final-flow-checks.json`: 32 final quote/review/expanded-terms, keyboard, early-anchor, capacity-error and 200% text-scaling checks. No overflow; nine locale/width review states had both required checkboxes unchecked. Keyboard focus showed a 3px outline. The early anchor placed the search form about 16px below viewport top.

The first rendered pass found and corrected mobile image flex sizing; text scaling found and corrected long German heading overflow. Final quote/review captures reflect the corrected initial-payment hierarchy. The initial desktop landing/comparison captures predate the small shared font-compression/wrapping corrections; they remain evidence of their composition, not a claim that every historical screenshot was recaptured after every edit. Development bubbles are tooling, not production interface.

Representative computed palette ratios: reading text 12.05:1; paper text on forest 11.72:1; control border 3.34:1; warm focus on paper 4.96:1; light focus on forest 8.07:1. These are palette calculations, not comprehensive automated accessibility certification.

The one detector pass reported 26 advisories/warnings: supporting Arial, six public palette values, one public radius and 18 public type sizes outside the older workspace system. These intentional public-extension values are now documented in DESIGN.md and the separate public sidecar. No detector clean-pass claim is made, and no second scan was used to manufacture one.

### Four Phase A concerns

| Concern | Implemented evidence |
| --- | --- |
| Mobile booking access | Early date anchor; mobile index → usable date search → photograph; no sticky UI or motion; same server journey. |
| Differentiation | Three separately generated compositions, varied comparison framing, factual DB names/capacities; no invented features. Similar regional timber character remains intentional. |
| Genuine navigation | Ordinary detail anchors, All stays/back routes, direct date actions, visible language links and keyboard focus. No essential hover interaction. |
| Readable disclosure | Visible fictional band, readable opaque AI captions, explicit unspecified facts and no lake-access claim. No raster-text disclosure copied into production. |

### Preservation and Git evidence

`main` remains at `aebe24b`; no staging, commit, push, reset, clean or deployment. The tracked implementation diff has six files (plus the user's unchanged pre-existing `next-env.d.ts` diff); new files are listed above and remain untracked. The pre-existing Phase A files, boards, metadata, build/mocks and pending surface brief remain in place. `next-env.d.ts`, root `ACCOMMODATION_MANAGEMENT_SPEC.md` and both root owner-management patch files match `/tmp/m16-protected.sha256`. No PHP, new runtime dependency, live Stripe activation, real communication or real-property claim was introduced.

## D. Open issues and decisions

- Independent ChatGPT architectural, security, functional and design review is still required. The Impeccable verdict is scoped to its four design fixes and is not that checkpoint. Git actions require later explicit authorization.
- No real Stripe test-account browser Checkout/webhook round trip was performed. Existing deterministic provider tests and actual PostgreSQL tests passed; scheduler/outbox operation and external IdP/Stripe integration retain their existing gates.
- The existing local `.env.local` lacks `APP_ORIGIN` and `ACCESS_SECRET`. Supply the already documented environment configuration and apply 0034 through the normal migration path before interactive acceptance on that database. No environment secrets were written by this task.
- Rates remain accommodation-only/provisional, currently configured for 2027. No configured rate produces an explicit error; nothing substitutes the illustrative board total. Taxes, fees, extras, facilities, accessibility facts and live commercial/legal approval remain unresolved under the original decisions.
- Browser evidence covers emulated Edge viewports, native keyboard and text-size scaling. Physical touch devices, screen readers, additional engines, exact browser 200% zoom and full accessibility certification were not performed. Text scaling is identified accurately rather than described as browser zoom.
- Initial quote authority lasts 15 minutes; the status receipt lasts at most 24 hours and is revoked by the existing access generation. If an acceptance response is lost and the ticket expires before recovery, use the existing sandbox operator/access workflow. A browser holds only its latest receipt; it is not a multi-booking account.
- Changing locale via ordinary navigation can discard unsent review state and request a new quote; allowed date/guest/unit context remains. Accepted contractual locale remains fixed by the server ticket/snapshot.
- Stable public slugs follow the existing localization contract. Destination/map content, translated SEO slugs/hreflang/sitemap, complete legal/privacy content and production deployment belong to later milestones.
- Generated plates and the chosen public font are implementation assets for the next review, not real property photographs or a new claim of licensing clearance. Pixel-identical raster matching and automated region-map/comp-diff gates were intentionally not claimed; practical responsive/copy changes are documented.
- The old `.impeccable/design.json` remains stale and preserved. The public extension has its own sidecar; a separately authorized document refresh can reconcile the original workspace sidecar later.

Stop condition met: implementation, local verification and handover only. No next Git step is taken.
