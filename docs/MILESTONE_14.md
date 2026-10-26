# Milestone 14 — Guest self-service and administration

Implementation for independent security/code review. Fictional properties, synthetic guests and Stripe test mode only. Nothing is committed or pushed. No scheduler, live payment, real email delivery or public deployment was activated.

Independent security corrections and current verification are documented in [Milestone 14 security review corrections](MILESTONE_14_SECURITY_REVIEW.md). That addendum supersedes the original migration/table/test counts below.

## Implemented functionality

- `/manage/access`: explicit exchange of a single-use booking link. The token is in a URL fragment, is removed before the exchange request, and never appears in server request URLs. Opening a link does not silently cancel, pay or consume it; the guest chooses Open my reservation.
- `/manage`: own-booking details, immutable accepted nightly prices and payment schedule, verified payment position/deadlines, balance Checkout through Milestone 11, policy information, cancellation through Milestone 13, assessment/refund status, sandbox link renewal and sign-out. Mobile displays the current payment obligation before detailed reservation facts. Browser return navigation remains read-only.
- `/admin/signin`: OpenID Connect authorization-code flow using pinned `openid-client@6.8.8`, S256 PKCE, state, nonce, signed RS256 ID tokens and fresh provider-asserted MFA assurance. There is no password store, shared credential or request-controlled authentication bypass.
- `/admin/bookings`: role-scoped reservations and operational payment positions; individual review includes attributable provider cancellation and authorized guest-access issuance/revocation. Finance/administrator users additionally see immutable financial history, structured evidence-based assessment approval and durable refund initiation. The assessment form displays gross loss, avoided costs, attributed recovery, remaining loss, policy ceiling and proposed charge in EUR; internal commands still use integer cents.
- `/admin/calendar`: month/week navigation, all permitted units or one unit, property-local today indication, labelled active inventory, a keyboard-scrollable table and mobile text list. Confirmed bookings, creating/reconciling holds, private use, maintenance and other blocks remain distinct. It includes audited/idempotent create, release and atomic replacement, recent block history and read-only unit configuration.
- `/admin/incidents`: unresolved financial incidents for finance/administrator, plus failed/waiting sandbox notices scoped to the current role and units. It provides investigation context without a financial/inventory override.
- `/admin/identities`: administrator-only identity provisioning/updates, role and unit grants, enabled status, explicit review reasons, current-MFA checks and session revocation. Self privilege changes are rejected.
- Loading, empty, denied, invalid-input, pending, conflict and failure/recovery states; explicit confirmations for consequential commands. The public landing page is unchanged.

## Guest credential contract

Tokens are generated with `randomBytes(32)` (256 random bits). Only SHA-256 digests are stored. The trusted token issuer accepts a synthetic booking and explicit scopes from `booking:view`, `booking:balance`, `booking:cancel`, `booking:renew`; no HTTP route accepts an authority object, arbitrary scope list, guest identity or accepted money/deadline values.

A link expires after **15 minutes** and is consumed by one atomic conditional update. Concurrent exchanges produce one session. A token can be revoked independently. Exchange creates a separate **30-minute** hashed, opaque database session; link expiry does not truncate an already established session, while parent-token revocation immediately invalidates it. Guest sessions cannot authenticate as administrators or select another booking.

Cancellation, balance and renewal use additional **five-minute**, operation/session/booking-bound one-use authorizations. Every protected operation checks the database session and required scope. Cancellation passes a live session/action reference to the existing authority service, which rechecks it under the domain lock. Balance acceptance also rechecks guest access after acquiring the existing booking lock. A consumed action cannot be replayed to repeat an effect; retry requires a refreshed form. Durable domain operation identities remain the final payment/refund safeguards.

`GUEST_ACCESS_LINK` uses the existing outbox/delivery lease/retry/unknown-send machinery and synthetic-recipient checks. The delivery worker generates the token immediately before sending and stores no raw credential in the outbox or audit. A raw link exists only in process memory/the sandbox message. Renewals and authorized operator resend queue a fresh event; they do not enable production mail. Existing guest notices include a scoped link when access configuration is provided; dedicated access notices require it. LT/EN/DE access-notice text uses the existing notice mechanism, without adding locale routing.

## Administrator authentication and roles

