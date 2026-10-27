# M17 Phase B — isolated Impeccable Assessment B

27 October 2026. Detector + source/evidence assessment, performed without reading Assessment A. This is a local agent assessment, not an independent ChatGPT/external review. No source files, approved policies, historical sidecars, financial data or database records were changed.

## Implementation integrity verdict

**Final scoped pass after reconciliation; initial findings are retained below as history.** The implementation expresses the approved regional hospitality identity and conservative evidence scope: a landscape introduction, four-point local atlas, distinct Hill of Crosses feature and wider directory. There is no fabricated accommodation pin or boundary. The deterministic detector raises intentional existing-font reuse and new design-token drift; those findings are not a substitute for the browser failures reproduced below.

## Findings

### B-01 [P1, resolved] Map markers advertise buttons but cannot be activated with keyboard

- Location: `src/app/explore/destination-atlas.tsx:43–57`, particularly the immediate `getElement()` at line 49 and Space listener at line 52.
- Browser reproduction: Edge 155, fresh contexts, localhost production preview on port 3178, tested at 390px and again independently at 1440px. Select Siberija Viewing Tower using its list button. Focus the Šeirė marker, press Enter, then independently Space. After 300–400ms, selected title remains “Siberija Viewing Tower”, URL remains `?destination=L04`, and marker `aria-pressed` remains false. The focused element has `tabindex="0" role="button" title="Šeirė trail start"` but lacks the intended `aria-label`/`aria-controls`.
- Source explanation: markers are added before the first `fitBounds` establishes a map view. Their DOM elements are not yet created when `getElement()` is read; the custom Space handler and attributes are therefore skipped. Leaflet's popup Enter behavior does not invoke this custom click selection. The later selected-state effect does successfully set `aria-pressed`.
- Impact: keyboard users can use the adjacent native list buttons, but the advertised map buttons are inoperative; this is a keyboard access defect (WCAG 2.1.1), not merely missing polish.
- Recommendation: install marker keyboard handlers after each icon actually exists (or listen to Leaflet keyboard events), handling both Enter and Space, and verify pointer/list/keyboard equivalence after hide/reopen and localization. Suggested command: `$impeccable harden`.
- Scope: introduced M17 component; unrelated booking functionality is not implicated.

### B-02 [P2, resolved] Kurtuvėnai official-information link is truncated and returns 404

- Location: `src/content/destinations.ts:396`; surfaced by `src/app/experiences/page.tsx` in `#destination-E03 a`. The same incomplete URL also appears in the E03 row of `docs/design/m17-phase-b/VERIFICATION_GATE.md`.
- Browser DOM value: `https://www.visitsiauliai.lt/data/ckfinder/files/Saules_zemes%20tturtai%20_EN(1`.
- Network evidence: a read-only Playwright API GET of that exact public destination link returned HTTP **404**. The gate's explanatory paragraph separately names the complete `.pdf` guide URL, revealing the likely truncation.
- Impact: the official source fallback fails for this directory entry, especially significant while its map point is intentionally withheld.
- Recommendation: repair to the verified official guide URL, confirm successful retrieval and preserve the unpinned disposition. Suggested command: `$impeccable harden`.
- Scope: new M17 content/evidence, not an inherited unrelated-page error.

### B-03 [P3, documented] New typography and marker color exceed the normative documented ramp

- Location: `src/app/explore/destinations.css` (detector details below).
- Impact: no observed immediate task failure; the authoritative design-system reference no longer completely describes the extension. Do not replace the expressly approved serif/Arial system to satisfy a heuristic.
- Recommendation: reconcile intentional M17 type steps and marker semantic blue with design documentation or reuse approved steps; preserve prior artifacts as required. Suggested command: `$impeccable document`, then `$impeccable polish`.

## Detector — one run

Command: `.agents/skills/impeccable/scripts/impeccable detect --json src/app/explore src/app/experiences`.

The CLI accepted both directories. Exit code 2, **9 findings**, all in `src/app/explore/destinations.css`; no findings were reported in experiences markup. No second detector run was performed.

