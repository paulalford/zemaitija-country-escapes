# Milestone 15 — LT/EN/DE routing and content model

Implemented against `main` baseline `c25b2c6`. Ready for independent functional, security, translation and design review before commit approval. No staging, commit, push, deployment, live Stripe activation or production email transport.

## Architecture and route conventions

The implementation uses the existing Next.js 16 App Router, React and TypeScript stack with native `Intl`; no dependency or database migration was added. No PHP is used.

`src/proxy.ts` validates a supported locale prefix and internally rewrites to the existing page route, forwarding a server-controlled `x-zce-locale` request header. Existing page modules, dynamic booking IDs and authorization boundaries remain in place. Incoming locale headers on supported page requests are overwritten. Locale is presentation data, never an authorization grant.

| Incoming URL | Behavior |
| --- | --- |
| `/` | Redirect to `/lt`, irrespective of a previous preference. |
| `/lt`, `/en`, `/de` | Render the existing localized fictional-demo placeholder; no public booking or accommodation development. |
| `/{lt,en,de}/manage`, `/manage/access` under a locale prefix | Equivalent guest interfaces. |
| `/{lt,en,de}/admin/...` | Equivalent existing operator routes, including calendar and booking review IDs. |
| Unprefixed `/manage`, `/admin/...` | Redirect to the equivalent page using a validated language preference; default Lithuanian. |
| Legacy `/manage/access#token` | Render directly without a server redirect. After hydration the client captures the fragment in memory, clears it and replaces the visible path with its canonical localized access path. Existing notification links remain compatible. |
| Unsupported, uppercase, malformed or nested locale paths | Return 404, with a localized generic message; do not guess an equivalent page. |
| `/api/access/...`, exact OIDC callback, `/api/stripe/webhook`, framework assets | No locale redirect/rewrite or preference-cookie mutation. |

Private route slugs remain stable internal IDs (`manage`, `admin`, `calendar`, etc.). Future public translated slugs, sitemap, hreflang and public SEO completion belong to their approved milestones. No new public marketing route model is invented here.

`localePath` accepts only known application pages. It retains allowlisted, validated `date`, `view`, `unit` and `notice` context, drops unrelated query inputs, and refuses external destinations, protocol-relative paths, path escapes and fragments. It never accepts a credential-bearing return URL. Nested prefixes are rejected by the proxy before rewriting.

The nonsecret `zce_locale` preference cookie has site-wide Path, SameSite=Lax and Secure on HTTPS. It is deliberately readable by the client to support in-place access-screen language changes; it grants no authority. Guest/admin session cookies retain their existing names, hashing, HttpOnly, Secure/host-only behavior and site-wide paths.

Root HTML language and descriptions derive from the validated request locale. Guest/admin page titles are localized and retain noindex/no-referrer metadata. Existing private headers, CSP and no-store behavior cover both prefixed and legacy paths. Responses declare `Content-Language`.

## Translation organization and extension contract

- `src/i18n/routing.ts`: supported locales, default, language names and safe equivalent-page URLs.
- `src/i18n/content/common.ts`: shared navigation, accommodation fixture names, labels and generic content.
- `src/i18n/content/guest.ts`: access, reservation, payment and cancellation interface copy.
- `src/i18n/content/operations.ts`: owner calendar, finance, identities, forms and operator states.
- `src/i18n/content/notices.ts`: existing interface notice messages keyed by stable internal notice codes in the shared UI.
- `src/i18n/catalog.ts`: typed union of the four resources. **290 messages, each with LT/EN/DE values.**
- `src/i18n/messages.ts`: strict lookup, interpolation, localized presentation helpers and **58 operational state/role labels**.
- `src/i18n/policy.ts`: shared approved presentation facts and four equivalent policy sections in all three languages.
- `src/i18n/format.ts`: exact integer-cent EUR formatting, local dates and Vilnius instants.
- `src/i18n/server.ts`, `client.tsx`: request-bound server presentation and client context/language navigation.

