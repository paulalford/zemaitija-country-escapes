# M16-V01 / M16-V02 — focused booking readability correction

27 October 2026. Implemented and locally verified by Codex; independent ChatGPT visual/functional review remains pending. No commit, push, deployment, migration or database-record changes.

## A. Specification requirements

Read `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, the Phase A record and `MILESTONE_16_PHASE_B_DIRECTION.md`. Preserve the approved Timber Index identity and landing composition. This is the booking surface's Operate mode: clear obligations, readable disclosures, semantic controls and visible keyboard focus take priority. Retain complete LT/EN/DE meaning, exact server amounts/instants, Europe/Vilnius DST semantics, unchanged policies, independently required unchecked acknowledgements, provisional/demo disclosures and provider-only payment confirmation.

Applied the installed Impeccable skill: `impeccable context --target src/app/booking/stay-form.tsx`, read the existing public surface brief and adaptation/clarification/craft-floor/polish guidance, investigated the supplied screenshots and current CSS/components, then reviewed the final browser renders. No new concept exploration, generated assets, sidecar reconciliation or independent approval is claimed.

## B. Implemented changes

| File | Change |
| --- | --- |
| `src/app/booking/stay-form.tsx` | Integrates the presentation components; keeps state-change heading focus; wraps native checkbox text for controlled reflow; uses guest date presentation in full policy details. Acceptance conditions/requests are unchanged. |
| `src/app/booking/quote-presentation.tsx` (new) | Labelled quote check/expiry, exact machine-readable instants, payment facts, nightly date/amount definition-list pairs, and a labelled cancellation list. |
| `src/app/public-ui/timber.css` | Booking-scoped natural wrapping, bounded viewport insets, container-query stacking below 34em, intact amounts, spaced fact rows, readable cancellation bullets and top-aligned checkbox labels. Removes obsolete flat-grid quote rules. Landing styles/composition are preserved. |
| `src/i18n/content/public.ts` | Equivalent short check/expiry and Lithuania-time messages; advisory reservation message; localized cancellation heading; less technical quote title. Optional German soft hyphens at the natural boundaries in `Zahlungsübersicht` and `Demobuchung`. Stable message keys/routes/identifiers remain unchanged. |
| `src/i18n/format.ts` | Adds opt-in `guest` presentation to the existing formatter, still pinned to Europe/Vilnius. Its default technical workspace output is unchanged. |
| `tests/milestone16-presentation.test.tsx` (new) | Ten focused checks for exact policy preservation, timestamps/context, financial/date associations, full-payment presentation and DST. |
| `DESIGN.md` | Records the public booking refinement without changing the workspace system or historical design artifacts. |
| This handover (new) | Scope, verification and remaining review gates. |

The inherited `overflow-wrap:anywhere` and a two-column financial grid at 390px caused the reviewed fragmentation. Enlarged rem side padding further squeezed the content; padding inside the highlighted payment row could fragment or overflow the amount. The correction gives narrow/enlarged text a single-column flow and retains larger layouts where space allows. Nightly rows are semantic date/value pairs rather than a squeezed two-column table. No text shrinking below accessible sizes, overflow concealment, truncation or disabled scaling is used.

Cancellation sentences come directly from `policyContent`; sentence grouping occurs before inserting localized dates, so abbreviation periods cannot split the deadline. Tests compare the joined visible sentences against the entire unchanged policy in every locale. Full payment/cancellation/refund/review policies remain available in native details. The quote lifetime, cutoff instant, advance/full amounts, charge cap, avoided-cost/rebooking conditions and no-automatic-forfeiture rule are unchanged.

The heading outline is deliberate: the existing programmatic focus moves to the heading when search/review/change-date state changes. The heading stays outside the sequential tab order (`tabIndex=-1`); Tab proceeds to the policy disclosure and then the checkboxes. The browser reported a visible 3px focus outline. No suppression of focus or acceptance requirement was introduced.

Timber Serif, forest/paper palette, flat ruled sections, highlighted initial payment, native controls and all existing fictional/demo disclosures preserve Concept B. Public landing/showcase components and generated assets were not modified.

## C. Verification evidence

### Commands executed today

| Command | Actual final result |
| --- | --- |
| `npm test -- tests/milestone16-presentation.test.tsx tests/milestone16.test.ts tests/milestone15.test.tsx tests/milestone15-calendar.test.tsx --reporter=dot` | **100 passed, 4 files**: 10 new presentation tests and 90 existing tests. |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed, no warnings. |
| `node /tmp/m16-visual-build.cjs` (bounded CPU affinity) | Runs `npm run build` in `/tmp/m16-visual-production`: passed with exit 0, route table and 11 workers. First attempt printed a completed route table but exited 143; it was not counted as a pass. |
| `node /tmp/m16-visual-browser.mjs` | Final production-preview browser matrix passed, with synthetic quote interception, layout assertions and native keyboard/AX inspection. |
| `git diff --check` | Passed. |
| Session-start SHA-256 comparison | All files outside the five intended existing-file changes preserved, including all four protected files. |

The first presentation-test run expected lowercase HTML `datetime`; React static output used `dateTime`. Corrected the test expectation; no production change was made for that failure. Initial rendered checks found enlarged-word/amount overflow; the final source and captures include the corrections.

The build and previews use isolated temporary copies to preserve root `next-env.d.ts`. Runtime catalog access is SELECT-only against the disposable M16 database. Browser Fetch interception fulfils **all** booking quote requests with a synthetic response; no public booking endpoint is called, no rate-limit row is written, and no acceptance or provider operation is requested. Database-backed write-fixture suites and the closed S01/S02 reviews were not rerun. Preview configuration is temporary; no environment file or credential was written to the repository.

### Fresh browser evidence

Headless Microsoft Edge/Chromium, built production UI, 900px viewport height. Browser timezone deliberately set to `America/Los_Angeles`; displayed check/expiry and deadline still use Lithuania time. Scaling is **CSS root text scaling**, 16px → 32px, not browser zoom. The 390px emulated window has 375px content width with its normal scrollbar. Full-page screenshots capture the complete nominal window width.

| Locale / viewport / root text | Captured states |
| --- | --- |
| EN / 390px / 100% | Quote, review, expanded review |
| DE / 390px / 200% | Quote, review, expanded review |
| LT / 390px / 200% | Quote, review, expanded review |
| DE / 768px / 100% | Quote, review, expanded review |
| EN / 1440px / 100% | Quote, review, expanded review |

Requested final screenshots:

- [English mobile review](../../.impeccable/review/m16/v01-v02/en-review-390-100percent.png)
- [German quote, 200% text](../../.impeccable/review/m16/v01-v02/de-quote-390-200percent.png)
- [Lithuanian review, 200% text](../../.impeccable/review/m16/v01-v02/lt-review-390-200percent.png)
- [Desktop review](../../.impeccable/review/m16/v01-v02/en-review-1440-100percent.png)
- [Full matrix, measurements and keyboard/AX evidence](../../.impeccable/review/m16/v01-v02/browser-checks.json)

Automated browser observations: all 15 rendered states had no document or inspected-element overflow, intact financial/date pairs and operable visible buttons. All five review configurations began with two required unchecked checkboxes. Native Tab/Space input opened the policy disclosure and toggled each checkbox independently, then restored unchecked state. The accessibility tree exposed the complete checkbox names, including the exact initial payment amount; focused controls had a 3px visible outline.

Visual review of the final four requested production captures confirmed readable heading/financial hierarchy, natural compound-word wrapping, separated cancellation points and no apparent clipping/overlap or concealed controls. The first highlighted amount remains prominent; enlarged text creates a longer page rather than compressed side-by-side financial columns. Native disclosure and expanded-state screenshots preserve all policy content. These are local browser observations and automated assertions, not screen-reader certification or independent ChatGPT acceptance.

### Preservation / Git summary

Initial state: seven modified tracked files plus substantial untracked Milestone 16 work, including the S01 tests/report. Recorded status and hashes before edits in `/tmp/m16-visual-start-status.txt` and `/tmp/m16-visual-start.json` (339 files).

Today's source/document delta: **five existing files changed and three files added**, listed above; new screenshots/JSON are ignored review artifacts. The previous landing, server, schema, migration, Stripe, token/security, Phase A/assets and S01 files are byte-identical to session start. No files were staged, reset or removed.

Protected starting SHA-256 values remain unchanged:

- `next-env.d.ts`: `0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc`
- Root `ACCOMMODATION_MANAGEMENT_SPEC.md`: `ca18bf69b45a52007247f669742fbcd706af67a20d0ac32c9c274f61eb2a6187`
- `owner-accommodation-management-docs-fixed.patch`: `2e13da7346654866d462981def2f31349b7790f4c2d8169ad066632c662bd0e7`
- `owner-accommodation-management-docs.patch`: `feccd3d7ac5264d39f83e0c08e6c024572b8a2b3306c5102e15a261b249665bf`

## D. Remaining concerns and approval

M16-V01/V02 are ready for independent review. Final Milestone 16 approval remains pending. No Milestone 17 work was started.

Physical touch devices, other browser engines, actual browser zoom, OS text preferences and a real screen reader were not tested. Native browser hyphenation dictionaries vary; optional German compound breaks support the reviewed headings, while unusually long unspaced policy words/technical references can use emergency wrapping. Full enlarged-text policy content necessarily requires substantial vertical scrolling. No general accessibility-conformance claim is made.

The pre-existing stale `.impeccable/design.json` remains preserved; a separate Impeccable `document` refresh can reconcile it when authorized. No sidecar reconciliation was performed here.
