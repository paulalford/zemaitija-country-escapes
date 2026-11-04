# Stage 2B-3C-1 — PostgreSQL integration hardening (source only)

Checkpoint result: **PARTIAL**. Source preparation and deterministic verification
are complete. PostgreSQL scenarios have not been executed. Genuine pre-0035 history
verification and actual transport-loss testing remain explicit acceptance gaps;
this checkpoint grants no execution authority. The commands below are proposals.

## Architecture and authority

The migration CLI now requires exactly:

```text
--acknowledge-stage-2b-3c-migrations RUN_ID --human-approval-reference REVIEW_REFERENCE
```

The exported migration executor also requires a review reference before accessing
any dependency. Run identifiers contain 16–80 ASCII letters/digits/underscores/hyphens;
references contain 16–100. The reference and acknowledgement record an operator's
assertion. **Neither verifies separate human approval or implements an independent
authorisation system.** A separately recorded human approval must precede each
migration invocation. Do not describe accepted arguments as external approval.
A trusted operator/host remains part of the security boundary. External enforcement
would require an independently controlled launcher/credential broker, outside this
source-only checkpoint; the current local process cannot prove that approval occurred.

Importing the migration, fixture and application entry modules performs no file,
Docker, credential, database or provider IO. No installation, startup, npm script,
Vitest hook or ordinary unit test invokes their live entries. No `.env.local`,
Drizzle CLI configuration, repository credentials or default connection is used.
The full journal, all 36 ordered SQL hashes through 0035, captured migration bytes,
exact-prefix ledger checks, migration advisory lock and independent post-apply ledger
observation remain intact. There is one apply attempt, with no automatic retry,
reset, rollback migration or inference that a lost acknowledgement means failure.
A full observed ledger is COMPLETED; a valid shorter prefix observed under the same
lock is INCOMPLETE; failed observation or lock acquisition is UNCERTAIN.

## Exact isolated target

Every process validates Docker metadata and each authenticated PostgreSQL session:

| Resource | Required value |
| --- | --- |
| Compose project | `zemaitija-stripe-automation` |
| Container / service | `zemaitija-stripe-automation-db` / `stripe-automation-db` |
| Image / SQL version | `postgres:17.6` / `170006` |
| Database / owner | `zemaitija_stripe_automation_dev` / `zemaitija_migrator` |
| Network | `zemaitija-stripe-automation-internal`, internal bridge, sole membership |
| Data volume | `zemaitija_stripe_automation_data` |
| Fixture / migration role | actual `zemaitija_migrator`, nonsuperuser, no memberships |
| Application role | actual `zemaitija_app`, no ownership, CREATE or migrator membership |
| Connection | freshly attested container address, port 5432; no URL query/fragment |

Existing checks for resource IDs, mount identity, initializer bind, privilege flags
and host port restrictions are preserved in the Docker/connection adapters. No
Docker adapter changes were needed. Nothing creates or repairs infrastructure.
`zemaitija_dev`, its credentials, `.env.local`, private fingerprints and protected
bookings/payment records are outside this workflow.

## Fixture process separation

Three explicit operating-system invocations replace the old callback harness:

1. `scripts/stripe-automation-fixtures.ts`, fixture-setup: only migration credentials.
   Requires the complete ledger and empty bookings/webhook tables in the isolated
   database. Takes the fixture session advisory lock before checking/writing.
2. `scripts/stripe-automation-postgres-acceptance.ts`, app-tests: only application
   credentials. Does not import the privileged fixture entry or migration executor.
   Holds the same advisory lock for the run, validates capabilities and fixture
   ownership, and rejects unrelated bookings or pre-existing webhook events.
3. Fixture entry, fixture-retain: separately acknowledged and approved retention
   verification using migration credentials. Never invoked automatically.

