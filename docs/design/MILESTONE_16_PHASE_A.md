# Milestone 16 — Phase A visual review

Date: 2026-10-26. Baseline: `main` at `aebe24b`. **Awaiting explicit user approval. Phase B has not started.** These are rendered raster compositions, not implemented pages, working forms, approved contractual copy or evidence of available accommodation. The user selected English for this review; LT/EN/DE navigation is represented.

## Review gallery

Each landing board pairs a rendered desktop composition with a separately arranged portrait mobile composition. The boards show intended hierarchy and image composition, not measured browser viewports. Full-resolution PNGs are supplied for inspection.

| Direction | Rendered desktop and mobile | Creative rationale and guest path |
| --- | --- | --- |
| A — Meadow journal | [Open composition](m16-phase-a/a-meadow-journal.png) | Warm paper, literary serif, broad meadow panorama and editorial accommodation photographs. Landscape leads to a flat date-search strip and the three stays. The most familiar hospitality direction; the fastest visual route from atmosphere to a conventional search form. |
| **B — Timber index — recommended** | [Open composition](m16-phase-a/b-timber-index.png) | Forest-green ground, substantial serif stay names, fine rules and one dominant timber-building image. The three names and capacities form the opening structure. Mobile deliberately stacks the accommodation index above the photograph, then the labelled availability form. |
| C — Water and light | [Open composition](m16-phase-a/c-water-and-light.png) | Cool mineral ground, humanist sans and a long wooded-water horizon. A dark search band and restrained accommodation directory establish a horizontal rhythm. The water is explicitly illustrative regional atmosphere, with no implied property access. |

Recommended direction extended:

- [Comparison and individual accommodation showcase](m16-phase-a/b-discovery.png): distinct image framing, supported capacities, direct date-check actions and a factual Forest Cottage page.
- [Mobile date selection, illustrative quote and booking review](m16-phase-a/b-booking.png): the practical transition from discovery to test payment, with synthetic information, unchecked terms acceptance and a visible financial summary.

These are five review boards containing three desktop/mobile landing alternatives, two desktop discovery pages and three mobile booking screens. Earlier generation attempts are superseded; only the files linked above belong to the final review set. Prompts and generation lineage remain under `.impeccable/mocks/m16-phase-a/`; original generations remain in the image tool's output directory. All final image sidecars state `approved: false`.

## Verified reference base

Research accessed on 2026-10-26. The following describe the region; none establishes the location, facilities or construction of our fictional accommodations.

