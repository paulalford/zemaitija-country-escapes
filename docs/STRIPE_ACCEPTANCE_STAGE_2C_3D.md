# Stage 2C-3D — Dedicated acceptance host foundation

Source-only inspection. This host never listens, connects, provisions or activates.

## Source-verified interfaces before adaptation

- `createStripeAcceptanceBoundary(env, authority, authorization, deps)` returns
  accept/quote/webhook/automationStatus/automation/close. Dependencies include pool,
  Docker reader, gateway factory and fetch. It pins the old Stage 2B database. The
  new host must not invoke it or mount `stripeAcceptanceHttp(env, authority, deps)`.
- `freshAcceptanceNames(runId)` derives the fixed fresh profile's resource names.
  `artifactDigest(kind, files)` hashes ordered path/raw-byte pairs; canonicalRunJson
  and runManifestDigest define canonical manifest integrity.
- `sealAcceptanceRun(text, evidence, sourceFiles, migrationFiles)` validates all
  supplied snapshots and returns a frozen in-process seal. It does no live IO.
  `requireSealedAcceptanceRun` checks issuance only, not durable approval or expiry.
- `attestIsolatedTarget(reader)` and refreshIsolatedTarget read Docker evidence for
  the old fixed target. `verifiedSession` checks actual authenticated identity in
  READ ONLY/ROLLBACK; verifyAutomationRecoveryCapabilities checks 0035 ACL/guards.
  They are not fresh-profile adapters and cannot be called for readiness here.
- `runStripeAutomationVerification(env, authorization, deps)` accepts database and
  Stripe factories, fetch and processors; it must not be invoked by this host.
- `boundedAutomationFetch(fetch, currentScope)` and AutomationScope enforce scope
  cancellation/request limits. Stage 2C-3C supplies this transport to a fresh worker
  gateway and bounds startup account verification. Aggregate request caps remain
  outstanding. StripeSdkGateway construction is also prohibited in this host.

The profile/seal, existing boundary, transport, runner, routes and financial engines
remain unchanged. Existing financial/booking requirements continue to govern future
execution: synthetic test data, EUR cents, Vilnius dates, provider evidence, stable
keys, inventory exclusion and no elapsed-time-only release.

## Host interface and trust model

The proposed `inspectAcceptanceHost(config, readers)` is a source-only evidence
inspector. Config contains NODE_ENV=test, mode=source-only, the exact fresh profile,
run UUID and requested operation names. It accepts no URL, address, credentials,
HTTP authority or approval object. Readers are trusted injected capabilities;
there are no defaults, real filesystem adapters or operational factories.

Separate readers supply protected manifest text, independent approval text,
inventory/reservation text, reviewed artifact bytes and recorded Docker/PostgreSQL/
Stripe attestations. A deterministic injected clock supplies time. The readers
must only read detached records: no live Docker, SQL or Stripe calls are permitted.

Future protected roots are fixed in source:

- `/var/lib/zec-acceptance/approved/RUN_ID/manifest.json`
- `/var/lib/zec-acceptance/reviews/RUN_ID.json`
- `/var/lib/zec-acceptance/inventory.json`
- `/var/lib/zec-acceptance/artifacts/SOURCE_DIGEST/`
- `/var/lib/zec-acceptance/attestations/RUN_ID/{docker,postgres,stripe}.json`

No paths are created or read on disk by this checkpoint. Future launcher adapters
must verify root ownership, restrictive file modes, protected parent directories,
regular single-link files, descriptor-based no-follow opening and no symlinks;
they must independently establish source closure/lock metadata. Injected metadata
assertions cannot prove those OS properties. The independent review store must be
controlled separately from the application and manifest author. Hostile root or
capabilities supplied by malicious same-authority code are outside this boundary.

## Validation order and readiness

1. Strict static configuration, then the fixed fresh profile.
2. Protected fixed-location manifest; strict versioned host parsing and derived
   target identities, followed by canonical source/migration integrity checks.
3. Independent protected review record: manifest/source/migration hashes, source
   path list, run/reference, exact allowed operations and current authority window.
4. Complete protected historical/foreign reservation inventory and an exclusive
   current-run record from a future durable atomic reservation authority.
5. Recorded Docker identity/isolation, PostgreSQL role/capabilities/ledger and
   Stripe test-account/endpoint evidence in that order.
6. Full unchanged Stage 2C-3B seal validation using actual recorded data; discard
   the seal and return pending live revalidation, never execution authority.

The host's strict static manifest parser intentionally mirrors the version-1 wire
shape so failures can be rejected before external evidence exists. The unchanged
seal validator remains the final combined check. Future contract versions must
review both parsers together; neither permits a target override.

States: REJECTED for invalid/failed/uncertain evidence;
PENDING_EXTERNAL_ATTESTATION for missing/unavailable external attestations or for
otherwise valid recorded evidence needing live revalidation. Every result has
ready=false and operationsEnabled=false. There is no READY state or activation API.

Attestation records bind the manifest hash and a current UTC window of at most
60 seconds. Approval, reservation and all collected record windows are checked
again after asynchronous reads. Artifacts are copied before later reads to prevent
in-process mutation of the verified byte snapshot. Records are bounded to 1 MiB,
the manifest to 16 KiB and the total supplied artifact to 32 MiB.

Diagnostics are fixed codes only: invalid configuration/profile, manifest integrity,
approval invalid/expired, resource collision, reservation missing, each external
attestation unavailable/mismatched, and cleanup/resource uncertainty. Unknown reader
results reject. Only the first blocking diagnostic is returned, bounding output.
No raw exception, user field, URL, credential, guest data or payload is returned.

An inventory snapshot is not a lock. A matching reservation record is only recorded
evidence; future operations require a durable atomic compare-and-reserve/revalidation
authority. History includes previously used resources and foreign reservations;
the one matching current reservation is represented separately. Never remove a
historical resource from collision detection to make a run pass. Reads reserve
nothing and cannot prevent concurrent races or prove ongoing exclusivity.

## Outstanding approvals and limitations

Still required: reviewed protected-file adapters, independent review-store control,
complete artifact packaging, durable atomic reservation controller, actual fresh
infrastructure and live Docker/SQL/account checks. Recorded checks need timestamp
and manifest-hash binding; they do not substitute for current authenticated sessions.
Later activation must revalidate all authority/target facts and enforce aggregate
budgets. Approval for this inspector authorises none of those operations.

No webhook forwarding, fixtures, HTTP mounting, scheduler integration, migration,
provisioning or genuine Stripe testing is included. Stopping inspection changes no
external state and cannot roll back earlier financial records or provider objects.

## Verification record

338 tests passed across acceptance-host, acceptance-run, acceptance-transport,
acceptance, automation-foundation and automation-runtime. Nonincremental TypeScript,
targeted ESLint with zero warnings, tracked whitespace and scoped new-file whitespace
checks passed. Tests use synthetic identities, clocks and in-memory readers; raw
migration source bytes are read solely to exercise the pinned integrity contract.
No database, Docker, Stripe, network, credential, listener, worker, scheduler,
migration, fixture, Git staging, commit or push operation was performed.

Only three new files belong to this checkpoint: this document,
src/server/stripe-acceptance-host.ts and tests/stripe-acceptance-host.test.ts.
Existing Stage 2C-2/3B/3C source, documentation and tests were not edited.
