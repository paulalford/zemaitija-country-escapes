---
name: "Žemaitija Country Escapes — workspace"
description: "Warm, ruled guest and operator interfaces grounded in a regional catalogue."
colors:
  ink: "#25332c"
  muted: "#506258"
  forest: "#193e32"
  ground: "#f3f1e8"
  paper: "#fffefa"
  line: "#c5cfc5"
  alert: "#873c29"
  focus: "#9b4e1e"
  forest-hover: "#2e5741"
  forest-active: "#102f22"
  alert-hover: "#672a1d"
  link-hover: "#8a4324"
  header-text: "#f6f3df"
  header-muted: "#dae2ce"
  summary-ground: "#e3e8d8"
  summary-ink: "#324b38"
  secondary-line: "#7f9485"
  secondary-hover: "#e1e8dc"
  field-line: "#788b7d"
  placeholder: "#647267"
  notice-ground: "#e4e9dd"
  error-ground: "#f4e4dc"
  error-ink: "#6e2f20"
  table-heading: "#e0e7da"
  occupied-ground: "#e8ece2"
  status-ground: "#e1e8dd"
  status-ink: "#284932"
  pending-ground: "#f3e3b9"
  pending-ink: "#684716"
  incident-ground: "#f1ddd3"
  incident-ink: "#783723"
  private-ground: "#dbe6ef"
  private-ink: "#294964"
  other-ground: "#e5dfea"
  other-ink: "#544065"
  public-forest: "#103b2d"
  public-paper: "#faf8f0"
  public-ink: "#16382e"
  public-rule: "#b9c4b6"
  public-muted: "#4d6156"
  public-focus: "#a95426"
  public-focus-dark: "#f2ca8b"
  public-action-hover: "#27523c"
  public-secondary-line: "#748879"
  public-secondary-hover: "#e4e9dc"
  public-field-line: "#798d7d"
  public-dark-rule: "#50715f"
  public-index-hover: "#1d4b36"
  public-search-ground: "#f0eee3"
  public-detail-search-ground: "#ecefe3"
  public-selection: "#dbe5c7"
typography:
  headline:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "2rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.025em"
  headline-mobile:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.65rem"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "-.025em"
  title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.35rem"
    fontWeight: 650
    lineHeight: 1.3
  subtitle:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1.05rem"
    fontWeight: 650
    lineHeight: 1.6
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: ".9375rem"
    fontWeight: 550
    lineHeight: 1.6
  data:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: 1.6
  status:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif"
    fontSize: ".8125rem"
    fontWeight: 600
    lineHeight: 1.5
  public-display:
    fontFamily: "Timber Serif, Georgia, serif"
    fontSize: "clamp(2.75rem, 5.2vw, 5.5rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-.025em"
  public-headline:
    fontFamily: "Timber Serif, Georgia, serif"
    fontSize: "clamp(2.25rem, 3.5vw, 3.75rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-.025em"
  public-index-title:
    fontFamily: "Timber Serif, Georgia, serif"
    fontSize: "clamp(2.3rem, 3.5vw, 3.9rem)"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-.025em"
  public-body:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.6
  public-control:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.4
  public-label:
    fontFamily: "Arial, Helvetica, sans-serif"
    fontSize: ".95rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  public-control: "3px"
  control: "4px"
spacing:
  xs: ".5rem"
  sm: ".75rem"
  md: "1rem"
  field-gap: "1.25rem"
  lg: "1.5rem"
  panel: "1.75rem"
  page: "2.5rem"
  section: "2.75rem"
  column: "3rem"
  public-page-inset: "4%"
  public-mobile-inset: "1.25rem"
  public-field-gap: "1.1rem"
  public-section-gap: "3rem"
