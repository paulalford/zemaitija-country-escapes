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
rounded:
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
components:
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

## Layout

Content and navigation are capped at 78rem. Desktop content uses 1.5rem side padding and 2.5rem top padding; paired reservation/payment sections use equal columns with a 3rem gap. Major sections begin with a rule, 2.75rem outer separation, and 1.75rem inner top space. Facts use a two-column definition list; forms use two columns where appropriate and stop at 50rem. Individual fields stop at 44rem.

At the observed 700px breakpoint, the header stacks, the main side inset becomes 1.25rem, paired sections and form grids become one column, and facts put each value below its label. The guest payment summary becomes visible before the longer reservation details. Navigation and toolbars wrap.

Tables scroll within a bounded region instead of widening the page. The month calendar retains its 72rem table measure and compact dates; the week calendar gives nights wider labelled cells. Desktop accommodation headers remain sticky; mobile removes stickiness and limits calendar height to 26rem. The occupied-period list provides the readable alternative to dense date cells. These dimensions describe that specialised component, not the general text scale.

## Elevation & Depth

The interface is flat. Paper against warm ground, tinted headings, occupied cells, and fine borders establish grouping. No ornamental shadow vocabulary is present. Today uses a functional inset outline (2px); keyboard focus uses a warm outline (3px with 3px offset).

### Named Rules

**The Ruled Surface Rule.** Separate operational groups with fine rules and tonal grounds; keep containers flat at rest.

## Shapes

Controls have gently relieved corners using the recorded control radius. Status labels, tables, notices, and payment sections remain square. Fine single-pixel rules separate rows and sections; stronger control borders distinguish editable fields. No pill-shaped brand language or clipping motif is established.

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
