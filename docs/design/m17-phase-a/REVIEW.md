# Impeccable review and verification

27 October 2026. Target: `docs/design/m17-phase-a/`. **Ready for concept review, with open refinement conditions; no implementation or external approval claimed.**

## Method and independent assessments

Actively ran the installed Impeccable context launcher, read the public DESIGN/PRODUCT context, M16 direction/assets/boards and production-preview screenshot, new-work, visualize, Persuade and craft-floor guidance. The user explicitly pinned A/B/C and required all three before selection; that instruction governs over a random concept tournament, additional concept interview or early choice. Seven structures were considered in the separate working workflow record. No durable brand system was replaced.

Two isolated fresh-context agents performed Assessment A (visual design) and Assessment B (detector/evidence). Neither received the other's findings before reporting. Their later verdict passes inspected only the stated refinements and final artifacts. These are local independent assessments for this preparation, distinct from the user's requested external ChatGPT review.

The initial rounds caught incorrectly plotted Šeirė, unverified Hill markers, B's Beržoras/Village Museum and Telšiai/palace conflations, C's Alka “sacred hill” and “Plateliai Regional Park” errors, unsupported proximity/year-round wording, hidden mobile navigation and missing selected mobile detail. Two image-refinement passes per board corrected the identity errors, removed precise Hill markers, reduced unsupported copy, improved navigation and restored C's seven local entries and selected detail. Initial generations are superseded, preserved only in Impeccable working artifacts.

## Final visual verdict

| Concern | Result / remaining condition |
| --- | --- |
| Timber Index continuity | Palette, flat ruled composition, editorial hierarchy and booking return broadly retained. Raster body lettering varies from the normative Arial/Helvetica and requires literal implementation against DESIGN.md. |
| A geography | Local trail is no longer misplaced on the overview. Hill is an excursion annotation, not a precise dot. Town/shoreline/zone positions remain conceptual. |
| B identity | Village Museum explicitly Telšiai, Alka explicitly Telšiai, palace explicitly Plungė; separate Beržoras link. Speculative Ilgis/Babrungas entries and proximity/year-round copy removed. |
| C identity and continuity | Alka museum and Žemaitija National Park corrected; local list has all seven destinations; selected Šeirė detail retained on mobile. Four abstract marker relationships replace invented local basemap. |
| Hill of Crosses | Dedicated feature in all alternatives; B leads with it. **A still needs the district/major-excursion qualifier immediately at its feature; C's narrow mobile feature needs more space.** Both conditions remain explicit review gates. |
| Mobile booking / languages | Early booking access in all. A/B expose language choices. **C's final mobile render hides languages behind menu treatment; restore visible links.** A repeats its early CTA unnecessarily. |
| Map/list interaction | C shows List selected alongside both list and diagram on desktop. Define desktop vs mobile switching and selected-row styling before implementation. C's diagram also needs an adjacent “schematic / not for navigation” caption. |
| Image integrity | AI captions are present, but photographic specificity can still imply documentary association. Shared B imagery must remain explicitly thematic; choose genuine cleared photography or clearly non-documentary illustration after concept approval. |

Both visual and evidence assessments favour **A** as the balanced starting direction; C has the clearest discovery information architecture. B is the strongest cultural essay but has a narrower emotional emphasis. No heuristic total from the initial boards is promoted to a final score: later verdicts assess specific corrections, and raster-only interaction heuristics are not measurable.

## Verification scope

Assessment B ran `impeccable detect --json docs/design/m17-phase-a` once: **`[]`, zero reported findings**. This folder contains documents and rasters, so the result is not useful evidence of DOM quality or accessibility. It was not rerun on unchanged non-UI targets. No browser, injected overlay, local preview server or production app was started; there is no implemented M17 surface to inspect. Image outputs were visually inspected directly. The separate SVG coordinate relationships were checked against the source JSON, not treated as a full geographic basemap.

Artifact validation checks PNG dimensions, final SHA-256 sidecars, unapproved status, generation metadata, local Markdown links, JSON and SVG structure, source-coordinate ranges/order and unchanged pre-existing files. The retained verification record is `.impeccable/review/m17-phase-a/verification.json`; the reproducible script is beside it. `ARTIFACTS.json` records handover file hashes, excluding itself to avoid a recursive hash. Impeccable's metadata scan reports **12 working/review PNG rasters, zero missing embedded prompts**.

Final session verification: **523 pre-existing files compared, zero changed; 23 local Markdown links checked; all three final PNG hashes/dimensions/sidecars validated; JSON/SVG parsed; `git diff --check` passed.** All four protected files match their starting hashes. The first verification attempt found that the manifest link was checked before the script created the manifest; the script ordering was corrected and the complete check passed. Repeating the preservation check requires the retained session-start snapshot in `/tmp/m17-start.json`.

No application tests, typecheck, lint or production build were run: this phase adds no application code/dependencies. Keyboard, real screen-reader output, measured contrast, 44px targets, actual browser responsive behaviour, 200% reflow, LT/DE expansion and performance are **untested**, not passed. These remain required in an approved implementation phase.

## Preservation and workflow notes

Start status: modified `next-env.d.ts`; untracked `.impeccable/build/`, `.impeccable/mocks/`, root accommodation spec and the two owner-management patches. The starting inventory/hashes are `/tmp/m17-start.json` and `/tmp/m17-start-status.txt`. Validation compares every pre-existing inventoried file, including the four protected files, rather than using a clean-tree assumption. No reset, clean, staging, commit, push or deployment.

The shared Impeccable build state already belongs to M16 and remains at its historical open comps phase. `build-phase start` declined replacement; no reset/advance or false M17 approval was applied. M17 pending state is recorded in this handover, working workflow and `approved:false` sidecars. The pre-existing stale `.impeccable/design.json` was reported and preserved; a separately requested Impeccable `document` refresh can reconcile it without redesigning the approved system.

No ignore-list exclusions were used, no overlay was claimed and no review server required cleanup. Temporary start snapshots are retained for audit; generated working assets are intentionally retained. No third-party photographs were copied; failed source-image retrieval is disclosed in provenance.

Questions skipped in the local assessment runs: the parent is assembling the requested three-option review package. User selection and independent ChatGPT review remain the next checkpoint; Phase B stays blocked.