Each operation has its own exact `--acknowledge-stage-2b-3c-1-OPERATION` flag,
run ID and human approval reference. Missing/wrong gates reject before factories.
Cross-role environments reject before pool construction. The retired
`withIsolatedPostgres` API unconditionally throws `SEPARATE_FIXTURE_PROCESS_REQUIRED`,
without reading inputs or calling callbacks. There is no privileged rollback API,
caller-supplied fixture SQL, lifecycle callback or owner connection in the app context.

Fixed setup derives UUIDs and ownership markers from the run ID. It creates only
synthetic guest/catalog/tariff rows and a snapshot-free historical-shaped booking,
obligation and unenrolled payment attempt. Application scenarios use the actual
quote and acceptance services to create accepted synthetic bookings, with separate
dates on the run-owned unit. Existing domain guards and inventory exclusion remain.
No production seed helper is imported. There is no upsert or automatic retry.
Reusing a failed run or running a second setup in a populated database fails closed.

This separates process memory and credential delivery, not hostile same-UID code.
Tests and the host Docker adapter remain trusted source. A process with unrestricted
host/Docker privileges could obtain other credentials outside these APIs. Do not
claim an OS security sandbox, isolated UID/container, network firewall or hardened
credential broker has been implemented. No privileged secret object is sent to the
application process by this workflow.

## Executable acceptance matrix

`tests/stripe-automation-postgres.scenarios.ts` exports explicit executable
PostgreSQL cases; it is not an automatically discovered `.test.ts` suite. The app
entry is the only live launcher. Fixture preflight provides the privileged ledger
check; the migration entry provides the actual reviewed full-chain executor.

| Area | Prepared executable checks | Remaining acceptance limits |
| --- | --- | --- |
| Migration/schema | Full reviewed chain/ordered ledger through 0035 in fixture preflight; btree_gist, table/sequence ownership, app ACL/capability guard, deferred enrollment trigger flags | Actual chain application, migration lock contention/ledger bootstrap and transport-loss behavior require separately approved execution; no automated live fault injection for migration locks |
| Enrollment/history | Concurrent domain acceptance replay; atomic enrollment; deferred INSERT error at COMMIT rolls back both synthetic writes; historical attempt unchanged and app enrollment UPDATE forbidden | Snapshot-free fixture is created after 0035. It does not prove preservation across applying 0035 to genuine pre-0035 rows |
| Scheduling | Future due-time exclusion with older rows locked; two independent transactions claim different oldest due rows; second claim bypasses locked first row; wrong-owner/wrong-generation fencing; invalid generation SQL error; durable interrupted lease, real-time expiry, stale token rejection and reclaim generation; progress while another lease is held | Future-time check fails closed if its newly created row becomes due before observation. Lease expiry uses real PostgreSQL time (about two minutes), never privileged timestamp rewriting |
| Financial safety | Fake-session dispatch, injected real-transaction failure after payment INSERT and rollback; concurrent initial reconciliation yields one capture/allocation; duplicate provider identity SQL constraint; committed success survives a metadata acknowledgement error | Balance-payment concurrent settlement and separate duplicate-allocation constraint fault injection are not additional live cases in this checkpoint |
| Timeouts/cancellation | Real statement timeout 57014; real row lock timeout 55P03; backend cancellation of an observed running query, awaited rejection; destructive session/pool disposal | Own-role pg_cancel_backend and pg_stat_activity visibility require live verification; no server stop is inferred from timeout alone |
| Settlement | Actual COMMIT followed by injected reply loss uses the shared UNCERTAIN classifier; independent connection observes persisted version; fixture COMMIT uncertainty preserves evidence | Reply loss is synthetic, not an actual network partition; interrupting a real COMMIT still requires a supervised fault experiment |
| Historical webhook exclusion | Synthetic old refund event remains byte-for-byte unchanged after payment-only inbox processing; no provider invocation | Does not cover every historical webhook type or prove historical data migration behavior |
| Cleanup | Final app pool closure; deterministic normal/rejected/stalled shutdown, cancellation, partial outcomes and metadata failure tests; separate retention verification | Strict wall-clock cancellation and server-session termination are not guaranteed |

