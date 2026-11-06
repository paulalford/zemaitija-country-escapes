# M19 deferred browser, assistive-technology and HTTP verification

**Preparation only — no preview started or accessed in Run 1.** M17 acceptance and
M18 source acceptance preserve all recorded browser/accessibility/legal limitations.
This matrix does not grant Run 2 permission, WCAG conformance or provider acceptance.

## Environment and approval contract

Classification: **LOCAL_PREVIEW_APPROVAL_REQUIRED** for every interactive case below.
An owner must approve the exact isolated source revision/copy, fixture adapters,
loopback origin and port, browser profiles, test operations and evidence directory.
Suggested port is 3179, subject to explicit reservation; this document does not
assert availability or start a listener. Bind loopback only, never 0.0.0.0 or LAN.
No production hostname, public tunnel, deployment or indexing is involved.

Two distinct preview arrangements are possible:

1. **Synthetic presentation preview:** a separately reviewed disposable source copy
   with test-only server dependency adapters and synthetic route states. Browser
   request interception alone cannot replace server imports of db/client. The
   fixture source/adapter differences must be recorded; do not claim shipping DB
   integration or real authorization from this presentation evidence. If safe
   injection is unavailable, stop that case rather than use a shared database.
2. **Shipping-source integration preview:** needs both preview approval and
   ISOLATED_DATABASE_APPROVAL_REQUIRED authorization, independent target/session
   preflight and synthetic fixtures. All database operations use the fresh M19
   target, separate roles and fake providers. No retained milestone target or
   shared application DATABASE_URL/env-file fallback is permitted.

Protected: zemaitija_dev, zemaitija_stripe_automation_dev, all retained milestone
databases, containers/volumes/history, operational credentials, .env.local and
backups. No Docker, systemd, real OIDC/email, Stripe, worker/scheduler or provider
endpoint operation follows from preview approval.

Use new ephemeral synthetic access/encryption values only. Secure-cookie browser
verification additionally needs a separately approved loopback HTTPS endpoint and
temporary certificate/profile trust; do not alter system trust or reuse credentials.
HTTP source tests of Secure attributes do not prove actual browser cookie transport.

Block all non-loopback requests, downloads and provider navigation by default,
including OSM tiles and official links. Map fallback can be tested with blocked
tiles and reviewed local synthetic tile responses. Genuine OSM requests require
explicit external-network approval; no availability/rights claim is inferred from
local tiles. Keep local fonts/images and their existing attribution/disclosures.

No real Stripe Checkout navigation/payment or genuine signed webhook. Intercepted
destinations/JSON simulate application states only. Genuine provider accessibility
or acceptance needs EXTERNAL_PROVIDER_APPROVAL_REQUIRED and the existing Stripe
G2/G3/G4 process; do not bundle that into this matrix's commands.

Cleanup: stop only the approved preview process; remove temporary browser profiles,
ephemeral secrets/certificates and disposable preview copies after retaining redacted
evidence. Preserve failures and uncertain outcomes; no automatic database deletion,
refund, cancellation, destructive cleanup or history reset. Owner must define who
retains screenshots/reports, access controls, retention duration and retirement
authority before execution. Never capture tokens/cookies/secrets in screenshots,
traces, console dumps, browser URL records or public artifacts.

Safe failure: missing approval, wrong source/resource, unsupported adapter, network
escape, service/DB uncertainty or credential exposure stops dependent work. Record
BLOCKED/FAIL and the reason; continue other independently authorized checks. No
silent fixture substitution or fallback. No new dependency/browser/voice installation
without its own permission.

## Evidence baseline and recording

| Evidence category | Current status |
| --- | --- |
| Source-supported | Native controls/labels, focus/alert/status code, CSS breakpoints/reduced motion, locale routing, restrictive publication and map/list fallback. |
| Historically reported | M16/M17 Edge/Chromium emulated viewport/keyboard checks, palette calculations and doubled-root-text captures. They are not current browser zoom or Orca results. |
| Fresh Run 1 | Allowlisted Vitest synthetic server rendering/domain/HTTP checks only; no running app, DOM interaction or computed CSS. |
| Fresh Run 2 browser | NOT_EXECUTED for every case below. Fill only after explicit preview approval. |
| Manual/specialist | Orca, editorial/legal assessment, physical-device behavior and any unavailable engine/voice remain pending until actually assessed. |

For each execution record: case ID, LT/EN/DE, fixture/shipping-source mode, exact
source and fixture differences, origin, browser/engine/Orca/OS/voice versions,
timestamp, viewport in CSS pixels, actual browser zoom percentage, OS/text scaling,
reduced-motion setting, input method, steps, expected/observed results, evidence
path, PASS/FAIL/BLOCKED and remaining limitation. AX-tree snapshots are not speech
output evidence. CSS root-font doubling is not actual browser zoom. Emulated
viewports or synthesized touch are not physical-device tests.

Run LT/EN/DE in installed Firefox and Chromium on Linux Mint. Use Firefox with
Orca for complete keyboard/speech journeys, recording available voices and correct
language switching; missing tooling or a voice means a stated limitation, not a
substitute pass. Cover desktop 1440x900, mobile 390x844, 320 CSS-pixel width and
representative tablet 768px. Prioritize complete booking/error/recovery flows in
each language, then affected policy/map/calendar controls. Avoid an unhelpful full
Cartesian product of identical static pages; document representative equivalence.

## Interactive matrix — every row NOT_EXECUTED

