# Milestone 17 · Phase A review handover

27 October 2026 · `main` baseline `acdce08` · **Design research and visual compositions only. All concepts unapproved. Phase B blocked pending explicit user approval.**

## Review set

Each board pairs a full desktop page with a separately arranged portrait mobile treatment. These are high-fidelity image compositions, not wireframes, code prototypes or browser screenshots. Board dimensions are export dimensions, not claimed CSS viewport measurements. Review at full resolution; small preview lettering is not evidence of production readability.

| Concept | Desktop + mobile | What changes structurally | Tradeoff |
| --- | --- | --- | --- |
| **A — Landscape Atlas** | [Open A](a-landscape-atlas.png) | Landscape opening, substantial regional orientation map, short ruled local index, a dedicated Hill of Crosses feature and regional/major-excursion links. Mobile keeps early booking access, then landscape, map and list. | Most immediate regional hospitality identity and clearest bridge to Timber Index; map-first mobile content takes space before practical links. The dramatic lake image must never become a property-water relationship. |
| **B — Cultural Journey** | [Open B](b-cultural-journey.png) | A sustained cultural essay: Hill of Crosses leads, followed by timber/sacred architecture, distinct museum/arts destinations, Žemaičių Kalvarija, then a quiet locality/excursion map and stay-return band. | Strongest cultural editorial character; greater sacred emphasis and reading length. It must not make national pilgrimage heritage the operator's own service or exclusive Samogitian identity. |
| **C — Regional Field Guide** | [Open C](c-regional-field-guide.png) | Three geographic jump links, practical destination directory, a selected entry and meaningful map/list relationship, followed by regional links and a separate Hill of Crosses/Palanga excursion section. | Strongest wayfinding and geographic scope; selection, filters and mobile detail behaviour require careful definition. More interaction and cognitive load than A. |

**Recommendation: A as the visual direction.** Its restrained atlas/index relationship and early mobile booking access extend the approved website most naturally. Use the three-level content scope defined in the inventory whichever composition is selected. C is the strongest alternative if practical discovery is the dominant objective. B is a viable deliberately culture-led editorial direction; it is not proposed as an unrelated brand redesign. No combination is approved by this recommendation.

All three retain Forest/Paper, editorial display type, rules, flat sections, visible mobile accommodation/booking routes, language intent, fictional-demo disclosures and independent-destination wording. A/B show mobile language choices; **C's final mobile header hides them and needs correction before implementation approval**. The output is illustrative: body font and raster lettering are approximations, not new type tokens. Actual implementation must keep self-hosted **Cormorant Garamond / Timber Serif** for public display and **Arial/Helvetica** for body/controls. No changes to `DESIGN.md` or existing localization are proposed by these boards.

## Evidence package

- [Destination inventory](DESTINATIONS.md): **17** source-backed records covering every mandatory destination; verified claims, exact source URLs, locality/address or coordinates, proposed editorial copy and map-readiness boundaries.
- [Map proposal](MAP.md): real-attraction vs fictional-locality semantics, coordinate conflicts, non-map fallback, mobile behaviour and implementation boundaries.
- [Four verified local map points](verified-map-points.json) and [coordinate relationship diagram](map-reference.svg): separately inspectable geographic evidence, without invented property geometry.
- [Image provenance and rights status](IMAGE_PROVENANCE.md): generation lineage, researched references/authorship where discoverable, failed retrievals, licensing status and future image-clearance requirements.
- [Local critique and verification](REVIEW.md): isolated assessments, refinement findings, final residual issues and preservation evidence. This is local preparation for the user's independent ChatGPT review, not external acceptance.
- Each final PNG's `.png.json` sidecar: exact final prompt, original prompt/refinement lineage, reference paths, hash and `approved:false`.

## Open decisions and explicit gates

1. **Select, combine, revise or reject A/B/C.** Explicit user approval is required before Phase B. The requested independent ChatGPT architectural, cultural, geographic, factual and visual review is still pending.
2. **Image strategy:** commission/license genuine destination photography, use clearly non-documentary regional illustration, or combine them with distinct captions. No final production-photo rights are established. Generated palace/church/cross/shoreline arrangements are not evidence of real features.
3. **Map data:** resolve the Hill of Crosses source conflict; verify exact entry points for destinations currently supported only by locality/address. Do not publish generated-board positions, roads, lake outlines or fictional-locality shapes as geographic data. Production coordinate readiness is not a prerequisite for reviewing the compositions.
4. **Locality presentation:** prefer an adjacent locality annotation vs a broad on-map dashed zone. Any zone is purely illustrative, contains no accommodation centre pin, and must not imply a property extent or that the fictional property is in the park.
5. **Content scope and default view:** confirm A's orientation-first vs C's directory-first behaviour, which destinations lead, and how selected details appear on mobile. The complete inventory exceeds the content displayed in any single illustrative board.
6. **Editorial qualification:** Hill of Crosses must retain “Major excursion · Šiauliai district” beside the feature title in every locale. A's final feature does not retain that full line, so its map-edge excursion annotation is insufficient as final copy; preserve the inventory's explicit qualifier when preparing an approved implementation. Never imply exclusive Samogitian attribution.
7. **Localization and accessibility:** English is the review language, following M16. Lithuanian remains default; C must expose all three mobile language choices and enlarge its compressed mobile Hill of Crosses feature so its editorial prominence matches desktop. A should consolidate its repeated early booking buttons. LT/EN/DE content, diacritics, long German labels, source-link names, 200% reflow, keyboard/focus, contrast and touch targets require semantic implementation and later testing. Composed phone columns do not establish these results.
8. **Map provider and loading:** confirm Leaflet/tile service, attribution, terms, privacy/network behaviour and fallback after concept approval. No map dependency or external embed is installed here.

## Scope and next-phase boundaries

Only new review documents, PNG/JSON artifacts, a source-coordinate JSON and a diagram are added in `docs/design/m17-phase-a/`; Impeccable working material stays under `.impeccable/mocks/m17-phase-a/` and `.impeccable/review/m17-phase-a/`. Exact files and hashes are recorded in `ARTIFACTS.json`. Initial generations are superseded working records, not alternatives for approval.

Application source, database records, migrations, services, booking, payment, inventory, policies and localization remain unchanged. No PHP, dependency installation, production UI, deployment, Stripe operation, commit or push. Root protected files and all pre-existing work are preserved. The existing M16 Impeccable build state was not reset or advanced; M17's pending approval is recorded in these dedicated files rather than changing historical M16 artifacts.

If a concept is approved, Phase B must start with its explicit approved composition and the inventory/map/image constraints, produce independently cleared or appropriately disclosed image plates, and implement semantic text, links, map fallback and responsive behaviour. Do not ship a screenshot as a page or copy a raster map into an interactive map. Existing server-authoritative booking and financial contracts remain outside this phase.

**Stop here. Phase A is submitted for independent review; no concept has been selected or approved.**
