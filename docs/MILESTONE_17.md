# Milestone 17 — Phase B handover

27 October 2026 · baseline `acdce08` · local implementation, no commit/push/deployment. Final acceptance requires independent ChatGPT review and explicit user authorization before Git actions.

## A. Specification requirements

Authority: the user's Milestone 17 Phase B request and explicit approval of **Concept A — Landscape Atlas**, repository `AGENTS.md`, `PRODUCT.md`, `DESIGN.md`, `docs/PROJECT_BRIEF.md` §§3–4/9–11, `docs/IMPLEMENTATION_PLAN.md` milestone 17, `docs/DECISIONS.md`, and the existing M15 localization/routing and M16 public UI contracts. Phase A was read beginning with [REVIEW_HANDOVER](design/m17-phase-a/REVIEW_HANDOVER.md), including its approved A board, destination inventory, map evidence, imagery/provenance and review records. Impeccable context, new-work, craft-floor, critique and polish informed implementation and finish review.

The implementation-plan row's older “honest illustrative property marker” conflicts with the Phase B safeguard. The newer explicit instruction governs: **no accommodation point, polygon or zone**. The generated board is visual composition evidence, never factual map/photographic evidence. The Phase B request supplies approval; old Phase A `approved:false` metadata remains historical and unchanged. Existing stale Impeccable sidecars and M16 working artifacts were preserved rather than silently reconciled.

The [pre-implementation verification gate](design/m17-phase-b/VERIFICATION_GATE.md) passed for a conservative subset before production edits. All 17 original IDs survive; uncertain exact locations become text-only records. Its source-backed publication matrix is reproduced below. Official sources establish the restrained identity/description, not current opening hours, price, permissions or guaranteed access.

