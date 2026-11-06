# Stage 2C-3I — Evidence register

Source-development follow-up: [Consolidated Run 1](STRIPE_ACCEPTANCE_CONSOLIDATED_RUN_1.md).
This 3I document remains the historical review snapshot; the follow-up records
source fixes and remaining integration gaps. Operational readiness remains
**NOT_READY**, all 20 blockers remain OPEN and operational approvals remain gated.

**Readiness: NOT_READY.** This is a documentation-only register of inspected source,
repository reports and evidence gaps. It is not an owner approval, independent
ChatGPT sign-off, test rerun or operational acceptance report.

See the [readiness report](STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md) for capability,
requirements, B01–B20 blockers and F01–F07 findings, and the
[runbook](STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md) for future approval gates.

## Evidence classification and chain of attribution

| Class | Available evidence | Attribution/limits |
| --- | --- | --- |
| Specification | [AGENTS.md](../AGENTS.md), [PRODUCT.md](../PRODUCT.md), [booking/payment specification](BOOKING_PAYMENT_SPEC.md), [state machines](BOOKING_STATE_MACHINES.md), [Stage 2A](STRIPE_AUTOMATION_STAGE_2A.md), [Stage 2B review](STRIPE_AUTOMATION_STAGE_2B_REVIEW.md) | Repository requirements, not proof of their implementation or operating approval. PRODUCT's scaffolding/milestone statements are historical drift (F07). |
| Actual implementation | Source/test/DDL files listed below and selected baseline diffs | Inspected as text by Codex in 3I; no application/module/operational script was imported or executed. Source inspection is not an independent test rerun. |
| Historical deterministic results | Codex-reported verification sections in the Stage documents | Reported results only. No new Vitest, TypeScript, lint, build or integration execution in 3I. Test names/assertions were inspected; they are not new run results. |
| Source-checkpoint acceptance | Owner's current request identifies 2C-2 and 3B–3H as accepted source-only prerequisites | Accepted as task context. Detailed independently attributable ChatGPT review text, dispositions, signatures and approval identifiers are unavailable in the reviewed repository. Do not invent them or equate this Codex audit with them. |
| Historical PostgreSQL acceptance | Git baseline subject; retained-history preservation requirement; source-only Stage 2B-3C-1 report | Inconsistent level of reporting (F06). No protected database, retained execution bundle or live financial record inspected. Preserve the history; do not infer its contents or completeness. |
| Genuine Stage 2C evidence | None supplied in reviewed paths | No independent genuine Stripe test payment/signature/transport/lock/journal/cluster evidence supports activation. Synthetic fields and in-process review fakes are not external evidence. |

HEAD and requested baseline both resolve to `a4f4a22`, whose subject is
`feat: complete Stripe automation recovery and PostgreSQL acceptance`. The subject
is a repository label, not a run-level attestation. Stage 2C source files are still
untracked; a committed baseline does not contain an approved package of that work.
No Git mutation is performed. No separate Stage 2C-3A document was found in the
requested checkpoint set; this register does not invent an additional acceptance.

## Reviewed Stage 2C checkpoint ledger

The independent-review column in every row means **owner-described source-only
acceptance; detailed independent ChatGPT record unavailable**. This preserves the
stated prerequisite without claiming independently rerun tests or operational
approval. All reported totals overlap earlier suites and must not be added together.