components:
  public-button-primary:
    backgroundColor: "{colors.public-forest}"
    textColor: "{colors.public-paper}"
    typography: "{typography.public-control}"
    rounded: "{rounded.public-control}"
    padding: ".8rem 1.3rem"
  public-button-primary-hover:
    backgroundColor: "{colors.public-action-hover}"
  public-button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.public-forest}"
    typography: "{typography.public-control}"
    rounded: "{rounded.public-control}"
    padding: ".8rem 1.3rem"
  public-button-secondary-hover:
    backgroundColor: "{colors.public-secondary-hover}"
  public-input:
    backgroundColor: "{colors.public-paper}"
    textColor: "{colors.public-ink}"
    rounded: "{rounded.public-control}"
    padding: ".7rem .75rem"
  public-illustration-caption:
    backgroundColor: "{colors.public-forest}"
    textColor: "{colors.public-paper}"
    padding: ".7rem 1rem"
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: ".7rem 1rem"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.forest}"
    rounded: "{rounded.control}"
    padding: ".7rem 1rem"
  button-danger:
    backgroundColor: "{colors.alert}"
    textColor: "{colors.paper}"
    rounded: "{rounded.control}"
    padding: ".7rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.forest-hover}"
  button-primary-active:
    backgroundColor: "{colors.forest-active}"
  button-secondary-hover:
    backgroundColor: "{colors.secondary-hover}"
  button-danger-hover:
    backgroundColor: "{colors.alert-hover}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: ".65rem .75rem"
  status:
    backgroundColor: "{colors.status-ground}"
    textColor: "{colors.status-ink}"
    typography: "{typography.status}"
    padding: ".15rem .5rem"
  payment-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "{spacing.panel}"
  navigation:
    textColor: "{colors.forest}"
    padding: "1rem 1.5rem"
  table:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
---

# Design System: Žemaitija Country Escapes

## Overview

**Creative North Star: "The Regional Catalogue"**

A regional catalogue gives the workspaces their calm, disciplined hierarchy: warm grounds, forest navigation, fine rules, and explicit labels. The guest can read the accepted stay and verified payment position; the operator can inspect nights and review consequential actions without decorative machinery.

This system records the implemented guest and operator workspaces in `src/app/manage`, `src/app/admin`, and `src/app/workspace`. It establishes reusable functional UI rules, not a composition or display identity for future marketing pages. The fictional demonstration disclosure remains visible; visual treatment must never imply operating approval, certification, real guests, or real property features.

**Key Characteristics:**

- Warm light surfaces with forest-green actions and navigation.
- Readable system sans, aligned facts, and tabular financial data.
- Flat sections, fine rules, and restrained square status labels.
- Native controls, explicit consequences, and visible keyboard focus.

### Public extension — Timber Index, Milestone 16 Phase B

The user-selected **Timber Index** extends the Regional Catalogue onto approved public discovery, comparison, accommodation detail and booking surfaces. It is an ordinary public extension, not a workspace redesign. All preceding workspace tokens and rules remain unchanged and authoritative for their original scope; `public-` tokens apply only inside the public shell. The approved composition is a ruled timber-stay index, substantial regional illustration, warm date strip and restrained editorial section. Public booking keeps the same material language while prioritising payment comprehension.

The evidence is `src/app/public-ui/timber.css`, `shell.tsx`, the home and accommodation routes, and `booking/stay-form.tsx`, supported by `.impeccable/review/m16` captures. The direction and asset limitations remain in `docs/design/MILESTONE_16_PHASE_B_DIRECTION.md` and `MILESTONE_16_ASSETS.md`. Existing Phase A boards, reviews, sidecars and build state are intentionally preserved. No completed region-map or automated comp-diff is claimed.

## Colors

The palette combines warm paper with woodland greens, muted rules, and restrained semantic state colours. Frontmatter values are normative; the source of the shared workspace palette is `src/app/workspace/workspace.css`.

### Primary

- **Forest:** navigation, links, primary buttons, native accents, and the current-day inset marker. Hover and active shades vary this same material.
- **Rust:** consequential actions use the alert colours; the separate warm focus colour marks keyboard position.

### Neutral

- **Warm Ground / Paper:** page canvas and lighter payment, field, and table-body surfaces.
- **Ink / Muted:** reading text and supporting labels.
- **Fine Rule / Field Line:** section and row separation; controls use the stronger field line.
- **Summary Ground:** explanatory summaries and demonstration disclosure. Table headings and occupied nights use related, separately evidenced green grounds.

### Named Rules

**The Labelled State Rule.** Colour supports a written status; it never replaces the status label or calendar legend.

Status pairs cover ordinary states, amber pending states, rust incidents, blue private use, and purple other closures. These are semantic variants. Error notices have a separate light rust ground and dark ink.

