# Stage 2B-3C preparation — source only

This checkpoint prepares restricted connection guards, an inert migration entry and
an integration foundation. It authorizes no database access or mutation, migration,
fixture creation, Docker operation, provider call, worker, scheduler or deployment.
Independent source review and new execution authorization are required before use.
The Stage 2A HTTP endpoint remains hard-inactive and imports no executing core.

## Four separate boundaries

1. **Static configuration:** `stripeAutomationConfig` validates the existing local,
   test-account, exact-database and application-role contract. Legacy loopback syntax
   remains available to the inactive foundation; it cannot authorize executing the
   verification core. Direct connections require an in-process attestation object;
   neither an environment switch nor HTTP input can manufacture one. Application
   execution rejects migration/bootstrap credentials and unknown direct-worker env
   entries, including Node, PostgreSQL, Docker and Compose overrides.
2. **Host Docker attestation:** `hostDockerReader` uses the fixed local default
   Docker context and Unix socket with a clean child environment. It reads only
   bounded nonsecret metadata for the exact approved container/network/volume.
   It never reads `Config.Env`, credentials or `.env.local`. This adapter belongs
   in an explicitly approved host tool; do not give the web application Docker
   socket access. Dependency-injected readers are trusted host capabilities, never
   request parsers. Host Docker permission remains a separate execution prerequisite.
3. **PostgreSQL authentication and identity:** every tooling session is connected
   as its actual app or migration role and checked in `BEGIN READ ONLY` / `ROLLBACK`.
   It must match the attested server IP, port 5432, exact database, owner, version
   170006, session/current role, writable-primary identity and restricted role flags.
   App database/schema CREATE and migration membership are forbidden. `host()` is
   used for PostgreSQL inet output so `/32` formatting is not mistaken for drift.
4. **Stripe sandbox identity:** the existing configuration and account-verification
   boundary remains separate. The integration harness constructs only its own
   in-memory synthetic gateway and rejects external provider transport. It never
   constructs the SDK or uses a real key. Fake account evidence proves test behavior
   only, not ownership of a real Stripe account.

The approved Docker identities are `zemaitija-stripe-automation`,
`stripe-automation-db`, `zemaitija-stripe-automation-db`, `postgres:17.6`,
`zemaitija-stripe-automation-internal` (internal bridge), and
`zemaitija_stripe_automation_data` (independent local volume). The sole network,
container membership, data mount and exact read-only initializer bind are checked;
privileged execution, added capabilities and extra mounts are rejected. A private
IPv4 address alone is never sufficient. The address is obtained from Docker, bound
to container/network IDs, and rechecked before acquisition and worker lanes.
Address or resource-ID drift rejects the existing run. A new run needs a newly
verified attestation and matching explicit connection configuration.

An attestation is not a permanent identity certificate. These local mechanisms trust
the host, Docker daemon and injected host tool. They cannot defeat a hostile root or
same-UID process editing local source. No network settings or published ports change.
Port 55433 need not be published for the direct connection mode.

## Migration entry and evidence

`scripts/stripe-automation-migrate.ts` has no import-time file, Docker, database or
provider IO. The exported entry requires explicit operation authority. The future
CLI requires exactly `--approved-stage-2b-3c-migrations` and a run identifier (16–80
ASCII letters, digits, underscores or hyphens). That flag is an operator
acknowledgement, not proof of independent approval. Do not invoke it in this checkpoint.
There is no npm lifecycle, startup or default test command wired to this entry.

The future host launcher must support TypeScript imports and the `react-server`
condition for `server-only`. It must supply a clean explicit environment consisting
only of `NODE_ENV=test`, `MIGRATION_DATABASE_URL`, and optional PATH/HOME/LANG/LC_ALL.
The URL must name the actual `zemaitija_migrator`, the newly attested IP, port 5432
and `zemaitija_stripe_automation_dev`, with no query parameters or fragment. The
ordinary `drizzle.config.ts` is never imported, since it loads `.env.local`.
No credential is read from a file or default environment by the library API.
Credentials must be injected privately by a separately approved launcher.

The new reviewable manifest pins all 36 current migration SQL files, journal
ordering, tags and timestamps through 0035. No historical migration, 0035 or journal
is changed by this checkpoint. Source validation captures the checked SQL bytes;
the real installed Drizzle PostgreSQL dialect applies those captured statements and
maintains its real `drizzle.__drizzle_migrations` ledger. It does not re-read arbitrary
SQL after integrity verification or use the ordinary CLI configuration. The manifest
and this adapter need independent review before they become an execution baseline.

The migrator owns the database/schema, creates the migration ledger and objects, and
must retain its nonsuperuser identity. Existing `btree_gist` requirements remain part
of the original chain; no grant or extension change is implemented here. Migration
timeouts are bounded at statement 15 s, lock 5 s, idle transaction 1 s and transaction
120 s. No retry is automatic. Reassess these limits under separate execution review.