| Stable ID / name | Geographic group | Official primary evidence | Safe public facts | Further verification / exact coordinates | Marker | Image | Disposition |
| --- | --- | --- | --- | --- | --- | --- | --- |
| L01 Lake Plateliai / Platelių ežeras | Around Plateliai | [Official source](https://zemaitijosnp.lt/veikla/lankytini-objektai/plateliu-ezeras/) | Lake landscape in Žemaitija National Park. | 56.047040, 21.828335 · public viewpoint; source: park viewpoint page Other visitor details withheld. | Yes | Viewpoint photograph, attribution required | **verified** |
| L02 Šeirė Nature Trail / Šeirės takas | Around Plateliai | [Official source](https://zemaitijosnp.lt/veikla/pesciujudviraciu-takai/seires-takas/) | Forest and wetland trail in Plateliai landscape reserve. | 56.048411, 21.827357 · trail start; source prints longitude first Other visitor details withheld. | Yes | None; text only | **verified** |
| L03 Beržoras | Around Plateliai | [Official source](https://zemaitijosnp.lt/veikla/lankytini-objektai/berzoras/) | Historic village with wooden sacred architecture. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| L04 Siberija Viewing Tower / Siberijos apžvalgos bokštas | Around Plateliai | [Official source](https://zemaitijosnp.lt/veikla/lankytini-objektai/siberijos-apzvalgos-bokstas/) | Viewing tower overlooking lakes and wetland. | 56.030465, 21.814336 · tower; source prints longitude first Other visitor details withheld. | Yes | None; text only | **verified** |
| L05 Cold War Exposition / Šaltojo karo ekspozicija | Around Plateliai | [Official source](https://zemaitijosnp.lt/en/expositions/) | Exposition at a former Soviet missile installation in Plokščiai. | 56.030391, 21.906232 · visitor centre, not silo entrance Other visitor details withheld. | Yes | None; text only | **verified** |
| L06 Plateliai Manor Park / Platelių dvaro parkas | Around Plateliai | [Official source](https://zemaitijosnp.lt/veikla/lankytini-objektai/plateliu-dvaro-parkas/) | Surviving manor park in Plateliai; do not depict an intact central palace. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| L07 Žemaičių Kalvarija | Around Plateliai | [Official source](https://zemaitijosnp.lt/veikla/lankytini-objektai/zemaiciu-kalvarija/) | Pilgrimage town with a basilica and Stations of the Cross tradition. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| R01 Telšiai | Across Žemaitija | [Official source](https://visit.telsiai.lt/en/sightseeing-places/telsiai-old-town/) | Old town in Telšiai. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| R02 Samogitian Museum Alka / Žemaičių muziejus „Alka“ | Across Žemaitija | [Official source](https://visit.telsiai.lt/en/event-place/samogitian-museum-alka/) | Regional history/culture museum in Telšiai. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| R03 Samogitian Village Museum / Žemaičių kaimo muziejus | Across Žemaitija | [Official source](https://visit.telsiai.lt/en/sightseeing-places/exposition-of-samogitian-museum-alka-in-samogitian-village/) | Alka open-air branch preserving traditional rural architecture in Telšiai. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| R04 Mykolas Oginskis Palace / Mykolo Oginskio rūmai | Across Žemaitija | [Official source](https://www.zdm.lt/plunges-dvaro-sodyba/) | Mykolas Oginskis Palace in Plungė; neo-Renaissance estate architecture. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| R05 Kretinga Winter Garden / Kretingos žiemos sodas | Across Žemaitija | [Official source](https://www.kretingosmuziejus.lt/lt/opening-hours/) | Winter Garden within Kretinga museum/manor complex. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| R06 Šatrija Hill / Šatrijos kalnas (Pašatrijos piliakalnis) | Across Žemaitija | [Official source](https://visit.telsiai.lt/lankytinos-vietos/pasatrijos-piliakalnis-satrija/) | Šatrija hillfort at Pašatrija, Telšiai district; no detailed archaeology/eldership claims. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **qualified** |
| R07 Biržuvėnai manor / Biržuvėnų dvaras | Across Žemaitija | [Official source](https://visit.telsiai.lt/en/info/about-us/) | Wooden manor heritage at Biržuvėnai, interpreted by the official TIC. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| E01 **Hill of Crosses / Kryžių kalnas** | Major regional excursions | [Official source](https://www.visitsiauliai.lt/en/sightseeing-places/the-hill-of-crosses/) | National pilgrimage site in Šiauliai district, associated with faith, remembrance and resistance. | CONFLICT: guide 56.015850,23.415565 vs webpage-linked map 56.019358,23.432064; withheld, not averaged. Other visitor details withheld. | No | Ben Meyer photograph, attribution required | **qualified** |
| E02 Palanga | Major regional excursions | [Official source](https://www.visit-palanga.lt/en/sightseeing-places/palanga-amber-museum/) | Palanga coastal excursion with Amber Museum in Tiškevičiai Palace, Birutė Park. | No exact entrance point approved; locality/address association only. Other visitor details withheld. | No | None; text only | **text-only** |
| E03 Kurtuvėnai | Major regional excursions | [Official source](https://www.visitsiauliai.lt/data/ckfinder/files/Saules_zemes%20tturtai%20_EN(1).pdf) | Manor/landscape heritage at Kurtuvėnai, Šiauliai district. | Guide candidate 55.82679111289498,23.049072711639383; visitor-centre/entry function not independently resolved; withhold marker. Other visitor details withheld. | No | None; text only | **text-only** |

Four independently reread point functions are permitted: L01 public viewpoint, L02 trail start, L04 tower, L05 visitor centre. No inferred town-centre/entrance points. Hill of Crosses' conflicting official coordinates remain withheld. No exact accommodation location, distance, journey time, lake frontage or commercial relationship is implied.

## B. Codex implementation

- `/lt|en|de/explore`: approved landscape introduction, early booking action, genuine landscape photograph, local Atlas/list, prominent Hill of Crosses feature with adjacent localized “Major excursion · Šiauliai District”, and ruled wider discovery. Wider links land at named directory articles.
- `/lt|en|de/experiences`: all 17 destinations in geographic editorial groups, official source links, native GET area/interest filters and honest empty state, Hill highlight, Atlas and return-to-stay actions. Unprefixed routes use existing locale handling.
- `DestinationAtlas`: locally bundled Leaflet 1.9.4 loaded after hydration, four numbered/shaped markers and equivalent semantic list, synchronized selected detail/pressed state, Enter/Space controls, visible attribution, hide/reopen and localized loading/failure states. No geolocation, geocoding, routing, clustering, analytics or speculative geographic points. Selection preserves validated destination context in locale links.
- Shared public shell, existing Timber fonts/tokens, localization provider, booking/accommodation links and native filter controls are reused. `destinations.ts` separates sourced records from marker coordinates and records review date/disposition. LT/EN/DE interface and descriptive copy are supplied.
- Two genuine CC BY-SA 4.0 photographs, with creator/source/license/crop notices and hashed provenance sidecars; no generated Phase A imagery ships. Full [asset and map-rights record](design/m17-phase-b/ASSETS.md). All other records remain text-led rather than receiving invented imagery.

Files created: `src/content/destinations.ts`; `src/i18n/content/destinations.ts`; `src/app/explore/{page.tsx,destination-atlas.tsx,destination-ui.tsx,destination-labels.ts,destinations.css}`; `src/app/experiences/page.tsx`; `tests/milestone17.test.tsx`; `public/images/destinations/{plateliai-viewpoint.jpg,plateliai-viewpoint.jpg.json,hill-of-crosses.jpg,hill-of-crosses.jpg.json}`; this handover; `docs/design/m17-phase-b/{VERIFICATION_GATE.md,ASSETS.md,PRESERVATION.json,REVIEW.md}`; final captures/checks/assessments in `docs/design/m17-phase-b/evidence/`; new working review artifacts under `.impeccable/review/m17-phase-b/` (ignored).

Existing files changed: `DESIGN.md` (narrow public extension), `package.json`/lock (Leaflet and types), `next.config.ts` (destination-only headers), `src/proxy.ts` (destination-only referrer policy), `src/app/public-ui/shell.tsx` (two navigation links), `src/i18n/catalog.ts` (message merge), `src/i18n/routing.ts` (public route/context allowlist). Post-completion hook triage also changes `.impeccable/config.json` with the narrow `overused-font=Arial` exception for approved supporting typography. Tool-generated ignored `tsconfig.tsbuildinfo` and `.impeccable/hook.cache.json` also changed. Pre-existing dirty `next-env.d.ts` and unrelated untracked files are not M17 edits.

## C. Verification evidence

Final checks:

| Check | Actual result |
| --- | --- |
| `npm test -- tests/milestone17.test.tsx` | 19 tests passed |
| Focused M15/M16/M17 suite (M15, M15 calendar, M16, M16 presentation, M17) | 119 tests / 5 files passed |
| `M17_TEST_DATABASE=/zemaitija_m16_phase_b_20261026_dev node /tmp/m17b-run.cjs npm test -- --reporter=dot` | 360 tests / 19 files passed on final source |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm run db:check` | Passed; no schema or migration changes |
| `npm run build` in isolated production copy | Passed; Explore and Experiences included |
| `git diff --check` | Passed |

The temporary wrapper loads credentials without printing them and overrides database names. Initial migration replay used a fresh disposable `zemaitija_m17_20261027_dev`, with existing migrations only. One legacy test suite insists on the exact established M16 disposable database, so the initial fresh-M17 full run refused that guard (351 tests passed; suite not counted as a full pass). Full regression was then run using `zemaitija_m16_phase_b_20261026_dev`. The main development database was not used for writing tests. No destructive cleanup, live payments or real guest data. Test wrappers/browser tooling are outside the repository. Disposable databases remain available.

An intermediate full run caught an invalid fragment passed into the strict locale-path helper; the fragment now appends after localization, preserving its security validation. Browser review caught long German words at enlarged text size, lazy-image screenshot omissions and unreliable implicit Leaflet Enter activation. Wrapping, view-before-marker initialization and explicit Enter/Space handling were fixed; the evidence reviewer verified 12 key/locale/reopen combinations. A truncated E03 official PDF URL was repaired and returned 200 application/pdf. Photos were decoded before final captures. One sandboxed build failed parsing TypeScript's config output; the isolated normal build completed successfully. These failures are not represented as passing evidence.

### Browser evidence

Production Next server, headless Microsoft Edge/Chromium on Linux, real OSM tile responses, no booking actions. Evidence lives in [the review directory](design/m17-phase-b/evidence/); [machine-readable checks](design/m17-phase-b/evidence/browser-checks.json).

| State | Explore | Experiences |
| --- | --- | --- |
| EN desktop 1440px | [Capture](design/m17-phase-b/evidence/en-explore-1440-100.png) | [Capture](design/m17-phase-b/evidence/en-experiences-1440-100.png) |
| EN mobile 390px | [Capture](design/m17-phase-b/evidence/en-explore-390-100.png) | [Capture](design/m17-phase-b/evidence/en-experiences-390-100.png) |
| LT tablet 768px | [Capture](design/m17-phase-b/evidence/lt-explore-768-100.png) | [Capture](design/m17-phase-b/evidence/lt-experiences-768-100.png) |
| DE mobile 390px, doubled root text | [Capture](design/m17-phase-b/evidence/de-explore-390-200.png) | [Capture](design/m17-phase-b/evidence/de-experiences-390-200.png) |

Doubled root font size is CSS text scaling, not actual browser zoom. Final captures explicitly load/decode offscreen photographs before full-page capture; this is capture preparation, not a production eager-loading change. All eight base views retain three visible language links and booking access with no document-width overflow or page errors. Four markers render; the directory renders 17 records.

Keyboard/browser assertions cover native list Space selection, map-marker Enter selection, synchronized detail/pressed state, selected destination in the URL, equivalent German locale context, visible focus and Tab exit from map controls. Browser accessibility-tree inspection checks named buttons; it is not a screen-reader test. The [selected German map state](design/m17-phase-b/evidence/de-map-selected-390.png) shows context retained after switching language.

Fallback checks: 53 real tile HTTP 200 samples recorded. One EN desktop Explore load also reported partial tile failure, exercising the warning in ordinary conditions; provider success is not universal. Separately, [tile failures deliberately simulated](design/m17-phase-b/evidence/en-map-tiles-blocked-390.png) with localized warning and four usable source/list entries; native filter empty state/reset; [JavaScript-disabled LT directory](design/m17-phase-b/evidence/lt-experiences-no-js-390.png) retains 17 records, sources and languages. No claim of physical-device, assistive-technology or all-browser coverage.

Impeccable finish review uses direct approved-board/render comparison, with separate fresh-context design and detector/evidence assessments. It is internal Codex review, **not independent ChatGPT acceptance**. [Review reconciliation](design/m17-phase-b/REVIEW.md) records the fixes, disposition, detector interpretation and limits. Existing build state was not advanced; no automated comp-diff score is claimed.

### Preservation and change scope

Final `git diff --stat`: 9 tracked files, 57 insertions / 7 deletions, including the pre-existing `next-env.d.ts` diff. M17 itself modifies 8 tracked files (55 insertions / 5 deletions) and creates 32 deliverable files including 14 final evidence artifacts; ordinary Git diff does not include those untracked additions. No files staged or committed.

[Preservation audit](design/m17-phase-b/PRESERVATION.json) compares all 565 pre-existing file hashes: no file missing; Phase A, old build/mocks, both design sidecars, pre-existing `next-env.d.ts`, root accommodation spec and both owner patches remain byte-identical. The only pre-existing changes are the intended files above plus the disclosed hook configuration exception and two ignored generated caches. Hash audit includes untracked and relevant ignored state, beyond `git diff`. Final PNGs, JSON and assessment records are copied to `docs/design/m17-phase-b/evidence/`; intermediate working captures remain ignored.

Financial, booking/payment/refund, access/authentication, notification, inventory and database implementation files remain byte-identical. **Security configuration does change in the narrow public-map exception:** only Explore/Experiences permit OSM tile images and send `strict-origin-when-cross-origin`; private/booking/admin/API routes retain existing CSP/referrer rules. It would be inaccurate to claim all security-related files are unchanged. No PHP, new schema, migrations or platform features outside M17.

## D. Outstanding issues and approval

- Hill of Crosses: official PDF and linked map coordinates conflict. No pin until intended visitor-point semantics are resolved. E03 Kurtuvėnai candidate semantics remain unresolved; remaining text-only records have no verified exact entrance point. Current prices/hours/access must be checked through official links.
- Historical photographs are licensed by their uploaders under CC BY-SA 4.0; attribution, change notice and share-alike for derivatives must continue. No exclusive rights, endorsement or comprehensive rights clearance is asserted. No photo establishes fictional accommodation features.
- OSM tiles are a best-effort external service with no SLA. Requests disclose site origin/IP to the provider. Hosting/provider operational suitability must be reviewed before deployment; directory/source fallback remains available.
- No Safari/Firefox/physical-mobile, actual browser-zoom or assistive-technology validation. Browser AX/keyboard checks support limited observations, not accessibility certification. No performance budget/Lighthouse measurement is claimed. Dependency installation reported four moderate advisories in the dependency graph; unrelated upgrades were not attempted.
- Evidence-driven departures from the generated A board: genuine documentary photographs, four verified local points rather than generated regional positions, no fictional dashed zone, complete editorial directory, and automatically hydrated map with Hide/Reopen rather than an initially empty activation area. The approved composition, typography/palette, prominent qualified Hill feature and booking priority remain intact.
- No material evidence-gate conflict remains for this conservative publication. Internal finish checks complete; **independent ChatGPT review and explicit user acceptance remain pending**. No commit, push, deployment or Milestone 18 work is authorized or performed.
