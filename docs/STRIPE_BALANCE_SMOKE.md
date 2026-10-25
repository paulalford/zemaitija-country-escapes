# Local Stripe sandbox balance smoke test

This opt-in runner is fixed to existing booking `566264cc-b0ca-4511-9434-6a26a0dabd8c`: total EUR 200.00, verified initial allocation EUR 60.00, scheduled balance EUR 140.00. It never creates a guest or booking. No schema or payment policy changes are required.

Early balance payment is explicitly covered by [acceptance scenario 3](BOOKING_ACCEPTANCE_SCENARIOS.md#3-full-balance-paid-before-due-date) and [the balance collection contract](BOOKING_PAYMENT_SPEC.md). The runner checks these local references before connecting.

## Local preparation

Run from the repository root with Node 24 and installed development dependencies. `tsx` is already provided by the locked development tooling. The CLI requires an interactive terminal and refuses redirected output, production/CI environments, live keys, remote database URLs, and migration-role database credentials.

Use the existing `.env.local` test configuration: restricted `DATABASE_URL` on localhost ending `_dev`, `STRIPE_SECRET_KEY=sk_test_...`, `STRIPE_ACCOUNT_ID`, `STRIPE_WEBHOOK_SECRET`, and loopback return URLs on port 3000. Set the independently checked expected account in your terminal:

```bash
export SMOKE_EXPECTED_STRIPE_ACCOUNT_ID='acct_YOUR_SANDBOX_ACCOUNT'
```

For signed webhook ingestion, run the existing application bound to loopback and the Stripe CLI listener in separate local terminals, authenticated to that same sandbox account:

```bash
npm run dev -- --hostname 127.0.0.1
stripe listen --forward-to http://127.0.0.1:3000/api/stripe/webhook
```

Configure the listener's signing secret in `.env.local` and restart the application if it changed. The existing endpoint verifies Stripe signatures. No public tunnel or new endpoint is needed. Return-page navigation is not payment evidence; the currently missing return page does not prevent terminal verification.

## Three explicit commands

PREFLIGHT performs read-only PostgreSQL inspection and a Stripe account GET. It creates no Stripe objects, database records, local state, or lock files. It requires exactly EUR 140.00 still outstanding, the intact original EUR 60.00 allocation and inventory claim, and no unresolved balance attempt. After START, use VERIFY rather than expecting fresh PREFLIGHT conditions to hold.

```bash
node --conditions=react-server --import=tsx scripts/stripe-balance-smoke.ts preflight --local-sandbox-only
```

START rechecks the booking, saves an inventory/financial baseline, requests the balance through the existing services, saves the original attempt and command IDs, and dispatches EUR 140.00 test-mode Checkout. The URL is printed only in the local terminal; it is not stored in the state file.

```bash
node --conditions=react-server --import=tsx scripts/stripe-balance-smoke.ts start --local-sandbox-only
```

Open that Checkout URL and complete the payment using Stripe sandbox card details. Repeated START resumes only the saved attempt/command. An uncertain create reuses the service's durable request/key within its safe retention window. An expired or failed original attempt never causes automatic replacement. If interrupted between database commit and saving IDs, the runner can adopt the single canonical attempt created after its saved intent. If local state is missing but an active attempt already exists, it stops.

VERIFY processes only matching signed inbox events, then reconciles through the existing balance service and checks all financial/inventory evidence.

```bash
node --conditions=react-server --import=tsx scripts/stripe-balance-smoke.ts verify --local-sandbox-only
```

`PASS` requires exactly one EUR 140.00 balance credit, EUR 200.00 total allocations, `PAID_IN_FULL`, zero outstanding, `CONFIRMED`, the unchanged original claim/holds, no duplicate financial effects, authoritative Stripe verification, and a matching processed signed **success** webhook. Paid ledger facts without a success webhook yield `PAYMENT_CONFIRMED_WEBHOOK_MISSING`. Unpaid or uncertain outcomes yield `PENDING`; terminal unpaid or inconsistent evidence yields `FAIL`. Exit codes are 0 for PASS/ready/preflight success, 2 for pending or missing-webhook outcomes, and 1 for failure. VERIFY is safe to repeat after delayed webhook delivery; it never creates Checkout.

## State and recovery

State lives exclusively in ignored `.local/stripe-balance-smoke/`, with private directory/file modes and atomic state replacement. It contains account/database identity, original attempt/command IDs, and fingerprints of the original booking, schedule, initial financial facts and inventory. It contains no API key, signing secret, or Checkout URL. Milestone 10's `.local/stripe-smoke/` is untouched.

A process lock prevents overlapping local runner invocations. A crash may leave `runner.lock`; inspect its PID and confirm the process is no longer running before removing only that lock. Preserve `state.json`. Never delete state to force a new collection.

The existing inbox worker has global expired-lease housekeeping even when called for one event. A runner-local pool facade adds the selected event ID to that one maintenance statement; financial processing still uses the unchanged services. No unrelated inbox events are processed or updated by this runner.

Preparation checks use fake evidence and mocked connection constructors only. Do not run genuine PREFLIGHT, START, or VERIFY as part of automated validation.