Protocol references consulted: [OpenID Connect Core](https://openid.net/specs/openid-connect-core-1_0.html), [OAuth Security BCP / RFC 9700](https://www.rfc-editor.org/rfc/rfc9700.html), and the [openid-client maintainer documentation](https://github.com/panva/openid-client).

Managed OIDC was selected over self-managed passwords: the provider owns MFA enrollment/recovery and the application verifies its signed assurance claims; a custom password store would add recovery, credential protection and MFA implementation scope. No vendor account is selected or configured by this change.

Configure an HTTPS issuer, confidential client, exact callback `${APP_ORIGIN}/api/access/admin/callback`, RS256 signing, and a documented `ADMIN_OIDC_MFA_ACR` that actually means enforced MFA (prefer passkeys/security keys). The authorization endpoint should share the configured issuer origin for the form-action policy. The callback verifies issuer/audience/signature, nonce, state, PKCE, expiry and `auth_time` within five minutes. The session preserves that signed authentication instant rather than restarting the financial freshness clock at callback. Browser-bound flow state is AES-256-GCM sealed, expires in ten minutes and is consumed once through a durable shared counter. Provider access/refresh tokens are not persisted. Unknown subjects never create an administrator.

External identities map by exact `issuer|subject` to enabled `admin_users`. Database sessions last at most **one hour**, expire after **30 minutes idle**, and are revoked after identity/role/enabled changes. Every protected request rechecks enabled status, current role, auth version and unit grants. Sensitive domain operations recheck the authenticated context. Financial and identity mutations require authentication within **ten minutes**; sign in again for fresh MFA after that window.

| Role | Access |
| --- | --- |
| `operations` | Assigned units only: booking/occupancy, operator blocks, provider cancellation, sandbox guest-access operations, scoped notification failures. No assessment approval, refund initiation, identity management or detailed financial incident investigation. |
| `finance` | Financial booking review, assessments, refunds, financial incidents and delivery investigations; provider cancellation retains the Milestone 13 permission. No inventory blocks or guest-access issuance/impersonation, and no identity management. |
| `administrator` | Existing full role permissions, including inventory and identity management, with the same financial safeguards and fresh-MFA requirement. |

“Owner” remains a persona, not a new role. Operations identities need explicit `admin_unit_access` rows; no implicit all-unit grant exists. An administrator can grant units through the separate reviewed identity workflow.

First identity provisioning is an explicit local migration-credential CLI action, not a web bootstrap or authentication bypass:

```sh
npm run admin:provision:dev -- '<independently-verified-subject>' administrator
# An operations identity requires explicit unit UUIDs:
npm run admin:provision:dev -- '<independently-verified-subject>' operations '<unit-uuid>'
```

Set `ADMIN_OIDC_ISSUER` first. This CLI accepts only a localhost `*_dev` database, inserts an audit event and does not produce a session; the identity must still complete OIDC MFA. Do not pass secrets in CLI arguments. No initial identity was provisioned for user access during implementation; automated/UI-review identities are synthetic and their preview sessions are revoked after review.

## Inventory and authorization safeguards

The existing `inventory_claims_no_overlap` partial GiST exclusion remains the sole inventory conflict authority. All stays are half-open local dates `[arrival,departure)` in `Europe/Vilnius`. Old/unresolved guest holds continue to block. No calendar operation reconciles or releases guest claims.

Block create writes the operator block, one matching claim, audit event and stable operation result in one transaction. Unit locks are acquired before inventory, and multiple units are sorted. Same key/same normalized payload returns the prior result; changed payload or actor fails. Conflicts map only SQLSTATE `23P01` to unavailable; operational SQL errors remain failures. Release updates both timestamps together and preserves history; replacement releases/acquires atomically and rolls back completely on a conflict. No timeout automatically releases owner blocks.

New controlled reasons `PRIVATE_USE`, `MAINTENANCE`, `OTHER` receive deferred owner/unit/date/release consistency checks and immutable history protections. Earlier synthetic `TEST` / `SYNTHETIC_TEST` fixtures retain their previous contract, including privileged test cleanup; runtime cannot delete operator blocks. No personal notes or second calendar/booking store was added.

New access denials carry an immutable event identity/time and redacted actor/session/scope context when available. Transaction wrappers roll back before persisting the same denial, preventing lost or duplicated denial evidence. Existing Milestone 13 durable-denial behavior remains intact. Unknown/out-of-scope guest credentials receive the same generic response. Strict canonical Origin checking, SameSite cookies, one-use mutation authorizations, bounded/strict inputs and shared PostgreSQL rate limits protect writes. Counters are keyed with a separate HMAC secret; untrusted forwarding headers are not used as authority. Ingress-wide and session/credential counters are used rather than process-local counters.

HTTPS sessions use Secure, HttpOnly, SameSite=Lax, Path=/, host-only `__Host-` cookies. Local HTTP development uses the same session checks with unprefixed/non-Secure localhost cookies; production rejects HTTP `APP_ORIGIN`. Protected routes have no-store/no-referrer/noindex headers, frame denial, nosniff and a restrictive same-origin resource/form policy. Next inline hydration scripts remain allowed by CSP; this is not a claim of a fully nonce-based production CSP. No third-party assets/analytics are added to access pages.

## Migrations and privilege implications

Applied to the existing local development database after explaining the effects. No reset, record deletion, historic money rewrite or applied-migration edit was performed.

| Migration | Effect |
| --- | --- |
| `0029_access_management` | Adds five access/authorization/command tables, guest token consumed time and admin auth version; identity invalidation, controlled identity administration, narrow runtime grants, unit-lock capability and managed block history/consistency guards. |
| `0030_managed_claim_guards` | Forward correction for distinct trigger row shapes exposed by regressions; prevents managed claim deletion, date/owner rewriting and resurrection. |
| `0031_identity_lock_capability` | Narrow security-definer identity row-lock capability. PostgreSQL SELECT FOR SHARE needs mutation privilege, so this avoids granting administrator UPDATE to runtime. |
| `0032_identity_authorization_guard` | Holds the acting administrator identity lock through controlled identity-management commands, serializing role/disable changes. |

The domain tables are reused. The five new tables are `access_sessions`, `access_actions`, `access_rate_limits`, `admin_unit_access`, `management_commands`; none is another accommodation, inventory or financial authority. Existing financial services remain intact apart from optional authenticated balance revalidation and session-bound authority checks.

Runtime grants are restricted to access insert/read and relevant usage/revocation fields, rate counters, block insertion/release, read-only identity/unit-grant context, and controlled functions. Runtime cannot insert/update administrator identities directly, update unit configuration, edit captured amounts, delete refund/block history, or rewrite audits. Functions use fixed search paths and revoke PUBLIC execution. Migration credentials are confined to migration/explicit CLI workflows.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed with zero warnings.
- `npm run db:check`: passed.
- `npm run db:generate`: reports no schema changes; journal/snapshots agree.
- `npm test -- --reporter=dot`: **218/218 tests in 12 files**, comprising all 174 prior tests and **44 Milestone 14 tests**.
- `npm run build`: optimized production build passed in an isolated `/tmp/zemaitija-m14-build` copy, preserving the protected working-tree `next-env.d.ts`.
- `npm audit --omit=dev`: zero published runtime advisories. Full audit reports four moderate development-tool advisories in the existing Drizzle/esbuild tooling graph; no unrelated dependency upgrade was made.
- `git diff --check`: passed.
- SHA-256 checks confirm all four protected files remain byte-identical to their initial contents.

Tests exercise cryptographic link hashing/exchange and concurrent replay, expired/revoked/invalid credentials, guest scope/read-only/cross-booking denial, one-use actions, sandbox notification access, current admin role/enabled/version/expiry, unit boundaries, finance separation and fresh-MFA checks, identity changes/self-escalation denial, CSRF/strict input/confirmation/body bounds, restricted SQL privileges, owner create/release/replace/idempotency, rollback on claim/audit failure, old unresolved holds, direct SQL history/consistency denial and inherited financial behavior. Signed synthetic OIDC tests validate RS256 signature, issuer, audience, nonce, PKCE, token expiry, MFA assurance, auth age, browser flow replay/forgery and unknown subject denial. The synthetic IdP runs through the actual OpenID client verification path; no real identity-provider or Stripe API request is involved.

Concurrency tests use independent PostgreSQL connections, explicit unit-lock barriers and `pg_blocking_pids` evidence before releasing the first worker. They prove block-v-block and block-v-guest acceptance arbitration, no losing guest command, concurrent identical operation identity, release-v-new-claims exclusion and full rollback on failed replacement. They do not rely on an assumed sleep ordering. Full browser/security QA remains Milestone 19.

A final read-only local integrity scan found **zero** active inventory overlaps, capture reservation discrepancies, obligation reservation discrepancies, refund ledger discrepancies and managed-block/claim inconsistencies.

Rendered checks at 1440×1000 and 390×1000 cover month/week calendar, operator booking, guest details/cancellation expansion, sign-in, denied identity access, notices and finance assessment/history. No page overflow or JavaScript errors were observed; the calendar region supports keyboard focus, the guest URL fragment is cleared before exchange and mobile payment facts end at approximately y=774. Financial sample input produced €100 loss − €20 avoided costs − €0 recovery = €80 remaining loss, with €25 proposed charge. No financial form was submitted during visual review. The three isolated preview blocks were released with history, their units and two preview identities were disabled, preview credentials were revoked, private credential files were removed, and the preview server was stopped. Screenshots/JSON evidence live in ignored `.impeccable/review/`.

The independent Impeccable reviewer scored the two material fixes (mobile payment visibility and structured assessment/history) resolved and returned `ship` at that scored-fix scope; this is not an external security certification. The mandatory Impeccable workflow was invoked, the user chose its proposed direction, the detector returned no findings, and independent finish review drove the mobile payment and structured assessment refinements. The surface brief discloses that the approved direction was persisted during finish preparation rather than before UI coding. The local decision page could not survive the tool process lifecycle; the user selected the displayed direction through chat. Functional Operate screens use the skill's code-led path; no marketing composition or shipping image was required.

## Boundaries and outstanding decisions

- Real test-IdP configuration, exact MFA assurance semantics, enrollment/recovery and an end-to-end external provider login require operator setup/security review. No vendor subscription or external account change was made.
- The chosen token/session lifetimes and delivery flow are explicit implementation decisions for independent review before deployment, not approval for live guest use.
- Unit identity/capacity/enabled/version are intentionally read-only here. Section 5 of the accommodation specification permits subsequent governed unit/pricing configuration; it does not require inventing editable property content or D17 rates now. Price/content editing, internal business notes and new commercial configuration remain deferred.
- Calendar/guest routing is English at this milestone; Milestone 15 adds equivalent LT/EN/DE routing/content. Existing notice translations are preserved.
- Incident investigation is read-only. No generic command-quarantine override, automatic refund dispatch, notification resend scheduler or unattended cancellation job is added.
- PostgreSQL access-counter/session/action retention cleanup, edge-specific rate limits, CSP nonce hardening and provider operational monitoring remain deployment/security-review considerations. Historical money/audit retention is not changed.
- Existing commercially unapproved nonpayment cancellation, live legal/registration review, provisional check-in time and other policy gates remain unchanged.

## Files and working tree

Created: the guest/admin/workspace routes and styles under `src/app/manage/`, `src/app/admin/`, `src/app/workspace/`; `src/app/api/access/[...action]/route.ts`; `src/db/schema/access.ts`; `src/server/access.ts`, `access-http.ts`, `admin-auth.ts`, `admin-management.ts`, `guest-management.ts`, `accommodation-management.ts`; `scripts/provision-admin.ts`; `tests/milestone14.test.ts`; four SQL migrations and matching snapshots; this report and the Impeccable surface/design documentation.

Modified: `README.md`, `.env.example`, `package.json`, `package-lock.json`, `next.config.ts`, `src/db/schema/booking.ts`, `src/db/schema/index.ts`, `src/server/balance-payment.ts`, `src/server/cancellation-authority.ts`, `src/server/sandbox-notification-worker.ts`, `tests/database.test.ts` (33-table baseline), and `drizzle/meta/_journal.json`.

The pre-existing modified `next-env.d.ts` and untracked root `ACCOMMODATION_MANAGEMENT_SPEC.md`, `owner-accommodation-management-docs-fixed.patch`, `owner-accommodation-management-docs.patch` are preserved without staging or edits. New milestone files remain untracked; existing milestone edits remain unstaged. No commit or push.

Independent verification:

```sh
git status --short
git diff --check
npm run typecheck
npm run lint
npm run db:check
npm run db:generate
npm test -- --reporter=dot
```

Tests require the existing local PostgreSQL development database and its reviewed migrations. Apply migrations with the separate migration identity; keep request handlers on `DATABASE_URL` using the restricted app role. `npm run build` may regenerate `next-env.d.ts`; use an isolated copy if that protected file must remain unchanged. Configure the dedicated access secret and test OIDC provider before manual administrator sign-in; never substitute public credentials or a development HTTP bypass.

## Final working-tree snapshot

```text
 M .env.example
 M README.md
 M drizzle/meta/_journal.json
 M next-env.d.ts
 M next.config.ts
 M package-lock.json
 M package.json
 M src/db/schema/booking.ts
 M src/db/schema/index.ts
 M src/server/balance-payment.ts
 M src/server/cancellation-authority.ts
 M src/server/sandbox-notification-worker.ts
 M tests/database.test.ts
?? .impeccable/design.json
?? .impeccable/surfaces/
?? ACCOMMODATION_MANAGEMENT_SPEC.md
?? DESIGN.md
?? docs/MILESTONE_14.md
?? drizzle/0029_access_management.sql
?? drizzle/0030_managed_claim_guards.sql
?? drizzle/0031_identity_lock_capability.sql
?? drizzle/0032_identity_authorization_guard.sql
?? drizzle/meta/0029_snapshot.json
?? drizzle/meta/0030_snapshot.json
?? drizzle/meta/0031_snapshot.json
?? drizzle/meta/0032_snapshot.json
?? owner-accommodation-management-docs-fixed.patch
?? owner-accommodation-management-docs.patch
?? scripts/provision-admin.ts
?? src/app/admin/
?? src/app/api/access/
?? src/app/manage/
?? src/app/workspace/
?? src/db/schema/access.ts
?? src/server/access-http.ts
?? src/server/access.ts
?? src/server/accommodation-management.ts
?? src/server/admin-auth.ts
?? src/server/admin-management.ts
?? src/server/guest-management.ts
?? tests/milestone14.test.ts
```
