# Stripe automation — Stage 2A foundation

Stage 2A implements configuration, authentication, an inactive orchestration contract,
an unavailable internal endpoint and a standalone isolated PostgreSQL template.
It does **not** implement or prove automatic payment reconciliation. Stage 2B/2C,
provisioning, provider operations and activation require independent review and approval.
Milestone 18 remains outside this change.

## Implemented configuration and authority

Configuration validation is pure and takes an explicit environment object. Imports do
not load environment files, construct clients, query PostgreSQL or contact Stripe.
Do not serialize the configuration object: it contains a credential digest. Public
responses contain only controlled status codes; inactive summaries contain fixed
lane names, an inactive reason and zero execution counters. Nothing logs credentials,
connection URLs, provider errors or request bodies.

Worker environment variables, by name only:

- `STRIPE_AUTOMATION_ENABLED`
- `STRIPE_AUTOMATION_ENVIRONMENT`
- `STRIPE_AUTOMATION_DEPLOYMENT`
- `STRIPE_AUTOMATION_SECRET`
- `STRIPE_AUTOMATION_DB_NAME`
- `STRIPE_AUTOMATION_DB_HOST`
- `STRIPE_AUTOMATION_DB_PORT`
- `STRIPE_AUTOMATION_DB_ROLE`
- `STRIPE_AUTOMATION_DB_SERVER_ADDRESS`
- `STRIPE_AUTOMATION_EXPECTED_ACCOUNT_ID`
- `DATABASE_URL`
- `NODE_ENV`
- `STRIPE_MODE`
- `STRIPE_LIVEMODE` (optional, must not indicate live mode)
- `STRIPE_SECRET_KEY`
- `STRIPE_ACCOUNT_ID`

Only explicit enablement is accepted; unset or explicit false is disabled, and other
values are invalid. Enabled validation permits only isolated development, local
deployment and development/test Node modes. Vercel environment markers are rejected,
including preview and production. Future hosted support requires a reviewed code
change, not an environment override. Unknown automation-prefixed switches are rejected.

The dedicated secret must contain 43–128 base64url characters and at least 16 distinct
characters. Generate it independently from a cryptographically secure random source;
format validation cannot establish entropy or prove independent generation. Known
secret/password/token/key variables cannot reuse its exact value, nor can the database
URL password. The bearer comparison hashes both values to equal-length SHA-256 digests
and uses `timingSafeEqual`. Guest/admin cookies and Stripe signatures grant no authority.

Worker configuration rejects migration/bootstrap credential variables and PostgreSQL
environment override variables. Do not pass a general development/provisioning
environment into a future worker. Migration access stays in a separate process.

## Exact target and identity guards

The only syntax-approved target is `zemaitija_stripe_automation_dev` on IPv4 loopback
at host port 55433 using `zemaitija_app`. These values must be explicitly configured
and match `DATABASE_URL`; there are no target defaults or arbitrary allowlist overrides.
The protected `zemaitija_dev`, other names, hosts, ports and roles are rejected.
URL options, fragments and alternate encodings of target names are not accepted.
The database password must be present and at least 32 characters long.

`verifyAutomationDatabaseIdentity` is a separately callable, read-only guard for a
future connected client. It revalidates the environment, then checks the actual
database, current and session roles, server IP, server port, PostgreSQL major version,
primary status, database owner and dangerous role attributes. It rejects missing or
ambiguous results and redacts query failures. The host-mapped port and actual server
port differ: the isolated container listens internally on 5432. The server IP must be
explicitly supplied and independently checked after approved provisioning; none is
discovered or trusted automatically. An IP/port check is not cryptographic cluster
identity, does not attest the container volume, and can become stale after recreation.
Future permissions/cluster-isolation verification remains an activation gate.

Stage 2A never calls this guard against a real connection. Tests supply fake rows only.
No claim is made that the configured database exists or that its privileges are correct.

Stripe validation accepts only test secret-key syntax, explicit test mode and matching
configured/expected account identifiers. **Key format and matching configuration do
not prove Stripe account ownership.** A separately authorized provider lookup and
continued test-mode/current-object checks are required before future processing.
Existing adapter/webhook validation remains authoritative and unchanged.

## Endpoint and hard inactive gate

`POST /api/internal/stripe-automation` uses Node.js and disables response caching.
It validates configuration, checks the dedicated bearer, then rejects query strings,
bodies and payload framing. There are no caller-controlled targets, accounts, limits
or processing options. Other HTTP methods have no processing handler.

- Disabled configuration: HTTP 503, `DISABLED`.
- Invalid configuration/internal failure: HTTP 503, generic `UNAVAILABLE`.
- Missing/incorrect authentication with valid configuration: HTTP 401, `UNAUTHORIZED`.
- Authenticated parameter overrides: HTTP 400, `REQUEST_PARAMETERS`.
- Valid configuration, authentication and empty request: HTTP 503, `STAGE_2A_INACTIVE`.

The endpoint imports no database pool, Stripe SDK gateway or existing financial
processor. It cannot construct those dependencies on either authorized or denied paths.
Environment variables alone cannot enable processing. There is no development bypass.