A database-specific session advisory lock serializes migration attempts. The existing
ledger must be an exact prefix of the reviewed chain before execution. Afterward a
new authenticated, attested session must acquire the same lock and validate the full
ledger. If the old backend is still completing COMMIT, lock failure preserves
`UNCERTAIN` rather than incorrectly asserting rollback. Reports distinguish:

- `COMPLETED`: the independently observed full ledger matches all 36 entries,
  including after a lost apply acknowledgement.
- `INCOMPLETE`: a valid shorter prefix was independently observed after acquiring
  the lock. This does not claim that no schema or ledger bootstrap object exists.
- `UNCERTAIN`: observation, attestation, locking or ledger validation failed. Preserve
  the database and investigate; never automatically retry/reset/down-migrate.

Drizzle creates the history schema/table before its pending-chain transaction; a
failed run can leave those bootstrap objects. Migration failure, process failure and
cleanup failure are not interchangeable. Query/pool settlement is cooperative;
there is no strict wall-clock completion promise. Existing Stage 2B rollback
limitations, enrollment guards and financial history protections remain authoritative.

## Integration foundation

`tests/helpers/stripe-automation-postgres.ts` is an explicitly invoked library, not a
test suite or a `beforeAll` hook. Without Stage 2B-3C integration operation authority
it touches no factory. Separate clean app/fixture environments reject cross-role
credentials; their passwords must differ. Setup verifies Docker, the complete real
migration ledger as migrator, app identity and the existing recovery capability/ACL
guard before giving a callback access. Setup invokes no provider method.

The harness supports independent real sessions (app pool maximum four), app and
migrator rollback scopes, statement/lock/transaction timeout configuration, tracked
session destruction and pool closure. The worker uses a dedicated maximum-one pool
whose newly acquired sessions receive Docker and SQL identity checks. Its injected
provider is always the synthetic in-memory gateway; network fetch throws. The
existing bounded runtime controls cancellation and connection disposal. The actual
HTTP endpoint remains inactive; worker-method invocation requires a separately
authorized integration callback and does not establish Stage 2C acceptance.

Explicit future fixture lifecycles receive the run ID and return immutable sets of
synthetic UUIDs. A successful case invokes its reviewed, ID-scoped cleanup and
cleanup assertion in a transaction. Rollback-only scopes always roll back. A failed
case or uncertain fixture/cleanup COMMIT preserves committed evidence and stops;
there is no global DELETE, TRUNCATE, database recreation or automatic retry.
Immutable financial evidence must be preserved by each concrete lifecycle, including
when a cleanup assertion defines retention rather than deletion. Actual fixture SQL
and suite scenarios remain future execution-review work, not implemented fixtures.

The case catalogue covers atomic/deferred enrollment, restricted permissions,
concurrent claims, fencing, retries/fairness, financial idempotency, rollback,
stale leases, timeouts, disconnect cleanup, historical preservation and target
enforcement. Pure assertion helpers support those future tests, but are not proof
of actual PostgreSQL behavior. No test in this checkpoint executes the catalogue
against a database. Historical enrollment/backfill fixtures require a separately
reviewed pre-0035 fixture strategy; never copy protected history or disable triggers
to manufacture it after migration.

## Deterministic verification and remaining review

Focused tests use fake Docker metadata, fake PostgreSQL sessions/ledgers, synthetic
passwords and fake provider evidence only. Dependency traps forbid live pg, Stripe,
Docker and the shared application pool. Coverage includes resource/endpoint drift,
unsupported versions and roles, clean-env restrictions, import-time inactivity,
missing/wrong execution authority, altered SQL/journal, ledger failures, lost
acknowledgements, lock uncertainty, independent sessions, rollback/disposal and
owned-fixture cleanup/preservation. Existing inactive-HTTP and recovery suites are
rerun without any live database tests.

Before migration or integration execution, independently review these changes,
the pinned manifest, launch environment, Docker access mechanism, concrete fixture
lifecycles and failure/preservation procedures. Re-attest the live resources and
credentials under new authority. This checkpoint supplies no runtime evidence about
the new adapter, migration dialect invocation, locking, SQL timeouts or fixture SQL.
No production build, schema command, database integration suite, Stripe operation,
worker, scheduler or Milestone 18 work is part of this preparation.

Checkpoint results: 210 deterministic tests passed across preparation, foundation,
runtime, enrollment, scheduling and domain suites, with
`STRIPE_AUTOMATION_ENABLED=false`. TypeScript (`--noEmit --incremental false`),
targeted ESLint, tracked whitespace checks and whitespace inspection of all 13 scoped
files passed. No actual integration suite or migration was invoked. The host harness
holds separate app/fixture configuration objects; this is checked connection and
environment authority, not a hostile-process memory sandbox. No production worker
process isolation or Docker access deployment is established by these tests.

Preservation inspection found no unrelated pre-existing file metadata changes against
the earlier checkpoint baseline except `.impeccable/hook.cache.json`, a tool-managed
cache. That cache was neither edited nor restored by this implementation. Existing
tracked changes and unrelated untracked work were preserved; nothing was staged,
committed or pushed.
