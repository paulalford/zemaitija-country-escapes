# Stage 2C — Consolidated Remediation C source review

**Verdict: NOT_READY. All B01–B20 remain OPEN.** Source-only launcher inspection,
read-only monitoring and observed shutdown contracts. No operational entry point,
service installation, listener, worker, scheduler or provider operation exists in
this package. Stop for independent source review. G2, G3, G4 and Milestone 18 remain
outside the authorised checkpoint.

## Exact checkpoint-owned files

Six new files; no pre-existing file was modified:

- [launcher](../src/server/stripe-acceptance-launcher.ts): disabled protected-loading/binding/revalidation foundation.
- [monitoring](../src/server/stripe-acceptance-monitoring.ts): independent service/process/lock observations composed with B's existing runner and collector inspectors.
- [shutdown](../src/server/stripe-acceptance-shutdown.ts): non-executable Linux Mint policy, existing persistence-interface aliases and observation-only process lifecycle fold.
- [fake adapters](../tests/helpers/stripe-acceptance-remediation-c-fixture.ts): protected descriptors, separately pinned records and joined budget/journal evidence in memory.
- [focused tests](../tests/stripe-acceptance-remediation-c.test.ts): 89 offline cases, including restart, uncertainty, shutdown and source-provenance regressions.
- This report.

The starting Git status was recorded before editing. Existing tracked changes to
PRODUCT.md, next-env.d.ts, stripe-automation-runtime.ts and
stripe-recovery-domain.test.ts, and every starting untracked entry, are preserved.
No repository-wide content/fingerprint scan was performed.

## Trusted launcher design and validation order

`inspectTrustedAcceptanceLauncher` accepts an issued fresh run, issued fixture plan,
a strict source-only request and injected read capabilities. The request contains
only mode, fixed profile and run ID. Targets, URLs, paths, approval references,
credentials, expiry changes, enablement switches and execution callbacks reject.
Both protected database identities remain excluded by the existing seal/profile
and observed-target checks. No shared pool fallback is introduced.

The approved manifest is the protected host configuration. The foundation reuses
`loadProtectedFreshIntegration` and its no-follow descriptor walk, root ownership,
non-writable parent, file mode/link/type, canonical JSON, bounded byte/path and raw
artifact checks. It neither constructs a filesystem adapter nor loads environment
or credential files. Supplied ports are fake adapters in this checkpoint.

The future construction sequence is expressed as data:

1. Load protected host configuration and complete reviewed artifact bytes.
2. Load independently controlled owner approval and bind exact run/artifact/profile.
3. Validate independently retained exclusive resource reservation.
4. Validate matching fresh Docker and PostgreSQL evidence, full pinned ledger and roles.
5. Establish journal and aggregate request-budget authority.
6. Establish exclusive fixed host and session-bound PostgreSQL lock ownership.
7. Verify test account/endpoint identity against previously budgeted account observations.
8. Bind the existing runner dependency descriptor and independent collector contracts.
9. Reload protected artifacts/approval, re-read B's complete authority chain and repeat monitoring immediately before returning the disabled inspection result.

Steps 3–8 delegate to accepted B contracts; financial authority is still decided
by the existing verifier. Reloaded protected review must equal the initially
reviewed record. Changed/revoked/expired authority, cancellation, missing identities,
lost locks, incomplete journal/budget evidence or later monitoring failure halts.
No revalidation step extends approval or grants a reusable capability.

Even the complete synthetic result is
`SOURCE_CONTRACTS_VALIDATED_BUT_DISABLED`, with `NOT_READY`, ready=false,
operationsEnabled=false, schedulingEnabled=false and
processorConstructionEnabled=false. No executable callback, command or client is
returned. This package assesses supplied future evidence; it is not the operational
pre-Checkout launcher. In the eventual separately approved implementation,
pre-execution collector **binding** and post-run financial **acceptance** must be
separate phases. A paid-booking verifier PASS cannot be a prerequisite for starting
its first approved Checkout. Synthetic evidence allows this source package to be
reviewed without introducing that operational dependency.

## Read-only monitoring and evidence independence

The monitor composes `inspectFreshRunnerBinding`, `collectAcceptanceEvidence` and
`inspectSupervisionSimulation`. Original reader objects/functions are checked
before wrapping them to retain detached snapshots. The wrapper cannot conceal a
shared reader or turn a status object into independent evidence. Existing B pins
and envelope/item checks remain authoritative.

