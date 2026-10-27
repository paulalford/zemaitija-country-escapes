# M16-S01 — Checkout destination validation and recovery

Date: 27 October 2026. Codex investigation and local verification only; independent ChatGPT review remains pending. Scope: M16-S01 only. No production-code change, migration, commit, push or deployment.

## A. Specification requirements

- `docs/MILESTONE_16.md`, public boundary/security contracts: same-origin bounded POSTs, shared rate limits, browser-bound encrypted receipts, generation-based revocation, status/resumption restricted to the original initial attempt, and persisted Checkout destination validation.
- `docs/BOOKING_PAYMENT_SPEC.md` §§2, 4, 7: common inventory exclusion, stable original draft/attempt and provider key, persistence before returning a destination, and reconciliation before releasing uncertain inventory.
- `docs/MILESTONE_09.md`, acceptance/idempotency: one atomic booking/snapshot/hold/claim/initial attempt/command; repeated identical operation keys return the original IDs. PostgreSQL owns inventory exclusion.
- `docs/MILESTONE_10.md`, durable dispatch/recovery: persist exact request and stable provider idempotency key before POST; recover the original Session; uncertain outcomes retain inventory. Browser return navigation cannot credit payment.
- `docs/MILESTONE_04.md` §§3–4, 7 and `docs/MILESTONE_14_SECURITY_REVIEW.md`: server authority, scoped guest authorization, revocation, CSRF and rate limiting.
- Existing executable destination policy, `safeCheckoutUrl` in `src/server/public-booking-http.ts`: URL parsing must succeed; HTTPS, exact `checkout.stripe.com` hostname, no nondefault port, username or password. This investigation preserves that policy.

### Observed behavior

After durable acceptance, `publicBookingRequest` initializes the destination to the localized `/booking/return` path. Both `dispatchSessionCreate` and `safeCheckoutUrl` run inside the existing recovery `try/catch`. A rejected URL or parsing exception leaves that destination intact. The handler then seals the accepted booking's receipt into an HttpOnly cookie and returns HTTP 200. A malformed URL's native `TypeError` follows the same catch path as a policy rejection.

The worker persists a returned Session and its URL before returning `READY`; it can also return that stored URL on later calls. The public boundary revalidates either result every time. `resume` opens the receipt and checks the booking, guest, attempt and access generation before dispatching the receipt's original attempt. It never calls acceptance. Replaying acceptance uses the quote's original operation key.

## B. Implemented changes

Added only `tests/milestone16-checkout-recovery.test.ts` and this handover. All starting repository files remain byte-identical. No production correction was necessary.

The regression suite uses the actual HTTP handler, token logic, acceptance service, Checkout worker, rate limiter and PostgreSQL, including the restricted application role. Only the external Stripe gateway is replaced; unexpected provider operations throw. There are no network calls to Stripe.

Nine executed test cases:

1. Seven parameterized cases named `withholds %s and preserves one booking, attempt and claim through resume/replay`: HTTP URL; unrelated host; malformed URL; hostname suffix attack; username; password; nondefault port. Each verifies the safe localized return destination, authorized receipt, persisted unsafe URL, status access, resume, quote replay, unchanged database identities/counts, zero captures and only one provider-create call.
2. `returns a valid Stripe destination on acceptance and authorized resume without another provider POST`.
3. `enforces receipt authority, expiry, CSRF, revocation and rate limits after an invalid destination`: missing/other-browser/expired/modified/wrong-purpose receipts; mismatched booking/attempt; cross-origin POST; revocation blocking resume and quote replay; actual HTTP rate-limit enforcement. Database identities/counts remain unchanged.

The inventory assertions include all hold-linked claims, including released rows, and explicitly require no released claim. The initial result requires exactly one booking, original attempt, hold, claim and provider command, with zero payment captures; resume/replay must preserve those facts exactly.

## C. Verification evidence

Executed today, separate from yesterday's reported checks:

| Command | Result |
| --- | --- |
| `node /tmp/m16-s01-run.cjs test -- tests/milestone16-checkout-recovery.test.ts --reporter=verbose` | 9 passed, final regression source. |
| `node /tmp/m16-s01-run.cjs test -- --exclude tests/milestone16-checkout-recovery.test.ts --reporter=dot` | Existing suite: 322 passed, 16 files, including booking/payment recovery and security tests. |
| `npm run typecheck` | Passed. |
| `npx eslint tests/milestone16-checkout-recovery.test.ts` | Passed. |
| `git diff --check` | Passed. |
| SHA-256 comparison against the session-start manifest | All 337 starting nonignored repository files preserved, including all four protected files. |

The temporary wrapper loads local configuration without printing credentials, replaces **both** database URL paths with `zemaitija_m16_phase_b_20261026_dev`, and spawns npm. The new test file additionally refuses any migration database other than that exact localhost disposable database. No environment file was edited. Existing seed procedures and synthetic fixtures ran only there; no database was reset and no migration was applied. Localhost connectivity initially returned sandbox `EPERM`; the permitted rerun succeeded. The first focused run exposed an incorrect test expectation of HTTP 400 for `EXPIRED_QUOTE`; corrected it to the existing HTTP 409 contract. No production behavior was changed to satisfy a test.

Unsafe destinations were rejected on acceptance and again when read from storage on resume/replay. Recovery retained the original booking, guest and initial attempt, without extra inventory or payment work. Valid Stripe destinations remained functional. These are Codex's checks, not independent ChatGPT approval or an external Stripe browser/webhook round trip. No build was required for this test-only addition.

### Preservation and diff

Initial `git status --short` and a SHA-256 manifest were recorded before edits in `/tmp/m16-s01-start-status.txt` and `/tmp/m16-s01-start.json`. The starting tree already contained seven modified tracked files and substantial untracked Milestone 16/design work. Today's diff consists solely of the two newly added files above; the pre-existing tracked diff remains 7 files, 154 insertions and 11 deletions. New files remain untracked and do not appear in ordinary `git diff --stat`.

Protected files match their starting SHA-256 values:

| File | SHA-256 |
| --- | --- |
| `next-env.d.ts` | `0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc` |
| Root `ACCOMMODATION_MANAGEMENT_SPEC.md` | `ca18bf69b45a52007247f669742fbcd706af67a20d0ac32c9c274f61eb2a6187` |
| `owner-accommodation-management-docs-fixed.patch` | `2e13da7346654866d462981def2f31349b7790f4c2d8169ad066632c662bd0e7` |
| `owner-accommodation-management-docs.patch` | `feccd3d7ac5264d39f83e0c08e6c024572b8a2b3306c5102e15a261b249665bf` |

## D. Outstanding issues and approval

M16-S01 appears resolved by regression evidence: the existing implementation already meets the requested destination rejection and authorized recovery requirements. No production defect was demonstrated.

A persistently invalid provider URL remains unavailable on subsequent resume attempts; the fallback preserves authority and the original attempt but does not repair provider data or create a replacement. Existing reconciliation/operator procedures and receipt lifetime/revocation contracts still apply. No claim of a completed external Stripe integration or overall Milestone 16 approval is made.

Next checkpoint: independent ChatGPT review of M16-S01, then the remaining Milestone 16 visual and functional acceptance review. No Git mutation, deployment or next-milestone work is authorized or performed.