| Checkpoint and report | Relevant actual source | Existing test evidence | Codex-reported deterministic result | Current source inspection and operational gap |
| --- | --- | --- | --- | --- |
| [2C-2](STRIPE_ACCEPTANCE_STAGE_2C_2.md) | [boundary](../src/server/stripe-acceptance.ts), [unmounted HTTP adapter](../src/server/stripe-acceptance-http.ts) | [acceptance tests](../tests/stripe-acceptance.test.ts), foundation/runtime/recovery-enrollment suites named in report | 178 tests across four suites; TypeScript/lint/whitespace reported passed | Boundary delegates existing domain logic and has separate host-only runner method. Actual guards target protected old cluster. No fresh-profile launch, listener or genuine acceptance. B01/B06/B14/B16; F03. |
| [2C-3B](STRIPE_ACCEPTANCE_STAGE_2C_3B.md) | [run/profile/seal](../src/server/stripe-acceptance-run.ts), [pinned migration manifest](../scripts/stripe-automation-migration-manifest.json) | [run tests](../tests/stripe-acceptance-run.test.ts), acceptance/foundation suites | 246 tests; TypeScript/lint/whitespace reported passed | Canonical manifest/source/migration checking and immutable in-process issuance exist. Resources and source closure remain supplied assertions; no durable reservation/live authority. B02–B06; F02. |
| [2C-3C](STRIPE_ACCEPTANCE_STAGE_2C_3C.md) | [boundary gateway wiring](../src/server/stripe-acceptance.ts), [bounded transport](../src/server/stripe-automation-runtime.ts), HTTP cleanup mapping | [transport tests](../tests/stripe-acceptance-transport.test.ts), runtime/foundation/recovery-domain/hardening and earlier acceptance tests | 325 tests; TypeScript/lint/whitespace reported passed | Fresh worker gateway receives supplied bounded transport; caller-aborted request rejects before underlying fetch. No actual network/SQL shutdown guarantee or aggregate gate. B11–B16. Historical 3B transport-defect text is superseded by this source correction. |
| [2C-3D](STRIPE_ACCEPTANCE_STAGE_2C_3D.md) | [host inspector](../src/server/stripe-acceptance-host.ts) | [host tests](../tests/stripe-acceptance-host.test.ts), run/transport/acceptance/foundation/runtime suites | 338 tests; TypeScript/lint/whitespace reported passed | Protected-location record schemas and validation order exist; every outcome has ready=false and operationsEnabled=false. No real protected readers/live attestation or resource reservation. B01–B07. |
| [2C-3E](STRIPE_ACCEPTANCE_STAGE_2C_3E.md) | [forwarding and admission contract](../src/server/stripe-acceptance-forwarding.ts) | [forwarding tests](../tests/stripe-acceptance-forwarding.test.ts), [fake forwarding fixture](../tests/helpers/stripe-acceptance-forwarding-fixture.ts), earlier host/run/transport/acceptance/foundation/runtime/recovery tests | 432 tests; TypeScript/lint/whitespace reported passed | Raw-byte/header and bounded forwarding logic exist, with atomic admission interface and no fallback store. No host, cryptographic genuine delivery, durable SQL admission/incident store or DDL. B07/B08/B14/B18; F02/F03. |
| [2C-3F](STRIPE_ACCEPTANCE_STAGE_2C_3F.md) | [planner](../src/server/stripe-acceptance-fixtures.ts), [status inspector](../src/server/stripe-acceptance-status.ts) | [scenario tests](../tests/stripe-acceptance-scenarios.test.ts), [synthetic helper](../tests/helpers/stripe-acceptance-scenario-fixture.ts), earlier eight suites named in report | 479 tests, including 47 scenario cases; TypeScript/lint/whitespace reported passed | Five plans use symbolic runtime IDs; writesEnabled=false. Status has injected restricted-read shape, not implementation. Original ID/commit mapping, monetary authority, writer/read roles absent operationally. B09/B10/B17; F01/F02/F04. |
| [2C-3G](STRIPE_ACCEPTANCE_STAGE_2C_3G.md) | [supervision contracts/model](../src/server/stripe-acceptance-supervision.ts) | [supervision tests](../tests/stripe-acceptance-supervision.test.ts), [simulated durable store/locks](../tests/helpers/stripe-supervision-store.ts), nine earlier suites named in report | 539 tests across ten suites, including 60 supervision cases; TypeScript/lint/whitespace reported passed | Ten simulated states and ordered journal/CAS/allowance contracts exist. Actual state stays DISABLED; no launcher, worker entry point, real lock/durable store/systemd installation/transport gate. B11–B15/B19; F05. |
| [2C-3H](STRIPE_ACCEPTANCE_STAGE_2C_3H.md) | [verifier](../src/server/stripe-acceptance-verifier.ts), [evidence schemas/readers](../src/server/stripe-acceptance-verifier-evidence.ts) | [verifier tests](../tests/stripe-acceptance-verifier.test.ts), [synthetic verifier helper](../tests/helpers/stripe-verifier-fixture.ts) and earlier ten suites | Report records 68 verifier cases plus 539 existing cases, 607 distinct tests across 11 suites; final verifier suite rerun after final refinement. Earlier batch was 606 before final additional case. TypeScript/lint/whitespace reported passed | Four verdicts, independent anchors and per-scenario checks exist; fakes synthesize all anchors/receipts. No independent collectors/readers or genuine bundle. F01 timestamp equality was not validated against real per-statement clocks. B10/B17/B20; F01/F04/F06. |