### Public palette

Public Forest carries the index, header, illustration caption and primary action. Public Paper is the reading canvas; Public Ink and Muted divide primary and supporting text. Public Rule separates facts and comparison rows; Dark Rule separates content on Forest. Search Ground makes the date strip easy to find, with a separate Detail Search Ground inside accommodation pages. Public Focus is warm rust on light surfaces, changing to the light warm focus token on the header and index. Selection uses the soft public selection tone. Existing error and notice colours are reused by public booking without changing their workspace values.

## Typography

**Workspace Font:** the complete system-sans stack in the frontmatter. No separate display face is established for these workspaces.

**Character:** familiar, direct, and readable. A single family carries the interface; medium-heavy headings and buttons provide structure without editorial display styling.

### Hierarchy

- **Headline:** page title; mobile uses the recorded smaller headline variant.
- **Title:** section heading and prominent payment amount.
- **Subtitle:** period and assessment subheadings.
- **Body:** prose, controls, links, and facts. Paragraphs stop at a readable measure (72ch).
- **Label:** persistent field labels, distinct from placeholder text.
- **Data:** tables, references, and supporting text. Facts and tables use tabular numerals.
- **Status:** compact written states. Supplementary explanatory copy uses the observed small size (.75rem).

### Named Rules

**The One Reading Voice Rule.** Use the shared system sans for workspace headings, labels, controls, prose, and data. Reserve its heavier weights for hierarchy and actions.

### Public typography

**Display Font:** locally hosted Cormorant Garamond, exposed as `Timber Serif`, with Georgia and serif fallbacks. Latin and Latin Extended WOFF2 subsets support LT/EN/DE, use `font-display: swap`, and request no remote browser font service. The included OFL and asset record establish provenance; the imagery is independently disclosed.

**Supporting Font:** Arial, Helvetica, sans-serif for public prose, persistent labels, language navigation, facts and controls. The workspace continues to use its existing system-sans stack.

Public display, headline and index-title tokens establish the narrow serif hierarchy. The index introduction is quieter (500 weight, 1.2 line height); the mobile index title becomes 2.35rem. Ordinary public body text remains 1rem with 1.6 line height and a 72ch paragraph measure. Editable controls remain 1rem; the smaller label does not reduce their input text. Quote section headings use 2rem, while the highlighted initial payment amount uses 2.2rem serif with 1.2 line height. Financial facts retain tabular numerals and wrap long deadlines.

## Layout

Content and navigation are capped at 78rem. Desktop content uses 1.5rem side padding and 2.5rem top padding; paired reservation/payment sections use equal columns with a 3rem gap. Major sections begin with a rule, 2.75rem outer separation, and 1.75rem inner top space. Facts use a two-column definition list; forms use two columns where appropriate and stop at 50rem. Individual fields stop at 44rem.

At the observed 700px breakpoint, the header stacks, the main side inset becomes 1.25rem, paired sections and form grids become one column, and facts put each value below its label. The guest payment summary becomes visible before the longer reservation details. Navigation and toolbars wrap.

Tables scroll within a bounded region instead of widening the page. The month calendar retains its 72rem table measure and compact dates; the week calendar gives nights wider labelled cells. Desktop accommodation headers remain sticky; mobile removes stickiness and limits calendar height to 26rem. The occupied-period list provides the readable alternative to dense date cells. These dimensions describe that specialised component, not the general text scale.

### Public layout and responsive behaviour

Desktop home pairs a 43% index with a 57% illustration, followed by a full-width date strip. Its editorial section uses a 34% text column and remaining illustration column, with 5% gap. Header content stops at 1600px; home composition gains outer centring space above that width. Comparison stops at 1500px and deliberately varies row proportions (52%, 43%, 59% image columns) and image crops. Detail title, capacity and early date anchor precede the image. Booking content stops at 1100px, input groups at 650px and payment/review groups at 750px.

At 1100px, navigation wraps and search becomes three columns. At 760px, the home order is **index → date search → illustration**; comparison and editorial sections become one column and page insets use the public mobile token. Language links remain visible and navigation becomes a wrapping full-width row. Search places accommodation, guest count and action across the grid; the two dates remain paired. At 380px, date fields and comparison actions stack and quote facts put the amount below its label. No sticky public interface or decorative motion is introduced.

