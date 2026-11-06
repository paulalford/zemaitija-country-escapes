# Stage 2C-2 — isolated Stripe acceptance boundary

Baseline: `a4f4a22`. This checkpoint implements source and verifies deterministic
fake-dependent behavior only. It does not activate sandbox testing, a server,
Checkout, webhook delivery, a worker, a scheduler, or any existing route. No actual
database state is read or inferred from the baseline commit message.

## Scope and shared behavior

New files:

- `src/server/stripe-acceptance.ts`
- `src/server/stripe-acceptance-http.ts`
- `tests/stripe-acceptance.test.ts`
- `docs/STRIPE_ACCEPTANCE_STAGE_2C_2.md`

No existing source, schema, migration, journal, manifest, dependency or configuration
file changes. In particular, `src/db/client.ts` keeps its existing DATABASE_URL pool.
The public booking and Stripe webhook routes retain their shared pool and handlers.
The internal automation route still calls only the hard-inactive Stage 2A foundation.
No Next.js route imports the new acceptance modules.

The booking contract lives at `docs/BOOKING_PAYMENT_SPEC.md`; there is no root-level
`BOOKING_PAYMENT_SPEC.md`. PRODUCT.md and existing Stage 2A/2B contracts informed this
boundary. Existing synthetic-only terms, quote validation, idempotency, inventory
exclusion, integer EUR cents, Vilnius deadlines and financial authority are retained.

## Explicit invocation and environment

`createStripeAcceptanceBoundary` has no default pool, provider, transport, Docker
adapter or environment. It does not import `src/db/client`, load `.env.local`, read
private files or mutate process.env. The trusted host must supply all dependencies.

Initial authority must have stage `2C-2`, operation `booking-and-webhook`, a 16–80
character run ID, 16–100 character human approval reference, and a fixture guest UUID.
Run/reference characters are ASCII letters, digits, hyphens and underscores. A valid
constant-time bearer check is also required. Authority is host configuration, never
accepted from request JSON. An approval reference is an operator assertion, not an
independent authorisation system or proof that external approval occurred.

The dedicated environment is a strict allowlist:

| Keys | Conditions |
| --- | --- |
| NODE_ENV | `test` only |
| STRIPE_ACCEPTANCE_ENABLED | exactly `true`; absent/false disables |
| STRIPE_ACCEPTANCE_ENVIRONMENT / DEPLOYMENT | `isolated-development` / `local` |
| STRIPE_ACCEPTANCE_DATABASE_URL | explicit isolated application-role PostgreSQL URL |
| STRIPE_ACCEPTANCE_SECRET | dedicated bearer, 43–128 permitted characters with diversity check |
| STRIPE_ACCEPTANCE_EXPECTED_ACCOUNT_ID / STRIPE_ACCOUNT_ID | matching explicit test-account IDs |
| STRIPE_ACCEPTANCE_ORIGIN | canonical HTTP `127.0.0.1` origin with explicit port, no path/credentials |
| STRIPE_MODE / optional STRIPE_LIVEMODE | `test` / `false` |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET | explicit `sk_test_` / `whsec_` secrets |
| Optional PATH / HOME / LANG / LC_ALL | ordinary host-tool context only |

DATABASE_URL, migration/bootstrap credentials, PG overrides, NODE_OPTIONS, cloud flags
and all unknown keys are rejected. There is no fallback to shared credentials.
Never log this configuration object, raw exceptions, bearer tokens or connection URL.

## Database and provider sequence

1. Validate host authority, dedicated configuration and bearer before accessing
   dependency factories. Static wrong database/role/URL and live-key/account mismatch
   failures cannot create records or construct Stripe.
2. Attest the exact existing Stage 2B Docker target with the existing verifier.
   Resolve the actual current IP and compare it with the explicit URL; a private IP
   alone does not establish identity. The server module does not import a Docker
   socket adapter. The reader is a trusted host capability, not HTTP metadata.
3. Construct only an application-role pool for `zemaitija_stripe_automation_dev`.
   Every acquisition re-attests Docker and performs existing read-only PostgreSQL
   identity checks: actual/session `zemaitija_app`, owner `zemaitija_migrator`, exact
   address/port, version 170006, primary, restricted role flags and CREATE privileges.
   The existing recovery-capability/ACL guard runs in a read-only transaction before
   the connection becomes available to a domain operation.
4. Only after database preflight construct the injected gateway with explicit
   test-only Stripe configuration and transport. Check declared gateway account and
   its `verifyAccount()` evidence against the expected account before domain writes.
   A declared mismatch calls no provider method. Actual account verification requires
   a provider read in future real testing; current verification uses only the fake.
5. Recheck database identity and provider evidence before acceptance or ingestion;
   the private pool also checks each newly acquired connection before domain queries.
   Sessions/pools are private: callers receive operation methods, not arbitrary SQL
   callbacks, raw connections or migration credentials.

The target remains project `zemaitija-stripe-automation`, container
`zemaitija-stripe-automation-db`, PostgreSQL `postgres:17.6`, internal network
`zemaitija-stripe-automation-internal` and volume `zemaitija_stripe_automation_data`.
All existing mount, port, resource-ID and isolation checks are reused unchanged.
There is no new schema, grant, migration, seed, reset or fixture lifecycle.

## Booking, webhook and HTTP integration