An independently controlled monitor review additionally pins SERVICE, PROCESS and
LOCK_HISTORY packets and the exact B runner/collector review digests. It inherits
B's run/source/migration/target/window/capture provenance, strict reader shape,
completeness/uncertainty and fixed diagnostic rules. Cross-source identity/class,
staleness and end-of-inspection authority checks reject mixed or expired evidence.
Unissued input objects do not expose caller-injected resource fields in reports.
No raw error, credential or signing secret is returned.

The report covers:

| Observation | Meaning and fail-closed behavior |
| --- | --- |
| Identity/authority/artifacts | Sealed run and source identity, reviewed artifacts and current inspection authority; authorityValid never grants execution |
| Resources/service | Exact fresh target, dedicated unprivileged user/group, test-only credential metadata, disabled service/timer, cleanup/resource uncertainty |
| Locks | Fixed host key and database control key, original owner/backend/session, acquisition, continuity, release, contention/loss and original validity interval |
| Journal | Full accepted 3G replay, independently protected checkpoint, corruption or interrupted history; replay never resumes a worker |
| Budget | Aggregate charged requests including bootstrap, remaining run and current-invocation allowance, retained uncertainty and unverified accounting |
| Invocation/process | Observed invocation/deadline, cancellation, signal/exit/descendant/cleanup observations and overdue termination |
| Webhooks/investigations | Pending governed inbox rows, unresolved incidents and separately counted expected-safe unsupported-event investigations |
| Collectors/verifier | Available anchored channels, unchanged collector/verifier verdicts and final recorded-evidence availability; missing capture cannot become operational readiness |

Every supervised request must also match the aggregate ledger's request,
invocation, operation, outcome, dispatch/settlement and provider request identity.
The runner's journal sequence/head must equal the collector's protected checkpoint.
Overlapping evidence is joined, never added as if it were separate consumption.
The synthetic combined fixture explicitly retains 22 charged requests: 20
supervised requests, one bootstrap and one separately observed controller startup
account request. Original B fixtures tested different boundaries; simply combining
their old totals of two and twenty would undercount the run. C tests prove that
omission and conflicting head/receipt identity halt instead of being hidden.

Expected investigation safety remains unpaid and unconfirmed. Process exit,
cleanup, an HTTP admission receipt, a simulated PASS or finalVerifierReady never
permits payment processing. finalVerifierReady refers only to complete, currently
valid RECORDED evidence for independent review; global readiness stays NOT_READY.
The existing verifier's FAIL > INVESTIGATION_REQUIRED > INCOMPLETE > PASS precedence,
original financial captures and all row/inventory/notice invariants remain intact.

## Journal, budget and lock integration

`FutureAcceptancePersistence` names the existing DurableSupervisionStore,
AtomicEvidenceCell, ProtectedHeadPort, DurableProviderBudget and
FutureExclusiveLocks interfaces. These are type-only future seams. C accepts no
append, reserve, dispatch, fence, acquire, renew or release writer capability in its
monitor/launcher inspectors and introduces no competing journal/budget engine.

The established append/CAS protocols require original durable commit plus an
independently protected head acknowledgement. Conflicts dispatch nothing; unknown
commit/head acknowledgement fences persistent state. Corrupt/truncated/interrupted
history must be independently reconciled under new authority before any subsequent
invocation; there is no resume or automatic repair path.

The existing aggregate gate reserves atomically before dispatch and charges every
underlying HTTP attempt, including bootstrap/startup/worker identity checks and
hidden SDK attempts. KNOWN/NOT_STARTED are distinguished from uncertainty;
NOT_STARTED, UNCERTAIN, CANCELLED and TIMEOUT retain allowance. Unknown or unsettled
history blocks further requests across simulated restarts. Tests reconnect new
adapter instances to the same fake persisted cell/head and verify that allowances,
bootstrap exclusion, per-invocation exhaustion and fences survive.

Resource reservation is a separate host-controller CAS prerequisite, not an
execution lock. Host ownership is process lifetime; the PostgreSQL control lock is
bound to its original backend/session, not a recovery lease. C's RENEWED record
means a continuity observation of that SAME owner/key/session and original expiry,
not an implemented renewal or approval extension. Replacement, reacquisition after
release, contention, loss, expiry or a release before settled process cleanup halts.
Actual lock adapter loss must stop future admission and trigger the separately
approved external shutdown mechanism; C only reports that requirement.

## Shutdown and Linux Mint systemd contract

**NON-INSTALLABLE / NOT AUTHORISED.** No unit or timer files, ExecStart command,
installation script, service management call or executable launcher are supplied.
The policy is data, consistent with the existing 3G illustrative design:

| Policy | Required future behavior |
| --- | --- |
| Identity/type | Dedicated unprivileged zec-acceptance user/group; oneshot |
| Default state | Service disabled, timer disabled, timer persistence false, no installation authority |
| Inner bound | At most 60 seconds and no later than sealed run expiry |
| Cancellation | Stop admitting work; cooperative SIGTERM abort and observed settlement |
| Grace/hard bound | Five-second reviewed grace; require entire service cgroup termination by the earlier stop/deadline-derived hard boundary, with a 65-second overall ceiling |
| Restart | No automatic restart/reissue of uncertain financial operations |
| Recovery | Verify journal, aggregate budget and protected heads, resolve uncertainty and obtain appropriate new authority before another invocation |

`inspectAcceptanceShutdown` folds observed START/STOP_REQUIRED/SIGTERM/SIGKILL/
EXIT/CLEANUP records only. It never sends a signal, waits on a timer, starts a
process or changes storage. Missed deadlines, missing SIGTERM, overdue hard stop,
foreign cgroups, remaining descendants, unknown cleanup and late exit remain
visible even if later cleanup reports success. Financial outcome always stays
UNKNOWN; process death cannot establish rollback, non-payment or a refundable quota.

A real external monitor must enforce these bounds independently of a stalled
application. The 3G illustrative TimeoutStartSec/TimeoutStopSec comments cannot be
installed as proof of the combined wall-clock ceiling: version-specific oneshot
behavior, signal timing and descendant termination need separate Linux Mint review
and approved real fault evidence. In particular, beginning a five-second stop only
after a 65-second start timeout would not establish this policy's 65-second ceiling.

## Compatibility findings and precise remaining seams

| Contract | Source compatibility and required future approval |
| --- | --- |
| A atomic inbox handoff | Existing atomic plan/native identity/independent commit witness enters B collectors unchanged. Actual restricted admission/inbox/incident SQL functions and observer remain unconnected; separately approved schema/transaction integration required. |
| A original financial XID8 | Original capture and eight ordered effects remain mandatory. stageOriginalFinancialCapture must be installed inside the governed recordSuccess/withInitialLock transaction before its existing COMMIT, using actual generated rows/native XID8 and a separate committed-row observer. No financial SQL/algorithm/trigger change is made here. |
| A-1 investigation-only | Null inbox plus durable incident/independent witness is retained; expected safety is not paid-booking success. Conflicting delivery keeps the original inbox/digest, adds an incident and never creates another allocation. |
| B fresh runner | Reuses the fixed profile, issued review and all B authority/attestation/lock/dependency checks. Existing executable runner/config/target helpers still pin the protected old database and have broad scans; a separately approved exact fresh seam is still needed. No call to that runner is introduced. |
| B collectors | Reuses independent packet/envelope/item validation and final verifier. Original runtime-ID storage/capture, restricted actual readers, provider archive and protected independent pin controller remain outstanding. |
| 3G journal/budget | Reuses full replay, persistent CAS/head semantics and existing charged provider gate. Bootstrap is explicitly accounted in the aggregate ledger and does not masquerade as a 3G v1 provider operation. That v1 enum lacks BOOTSTRAP_ACCOUNT; a real operational adapter must preserve its separate approved G2 provenance and join overlapping invocation evidence without double-counting or dropping allowances. |
| 3H verifier | Strictly read-only, unchanged financial/state/notification checks and verdict ordering. Current in-window/retained review authority, authentic signatures/provider observations and complete genuine evidence remain required. |

An additional format seam is now explicit: `inspectAcceptanceHost` (3D) expects a
protected-host-review-v1 issuer/allowedOperations/ISO-window approval record, while
`loadProtectedFreshIntegration` expects fresh-integration-review-v1 with supplemental
binding, dependency-closure scope and numeric windows. Both name the same protected
reviews/RUN_ID.json location. They are not interchangeable JSON formats. C uses the
consolidated loader already used by B and keeps the 3D inspector detached. No
accepted format is rewritten or silently upgraded. Any future unified reader/path
version needs separate compatibility approval and migration of protected records.

No DDL is proposed or applied in C. The pinned 36 migrations, supplemental proposal,
A schema sketch and B runtime-capture storage proposal remain unchanged. Deployment
still needs original acceptance/financial capture seams, approved evidence storage
and least-privilege functions/roles, actual independent readers/head stores, fresh
resource/credential authority, coherent phase-specific observations, a reviewed
executable fresh runner seam and real external supervision/termination. No genuine
run or owner decision is fabricated by these source contracts.