No row constitutes new verification of the reported test count. A comprehensive
review cannot turn inspected fake assertions into actual PostgreSQL concurrency,
durability, raw-signature validity, Stripe account ownership or systemd termination.

## Supporting implementation and preservation evidence

| Source | Inspected fact | Unavailable proof / remaining limit |
| --- | --- | --- |
| [booking acceptance](../src/server/booking-acceptance.ts) | Uses synthetic guest state, server re-quote/acknowledgement, stable operation key; generates its own booking/hold/claim/attempt/obligation/command IDs inside transaction | No approved fresh fixture writer or original binding recorder executed; independent transaction provenance not inferred |
| [payment reconciliation](../src/server/payment-reconciliation.ts) | Verified exact provider capture drives existing credit/allocation/claim transfer/confirmation/outbox; distinct clock_timestamp calls; late unallocatable capture retains liability | No capture read or reconciliation invoked; source timestamp mismatch with verifier remains F01 |
| [Checkout worker](../src/server/checkout-worker.ts), [submission gate](../src/server/checkout-command-scheduling.ts) | Original request/key/first-submission chronology, command lease/generation and safe-age checks precede dispatch | Fresh-target runner integration and independent actual dispatch receipts absent |
| [runner](../src/server/stripe-automation-runner.ts), [runtime](../src/server/stripe-automation-runtime.ts), [settlement](../src/server/automation-settlement.ts), [recovery](../src/server/payment-recovery.ts) | Separate finite lanes and cooperative scopes, bounded fetch/SQL, uncertain settlement and metadata generation fencing | No aggregate enforcement connection or external hard monitor; old target restrictions and broad enrolled scans remain |
| [public booking route](../src/app/api/booking/[action]/route.ts), [public webhook route](../src/app/api/stripe/webhook/route.ts), [shared client](../src/db/client.ts) | Shared application pathways remain separate from acceptance interfaces; selected Git baseline diff is empty | Not executed or connected; no claim about current database state |
| [internal route](../src/app/api/internal/stripe-automation/route.ts), [foundation](../src/server/stripe-automation.ts) | Hard-inactive implementation returns STAGE_2A_INACTIVE with no processor factory invocation | No operational route activation inferred from valid config/auth |
| [role bootstrap source](../db/init/01-roles.sh) | Source creates app/migrator roles and owner/usage/default read privileges from injected variables | Script inspected only; no actual credentials read or roles verified; new restricted-reader roles are not defined here |
| [0001 invariants](../drizzle/0001_invariants.sql), [allocation parent guards](../drizzle/0002_allocation_parent_guards.sql), [0018 capture guards](../drizzle/0018_stripe_initial_guards.sql), [0035 recovery](../drizzle/0035_payment_recovery_schedule.sql) | Common claim exclusion, unique financial/provider/outbox keys, immutable histories, deferred financial guards and restricted metadata recovery functions exist as source | No parsing/execution/ACL query or migration; new admission/journal/provenance schema not supplied by this chain |
| [booking schema](../src/db/schema/booking.ts), [payments schema](../src/db/schema/payments.ts), [operations schema](../src/db/schema/operations.ts) | Current relationships and evidence columns differ from the richer normalized 3H capture model | Missing capture history/transaction/lock/request fields cannot be invented as SQL columns or reconstructed from a paid flag |
| [Stage 2B-3C-1 report](STRIPE_AUTOMATION_STAGE_2B_3C_1.md), [preparation](STRIPE_AUTOMATION_STAGE_2B_3C_PREPARATION.md), [prepared scenarios](../tests/stripe-automation-postgres.scenarios.ts) | Prepared fake-provider/PostgreSQL acceptance procedures and retained-evidence strategy are documented; report says not executed | No actual run report resolving baseline subject versus documentation found; protected Stage 2B history remains out of access scope |