| Exact rule | Severity | File line | Finding and disposition |
| --- | --- | --- | --- |
| `overused-font` | warning | 18 | `font-family:Arial`. Intentional approved Timber Index supporting type, already normative in DESIGN.md. Not an actionable font replacement. The explicit `.atlas-map` declaration is new; the font choice is existing. |
| `design-system-font-size` | advisory | 5 | `clamp(3.5rem,6vw,6rem)` endpoints 3.5rem/6rem absent from ramp. New M17 drift. |
| `design-system-font-size` | advisory | 6 | `clamp(1.65rem,2.5vw,2.4rem)` endpoint 2.4rem absent. New M17 drift. |
| `design-system-font-size` | advisory | 21 | 1.5rem zoom symbols absent. New M17 map-control step; not body-text illegibility. |
| `design-system-color` | advisory | 23 | `#315b79` viewpoint marker absent from palette. New M17 semantic marker color. |
| `design-system-color` | advisory | 35 | Same `#315b79` in list number. Same underlying issue, not a second independent defect. |
| `design-system-font-size` | advisory | 41 | `clamp(3rem,5vw,5rem)` endpoints 3rem/5rem absent. New M17 drift. |
| `design-system-font-size` | advisory | 43 | `clamp(2rem,3vw,3rem)` endpoint 3rem absent. New M17 drift. |
| `design-system-font-size` | advisory | 70 | Mobile `clamp(3rem,12vw,4.5rem)` endpoints 3rem/4.5rem absent. New M17 drift. |

No pre-existing unrelated directories were scanned or charged against this milestone. No detector finding establishes a contrast or factual violation by itself.

## Browser and evidence checks

Fresh Edge/Chromium contexts were launched using `/tmp/m17b-browser/node_modules/playwright-core` and `/usr/bin/microsoft-edge`. The normal sandbox launch failed on browser socket creation; the same read-only browser command then ran successfully with approved escalation. No overlay/live server was started because a full overlay setup can mutate protected entry/artifact files. Actual page DOM, requests, responses and screenshots were used; no overlay or overlay contrast pass is claimed.

- `/en/explore?destination=E01` initially selects Hill of Crosses, has exactly four rendered markers and **zero map overlay paths**. Its selected section reports no map point; the photograph does not cause a pin to appear.
- Native atlas list selection changed title and URL to Siberija / L04. Hide removed map visibility while preserving selection; reopen rebuilt exactly four markers.
- Marker keyboard selection fails as described in B-01. This is separate from successfully working native list controls.
- Real requests went directly to `https://tile.openstreetmap.org/11/...png`, with ordinary browser User-Agent and **`Referer: http://localhost:3178/`**. Both Leaflet attribution and adjacent copyright/map-issue links were present. No geolocation, routing, analytics, accommodation marker or polygon appears in the atlas source.
- Header reads: `/en/explore`, `/lt/explore`, `/de/experiences` returned 200 with `strict-origin-when-cross-origin` and CSP image allowance for `https://tile.openstreetmap.org`. `/en/booking`, `/en/manage/access`, `/en/admin` retained `no-referrer` and CSP `img-src 'self' data:`. Read-only GET `/api/booking/quote` returned 405 with the same restrictive private/integration headers. No financial mutation was attempted.
- In a separate context all OSM tile requests were aborted. Visible status became “Some map tiles could not load. Use the destination list; points do not provide travel directions.” The full 17-entry directory and 17 official-information links remained present and selected text remained readable.
- With JavaScript disabled, `/en/experiences` still rendered 17 entries, 17 source links and the explicit no-map fallback message. This proves server-readable discovery, not that every external source resolves (B-02 is one verified exception).
- Fresh rendered source images include both visible photographers, Wikimedia source and CC BY-SA 4.0 links, and “Responsive crop; resized version.” No generated concept-board pixels are imported. Source record count/groups, four IDs and exact latitude/longitude values match the conservative gate; E01/E03/R06 have no extra marker.
- No page errors were recorded in the exercised live atlas context. This is not a blanket console/network-error-free claim: deliberate aborted tiles and unavailable third-party requests are separately handled.
- At fresh initial 390px the document had no horizontal overflow. Fresh desktop/mobile full-page screenshots were captured to `/tmp/m17b-assessment-b-desktop.png` and `/tmp/m17b-assessment-b-mobile.png` and visually inspected. Serif/forest/ruled-section identity, readable attribution bands, strong Hill qualifier and primary booking actions are coherent. The mobile screenshot followed a viewport resize of an existing map; it is not evidence for a complete physical touch or orientation-change acceptance test.
- An older `en-explore-1440.png` in the shared review folder still depicts deliberate map activation. It is stale against the current automatic-map source/ASSETS.md amendment and was not used as proof of current initial rendering. The automatic-map departure from the earlier gate is explicitly disclosed in ASSETS.md; this assessment does not silently claim the gate's original activation behavior remains implemented.

