# Milestone 18 — SEO, accessibility, privacy and terms

Date: 2026-11-06 (Europe/Berlin).

**Status: source changes and selected offline verification prepared for independent review. Milestone 18 is NOT accepted.** No Milestone 19 work is authorized or performed. The owner's supplied request records M17 acceptance and authorizes this source run; historical M17 handover wording is preserved.

## 1. Requirements and implementation inventory

Inspected AGENTS.md, PRODUCT.md, DESIGN.md, README.md, implementation plan, decisions, project brief, M15/M16/M17 handovers, booking/payment specification and state machines, relevant M4/M14 security contracts, public routes/shell, locale routing/provider/catalog/policy, proxy, Next configuration, booking/return and guest presentation, access/booking cookie and token implementations, and selected test sources. Impeccable context, its persisted public surface brief, new-work, audit, craft-floor and polish references informed direction and final source review. The old Phase A brief is historical; current DESIGN.md, later implementation and explicit M18 authorization govern this narrow extension.

Implemented the requested public publication model, two equivalent LT/EN/DE policy reading pages, footer discovery, narrow booking accessibility corrections and focused tests. Existing shared functionality and policy templates are reused. No PHP, dependencies, financial rules, data model or operational capability added.

## 2. Exact M18 files

Modified (13):

- `next.config.ts`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/accommodations/page.tsx`
- `src/app/accommodations/[slug]/page.tsx`
- `src/app/explore/page.tsx`
- `src/app/experiences/page.tsx`
- `src/app/public-ui/shell.tsx`
- `src/app/public-ui/timber.css`
- `src/app/booking/stay-form.tsx`
- `src/app/booking/return/page.tsx`
- `src/i18n/catalog.ts`
- `src/i18n/routing.ts`

New (8):

- `src/i18n/publication.ts`
- `src/i18n/content/legal.ts`
- `src/app/privacy/page.tsx`
- `src/app/terms/page.tsx`
- `src/app/robots.ts`
- `src/app/sitemap.ts`
- `tests/milestone18.test.tsx`
- `docs/MILESTONE_18.md`

No edits to PRODUCT.md, next-env.d.ts, stripe-automation-runtime.ts, stripe-recovery-domain.test.ts, existing Stage 2C contracts/tests/reports, accommodation specifications/patches, `.impeccable/` artifacts, financial/database/authentication services, API handlers, migrations or snapshots. Their pre-existing working-tree entries are retained. Preservation is based on the scoped edits and initial/final Git inventories; no repository-wide fingerprint scan or byte-identity certification was performed.

## 3. SEO and publication decisions

`publication.ts` allowlists exactly nine existing public path identities: home, accommodations listing, the three established accommodation slugs, Explore, Experiences, privacy and terms. All have complete LT/EN/DE presentation resources and page-specific localized title/description integrations. Accommodation descriptions identify each fictional unit while retaining the unspecified-facilities disclosure. Existing URL structures remain unchanged; no translated slugs or aliases were invented.

The shared builder supplies matching Open Graph text, site name, type and locale relationships. With a deterministic injected bare HTTPS origin it produces canonical URLs, reciprocal lt/en/de alternates, Lithuanian `x-default` (the already approved default locale) and an allowlisted sitemap of 27 entries with alternate relationships. It rejects private, unknown, locale-prefixed internal IDs, query-bearing and fragment-bearing paths. Invalid origins with credentials, non-HTTPS scheme, path, query or fragment are rejected.

**No approved canonical origin is configured.** Shipped metadata therefore omits absolute canonical/alternate/OG URLs, and `sitemap.ts` returns an empty sitemap model with no locations. The injected `.example` origin appears only in deterministic tests; it is not a production hostname. Request Host/forwarding headers and APP_ORIGIN are never sources of publication authority. Future origin approval requires a reviewed source decision; it does not automatically authorize indexing.

`robots.ts` disallows `/` for all crawlers and advertises no sitemap. Root and public metadata explicitly retain noindex/nofollow. Existing X-Robots-Tag headers remain intact. `next.config.ts` adds the existing restrictive header set to the new policy and metadata routes only; no security header values or existing map exceptions change. Robots restrictions are not access control.

APIs, guest/admin workspaces, login/access pages, booking/Checkout return/cancel states, tokens and query-specific URLs never enter the publication allowlist. The public policy route names are added to the established locale-route allowlist; proxy implementation is unchanged.

Open Graph images are intentionally omitted while no absolute publication origin is approved. Existing generated accommodation illustrations do not establish property facts; documentary destination images require contextual attribution. No new derivative/share asset, attribution assumption, rights-record modification or image generation was introduced. A suitable attributed share image and its absolute URL remain a publication-review decision.

## 4. Accessibility findings and corrections

WCAG 2.2 Level AA is the provisional planning target, not a conformance claim.

| Finding | Scoped correction / preserved evidence |
| --- | --- |
| Server booking errors had an alert but no explicit focus transfer to the error/recovery message | Focus the localized alert when a new error appears; keep the quote/review/change-date heading focus and existing recovery actions. No booking action or validation changed. |
| Required search controls relied solely on native required semantics | Add equivalent LT/EN/DE visible guidance that all booking fields are required; retain implicit native label associations, native validation and disabled unavailable-catalog action. |
| Return-page recorded booking state lacked explicit status semantics | Add `role="status"` to the existing recorded-state notice. GET remains read-only; provider verification remains authoritative. Initial server-rendered live regions do not guarantee an announcement by every assistive technology. |
| New policy information needed semantic reading and wayfinding | One main/h1 per policy page, focusable skip target, named section/index navigation, h2-linked sections, native anchors and localized footer access. |

Existing public focus rules, 44px navigation/48px controls, wrapping grids, 72ch prose measure, native details/checkboxes, mobile and booking container breakpoints, and reduced-motion behavior are preserved. No sticky public overlay, animation, custom keyboard trap or new modal introduced. M17 map Enter/Space/list/fallback behavior and geography remain unchanged.

Synthetic coverage uses real presentation components with injected data: existing M16 quotation/monetary/cancellation/validity tests, booking native controls and empty catalog, recorded pending/confirmed/expired return states, pending notice, payment investigation and refunded-state labels, and a cancelled guest view with assessment pending/refund processing. Exact EUR amounts (including 16,200/54,000 cents) and Vilnius deadline presentation remain assertions. Unavailable/expired-quote messages, focus transitions and review acknowledgements also receive source inspection. This is not a browser-driven quote-to-review interaction test. No synthetic view implies that a payment occurred or that Stripe-hosted Checkout is accessible.

## 5. Recorded automated verification

Only these selected tests were executed; no unrestricted test script or build was run:

```sh
./node_modules/.bin/vitest run tests/milestone18.test.tsx tests/milestone15.test.tsx tests/milestone15-calendar.test.tsx tests/milestone16.test.ts tests/milestone16-presentation.test.tsx tests/milestone17.test.tsx --reporter=dot
```

Final result: **164 tests passed across 6 files**, including **45 M18 tests**. The M18 authorization case calls the actual existing session guard with an injected query stub; no database client is constructed or SQL executed against PostgreSQL. M16 uses its existing mocked availability/quote/acceptance/dispatch services. M15 calendar and M18 guest/status views replace their service/session/data clients with synthetic fixtures. No operational timer/worker/scheduler is started.

Other final checks:

| Check | Result |
| --- | --- |
| `./node_modules/.bin/tsc --noEmit --incremental false` | Passed, no incremental artifact written |
| Targeted ESLint on `next.config.ts`, all 17 changed/new TS/TSX source files and `tests/milestone18.test.tsx` | Passed, no warnings/errors |
| `git diff --check` | Passed |
| Explicit whitespace check of all 21 M18 files, including untracked additions | Passed |

An initial six-suite run had 160 passes and three M18 assertion failures: the test expected JSX `tabIndex` casing in streamed HTML, which correctly serializes as lowercase `tabindex`. The test expectation was corrected. The final run above includes that correction and the added offline authorization-denial regression. No failed run is represented as a pass.

SEO tests cover unique localized metadata, actual source route existence/integration, injected canonical/reciprocal alternate/x-default relationships, matching OG text, default URL omission despite APP_ORIGIN, origin rejection, sitemap allowlisting, restrictive robots/headers and token/private-route exclusion. Locale completeness and shared policy facts remain checked through M15 and M18. Sitemap model/metadata functions were tested; Next's emitted HTTP XML/head serialization was not exercised by a build or running server.

## 6. Manual, browser and assistive-technology evidence

Performed: manual source/diff review, React streamed/static HTML inspection in deterministic tests, and inspection of the retained M17 mobile Experiences capture as incumbent visual evidence. That historical image is not a fresh M18 rendering.

Not performed: a running application, fresh browser screenshots, interactive keyboard walk, focus visibility/unobscured measurements, text enlargement/reflow measurements, actual browser zoom, screen-reader testing, computed contrast audit, cross-engine/physical-device QA, Lighthouse or provider-hosted Checkout assessment. No conformance, certification, formal automated accessibility score or fresh rendered visual acceptance is claimed. These remain independent-review/QA limitations. Existing M17 evidence is retained without expanding its claims.

## 7. Privacy and terms content status

New `/lt|en|de/privacy` and `/lt|en|de/terms` use the existing public shell and reading-oriented booking/ruled-section vocabulary. Both prominently identify the fictional draft and commercial/legal limits. Equivalent section structure and all three language values are supplied.

Privacy discloses synthetic booking identity/date/count/quote/state processing, visitor IP/request processing, locale preference and access/OIDC/session cookies, browser binding/receipt cookies, HTTPS prefixes and flags, browser lifetime versus server retention, in-memory quote/access-token handling and fragment clearing, automatically loaded OSM tiles and origin/IP disclosure, local fonts/photos, external links/identity provider, and conditional Stripe test-mode processing with inactive Stage 2C automation. No analytics, contact form, consent system or new collection mechanism is added. Cookie durations describe inspected source settings, not invented server retention. Operator/controller identity, postal/privacy contacts, legal bases, recipients/transfers, retention/deletion and rights procedures are explicitly unresolved.

Terms render the unchanged shared policy module: ordinary 30% advance, 100% short notice, T–14 balance/cancellation boundary, T–21 warning, 24-hour grace, evidence-supported maximum 30% late charge, avoided costs/rebooking mitigation, possible later reduction, no automatic forfeiture, full provider-attributable refund obligation and initiation versus verified refund. They retain provisional 15:00 check-in, unapproved fees/taxes/extras/nonpayment charges, ordinary advance terminology and no automatic 100% no-show charge. Exact obligations and deadlines still come from the accepted server snapshot. `SYNTHETIC_TEST_TERMS_V1`, historical accepted snapshots and policy engines are unchanged.

## 8. Translation, legal and owner decisions

Native LT/EN/DE editorial review and qualified Lithuanian legal review remain required. Completeness and numeric tests cannot certify legal equivalence. No real operator/address/contact, lawful basis, retention period, registration, certification or dispute procedure is invented. No live commercial term is approved here.

Owner decisions remain: canonical origin and later separate indexing/publication authority; suitable attributed OG share asset; final privacy identity/contacts/processing/retention/rights details; commercial check-in, rates/fees/taxes/extras and property/accessibility facts; nonpayment/no-show rules, cancellation assessment/refund timing and any additional provider remedies. Existing map-provider suitability, photograph rights verification and uncertain geographic-point decisions remain open.

## 9. Security and preservation findings

Selected M15 route/header/token filtering and localization regressions, M16 quote/receipt/CSRF/rate-limit/acknowledgement/booking-authority regressions, and M17 map/list/header regressions pass. M18 also verifies actual session-guard denials for missing/absent sessions, wrong workspace kind, missing scope and substituted booking identity using stubs. These do not establish real PostgreSQL access, revocation races or concurrency acceptance; those suites were excluded because they load private configuration and/or connect to databases.

Authentication/authorization services, API handlers, booking/inventory/financial/refund engines and SQL remain unmodified. Private route headers keep the same restrictions. No sensitive URL or token is added to public SEO output. No environment file, credential backup or secret was read or hashed. No protected PostgreSQL target or other database, Stripe API, Docker, systemd, infrastructure, listener, live map/network request, deployment or public indexing was accessed/activated. No dependency installation or network access occurred. No G2/G3/G4 operations occurred.

## 10. Stripe operational status

The existing readiness report explicitly records **NOT_READY** and **all B01–B20 OPEN**. This work leaves that report and all activation blockers untouched. A pure disabled-configuration test and the existing hard-inactive foundation function verify that no supplied database/Stripe constructors are invoked. No acceptance adapter is mounted or activated. This is source evidence only; it does not substitute for the separate supervised genuine Stripe acceptance process.

## 11. Impeccable design assessment

Installed Impeccable was actively invoked through its context command and persisted public surface read. Final source review followed its audit/craft-floor/polish guidance within the explicit offline scope. Read-mode policy additions inherit Timber Index forest/warm paper, local Timber Serif and supporting type, flat ruled sections, bounded prose, wrapping/footer navigation and existing control/focus styles. The content index provides direct reading access without decorative cards, imagery, gradients or a new composition. Landscape Atlas pages gain metadata only; geography, map implementation, documentary photography, attribution and expressive composition are preserved.

Source review found no new palette/type system, misleading property feature, payment-authority change or decorative pattern requiring redesign. It retained existing numeric/deadline hierarchy and gave new policy sections the established 2rem reading heading scale. No fresh browser visual verdict is issued under the no-services/offline authorization. No design detector run that could write `.impeccable/` artifacts was added. Impeccable reported a pre-existing stale design sidecar; DESIGN.md remains authoritative and sidecar repair is deferred to separately requested `document` work.

## 12. Acceptance and stop condition

**Independent review and explicit owner acceptance are pending. Do not call Milestone 18 accepted or complete.** No Milestone 19, operational acceptance, publication or Git action follows this run. All work is unstaged; no commit or push occurred.

## 13. Initial and final Git working-tree status

The baseline was recorded before edits with `git status --short`. Full inventories follow. No files are staged. All 73 initial status entries remain present; M18 adds 13 tracked modifications and 8 untracked deliverables. Final status is 17 modified tracked files and 77 untracked entries (including directory-collapsed entries), with nothing staged.

Initial:

```text
 M PRODUCT.md
 M next-env.d.ts
 M src/server/stripe-automation-runtime.ts
 M tests/stripe-recovery-domain.test.ts