These rules describe implemented behaviour, not a claim that every state is captured. Existing 390/768/1440-labelled review captures and browser/flow records are evidence for their captured routes and states only.

## Elevation & Depth

The interface is flat. Paper against warm ground, tinted headings, occupied cells, and fine borders establish grouping. No ornamental shadow vocabulary is present. Today uses a functional inset outline (2px); keyboard focus uses a warm outline (3px with 3px offset).

### Named Rules

**The Ruled Surface Rule.** Separate operational groups with fine rules and tonal grounds; keep containers flat at rest.

### Public depth

Public pages remain flat: Forest, Paper, tinted search strips and fine rules carry the hierarchy. Opaque Forest caption bands make disclosures readable independently of image crop. There are no public ornamental shadows or animated elevations. Public keyboard focus uses a 3px outline with 4px offset, with the separate light focus colour on dark header/index surfaces.

## Shapes

Controls have gently relieved corners using the recorded control radius. Status labels, tables, notices, and payment sections remain square. Fine single-pixel rules separate rows and sections; stronger control borders distinguish editable fields. No pill-shaped brand language or clipping motif is established.

### Public shapes

Public native fields and buttons use their own small control radius; rows, disclosures, illustrations, payment summaries and editorial regions remain square. Image crops differentiate the three comparison rows without making them rounded cards. The ruled catalogue remains the repeated motif.

## Components

### Buttons

Plain, readable actions with a minimum target height (44px), semibold text (600), and the shared control radius. Primary uses Forest with Paper text; secondary is transparent with a muted-green border; danger uses Rust for consequential submission. Primary buttons have hover and pressed colours; secondary and danger supply their observed hover colours. Disabled buttons lower opacity (.55) and use a waiting cursor. Background transitions last 160ms with ease-out and disappear for reduced motion.

### Inputs / Fields

Persistent labels sit above Paper fields with a visible field-line border, shared control radius, and minimum height (44px). Inputs, native selects, and textareas share this treatment. Focus uses the common warm outline. Placeholder text is supporting copy, never the sole label. Confirmation checkboxes sit beside full consequence text; fieldsets group replacement-recovery evidence.

### Navigation

A Forest header contains the project name and workspace context. Operator links sit beneath the demonstration band on the warm canvas, with underlines and visible focus. Calendar view links use a heavier active state. Mobile navigation wraps, retaining ordinary text links.

### Status Labels

Compact square labels use written states plus semantic background/text pairs. They are information, not buttons. Month-calendar abbreviations retain expanded accessible labels and an adjacent legend; the wider week view uses full labels.

### Cards / Containers

Payment panels and mobile payment summaries use Paper without shadow or rounded framing. Assessment and inventory summaries use the soft summary ground. Notices use a distinct tonal band; consequential disclosures gain top and bottom rules. These are task groups rather than an interchangeable card grid.

### Tables, Facts, and Calendar

Facts pair muted terms with ink values and tabular numerals. Financial tables use a tinted heading row, Paper body, fine row rules, explicit captions, and separate labels for materially different amounts. Nightly inventory aligns accommodation rows with occupied dates and marks today with an inset Forest outline. Every displayed stay distinguishes occupied nights from the exclusive departure date.

### Public controls and navigation

Public buttons and editable controls have a 48px minimum height. Primary and secondary variants have the recorded hover backgrounds; disabled actions use .6 opacity and a waiting cursor. Persistent native labels sit above selects, dates and guest count; controls use the stronger public field border. Links retain semantic anchors for page navigation and date-section jumps. The visible early date anchor belongs above the home index and before the detail illustration. A skip link appears on keyboard focus. Language navigation names Lietuvių, English and Deutsch, keeps 44px minimum links and marks the current language by weight and underline.

### Public disclosures and illustrations

A visible fictional-demo band and footer establish the demonstration context. Each separately generated regional illustration has an opaque adjacent caption saying that it depicts no real property or facilities; empty alt text avoids presenting atmosphere as property evidence. Preserve explicit unspecified-facility statements and the Lakeside name limitation. Image choice, crop and title do not establish amenities, architecture, exact setting or waterfront access.

### Public quote and review