## Verification and preservation

- **475 tests passed in six focused offline suites:** C 89, B 103, verifier 92, A 65, supervision 60 and forwarding 66.
- Nonincremental TypeScript: `tsc --noEmit --incremental false` passed.
- Targeted ESLint on all five added TypeScript files with zero warnings: passed.
- Tracked/new-file whitespace, documentation links/consistency and working-tree status checks: passed.
- Final Git status: four pre-existing tracked modifications and 69 untracked entries; exactly the six checkpoint-owned additions account for the status difference. Nothing staged, committed or pushed.

Only the six new files listed above were written. No credential-bearing file,
.env.local, backup, signing secret or token was read, hashed or inspected in C.
No repository-wide fingerprinting was performed. Explicit nonsecret source,
migration/proposal and documentation reads support the offline tests; they do not
apply SQL or access infrastructure. No PostgreSQL database, financial record,
Stripe API/resource, genuine webhook, Docker resource, systemd installation or
operational service was accessed. No OS locks, listener, operational worker,
scheduler, timer or background service was started.

Public routes, inactive automation endpoint, financial engines/recovery SQL,
constraints/triggers/migrations, prior accepted contracts, .impeccable content,
next-env.d.ts, accommodation work, proposals and owner patches remain unchanged.

## Open blockers and exact approval requirements

Historical [readiness](STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md),
[evidence](STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md) and
[runbook](STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md) remain unchanged, including
F01–F07, D01–D09, G0–G4 and every unchecked operational checklist item.

| Blocker | State | Remaining actual evidence/approval |
| --- | --- | --- |
| B01 trusted launcher | OPEN | Complete independent artifact/host review and separately approved operational entry, protected configuration and deployment |
| B02 owner authority | OPEN | Real independently controlled grant/revocation custody and attributable owner decisions |
| B03 complete artifacts | OPEN | Exact final transitive source/dependency package, protected reproducible bytes and independent closure review |
| B04 reservation | OPEN | Real atomic reservation, fsync/CAS contention and crash/reuse evidence |
| B05 PostgreSQL | OPEN | G2 provisioning, approved storage/DDL, least-privilege roles and actual constraint/ACL verification |
| B06 live attestation | OPEN | Approved actual restricted Docker/PostgreSQL identity and drift checks |
| B07 account/endpoint | OPEN | Accounted genuine test-account/endpoint verification under its separate bootstrap/execution grants |
| B08 atomic admission | OPEN | Approved atomic SQL/functions/observer and genuine durability/duplicate/conflict evidence |
| B09 original IDs/capture | OPEN | Actual synthetic booking and original transaction capture integration, protected native identities and monetary approval |
| B10 restricted readers | OPEN | Actual roles/adapters and denied-mutation acceptance on approved fresh resources |
| B11 durable journal/budget | OPEN | Real durable store/head/ack-loss/crash/restart proof and independently retained coherent histories |
| B12 exclusive locks | OPEN | Real host/session lifetime, contention/loss and correctly timed release/termination evidence |
| B13 aggregate allowance | OPEN | Actual lower-transport reservation/dispatch/settlement enforcement and complete budget joins |
| B14 restricted HTTP | OPEN | Separately approved host/routing deployment; nothing mounted here |
| B15 supervision | OPEN | Approved Linux Mint units/external monitor plus real descendant/timeout/shutdown evidence; no installation here |
| B16 fresh runner | OPEN | Separately reviewed fresh-profile executable seam and exact G3 scheduled/Checkout run |
| B17 evidence collection | OPEN | Original independently produced RECORDED captures, trusted archives/pins and genuine common-watermark observations |
| B18 credentials | OPEN | Owner-approved separated credential/signing custody, generation/access and endpoint association |
| B19 recovery/investigation | OPEN | Accountable incident procedure and separately approved controlled genuine failure/reconciliation evidence |
| B20 final go/no-go | OPEN | Independent source review now; attributable genuine five-scenario evidence and explicit G4 owner disposition later |

This checkpoint authorises source-only implementation and fake verification, not
G2 infrastructure/credentials/DDL/service installation, G3 monetary fixtures and
provider/runner/webhook activity, or G4 independent operational evidence review.
Each needs a concrete separately approved artifact, target/run, action set, window,
limits and responsible operator. Any change to accepted financial/storage/runner
contracts needs its exact source scope and independent review first. Git mutation
and Milestone 18 also require separate approval.

**NOT_READY. All 20 blockers OPEN. Stop for independent source review.**