?? .impeccable/build/
?? .impeccable/mocks/
?? ACCOMMODATION_MANAGEMENT_SPEC.md
?? docs/STRIPE_ACCEPTANCE_CONSOLIDATED_RUN_1.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A_1.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_B.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_C.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_2.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3B.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3C.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3D.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3E.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3F.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3G.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3H.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md
?? docs/proposals/
?? owner-accommodation-management-docs-fixed.patch
?? owner-accommodation-management-docs.patch
?? src/server/stripe-acceptance-atomic-handoff.ts
?? src/server/stripe-acceptance-capture-provenance.ts
?? src/server/stripe-acceptance-collectors.ts
?? src/server/stripe-acceptance-durable.ts
?? src/server/stripe-acceptance-evidence-adapters.ts
?? src/server/stripe-acceptance-financial-capture.ts
?? src/server/stripe-acceptance-financial-evidence.ts
?? src/server/stripe-acceptance-fixtures.ts
?? src/server/stripe-acceptance-forwarding.ts
?? src/server/stripe-acceptance-fresh-database.ts
?? src/server/stripe-acceptance-fresh-runner.ts
?? src/server/stripe-acceptance-handoff-evidence.ts
?? src/server/stripe-acceptance-host.ts
?? src/server/stripe-acceptance-http.ts
?? src/server/stripe-acceptance-integration.ts
?? src/server/stripe-acceptance-launcher.ts
?? src/server/stripe-acceptance-monitoring.ts
?? src/server/stripe-acceptance-run.ts
?? src/server/stripe-acceptance-shutdown.ts
?? src/server/stripe-acceptance-status.ts
?? src/server/stripe-acceptance-supervision.ts
?? src/server/stripe-acceptance-trust.ts
?? src/server/stripe-acceptance-verifier-evidence.ts
?? src/server/stripe-acceptance-verifier.ts
?? src/server/stripe-acceptance.ts
?? tests/helpers/stripe-acceptance-forwarding-fixture.ts
?? tests/helpers/stripe-acceptance-integration-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-b-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-c-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-fixture.ts
?? tests/helpers/stripe-acceptance-scenario-fixture.ts
?? tests/helpers/stripe-supervision-store.ts
?? tests/helpers/stripe-verifier-fixture.ts
?? tests/stripe-acceptance-compatibility.test.ts
?? tests/stripe-acceptance-forwarding.test.ts
?? tests/stripe-acceptance-host.test.ts
?? tests/stripe-acceptance-integration.test.ts
?? tests/stripe-acceptance-remediation-a.test.ts
?? tests/stripe-acceptance-remediation-b.test.ts
?? tests/stripe-acceptance-remediation-c.test.ts
?? tests/stripe-acceptance-run.test.ts
?? tests/stripe-acceptance-scenarios.test.ts
?? tests/stripe-acceptance-supervision.test.ts
?? tests/stripe-acceptance-transport.test.ts
?? tests/stripe-acceptance-verifier.test.ts
?? tests/stripe-acceptance.test.ts
```

Final:

```text
 M PRODUCT.md
 M next-env.d.ts
 M next.config.ts
 M src/app/accommodations/[slug]/page.tsx
 M src/app/accommodations/page.tsx
 M src/app/booking/return/page.tsx
 M src/app/booking/stay-form.tsx
 M src/app/experiences/page.tsx
 M src/app/explore/page.tsx
 M src/app/layout.tsx
 M src/app/page.tsx
 M src/app/public-ui/shell.tsx
 M src/app/public-ui/timber.css
 M src/i18n/catalog.ts
 M src/i18n/routing.ts
 M src/server/stripe-automation-runtime.ts
 M tests/stripe-recovery-domain.test.ts