Source searches in reviewed `drizzle/`, `src/db/schema/` and `db/init/` found neither
`zec_acceptance_status_reader` nor `zec_acceptance_verifier_reader` role definitions
and no implemented Stage 3E/3G durable admission/journal schema. Absence from those
paths is not an assertion about an uninspected actual database or external deployment.

## Evidence needed to resolve activation blockers

Every status remains OPEN. This table indexes the objective completion requirements
in the readiness register; a closure needs both independent evidence and the relevant
explicit owner gate. Evidence collection itself is NOT AUTHORISED in 3I.

Dependency cross-references use the readiness register's corrected typed fields:
I (implementation), D (deployment), R (genuine-run observations) and A (final
acceptance). The former undifferentiated dependency lists are superseded; they must
not reintroduce B07↔B13, B12↔B15, B10↔B17 or B16→B10→B17→B16. Source development
under separately approved G1 may use deterministic synthetic evidence; no live
identity, successful real run or final verifier result is an I prerequisite.

| Blocker | Evidence required for resolution | Typed prerequisite reference / gate |
| --- | --- | --- |
| B01 | Reviewed trusted launcher artifact; protected path/descriptor/mode/identity rejection evidence on approved host | Readiness B01: I/D/R/A fields; G1 then G2 |
| B02 | Attributable owner scopes and independently controlled grant/revocation records bound to run/artifacts/resources/time | Readiness B02: I/D/R/A fields; G1/G2/G3 |
| B03 | Complete approved transitive path list and byte hashes; reproducible protected package actually used | Readiness B03: I/D/R/A fields; G1 and final artifact review |
| B04 | Atomic reservation contention/crash proof and complete resource-reuse tombstones | Readiness B04: I/D/R/A fields; G1/G2 |
| B05 | Exact fresh resource and ordered migration/approved supplemental ledger, effective ACLs and constraint/trigger evidence | Readiness B05: I/D/R/A fields; G1/G2 |
| B06 | Live restricted Docker metadata and authenticated PostgreSQL identity with drift/recreation rejection | Readiness B06: I/D/R/A fields; G1/G2 |
| B07 | Genuine authorised test-account and dedicated endpoint association, per-object test mode and accounted preflight | Readiness B07: I/D/R/A fields; G2/G3 |
| B08 | Real atomic admission/ownership/digest/incident durability and acknowledgement-loss/concurrency evidence | Readiness B08: I/D/R/A fields; G1/G2/G3 |
| B09 | Approved synthetic monetary plan, original actual IDs/claims/obligations and independently captured commit provenance | Readiness B09: I/D/R/A fields; G1/G3 |
| B10 | Restricted roles/grants, denied mutation/function access and complete consistent independently anchored query outputs | Readiness B10: I/D/R/A fields; G1/G2/G4 |
| B11 | Real durable append/head/budget atomicity, protected checkpoint, restart/corruption/unknown-commit fencing | Readiness B11: I/D/R/A fields; G1/G2 |
| B12 | Actual flock/session-lock contention, loss halt, process/descendant lifetime and controlled release | Readiness B12: I/D/R/A fields; G1/G2 |
| B13 | Every real underlying HTTP attempt mapped to durable allowance/outcome, including preflight and restarts | Readiness B13: I/D/R/A fields; G1/G3 |
| B14 | Restricted host/run/cluster routing, preserved raw signatures, wrong target/auth/redirect/body rejection | Readiness B14: I/D/R/A fields; G1/G2/G3 |
| B15 | Explicitly disabled host supervision plus demonstrated inner admission stop and bounded external descendant termination | Readiness B15: I/D/R/A fields; G1/G2; separate G3 enablement |
| B16 | Genuine original Checkout dispatch/recovery via fresh-target scheduled runner, no foreign scan or old-target access | Readiness B16: I/D/R/A fields; G1/G3 |
| B17 | Independent RECORDED snapshots/signature/provider/commit/launch receipts with protected source anchors and common watermark | Readiness B17: I/D/R/A fields; G1/G3/G4 |
| B18 | Independently generated, protected, separated secrets and registered endpoint binding; no secret disclosure in evidence | Readiness B18: I/D/R/A fields; G1/G2 |
| B19 | Approved accountable incident workflow and observed halt/retention/reconciliation behavior; no reset/blind retry | Readiness B19: I/D/R/A fields; G1 plus scoped G3/G4 incident authority |
| B20 | Attributable independent finding dispositions, complete genuine five-scenario evidence and owner operational go/no-go | Readiness B20: I/D/R/A fields; G4 |