The host-only `accept` method uses existing `acceptBooking` unchanged and binds its
fixture guest and `stage2c2:RUN_ID:` operation namespace. The existing service still
validates trusted synthetic guest state, commercial snapshot, acknowledgements,
quote freshness, transaction ownership and inventory. It creates no Stripe Session.
The fixture guest, inventory and tariff must already have separately reviewed
synthetic provenance; this boundary does not create or erase fixture data.

The unmounted `stripeAcceptanceHttp` factory proposes two POST paths:

- `/api/acceptance/booking`: service bearer, exact origin/path rules, bounded strict
  JSON, only stay/locale/operation/acknowledgement fields. Guest identity comes from
  host authority; the quote is generated server-side with existing `quoteStay` and
  revalidated by `acceptBooking`. No browser-supplied quote or guest ID is accepted.
- `/api/acceptance/stripe/webhook`: service bearer and original bounded raw bytes plus
  `stripe-signature` are passed to existing `ingestStripeWebhook`. Its signature
  verifier, live/account checks, deduplication and durable inbox remain authoritative.

The adapter rejects unknown paths (including automation), wrong methods, query
credentials, cross-origin input, oversized bodies and missing webhook signatures.
Responses are fixed non-sensitive summaries with no-store headers. A success means
the domain operation returned, not that a booking is paid. No Checkout dispatch or
payment transition is derived from return navigation.

This is a service-authenticated host acceptance adapter, not a replacement for public
guest authorization, cookies, origin/rate-limit rules or shared booking endpoints.
A future Stripe forwarding arrangement would need to preserve raw signed bytes and
signature while supplying the host bearer independently; Stripe delivery does not
itself supply this application bearer. Such a forwarder/listener is not implemented.

## Automation remains separate

`automationStatus` reuses the existing foundation and returns INACTIVE with
processingEnabled=false. The HTTP factory never calls the executing runner.

A future **host-only** `automation` method delegates to the existing
`runStripeAutomationVerification` and `automationRecoveryProcessors`, without a new
financial/reconciliation engine. It requires a separate `automation` authority for
the same run/guest with a different approval reference and bearer authentication.
The runner receives only freshly checked application-role pools, the verified test
gateway and explicit transport. Its existing budgets, identity/account guards,
leases and reconciliation remain authoritative. No caller invokes this method in
the application, no active endpoint is added and no scheduler is registered.

The deterministic test substitutes the runner and tests its wiring/authority; the
existing runner unit suite tests its behavior with fake resources. No real worker
or provider operation has been activated by these tests.

## Future activation gates — no authority granted here

Before any real sandbox testing, obtain separate review and explicit authorization
for the exact operations and independently reviewed host launcher/listener. Then:

1. Verify the isolated full migration/ledger baseline and retained synthetic history
   under separately authorized read-only checks, not migration credentials in the app.
2. Re-attest Docker, role privileges, application connectivity and the supported
   PostgreSQL version. Do not repair networking, grants or protected resources as a
   fallback. Never target `zemaitija_dev`.
3. Privately inject independent application and Stripe test credentials, expected
   account, webhook secret, bearer and exact loopback origin into a clean dedicated
   environment. Existing `.env.local` and shared routes must not be repurposed.
4. Review fixture ownership and operation IDs. Review all eligible existing queues
   before authorizing the host-only automation method: the existing runner is not a
   run-ID-filtered engine and may process other eligible enrolled synthetic work.
5. Separately approve account-read transport, test Checkout creation/retrieval and
   signed webhook forwarding as needed. Use existing StripeSdkGateway and its
   signature/account guards; injected capabilities remain trusted, not a hostile-code
   or OS network sandbox. No default transport is selected by this boundary.
6. Approve external supervision, evidence retention and the exact stop procedure.
   A flag, approval reference or passing deterministic test is not runtime acceptance.

## Rollback and remaining gaps

Stop accepting new requests and dispose the dedicated boundary to disable it; the
shared pool is unchanged. Removing this adapter does not reverse a committed booking,
payment, provider object or webhook. Preserve every existing synthetic financial
record, immutable snapshot/audit fact and idempotency key. No DELETE, truncate,
destructive migration, automatic refund or database reset is introduced.

Unknown COMMIT/provider outcomes require reconciliation, not automatic retry or a
claim of rollback. Cleanup failure after a successful domain operation returns
UNCERTAIN. Pool termination is cooperative and uses the existing pending-supervision
observer; settlement is awaited and a stalled driver still requires external
supervision. A disconnect is not proof that COMMIT failed.

Real Docker/SQL identity, credentials, schema permissions, account ownership,
cryptographic webhook signatures, Checkout lifecycle, concurrency and transport
failure behavior remain unverified in this checkpoint. Tests use synthetic
configuration, fake Docker/SQL/provider dependencies and unsigned synthetic bytes.
No actual signed Stripe webhook, provider call, database connection or infrastructure
operation is used. Shared-route runtime delegation and the inactive automation route
are checked by focused deterministic tests. No deployment or Git mutation is included.

## Verification record

178 deterministic tests passed across `stripe-acceptance`, `stripe-automation-foundation`,
`stripe-automation-runtime` and `stripe-recovery-enrollment`. Nonincremental TypeScript,
targeted ESLint with zero warnings, tracked whitespace and scoped whitespace checks
passed. Read-only diff checks against `a4f4a22` confirmed the shared client/routes,
booking/webhook services, automation runner/config/target and connection guards are
unchanged. Only the four new files listed above are part of this implementation;
the pre-existing next-env.d.ts change and unrelated untracked work were preserved.
No database, Stripe, infrastructure, deployment, Git staging, commit or push operation
was performed. Activation and real sandbox testing require separate review and authority.