| Reference | Verified observation | Design interpretation |
| --- | --- | --- |
| [Žemaitija National Park Directorate — Landscape](https://zemaitijosnpd.lrv.lt/en/landscape/) | The park describes glacial hills and ridges, lakes, wetlands and winding streams. | Long landscape crops, low horizons and varied tree cover. This is a regional reference, not a claim that the fictional properties are inside the park. |
| [Park Directorate — Forests](https://zemaitijosnpd.lrv.lt/en/nature/forests/) | The authority documents extensive forest cover, including spruce, pine and birch. | Mixed conifer/deciduous imagery instead of generic alpine forest or tropical vegetation. |
| [Park Directorate — Meadows](https://zemaitijosnpd.lrv.lt/en/nature/meadows/) | The park distinguishes cultivated, semi-natural and natural grasslands, including patches near woodland and wetland edges. | Meadow clearings and seasonal light support the warm alternative. No exact habitat, protected species or property biodiversity claim is made. |
| [Park Directorate — Valuables of architecture](https://zemaitijosnpd.lrv.lt/en/cultural-heritage/valuables-of-architecture/) | The authority identifies surviving regional farmsteads and village examples. | Rural timber architecture is a relevant reference category. Religious monuments and heritage ornaments are not borrowed as brand decoration. |
| [Cultural Heritage Department — Wooden Heritage in Lithuania](https://kpd.lt/uploads/wooden_architecture.pdf), particularly printed pp. 138–139 / PDF spread 69 | Rasa Bertašiūtė's discussion describes substantial Samogitian timber houses, four-slope roofs, broad eaves, low/wide windows and restrained ornamentation. The publication includes documented architectural photography and regional comparisons. | Broad roof volumes, modest timber elevations and restrained detail inform the generated buildings. No reconstruction, heritage classification, building permission or historic origin is claimed. |
| [Park Directorate — Plateliai](https://zemaitijosnpd.lrv.lt/en/information-for-visitors/places-to-visit/plateliai/) | Establishes Plateliai as a real regional locality with its own historic context. | The project's approximate inspiration stays Plateliai/Žemaitija. No real address, property pin, travel distance or park affiliation is introduced. |

The park's linked *Kaimo statyba: Žemaitija* PDF was discoverable but exceeded the web reader's size limit. Attempts to retrieve selected park gallery photographs failed with cache/403 errors. They were not copied, used as image-model inputs or represented as examined property photographs. The accessible heritage publication and authority descriptions provide the architectural evidence used here; inaccessible material is not relied upon for additional construction claims.

## Cultural facts versus creative choices

Timber construction and documented roof/eave proportions are research-grounded references. The specific buildings, their windows and finishes, scenery, season, light, framing, palettes, typography and layouts are creative interpretations. They are not records of real accommodation. A green interface or literary serif is a contemporary design choice, not an assertion of a traditional Žemaitijan graphic style.

Seven grounded starting systems were considered: a landscape field journal; an architectural museum catalogue; a visitor-information sign; a photographic contact sheet; a water-horizon essay; a timber-elevation index; and a rural calendar sheet. The local Impeccable seed was `seed:109ee86d2f090492`, assigned to the timber-index candidate. The remote challenger fetch did not return, so this was a local exercise without external challenger boards. The user's explicit brief controls the three equal-salience rendered alternatives and approval gate.

The three final compositions vary the dominant image, reading order, navigation spacing, typography, color relationship and discovery pattern. They share truthful product content. No Mediterranean, Alpine, tropical or generic glass-cabin direction is proposed.

## Catalog and booking truth

A read-only PostgreSQL query confirmed the reference catalog: `forest-cottage` capacity 2, `lakeside-cabin` capacity 2, `family-cottage` capacity 6; all enabled, configuration version 1. No database mutation was performed for Phase A.

Differences between the illustrative properties come from framing: woodland context, closer timber detail and a broader meadow composition. They do not establish different amenities, bedrooms, accessibility, lake frontage or actual settings. The name Lakeside Cabin remains a fictional catalog name and conveys no verified access rights.

The mobile quote is the documented Milestone 8 example, not an executed availability result: Forest Cottage, 2–5 July 2027, 2 guests, three occupied nights. The checked-in provisional tariff gives €190 + €190 + €160 = €540. Before T–14, the advance is €162 and balance €378. The illustrated deadline is 18 June 2027 at 15:00 Europe/Vilnius, using the existing provisional check-in time. No genuine Stripe payment, inventory claim, quote acceptance, terms acceptance or synthetic guest record was created.

Phase B must use the existing server services to recheck the actual tariff, capacity, dates, deadlines and inventory. A displayed quote is advisory; successful server acceptance fixes the snapshot and acquires inventory before Checkout. Provider verification determines payment confirmation. Return-page navigation never confirms payment. Browser copy and translated labels must never become machine form values or internal identifiers.

## Image provenance and licensing treatment

All five boards and every photographic-looking element within them were generated with the built-in OpenAI image-generation tool during this task. Inputs to refinement calls were only earlier generated boards from this task. No third-party photograph, real-property image, hotel stock photograph, map or institutional logo is embedded in the deliverables.

Each final PNG has a neighboring JSON sidecar recording the exact generation/refinement prompt, source generation path, generated input lineage, research-reference status, SHA-256 and unapproved status. Prompt metadata is also embedded in the PNG. The prompts and earlier attempts remain in `.impeccable/mocks/m16-phase-a/` for traceability.

The official texts and documented photographs are research references, not licensed project assets. Their public accessibility is not treated as permission to republish them. No Creative Commons, public-domain, exclusive-ownership or legal-clearance claim is made for either the references or generated imagery. Any future use of actual regional photography requires a separately recorded author, original file, license/permission and attribution. These generated boards are review artifacts, not final exportable production image plates.

Visible disclosures identify the fictional demo and generated illustrations. Property image captions identify illustrative concepts; C additionally denies implied lake access. Final production alt text, captions and legal copy remain implementation work after design approval.

## Impeccable review and refinement

The installed skill was actively invoked through `impeccable context --target src/app/page.tsx`, the new-work and Persuade guidance, concept exercise, image-first visualization, craft-floor guidance and two isolated critique assessments. The existing workspace brief and authoritative `DESIGN.md` were read. No production prototype substituted for the image-first review. The pending public-surface brief is `.impeccable/surfaces/src-app-page-tsx.md`; the build-phase record remains open at composition approval.

Both independent agent assessments recommended B. Its accommodation index is the most distinctive, makes 2/2/6 capacities immediately scannable, and extends the existing warm/forest workspace palette without imposing marketing typography on the operational screens.

Refinements removed unsupported water-proximity copy and property-waterfront imagery from A, replaced unconfigured 2025 sample dates with empty controls, removed decorative logos, corrected A's generated mobile capacity typo, removed incidental decorative pattern/unsupported lower-page copy from the discovery board, and corrected generated booking copy that confused snapshot acceptance with later provider verification. Terms are shown unchecked by default. A second independent raster inspection confirmed the corrected Lakeside capacity, the €540 / €162 / €378 amounts, the 18 June deadline, unchecked terms and separation of acceptance/inventory from verified payment. A's mobile Family Cottage caption is below the displayed crop; its desktop capacity is visible and correct.

Remaining visible tradeoffs for user review:

- **A:** familiar editorial hospitality structure; photographs need stronger recognition through framing; italic image captions and the smaller disclosure need more robust treatment when implemented.
- **B:** the accommodation rows should be ordinary navigation links, not an unexplained hover-driven image selector. Mobile discovery plus photograph puts search lower down; provide a clear early path to dates and constrain image height after approval. Keep captions on an opaque backing and expose language navigation clearly in the mobile menu or header.
- **C:** the lake can dominate the product's first impression despite the explicit caveat. The demo disclosure should move near the heading before implementation. This is the least recommended direction because the permitted property facts do not establish a relationship to the pictured water.
- Raster typography and responsive arrangements are visual intentions. Real 16px editable text, 44px targets, 200% reflow, intermediate widths, keyboard focus, screen-reader labels, reduced motion, LT/DE text expansion and measured contrast require actual implementation and testing. No accessibility certification is claimed.

The raster-folder detector returned `[]`; this is not meaningful DOM or accessibility evidence. No placeholder-page scan is counted as verification of new UI. Impeccable also reported the pre-existing stale `.impeccable/design.json`; it was preserved. A separately requested `/impeccable document` can refresh it later while preserving `DESIGN.md`.

## Scope and approval gate

Only design documentation, rendered review assets and Impeccable working artifacts are added. Application source, approved policies, translations, dependencies, migrations and production UI are unchanged. `DESIGN.md` remains authoritative for the existing workspaces; these pending alternatives do not replace it.

All four protected files were verified byte-identical to the Phase A starting hashes. Asset links, provenance hashes and all five unapproved sidecars validated; `git diff --check` passed. The only tracked diff is the pre-existing protected `next-env.d.ts` change. New work comprises this document, five PNG/JSON pairs in `docs/design/m16-phase-a/`, the pending surface brief and `.impeccable/build/` / `.impeccable/mocks/` working artifacts. No stage, commit, push, deployment, real communications, live credentials or payment attempt occurred. Full regressions, typecheck, lint, database schema checks and an isolated build were not rerun for raster/document-only Phase A; they remain required after approved Phase B implementation.

**Decision requested:** select A, B or C, or specify refinements. B is recommended. No board is approved and no production page or booking workflow will be implemented until explicit user approval of Phase A.