| ID | Routes/state and steps in LT/EN/DE | Acceptance / evidence |
| --- | --- | --- |
| B01 | Home -> comparison -> each accommodation -> early date entry; Tab/Shift+Tab and Enter through header, languages, footer and skip link. | Logical reading/focus order; skip reaches main; focus visible/unobscured; no trap; booking action reachable without hover. Record focus targets/screenshots. |
| B02 | Booking form: empty fields, impossible/reversed dates, zero/over-capacity guests, missing catalog and unavailable dates. | Persistent localized labels/required guidance; invalid fields and error identified; keyboard recovery works; no fictitious availability/price. Native validation language limitation recorded. |
| B03 | Valid dates -> server quote -> review -> terms/details -> change dates; check both acknowledgement controls and submit states. | Heading focus moves appropriately; exact cents, initial/balance and Vilnius deadline readable; terms and checkbox consequences understood; unaccepted terms block submission. |
| B04 | Inject delayed/failed quote/accept response, double activation, expired quote and interrupted accepted dispatch. Reload and resume the same fixture attempt. | Busy/disabled states announced; error alert discoverable; logical focus recovery; no second logical booking/attempt; no false failure/rollback or payment claim. SQL identity requires separate DB evidence. |
| B05 | Pending, confirmed, expired and unavailable receipt return states; refresh, cancel alias and resume; guest investigation, assessment-pending and refund-processing states. | Meaningful named status and speech output; confirmation, pending and investigation remain distinct; no payment success from GET/navigation. Initial SSR role=status may need explicit reading; record actual behavior. |
| B06 | Guest access fragment and locale switch, invalid/expired link, denied session, sign-out and fresh-link recovery. Observe only redacted browser records. | Fragment removed before subsequent navigation; token absent from visible paths/referrer/storage/metadata/logs; no cross-booking disclosure; errors and actions usable. Live session/revocation semantics need approved DB QA. |
| B07 | Privacy and terms: skip, heading navigation, section index, native anchors, footer return and language links. | One main/h1, coherent reading order, headings/links announced, long legal text readable; equivalent section structure. This is not legal/editorial approval. |
| B08 | Map list/markers: Enter and Space, selected detail, pressed state, zoom controls, hide/reopen and Tab exit; locale switch preserves selected destination. | Pointer/list/keyboard selection agree; controls named; announcement meaningful; no trap; focus preserved sensibly after hide/reopen. No invented property marker or geographic claim. |
| B09 | Block tile responses, fail map module and disable JavaScript separately; exercise directory filters and empty/reset state. | Localized fallback; complete useful native directory/source links/booking access; attribution remains; no real external request needed. Record exact simulated failure. |
| B10 | Actual browser zoom 200% and 400% on booking/form/error/review/return, policies, discovery and guest/calendar controls. Separately set viewport to 320 CSS pixels at 100%. | No lost text/actions, clipping or overlapping controls; no unnecessary two-dimensional page scroll. At 1280-wide/400%, record effective CSS width near 320. Necessary map/calendar table local scrolling remains keyboard usable and does not obscure focus. |
| B11 | Compute foreground/background contrast for text, links, disabled/error/focus/status states, form borders and map controls; toggle reduced motion and repeat key state changes. | Normal text >=4.5:1, large text >=3:1, relevant non-text indicators >=3:1; focus visible. Motion reduced without losing hierarchy/state feedback; record computed colors and context. No palette-only conformance inference. |
| B12 | Owner calendar month/week/filter; private/maintenance/other labels; create/release/replace confirmations, conflict and authorization-denial fixtures. | Keyboard and Orca convey dates, exclusive end, unit, status and consequences; local table scrolling usable at zoom; private reasons/guest details absent from unauthorized/public outputs. Mutations only in synthetic adapters or explicitly approved fresh DB. |
| B13 | Switch LT/EN/DE during search, quote/review, access, policies, map and calendar; include allowed and credential-like query inputs. | Correct html lang and self-language names/current indication; allowlisted date/unit/filter/destination context preserved; rejected query credentials absent; accepted contractual locale/money unchanged. Unsubmitted review reset is recorded existing behavior. |
| B14 | Inspect actual HTTP/head/XML for public/private/booking/API routes, locale redirects, robots.txt and sitemap.xml; verify no session-bearing cacheable responses. | Default noindex/nofollow and restrictive headers; no approved canonical origin/absolute alternates/OG URL; sitemap has no locations; robots disallows /. Models do not substitute for actual emitted response evidence. No hostile Host/request value becomes publication authority. |

For speech assessment record whether alerts/busy/status changes are announced once,
whether error/focus recovery makes progress, whether numerical amounts/dates are
understandable, and whether the user can distinguish entitlement, queued refund and
provider-confirmed refund. Do not equate element presence or an automated score with
successful assistive-technology use.

WCAG 2.2 AA is a provisional target. Broad conformance requires sufficient assessed
scope, actual evidence and disposition of failures, not this matrix or a source pass.
Impeccable's audit guidance informs focus, semantics, contrast, responsive and motion
criteria; DESIGN.md remains authoritative. No design detector/launcher or sidecar
repair was run because Run 1 forbids its potential artifacts/network and UI changes.

## Disposition

Each failure needs a reproducible route/state, impact, evidence and exact proposed
file/scope. Fixing production UI/auth/payment code requires its own authorization;
do not weaken policies/guards to make tests pass. Native-language LT/EN/DE editorial,
qualified Lithuanian legal review, operator/privacy/retention decisions and genuine
provider acceptance remain separate. Stage 2C stays NOT_READY, B01–B20 OPEN,
automation inactive and G2/G3/G4 uninitiated until their independent approvals.