The payment summary precedes nightly rates and supporting policy content on both quote and review screens. Its first tinted fact pair gives the initial/full test-payment obligation the strongest amount hierarchy, followed by total, balance and deadline. The accommodation-only provisional-tariff notice remains beside these facts. Full unchanged payment, cancellation, refund and review policies remain available in native `details` with a visible, keyboard-operable `summary`; cancellation consequences also remain visible before acceptance. Disclosure reduces initial density without replacing or rewriting policy.

Synthetic guest details are explicit. Terms acceptance and payment acknowledgement start unchecked and require independent native checkboxes. The payment acknowledgement names the initial test amount. Loading uses a polite status region, failures use alerts and actionable retry/change-date copy, and the quote heading receives focus after a state change. A return-page navigation never visually substitutes for verified payment.

The focused M16-V01/V02 correction uses grouped definition-list rows for financial facts and nightly rates. Below 34em of booking-container width, labels sit above their values; this also responds to enlarged root text. Keep amounts intact, allow deadlines to wrap at spaces, and retain natural heading wrapping with optional German compound hyphens. Booking insets use a bounded viewport measure so enlarged text is not squeezed by enlarged side padding. Public booking instants use the existing locale formatter's guest presentation, pinned to Europe/Vilnius, with one explicit localized Lithuania-time indication; technical workspace formatting is unchanged. Quote check/expiry instants remain visible and machine-readable. Cancellation sentences retain their exact policy wording in a labelled list, with the full policies still available in the native disclosure. Preserve the visible heading focus outline for state changes and native checkbox focus; it is intentional navigation feedback.

## Do's and Don'ts

### Do:

- **Do** keep accepted facts, verified amounts, and actionable deadlines visibly labelled.
- **Do** retain native form controls, persistent labels, explicit confirmation, and visible keyboard focus.
- **Do** use tabular numerals for facts and tables, and allow long references to wrap.
- **Do** provide a readable occupied-period list alongside the horizontally scrolling calendar.
- **Do** retain fictional demonstration and Stripe test-mode disclosures.

### Don't:

- **Don't** convey inventory, payment, or error states through colour alone.
- **Don't** replace task-first forms and tables with decorative dashboard metrics.
- **Don't** add ornamental shadows, gradients, imagery, or rounded card stacks to these functional workspaces.
- **Don't** promote compact month-calendar typography into ordinary body copy or forms.
- **Don't** invent property features, testimonials, certifications, exact geography, or live-booking claims.

Evidence: shared workspace CSS; Shell, Status, Notice, and Confirm primitives; guest reservation page; operator calendar and structured assessment form; finished guest and finance desktop/mobile captures. Development overlays and synthetic fixture identifiers visible in captures are not design-system components.

## Multilingual workspace additions — Milestone 15

A visible language navigation row follows the demonstration band, using the existing text-link treatment and spacing. It names each language in its own language (`Lietuvių`, `English`, `Deutsch`), identifies the current language with weight and underline, and retains native keyboard links with a 44px minimum target height. The guest access screen switches language in place while its one-use token remains in memory. The existing placeholder home page receives language links without a marketing redesign.

Long translations wrap in headings, controls and financial tables; grid children may shrink without widening the page. Calendar date navigation wraps independently. Editable controls use at least 16px text, including on mobile. Financial deadlines explicitly include `Europe/Vilnius` and the applicable GMT offset. The accepted contractual language and viewing language are separate labelled facts. Palette, type hierarchy, ruled sections and disclosure patterns retain the Milestone 14 direction.

## Public extension handoff — Milestone 16 Phase B

Keep Timber Index scoped to public pages. Preserve the established workspace hierarchy, palette and controls. Keep mobile search ahead of the main illustration, visible semantic language/navigation links, adjacent truthful image disclosures and prominent initial test-payment terms. Do not replace the native policy disclosure with abbreviated policy text or preselect synthetic acknowledgements.

The Phase B extension sidecar is `.impeccable/public-design.json`. The document workflow normally regenerates `.impeccable/design.json`; this task explicitly preserves that pre-existing stale workspace/Phase A artifact. The separate sidecar records only public extension metadata and self-contained representative components. It does not repair or imply freshness of the original sidecar, build state or Phase A approval records. An independent external review remains the user's next checkpoint.