English source copy serves as a strongly typed internal message key. Every resource entry must contain all three translations. An unknown key, empty translation or missing interpolation value raises a generic error; it never shows an identifier or silently substitutes contractual terms. Native form validation follows the browser's own language; application copy and errors use the selected locale. Unknown historical machine states retain their exact identifier alongside a localized “State” label, preserving evidence instead of inventing a translation.

Later milestones should add an entry in the appropriate content file with complete LT/EN/DE values, use the typed `t` helper, and preserve the same named placeholders across languages. Use complete sentence templates when dynamic values affect grammar. Add business-policy facts only with an approved contract change; do not derive obligations from translated text. Add equivalent routes to the explicit route allowlist. Keep APIs and integration callbacks outside locale routing. Missing resources fail closed; only invalid noncontractual locale preferences safely default to Lithuanian.

## Guest, administrator and notification coverage

All three languages cover navigation, access-link/session messages, reservation facts, immutable prices and schedules, payment positions, reconciliation/return notices, actual warning/due/grace timestamps, cancellation consequences and confirmation, assessment/refund states, renewal/sign-out, loading/error/denial and empty states, and accessible control names.

The guest projection reads the accepted snapshot locale without changing it. It displays accepted contractual language and current interface language separately. It also reads existing warning/grace instants for display. No accepted snapshot, booking, guest preference or deadline is updated when viewing language changes.

Owner/operator coverage includes month/week calendar, date controls, accommodation filters, availability/hold/private/maintenance statuses, create/release/atomic-replacement forms, occupied-period summaries and exclusive ends, read-only configuration, management-history headings, booking reviews, evidence calculations, refund/provider-cancellation confirmations, incidents, identities, role/permission labels and MFA explanations. Technical identifiers, exact issuer/subject mappings, immutable reasons/audit actions and historical evidence remain intact. No inventory or finance functionality was added.

Existing notification delivery still selects the recorded booking or configured operational locale, independently of page language. Existing LT/EN/DE financial and timed templates remain available. EUR formatting now shares the exact locale-aware formatter; late-cancellation ceilings use the same approved presentation percentage. Lithuanian due-notice wording no longer incorrectly says “today” when delivery is delayed. The operational delivery-failure body has equivalent LT/EN/DE text. Already-issued notices, audit evidence and idempotency keys are not rewritten, and no real transport is enabled.

## Policy equivalence and financial presentation

Shared presentation facts encode 30% ordinary advance, full short-notice payment, T–14 cutoff/balance due, T–21 warning, 24-hour grace and the 30% maximum evidence-supported late charge. The localized policy templates contain the same named numeric placeholders. The backend remains authoritative for each accepted obligation, captured payment, assessed charge, refund liability and actual instant.

All languages explicitly preserve strictly-before-cutoff free guest cancellation, evidence/mitigation/rebooking review at or after the cutoff, possible later reduction, no automatic advance forfeiture, full captured-payment refund obligation for attributable provider cancellation, and the distinction between initiating and verifying a refund. Existing confirmation/terms workflows remain the only acceptance mechanisms.

Policy copy explicitly retains legal-review, provisional check-in-time and unapproved nonpayment-charge uncertainty. A display-language change cannot approve a policy, alter a financial snapshot or create a payment/refund command.

EUR amounts are formatted from bigint integer and fractional parts with `Intl.NumberFormat.formatToParts`; cents never pass through a floating-point amount or display-string recalculation. The PostgreSQL bigint upper bound is tested. Local booking dates are validated as civil dates; instants retain their original backend timestamp and display `Europe/Vilnius` plus the applicable GMT offset. Both 2027 DST transitions and the 24-elapsed-hour grace boundary are covered.

## Security and compatibility