All PostgreSQL rows in these definitions are synthetic. No live case has been run.
The prepared suite is intentionally **not full Stage 2B-3C acceptance**. The gaps in
this table must be resolved/reviewed before claiming complete PostgreSQL acceptance.
Do not manufacture pre-migration history by disabling triggers, editing historical
SQL, resetting the database or reading/copying protected development data.

## Fake provider and financial boundaries

The injected fake is an in-memory gateway, with deterministic preconfigured session,
payment and event evidence, one-shot failure injection and per-method invocation
counters. It contains no SDK, key, fetch or transport. Application tests construct
only this gateway. The financial case invokes the domain's session dispatch against
that fake and expects exactly one fake createSession call. There is no real Checkout
Session, capture, charge, refund, settlement or provider network operation. No real
provider transport is supplied. This is source-enforced dependency injection, not an
OS-level network-denial policy. Production Stripe logic/account guards are unchanged.

## Failure preservation and runtime cleanup

Accepted bookings, snapshots and financial evidence cannot safely be deleted under
the existing immutable-history rules. The cleanup operation therefore verifies
run-derived IDs, guest markers and unenrolled historical ownership, and returns
EVIDENCE_RETAINED. It does not delete test bookings, release inventory or erase
financial history. Retained inventory is on the synthetic unit. Actual deletion or
replacement is not authorized here and requires a separately reviewed strategy.
Failure never triggers automatic privileged cleanup, fixture reset or a rerun.

`commitAcknowledgement` classifies a rejected/lost COMMIT reply as UNCERTAIN, with no
retry or rollback assertion. Fixture setup suppresses a post-COMMIT rollback attempt
and preserves committed/possibly committed evidence. Definite pre-commit failures
attempt rollback; uncertain cleanup also requires investigation.

`observePoolShutdown` emits PENDING_EXTERNAL_SUPERVISION after a one-second observation
grace, then keeps awaiting actual pool termination. SETTLED/FAILED refer to the pool
promise only, not proof of server transaction outcome. A throwing observer cannot
abandon settlement. Dedicated runtime pool close is idempotent, destroys tracked
clients, attempts end even if destructive release throws, and rejects new acquisition.
The runner accepts an observer; migration/fixture/app host CLIs emit a fixed nonsecret
pending-supervision message. Existing scope/query cancellation and server timeouts
remain. There is no misleading Promise.race returning a completed run while work
may continue. A stalled driver can still wait indefinitely; an external supervisor
must preserve output, inspect authenticated server sessions and decide intervention.
Process termination alone is not proof that a COMMIT failed. No automatic retry.

## Proposed future sequence — do not run at this checkpoint

Separate human approval is required for migration, setup, app tests and retention.
Review the source/manifest and each matrix gap first. Confirm Node 24 and Python 3
availability, the trusted local Docker daemon, fresh target identities, approved
credential provenance, access without network modification, timeout suitability,
and an external supervisor/evidence destination. Do not enable HTTP, workers or
schedulers. Do not use normal npm test discovery for live tests.

The explicit Node hook resolves repository-relative TypeScript imports. Node 24
`--experimental-transform-types` handles existing parameter properties; the
`react-server` condition satisfies server-only imports. No package/dependency or
application startup changes are needed. Python below is a proposed credential-input
launcher only, not application/server logic. It replaces itself with a clean Node
process, prompts privately, rejects insecure getpass fallback and never loads files.
Do not put secrets in arguments, shell history, command output or this document.

Define this proposed command in a trusted interactive host shell, after approval:

```bash
cd /home/paul/Portfolio/zemaitija-country-escapes
set +x
stage_command() {
  python3 - "$@" <<'PY'
import getpass, os, shutil, sys, warnings
warnings.simplefilter('error', getpass.GetPassWarning)
action, run_id, review = sys.argv[1:]
entries = {
    'migrate': ('scripts/stripe-automation-migrate.ts', '--acknowledge-stage-2b-3c-migrations', 'MIGRATION_DATABASE_URL'),
    'fixture-setup': ('scripts/stripe-automation-fixtures.ts', '--acknowledge-stage-2b-3c-1-fixture-setup', 'MIGRATION_DATABASE_URL'),
    'app-tests': ('scripts/stripe-automation-postgres-acceptance.ts', '--acknowledge-stage-2b-3c-1-app-tests', 'DATABASE_URL'),
    'fixture-retain': ('scripts/stripe-automation-fixtures.ts', '--acknowledge-stage-2b-3c-1-fixture-retain', 'MIGRATION_DATABASE_URL'),
}
script, flag, key = entries[action]
node = shutil.which('node')
if node is None:
    raise SystemExit('Approved Node 24 executable required')
url = getpass.getpass('Approved isolated role URL (hidden): ')
child_env = {'NODE_ENV': 'test', key: url}
os.execve(node, [node, '--experimental-transform-types', '--conditions=react-server',
    '--import', './scripts/lib/stripe-automation-typescript-loader.mjs', script,
    flag, run_id, '--human-approval-reference', review], child_env)
PY
}
```

Proposed exact invocations (replace review reference literals with the separately
recorded nonsecret approval references; all must be approved before execution):

```bash
stage_command migrate stage_2b_3c_1_run_0001 approved_migration_review_0001
# STOP on INCOMPLETE, UNCERTAIN, cleanup failure, missing report or process timeout.
# Independently inspect preserved evidence. Do not automatically rerun.
stage_command fixture-setup stage_2b_3c_1_run_0001 approved_fixture_review_0001
# Separate process: enter only the app URL; no migration credential is inherited.
stage_command app-tests stage_2b_3c_1_run_0001 approved_app_test_review_0001
# Only after separate approval and evidence review, including after failure:
stage_command fixture-retain stage_2b_3c_1_run_0001 approved_retention_review_0001
```

Each call replaces the Python process with Node; the shell launches each in a new
process. Capture nonsecret reports privately using an independently reviewed
supervision procedure. Real lease/due waits make the app suite take several minutes;
a supervisor timeout is an uncertain interruption, never a reason for an automatic
retry. No infrastructure mutation commands or credential-retrieval commands are
included. These proposals have not been launched or runtime-validated.

## Verification and scope

Only focused synthetic Vitest tests, nonincremental TypeScript, targeted ESLint,
whitespace/diff inspection and read-only Git status are permitted and performed.
Final results are recorded in the completion report. Existing Stage 2A/2B domain
services, state guards, payment constraints, recovery fences, historical exclusion
and inactive HTTP endpoint are preserved. No historical migration SQL, manifest,
journal, Docker configuration, credentials, Milestone 18 or product specifications
were changed by this checkpoint. Prior uncommitted/untracked work was preserved.

No database operations, migrations, Docker operations, Stripe calls, live worker or
scheduler activation, protected-resource changes, Git staging, commits or pushes.

## Changed files and verification record

Modified existing preparation sources:

- `scripts/stripe-automation-migrate.ts`
- `scripts/lib/stripe-automation-connection.ts`
- `src/server/stripe-automation-runtime.ts`
- `src/server/stripe-automation-runner.ts`
- `tests/helpers/stripe-automation-postgres.ts`
- `tests/stripe-automation-preparation.test.ts`

Created:

- `scripts/lib/stripe-automation-test-contract.ts`
- `scripts/lib/stripe-automation-transactions.ts`
- `scripts/lib/stripe-automation-typescript-loader.mjs`
- `scripts/stripe-automation-fixtures.ts`
- `scripts/stripe-automation-postgres-acceptance.ts`
- `src/server/automation-settlement.ts`
- `tests/helpers/stripe-automation-app.ts`
- `tests/stripe-automation-postgres.scenarios.ts`
- `tests/stripe-automation-hardening.test.ts`
- `docs/STRIPE_AUTOMATION_STAGE_2B_3C_1.md`

