# Stage 2C-3B — Fresh-run profile and sealed manifest

Source-only contract. No provisioning, database connection, migration, fixture,
Stripe request, HTTP listener, worker or scheduler is implemented or authorised.
Baseline: a4f4a22 plus separately reviewed Stage 2C-2 preparation.

## Files and boundary

- `src/server/stripe-acceptance-run.ts`: pure validation, canonical hashing and
  immutable in-process seals. Imports only server-only, Node crypto/net, Zod and
  the nonsecret pinned migration JSON. No filesystem, process environment,
  database client, provider SDK, Docker adapter, execution callback or factory.
- `tests/stripe-acceptance-run.test.ts`: fake identities, explicit clocks and source
  bytes; reads only reviewed migration source files, never database state.
- This document.

The existing Stage 2C-2 boundary does **not** adopt this profile. Existing target
restrictions, shared database/routes, runner and inactive endpoint are unchanged.
A reference or seal is not independent proof of approval, a signed certificate,
live attestation or execution permission.

## Fixed profile and differences from Stage 2B-3C

Profile identifier: `stage-2c-fresh-pg17-v1`. For a lowercase UUIDv4 run ID, S is
that UUID without hyphens. Names are derived, never caller-selected overrides:

| Identity | Fixed rule |
| --- | --- |
| Compose project | `zec-acceptance-S` |
| Service / container | `acceptance-db` / `zec-acceptance-S-db` |
| Internal bridge network | `zec-acceptance-S-internal` |
| Persistent local volume | `zec_acceptance_S_data` |
| Database | `zec_acceptance_S` |
| Owner / application role | `zemaitija_migrator` / `zemaitija_app` |
| PostgreSQL major / exact server version | 17 / 170006 |
| Accepted image | `postgres:17.6`, plus exact approved `sha256:` image ID |
| Connection | Exact attested private IPv4, port 5432, no published ports |
| Schema baseline | public schema; full 36-entry chain through 0035 |

This fixes one fresh cluster per run. Container/network IDs and a persistent volume
UUID must match the approved manifest and trusted observations. The image ID is
pinned by the separately approved manifest hash; the tag alone is insufficient.
No image is pulled. The volume UUID is a future protected inventory/label identity,
not a Docker-native ID. Its provenance must be checked, not trusted from app input.

Unlike Stage 2B-3C, this profile derives new names per run, excludes old fixed names,
requires no published port and binds image ID and reuse inventory. The old fixed
initializer mount is not repurposed; a reviewed fresh initializer/mount contract
remains future work.

Reusable checks are Docker single-network/volume isolation, `ISOLATED_IDENTITY_SQL`
identity fields, application privilege prohibitions, 0035 capabilities and complete
ledger validation. Existing helpers pin the old target: do not make their protected
restrictions configurable to adopt this profile. This module only validates supplied
snapshots. Future live readers must independently populate and recheck them.

Database evidence requires current/session application role equality, migrator
ownership, primary server, exact endpoint/version, no superuser, CREATEDB,
CREATEROLE, replication, BYPASSRLS, memberships, database/schema CREATE or direct
recovery-metadata UPDATE. Recovery functions require the reviewed definer owner and
search_path, no public EXECUTE and valid guards. Inventory/financial constraints
and the complete ledger must be verified independently. Snapshot booleans are
trusted assertions, not SQL verification by this module.

## Manifest format

Version 1 is strict at every object level. Missing and unexpected fields fail.
The focused test fixture provides a complete synthetic format example.

| Field | Binding |
| --- | --- |
| `version`, `profileId` | 1 and exact profile identifier |
| `runId` | Lowercase UUIDv4; not previously reserved/used |
| `approvalReference` | `review:stage-2c:` then 16–80 lowercase letters/digits/hyphens, starting alphanumeric |
| `target` | Derived names, owner/role, container/network IDs, volume UUID, image/tag ID and endpoint |
| `sourceDigest`, `migrationDigest` | Lowercase 64-character SHA-256 hex |
| `stripe` | Test mode, one acct_ ID, registered we_ endpoint and `2026-08-26.dahlia` version |
| `operations` | Unique lexically sorted subset of the five names below |
| `issuedAt`, `notBefore`, `expiresAt` | Real canonical UTC instants with millisecond precision |
| `fixtures` | `stage2c:RUN_ID` namespace; distinct UUIDv4 guest, unit and booking-operation IDs |
| `budgets` | Invocation, item, provider-request and per-lane limits |

Operation names: `prepare-booking`, `dispatch-checkout`, `ingest-payment-webhook`,
`reconcile-payment`, `verify-read-only`. No migration, refund, provisioning or
scheduler-start operation exists. Listing an operation never activates it.

Maximum window and issue-to-start delay are each 30 minutes. Validation requires
issuedAt <= notBefore <= now < expiresAt. Invalid dates/offsets and missing
milliseconds reject, as does expiration exactly at now.

Caps: 30 invocations, 150 total items, 60 requests per invocation, 1,800 total
provider requests. Lane maxima: payment inbox 2, Checkout 1, initial reconciliation
1, balance reconciliation 1, deferred investigation 0. Executing lanes have positive
limits. Total items equals invocations times summed lane limits; total requests
equals invocations times per-invocation requests. These are proposed outer caps,
not active enforcement: existing transport counters are per scope. Aggregate budget
enforcement requires later wiring.