?? .impeccable/build/
?? .impeccable/mocks/
?? ACCOMMODATION_MANAGEMENT_SPEC.md
?? docs/MILESTONE_18.md
?? docs/STRIPE_ACCEPTANCE_CONSOLIDATED_RUN_1.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A_1.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_B.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_C.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_2.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3B.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3C.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3D.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3E.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3F.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3G.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3H.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md
?? docs/proposals/
?? owner-accommodation-management-docs-fixed.patch
?? owner-accommodation-management-docs.patch
?? src/app/privacy/
?? src/app/robots.ts
?? src/app/sitemap.ts
?? src/app/terms/
?? src/i18n/content/legal.ts
?? src/i18n/publication.ts
?? src/server/stripe-acceptance-atomic-handoff.ts
?? src/server/stripe-acceptance-capture-provenance.ts
?? src/server/stripe-acceptance-collectors.ts
?? src/server/stripe-acceptance-durable.ts
?? src/server/stripe-acceptance-evidence-adapters.ts
?? src/server/stripe-acceptance-financial-capture.ts
?? src/server/stripe-acceptance-financial-evidence.ts
?? src/server/stripe-acceptance-fixtures.ts
?? src/server/stripe-acceptance-forwarding.ts
?? src/server/stripe-acceptance-fresh-database.ts
?? src/server/stripe-acceptance-fresh-runner.ts
?? src/server/stripe-acceptance-handoff-evidence.ts
?? src/server/stripe-acceptance-host.ts
?? src/server/stripe-acceptance-http.ts
?? src/server/stripe-acceptance-integration.ts
?? src/server/stripe-acceptance-launcher.ts
?? src/server/stripe-acceptance-monitoring.ts
?? src/server/stripe-acceptance-run.ts
?? src/server/stripe-acceptance-shutdown.ts
?? src/server/stripe-acceptance-status.ts
?? src/server/stripe-acceptance-supervision.ts
?? src/server/stripe-acceptance-trust.ts
?? src/server/stripe-acceptance-verifier-evidence.ts
?? src/server/stripe-acceptance-verifier.ts
?? src/server/stripe-acceptance.ts
?? tests/helpers/stripe-acceptance-forwarding-fixture.ts
?? tests/helpers/stripe-acceptance-integration-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-b-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-c-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-fixture.ts
?? tests/helpers/stripe-acceptance-scenario-fixture.ts
?? tests/helpers/stripe-supervision-store.ts
?? tests/helpers/stripe-verifier-fixture.ts
?? tests/milestone18.test.tsx
?? tests/stripe-acceptance-compatibility.test.ts
?? tests/stripe-acceptance-forwarding.test.ts
?? tests/stripe-acceptance-host.test.ts
?? tests/stripe-acceptance-integration.test.ts
?? tests/stripe-acceptance-remediation-a.test.ts
?? tests/stripe-acceptance-remediation-b.test.ts
?? tests/stripe-acceptance-remediation-c.test.ts
?? tests/stripe-acceptance-run.test.ts
?? tests/stripe-acceptance-scenarios.test.ts
?? tests/stripe-acceptance-supervision.test.ts
?? tests/stripe-acceptance-transport.test.ts
?? tests/stripe-acceptance-verifier.test.ts
?? tests/stripe-acceptance.test.ts
```