An interface, fake durable flag, structural hash chain, synthetic protected-record
metadata or nonsecret approval reference cannot close any operational blocker.
The review may later accept a source implementation while leaving its live evidence
and deployment approval open; record those statuses separately.

## Consistency findings with evidence provenance

| Finding | Inspectable anchors | Status and limits of conclusion |
| --- | --- | --- |
| F01 | Verifier evaluateFixture timestamp equalities; financial observation/recordSuccess separate database clock calls; verifier helper uses shared confirmed instant | Source-level incompatibility identified by this Codex audit, not live reproduction or independent ChatGPT acceptance; no source repair authorised |
| F02 | 3B FRESH_ACCEPTANCE_PROFILE/verifyMigrations and 3E/3G/H missing persistent capabilities/roles | Supplemental schema/profile binding decision needed; no weakening or silently appended migration authorised |
| F03 | Old database literal/target guards, 3B fresh names, old adapter paths versus 3E run-specific path, runner global lanes | Known intentional separation that remains unintegrated; must not route acceptance to preserved old history |
| F04 | 3B 30-minute run window and WeakSet issuance; 3H validTime and grant containment/30-second freshness | Explicit verifier timing/reconstruction limitation, not permission for retrospective expiry bypass |
| F05 | 3G AUTHORITY stripeTestAccount requirement precedes lock acquisition and RESERVE; startup/worker reads require allowances | Operational bootstrap authority/accounting order is unimplemented; no outside-budget preflight implied |
| F06 | Baseline subject versus Stage 2B-3C-1 source-only text; owner prerequisite versus absent detailed review records | Historical operational and reviewer evidence unavailable in scope; no assertion of missing/damaged actual protected data |
| F07 | PRODUCT scaffolding statements; historical 3B transport warning versus 3C source correction | Historical documentation drift; keep earlier reports intact and do not treat superseded warnings as current fixes still missing |

## 3I verification record and evidence retention

This checkpoint performs only read-only source/document/test-text inspection,
Git HEAD/baseline/status and selected source diff inspection, content fingerprint
comparison, and consistency/link/Markdown/whitespace checks for the three new files.
Existing-source fingerprints cover 348 pre-existing source/evidence/configuration
files without reading environment files or secret stores. The preservation comparison
checks that those bytes remain unchanged. No test pass, owner acceptance date,
reviewer signature, live run ID or external approval identifier is created here.

Retain these reports as source-review evidence only, together with the pre-existing
working tree. Operational evidence, if separately authorised later, must retain its
original producer/record/hash/window/run links and incident history. Never overwrite
source-inspection reports with claimed live results, retroactively sign approvals,
erase uncertain outcomes or publish credentials/raw private evidence in Git.