## Initial audit score and limits

| Dimension | Score | Evidence/limit |
| --- | --- | --- |
| Accessibility | 2/4 | Labelled native list fallback works; map keyboard buttons fail. No comprehensive measured contrast audit claimed. |
| Performance | 3/4 | Client-only dynamic Leaflet, local bundle and optimized image component; automatic third-party map starts after hydration. No lab performance score claimed. |
| Theming | 3/4 | Existing authoritative public family/palette retained; new size/color steps need recording. No new dark-mode requirement assumed. |
| Responsive design | 3/4 | Initial 390px no overflow and coherent stacking; touch gestures/physical devices not independently verified. |
| Implementation integrity | 3/4 | Conservative source/geometry boundaries preserved, but broken official link and keyboard wiring need correction. |
| **Total** | **14/20** | **Good with required functional corrections; not release acceptance.** |

Issue count: P0 0, P1 1, P2 1, P3 1 (the detector's repeated advisory entries are grouped rather than inflated into separate defects). Fix B-01 and B-02 first, reconcile intended system changes, then `$impeccable polish` and targeted verification. No full WCAG certification, external legal approval, source re-research of all 17 destinations, operational OSM hosting approval or independent external review is claimed.

## Shared browser matrix

Inspected final `.impeccable/review/m17-phase-b/browser-checks.json` after it arrived. Eight recorded route/viewport cases all return 200 with document width equal to viewport width: EN Explore/Experiences at 1440 and 390px; LT Explore/Experiences at 768px; DE Explore/Experiences at 390px with **200% CSS root text size (not browser zoom)**. This supports the parent’s scoped wrap/min-width refinement. Recorded pageErrors is empty. Tile response samples are 200, although one EN desktop Explore case correctly reports partial tile failure; this is not suppressed or represented as universal provider success.

The shared matrix records successful native-list Space selection, marker Enter selection, selected URL context and equivalent language context; marker buttons have localized accessible names, focus style is solid, and tabbing after the map reaches its attribution link. Empty filters, simulated tile failure and JavaScript-disabled directory are recorded as passing. These shared checks supplement my fresh-context 12-case keyboard/source retest rather than replace it. Physical touch, browser zoom and exhaustive screen-reader behavior remain untested by this assessment.

## Final correction reconciliation

Retested against the rebuilt production preview after the parent applied focused corrections. This does not erase the original findings or claim that the original detector was rerun.

- **B-01 resolved:** `fitBounds` now establishes the map view before marker creation; the marker DOM exists when attributes and keyboard listeners are attached. Both Enter and Space are explicitly handled. A fresh Edge 155 context at 390px verified **12 successful combinations**: EN/LT/DE × initial/hide-and-reopen × Enter/Space. Enter on Šeirė selects L02 and Space on Siberija selects L04; each updates the localized selected title, URL query and `aria-pressed=true`. Every tested marker has its localized `aria-label` and `aria-controls="atlas-selected"`. No keyboard failure remained in these targeted cases.
- **B-02 resolved:** source now ends `_EN(1).pdf`; a fresh read-only GET returned **200, application/pdf**. The matching gate row is corrected. Kurtuvėnai remains unpinned.
- **B-03 documented:** DESIGN.md's M17 extension explicitly records the expressive display endpoints, 1.5rem map symbols and semantic marker blue. The approved Arial system remains intact. Detector advice was reconciled manually against the authoritative final document, not hidden or claimed absent.

Final unresolved verified issue count from this assessment: **P0 0 / P1 0 / P2 0 / P3 0**. Evidence limitations remain: no independent external review, full WCAG certification, physical-touch acceptance or deployment/OSM operational approval is claimed. The initial 14/20 score is retained as an initial snapshot rather than silently rewritten to suggest a comprehensive second audit.