Deterministic verification: **220 tests passed across seven focused suites** with
`STRIPE_AUTOMATION_ENABLED=false`: hardening, preparation, runtime, domain recovery,
scheduling, enrollment and foundation. These use dependency traps/mocks for live pg,
Stripe, Docker and the shared application pool. No PostgreSQL scenario export was
invoked. TypeScript `--noEmit --incremental false`, targeted ESLint with
`--max-warnings 0`, tracked `git diff --check` and scoped untracked whitespace
inspection passed. No production build or full test discovery was run.

Scope limitations/deviations are the explicit matrix gaps, retained-evidence cleanup
instead of deletion, procedural rather than independently enforced human approval,
and the narrow Node 24 import hook plus proposed Python credential-input launcher.
These do not authorize relaxing a guard or execution gate. In particular, this
report does not claim that all requested PostgreSQL acceptance cases are complete.

Final Git status: all 11 pre-existing tracked modifications remain; all pre-existing
untracked work remains. The new/updated preparation files above are untracked because
the preceding preparation was already untracked. Nothing is staged. The full final
status observed at verification follows (directory entries are Git's normal collapsed
untracked output):

```text
 M drizzle/meta/_journal.json
 M next-env.d.ts
 M src/db/schema/payments.ts
 M src/server/balance-payment.ts
 M src/server/booking-acceptance.ts
 M src/server/checkout-worker.ts
 M src/server/payment-locks.ts
 M src/server/payment-reconciliation.ts
 M src/server/stripe-adapter.ts
 M src/server/stripe-webhooks.ts
 M tests/stripe-adapter.test.ts
?? .impeccable/build/
?? .impeccable/mocks/
?? ACCOMMODATION_MANAGEMENT_SPEC.md
?? docker-compose.stripe-automation.yml
?? docs/STRIPE_AUTOMATION_STAGE_2A.md
?? docs/STRIPE_AUTOMATION_STAGE_2B_2.md
?? docs/STRIPE_AUTOMATION_STAGE_2B_3B_PREREQUISITES.md
?? docs/STRIPE_AUTOMATION_STAGE_2B_3C_1.md
?? docs/STRIPE_AUTOMATION_STAGE_2B_3C_PREPARATION.md
?? docs/STRIPE_AUTOMATION_STAGE_2B_REVIEW.md
?? docs/proposals/
?? drizzle/0035_payment_recovery_schedule.sql
?? drizzle/meta/0035_snapshot.json
?? owner-accommodation-management-docs-fixed.patch
?? owner-accommodation-management-docs.patch
?? scripts/lib/
?? scripts/prepare-protected-db-fingerprints.ts
?? scripts/stripe-automation-fixtures.ts
?? scripts/stripe-automation-migrate.ts
?? scripts/stripe-automation-migration-manifest.json
?? scripts/stripe-automation-postgres-acceptance.ts
?? src/app/api/internal/
?? src/server/automation-settlement.ts
?? src/server/checkout-command-scheduling.ts
?? src/server/payment-recovery.ts
?? src/server/stripe-automation-config.ts
?? src/server/stripe-automation-recovery.ts
?? src/server/stripe-automation-runner.ts
?? src/server/stripe-automation-runtime.ts
?? src/server/stripe-automation-target.ts
?? src/server/stripe-automation.ts
?? tests/helpers/
?? tests/stripe-automation-foundation.test.ts
?? tests/stripe-automation-hardening.test.ts
?? tests/stripe-automation-postgres.scenarios.ts
?? tests/stripe-automation-preparation.test.ts
?? tests/stripe-automation-prerequisites.test.ts
?? tests/stripe-automation-runtime.test.ts
?? tests/stripe-recovery-domain.test.ts
?? tests/stripe-recovery-enrollment.test.ts
?? tests/stripe-recovery-scheduling.test.ts

```