The orchestration foundation declares payment webhook, Checkout recovery, initial
reconciliation, balance reconciliation and deferred/investigation lanes. It exposes
small immutable future budgets, dependency-injection types and controlled failure
classification. It never accesses injected factories/processors and always returns
`INACTIVE`, `processingEnabled: false`, `NOT_EXECUTED` for every lane, and zero counters.
It does not inspect queues or imply they are empty. Budget enforcement for actual
processing does not exist yet; the declared values are future contract limits only.
Refunds, cancellations and notice delivery are excluded.

## Isolated PostgreSQL template — not provisioned

`docker-compose.stripe-automation.yml` is standalone, with a distinct project,
container, volume and localhost port. Do not merge it with the existing Compose file
or point it at the development volume. PostgreSQL is pinned to 17.6. Restart is off.
No migrations or seeds run at startup; the existing role bootstrap script is mounted
read-only and runs only under the image's normal fresh-data initialization mechanism.
Role names match existing migrations, but credentials must be independently generated.

Provisioning-only inputs, by name only:

- `AUTOMATION_BOOTSTRAP_PASSWORD`
- `AUTOMATION_APP_PASSWORD`
- `AUTOMATION_MIGRATION_PASSWORD`

Required protected-credential fingerprint inputs, by name only:

- `AUTOMATION_PROTECTED_BOOTSTRAP_PASSWORD_SHA256`
- `AUTOMATION_PROTECTED_APP_PASSWORD_SHA256`
- `AUTOMATION_PROTECTED_MIGRATION_PASSWORD_SHA256`

The template requires all isolated passwords, checks minimum lengths and pairwise
inequality, rejects obvious placeholders, and compares each isolated password's SHA-256
against all three required protected fingerprints before starting PostgreSQL. It does
not pass protected plaintext passwords into the container. Fingerprints must be 64
lowercase hexadecimal characters and must be independently obtained and reviewed
under separately approved provisioning authority; generating them is not part of
Stage 2A. Comparison values are removed from the server process environment. Treat
fingerprints as sensitive metadata, particularly for weak historical passwords. Docker
retains configured environment metadata, so restrict Docker access and never publish
resolved configuration or inspect output containing secrets. Checks cannot prove that
operator-supplied fingerprints are truthful or cover every historical secret;
independent credential generation and explicit review remain mandatory. Existing volume
contents are not attested by the template. Bootstrap scripts do not rerun against an
initialized volume; never infer that changed environment passwords rotate stored roles.

No Compose command, container/volume creation or database provisioning is authorized
by Stage 2A. After separate approval, first verify standalone project/volume identity,
port availability, credentials, target ownership and role permissions; apply the
complete migration chain through 0034 under migration authority, and initialize only
synthetic reference data. Any future migration requires separate Stage 2B review.
Do not copy bookings, events, attempts or smoke state from the protected database.

## Remaining Stage 2B work and activation gates

- Independently approve and provision isolation; verify actual connection targets and
  restricted permissions, including worker-versus-migration capability separation.
- Review worker identity choice: Stage 2A allows the migration-compatible application
  role only. A distinct least-privileged worker role requires an explicit grant design.
- Design and approve durable recovery scheduling, fairness, retry/backoff, scoped
  bounded inbox housekeeping, concurrency leases and runtime deadlines.
- Preserve existing financial/inventory constraints and safe provider retry boundaries.
- Verify Stripe account ownership after separate external-operation authorization.
- Implement eligible payment event filtering before claiming; existing inbox code also
  handles refunds, so invoking it indiscriminately would exceed this foundation's scope.
- Keep refund/charge events durable and observable. Deferral does not settle refund
  liability; bounded refund recovery and missing-webhook handling need separate work.
- Review actual scheduler/deployment limits, authenticated invocation, logs, queue age,
  last-run monitoring, owner and escalation. No scheduler template or service is activated.
- Replace the hard inactive gate only after approved implementation and verification.

## Remaining Stage 2C acceptance

After explicit approval, create fresh synthetic bookings and real sandbox Checkout
payments, ingest signed HTTP webhooks, and prove confirmation through the scheduled
entry point. The final verifier must only read evidence, not directly reconcile its
booking. Verify one allocation, consumed hold, transferred original claim, one logical
confirmation notice, duplicate/out-of-order safety, missed-webhook recovery, delayed
worker recovery, retry/stale-lease behaviour and investigation paths. Existing smoke
scripts and `stripe trigger` alone do not establish this lifecycle.

## Verification and rollback

Run only the focused foundation tests (fake database results, forbidden provider/client
imports, in-process Request/Response objects and static template inspection), TypeScript
with incremental writes disabled, targeted lint and diff/status checks. No test loads
`.env.local`, opens a listener, connects to PostgreSQL/Stripe or invokes Docker.
Template execution and operational integration remain unverified.

Rollback requires no data repair: keep automation disabled, remove the new route/modules
and template through a reviewed source change if needed, and retain existing records,
volumes and credentials untouched. Do not reset/clean unrelated work. Provisioned
resource cleanup, if later applicable, requires separate approval.