No passwords, URLs, bearers, signing secrets or API credentials are accepted.
Both test and live key fields are unexpected. Actual credential/account verification
remains a separate private preflight; this module never inspects credentials.

## Canonical bytes

Manifest bytes: UTF-8 canonical JSON, object keys sorted lexically, array order
preserved, JSON.stringify scalar encoding, no BOM, whitespace or final newline.
`runManifestDigest` hashes those exact bytes. Parse/reserialize comparison rejects
duplicate keys and alternative encodings. Digests use lowercase unprefixed SHA-256
hex; only image IDs use a `sha256:` prefix.

Artifact hashing uses unambiguous framing with decimal ASCII byte lengths:

```text
UTF8("zec-acceptance-" + KIND + "-v1\n")
for each file in strictly increasing ASCII repository-path order:
  UTF8(pathByteLength + ":") || UTF8(path) || UTF8(fileByteLength + ":") || rawFileBytes
```

KIND is source or migrations. No newline, Unicode or encoding normalization.
Duplicates, unsorted paths, traversal, empty segments and node_modules reject.
Allowed paths: source/tool/test/migration TS/TSX/MTS/MJS/JSON/SQL files and root
package.json, package-lock.json, tsconfig.json, vitest.config.mts. The module reads
no path itself.

The source artifact is the **complete exact path list in the independent review
record** and its reviewed bytes. A future launcher must package all runtime
transitive sources, tools, configuration and lock metadata, rejecting missing/extra
files, symlinks and unreviewed dependencies. No future host exists to enumerate yet.
Do not approve a partial subset as the complete runtime artifact. The test's single
synthetic source file exercises hashing only.

The migration artifact includes exactly 36 SQL files, drizzle/meta/_journal.json
and scripts/stripe-automation-migration-manifest.json. Beyond the approved aggregate
digest, validation requires raw manifest SHA-256
`c1ed48f3e7f730e641a98d8357e2e61e7a24b66da2c6ed26b21544d2f08d4abc`,
every pinned raw SQL hash and exact journal semantics/order. A replacement aggregate
approval cannot substitute a different chain. No migration is applied.

## Trusted launcher and seal lifecycle — outstanding

A later launcher must obtain the manifest and independent review record from a
fixed protected host-owned location outside repository/application write access.
Proposed root: `/var/lib/zec-acceptance/approved/RUN_ID/`. Verify owner, restrictive
modes, parent directories, regular-file type and no symlinks with descriptor-based
no-follow reads. No HTTP/env-selected path or fallback. Nothing is created here.

The independent record binds issuer `protected-host-review-v1`, approval reference,
run ID, manifest hash, source paths/hash and migration hash. A separately authorised
reviewer/controller must establish it. Deriving that record from the same untrusted
manifest defeats approval separation. This is not protection against hostile root
or code running with the same authority, and is not cryptographically signed.

Maintain a durable, complete inventory of reserved/used run IDs, resource names,
container/network IDs and persistent volume identities, retaining retirement
tombstones. Validation rejects intersection. `complete: true` asserts completeness
from the trusted inventory; the module does not discover it. Reserve atomically
before activation to prevent concurrent reuse. No inventory writer is implemented.

After separately approved provisioning/read-only checks, trusted readers must
collect Docker, database and Stripe snapshots. Fake snapshots prove only validation.
`independentCredentials: true` requires newly generated secrets and access controls,
not copying/comparing protected credentials. Actual PostgreSQL identity requires
an authorised connection: static validation must precede construction, then actual
authenticated identity must be reverified before domain access. No connection is
created in this checkpoint.

`sealAcceptanceRun` takes canonical text, explicit evidence and supplied bytes.
The result is detached, recursively frozen and registered in an internal WeakSet.
`requireSealedAcceptanceRun` rejects copies and JSON reconstruction. It checks seal
issuance, not continuing time/identity. Revalidate expiry, reservation, live target
and permission before every future operation. A seal is not a bearer credential;
never expose it over HTTP. Rejection messages contain one fixed code, no input values.

## Integration, approvals and rollback

Outstanding: launcher/review store/inventory, Docker metadata reader, initializer
contract, actual session/capability/ledger checks and aggregate budget enforcement.
Each needs separate source review. Separately approve new infrastructure, schema,
fixtures, Stripe account/API requests, signed webhook delivery, workers/scheduler
and final read-only verification. This checkpoint approves none of those operations.

Stage 2C-2 stays on its old target and must not run against preserved history.
Future wiring must explicitly adopt this separate profile, fix its prebuilt gateway
that ignores bounded runner transport, preserve signed raw bytes and event ownership,
and retain shared routes and the inactive endpoint. Removing this contract cannot
undo future commits/provider objects. Preserve evidence; never reset history as
rollback.

## Verification record

246 deterministic tests passed across stripe-acceptance-run, stripe-acceptance and
stripe-automation-foundation. Nonincremental TypeScript and targeted ESLint with
zero warnings passed. Tracked and new-file whitespace checks were clean. These
results establish source contract behavior only, not runtime target identity or
genuine Stripe acceptance. No database, Docker, credential, Stripe, provisioning,
activation, staging, commit or push operation was performed.