Authentication and mutation services continue to own session validity, scoped tokens, revocation generations, role/unit checks, MFA freshness, CSRF/Origin validation, rate limits and one-use action consumption. A full page navigation can mint a new authorized form action through the existing service; it cannot revive an already consumed action. Locale switching has no token-exchange or authorization side effect.

The OIDC registered callback URL, state, nonce, PKCE and provider validation code are unchanged. Callback completion returns to a localized workspace using the preference cookie. Stripe webhook and all access API paths remain exact and unprefixed. Existing durable Checkout success/cancel URLs remain compatible through unprefixed page routing; return navigation never marks payment paid.

The access-screen language switch uses History API and client context in place, preserving the fragment token only in the existing component ref. Tokens are cleared from the visible URL before exchange, are sent only in the existing bounded POST body, and are never put into the locale cookie, browser storage, query parameters, redirect destinations or analytics. No analytics were introduced. The page retains localized unavailable/offline/rate-limit feedback.

Milestone 14 revocation fencing, external-identity uniqueness and positive administrator-role authorization remain unchanged and pass inherited regressions. The restricted runtime database role has not gained privileges.

## Verification results

| Check | Final result |
| --- | --- |
| `npm test -- --reporter=dot` | **275 passed, 13 files**: 227 inherited + 48 new localization/session tests. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed, zero warnings. |
| `npm run db:check` | Passed. |
| `npm run db:generate` | 34 tables; no schema changes, nothing to migrate. |
| `npm run build` | Optimized webpack production build passed in isolated `/tmp/zemaitija-m15-production`, using shipping sources rather than visual mocks. |
| `git diff --check` | Passed. |
| Protected-file SHA-256 comparison | All four files byte-identical to session start. |

New deterministic tests cover Lithuanian defaults, EN/DE rewrites, unsupported/malformed/nested locales, equivalent routes/deep links and context filtering, open redirects and credential exclusion, legacy access paths, locale-header overriding, unchanged API/OIDC/webhook routing, complete translation sets and placeholder equivalence, missing-key failures, shared policy facts, exact cents and civil dates, DST presentation, localized loading/error/denial/form states, native switcher semantics and live-region/confirmation labels. PostgreSQL-backed additions prove guest/admin session identity and unit authorization persist, contractual locale/snapshot data is unchanged, consumed action tokens stay consumed, and localized logout still revokes the session.

The first restricted full test attempt could not connect to localhost PostgreSQL (`EPERM`). It was rerun with the necessary sandbox permission and all inherited and new tests passed. No application defect was inferred from that environment failure.

Read-only integrity checks found zero active inventory overlaps, managed-block/claim mismatches, capture/obligation refund-reservation discrepancies, refund-ledger mismatches, unexpected administrator roles, duplicate subjects or active sessions overlooked by revocation. Existing restricted privileges and unique external-identity index remain intact. The applied migration hash still matches `0033`.

Historical fingerprint comparison against the existing Milestone 14 baseline found zero changed/missing rows among 2,566 bookings, 1,950 payment records, 1,786 allocations, 605 refund obligations, 229 refund attempts and 143 refund records. Regression suites add their isolated synthetic fixtures; existing financial smoke-test history was preserved.

## Impeccable review and refinements

The installed Impeccable workflow was actively invoked: context and persisted surface brief, harden guidance, craft floor before UI edits, then polish and rendered review. The established warm/forest workspace identity, flat ruled sections, readable system type and guest payment priority were preserved. No imagery was generated and no public landing-page redesign was performed.

Review evidence under ignored `.impeccable/review/m15/` includes 45 combinations of guest, month calendar, finance assessment, identities and sign-in across LT/EN/DE at 390×1000, 768×1000 and 1440×1000, with expanded consequential disclosures. No document overflow, locale mismatch, sub-16px editable controls or JavaScript exceptions were observed. Additional checks cover week-calendar keyboard focus, 200% text sizing, German financial calculation (100 EUR − 20 EUR = 80 EUR net loss; 25 EUR proposed), fragment clearing/token retention through a language change, and the localized rejected-exchange error. Keyboard Tab navigation shows the existing 3px focus outline.

Resolved review findings/refinements: complete sentence templates replace consequential fragments; previous/next calendar labels omit redundant period words; navigation, long controls, grids and tables wrap; controls retain readable input text; booking contractual/viewing locales remain separately labelled. `DESIGN.md` and the existing surface brief record the additions. The design hook reports enabled; no redundant detector pass was added. Impeccable reported the pre-existing stale design sidecar; it was preserved, with `DESIGN.md` treated as authoritative.

The visual preview used isolated synthetic **view fixtures**, with its write handlers disabled. Automatic approval review rejected a separate proposal to persist preview administrator/session/guest credentials; that action did not run. The safer fixture preview completed the visual work without those mutations. Actual authentication/security behavior is covered separately by PostgreSQL regressions. No independent security/design certification is claimed.

Verdict: ready for independent milestone review. Native-language editorial/legal review, real identity-provider browser integration, assistive-technology testing and physical-device/cross-engine QA remain review/deployment gates. The browser evidence is headless Chromium/Edge with emulated viewports and keyboard events, not a physical touch-device test.

## Migration, limitations and remaining gates

No migration, reset, seed replacement, inventory rewrite or financial-history adjustment is required. Existing locale columns and snapshot authority are sufficient. No new runtime/tooling dependency was introduced.

Language navigation preserves equivalent routes, selected calendar context and valid sessions; ordinary navigation can reset unsubmitted form drafts. Guest access is the special in-place case because losing its in-memory one-use token would be destructive to that workflow. No credential persistence was added to retain drafts or tokens.

Native browser validation prompts follow browser configuration, not necessarily page language. Technical historical identifiers deliberately remain exact. Translation completeness and placeholder/policy-fact tests cannot substitute for qualified human confirmation of commercial/legal equivalence. Live legal terms, provisional check-in time, unapproved nonpayment charges, real test-IdP setup and existing deployment/security gates remain unresolved as before.

No Milestone 16 accommodation/booking UX, destination work, public SEO/legal completion, deployment or new owner/finance capability is included.

## Files and working tree

Created:

- `src/proxy.ts`.
- `src/i18n/{routing,format,messages,policy,server,catalog}.ts`, `src/i18n/client.tsx`.
- `src/i18n/content/{common,guest,operations,notices}.ts`.
- `tests/milestone15.test.tsx`.
- `docs/MILESTONE_15.md`.

Modified:

- `next.config.ts`, `vitest.config.mts`.
- `src/app/layout.tsx`, `src/app/page.tsx`.
- Existing `src/app/manage/{layout,page,loading,error}.tsx`, `src/app/manage/access/page.tsx`.
- Existing `src/app/admin/{layout,page,loading,error,not-found}.tsx`, `signin/page.tsx`, `bookings/page.tsx`, `bookings/[id]/{page,assessment-form}.tsx`, `calendar/{page,block-form}.tsx`, `identities/page.tsx`, `incidents/page.tsx`.
- `src/app/workspace/{ui.tsx,session.ts,workspace.css}`.
- `src/server/{access-http,guest-management,financial-notifications,nonpayment-notices,sandbox-notification-worker}.ts`.
- `tests/milestone14.test.ts` (two actual-session regression tests).
- `DESIGN.md`, `.impeccable/surfaces/src-app-manage.md`.

All milestone edits remain unstaged. The pre-existing modified `next-env.d.ts` and untracked root `ACCOMMODATION_MANAGEMENT_SPEC.md`, `owner-accommodation-management-docs-fixed.patch`, `owner-accommodation-management-docs.patch` were neither edited nor staged and retain their initial SHA-256 values. The repository remains on `main` at `c25b2c6`; no commit or push was made. Generated visual evidence remains ignored.
