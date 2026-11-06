# Milestone 19 Run 1 — Offline QA consolidation

2026-11-06 · Owner-authorized test/configuration/documentation package.
**Prepared for independent review. Milestone 19 is not accepted.** M17 is accepted
with recorded limitations; M18 is accepted at source level. Older handovers remain
historical records. **Stage 2C: NOT_READY; B01–B20 OPEN; automation inactive;
G2/G3/G4 uninitiated.** No Run 2 authority follows from this report.

## 1. Authority and inspected requirements

Read with AGENTS.md, PRODUCT.md, DESIGN.md, IMPLEMENTATION_PLAN M19, DECISIONS,
PROJECT_BRIEF, BOOKING_PAYMENT_SPEC, BOOKING_STATE_MACHINES,
BOOKING_ACCEPTANCE_SCENARIOS, ACCOMMODATION_MANAGEMENT_SPEC, M4/M14 security
contracts/review, M15–M18 and M16-S01 handovers, Stage 2C 3I readiness/evidence/runbook,
Consolidated Run 1 and remediation A/A-1/B/C source reports. The preceding read-only
M19 audit supplies the risk prioritization; this run checks actual suites/imports.
No external research, credential inspection or operational verification was used.

Integer EUR cents, Europe/Vilnius, immutable accepted snapshots, one inventory
exclusion domain, original command/claim ownership, provider-authoritative payment,
scoped guest/admin authority and evidence-supported cancellation remain unchanged.
No PHP, new framework, dependency, domain function or policy changes.

## 2. Acceptance matrix and evidence vocabulary

A = OFFLINE_SAFE: executed domain functions, synthetic query/provider adapters,
static source/SQL inspection or server-rendered HTML. This is not PostgreSQL,
provider acceptance or browser interaction. B = ISOLATED_DATABASE_APPROVAL_REQUIRED:
existing real PostgreSQL assertions inspected but not collected/executed here.
Browser = LOCAL_PREVIEW_APPROVAL_REQUIRED. C = EXTERNAL_PROVIDER_APPROVAL_REQUIRED:
genuine Stripe remains subject to the existing G2/G3/G4 sequence. NOT_AUTHORISED
includes protected databases, retained milestone targets, live payments, deployment,
public indexing, infrastructure/service activation and M20.

| Requirement | Acceptance and current disposition |
| --- | --- |
| Input, availability, occupancy, quote | A rejects malformed dates/counts/tickets and conserves cents; B must prove live constraints and catalog/rate reads. |
| Original acceptance/holds/claims | A exercises actual writer/reconciler with fakes; B proves rollback, uniqueness, exclusion and original transfer. |
| Concurrency and owner blocks | AM matrix below; independent PostgreSQL connections, bounded locks and no losing provider command required. No race proved from fakes. |
| Initial/balance/refund correctness | A preserves stable keys, allocations, unknown outcomes and presentation; B verifies SQL budgets/ledger/grants; C authenticates actual provider effects. |
| Authorization and token safety | A exercises real existing guards/HTTP with stubs, cookie/CSRF/input/redaction; B verifies revocation/role/session races. |
| Localization and restrictive SEO | A tests complete LT/EN/DE resources/models; Browser verifies actual rewritten responses/head/XML/headers. |
| Accessibility | Browser/Orca matrix is mandatory deferred evidence; no conformance claim. |
| Legal/privacy | Native-language editorial and qualified Lithuanian legal review remain separate acceptance dependencies. |
| Safe reproducibility | Default offline selection, rejected resource probes and prepared but disabled database config. |

## 3. All 34 booking acceptance scenarios

Test labels below are identifying fragments of real existing assertions, not claims
that a matching title alone proves every financial/audit/notification requirement.
Every B/C/Browser item remains unexecuted in this run. The offline matrix covers
selected source-level invariants, not all 34 scenarios end to end.

| # | Scenario | Existing/new assertion locations | Evidence class |
| ---: | --- | --- | --- |
| 1 | Normal 30% advance | M09 “atomically accepts advance cents…”; M10 “persists card-only exact request…”; recovery-domain “verifies capture and allocates once” | A+B |
| 2 | Short-notice full initial | M09 “recomputes full payment at D…”; M10 “marks a full-initial booking paid…”; quote-math exact-D checks | A+B |
| 3 | Full balance before due | M11 “collects a balance once…”; recovery-domain balance capture/replay | A+B |
| 4 | T–21 warning | M12 “respects exact warning…” and “queues short notice…”; quote-math eligibility | A+B |
| 5 | Unpaid at D | M12 exact boundaries; quote-math BALANCE_DUE at D without overdue | A+B |
| 6 | Grace starts after D | M12 boundaries; quote-math strictly-after-D overdue and 24 elapsed hours | A+B |
| 7 | Governed nonpayment cancellation | M12 “does not cancel without policy approval…” / “cancels only after terminal unpaid…” | B; commercial policy gate |
| 8 | Timely payment, delayed webhook | M12 “reconciles paid balance before release”; M11 sweep discovery without webhook | B; genuine recovery C |
| 9 | Free cancellation before D | M13 “cancels at D minus 1ms free…”; cancellation-math zero-charge settlement | A+B |
| 10 | Cancellation exactly at D | M13 “cancellation at D is pending…” and DST-boundary parameterization | B |
| 11 | Maximum justified late charge | M13 “enforces floor 30% ceiling…”; cancellation-math cap/net-loss checks | A+B |
| 12 | Reduced late charge | M13 “finalizes immutable assessments…”; cancellation-math 12000 paid / 5000 charge | A+B |
| 13 | Full-payment refund | M13 “allocates a single assessment obligation sequentially…”; cancellation-math 40000/8000/32000 | A+B |
| 14 | Rebooking lowers charge | M13 replacement/provenance and revision tests; cancellation-math saved-cost/recovery net | A+B |
| 15 | Provider cancellation | M13 “provider cancellation refunds 100%…”; M18 refund-pending presentation | A+B |
| 16 | Competing guest reservations | availability independent acquisitions; M09 “arbitrates overlapping guest requests” | B |
| 17 | Abandoned Checkout | M09 never-leased abandonment; M10 provider-terminal reconciliation; recovery-domain release | A+B |
| 18 | Session expiry | M10 uncertain expired Session remains blocking; recovery-domain requires retrieved evidence | A+B |
| 19 | Success after released hold | M10 “late capture as refund liability”; M13 incident/refund tests | B |
| 20 | Duplicate webhook | M10 signed event deduplication; recovery-domain bounded inbox; acceptance forwarding duplicates | A+B; genuine delivery C |
| 21 | Out-of-order webhook | M10 “processes out-of-order PaymentIntent and Session events…”; recovery-domain current-object reconciliation | A+B; genuine delivery C |
| 22 | Duplicate scheduler | M12 concurrent notice/cancellation cases; recovery-scheduling competing workers/lease fencing | A+B |
| 23 | Refund failure | M13 “records failed provider refund…” and liability retention; cancellation-math entitlement only | A+B |
| 24 | Email failure | M12 unknown send/transient/permanent failures; M13 localized notices without premature success | B; genuine transport separate |
| 25 | DST booking dates | quote-math literal civil dates/DST; M11/M12 spring/autumn integration assertions | A+B |
| 26 | Rounding | quote-math half-up advance, conserved remainder and bigint bounds; M15 exact display | A+B |
| 27 | Other guest booking | M14 cross-booking/session/scope cases; M18 and m19-security real guard with query stubs | A+B |
| 28 | Unauthorized admin/refund | M14 roles/MFA/unit/HTTP and revocation cases; m19-security requireUnit/requireFinance | A+B |
| 29 | Recovered open initial Session | M10 “recovers open unpaid…”; recovery-domain same original command/session | A+B |
| 30 | Unknown Session ≥24h | M10 aged submission / 24-hour replay cases; recovery-domain original scheduling/key fences | A+B |
| 31 | Unknown refund ≥24h | M13 “retains liability after unknown response…” and unknown-age quarantine | B |
| 32 | Delayed Session creation | M10 persisted provider creation/expiry; recovery-domain command/scheduling tests; acceptance-scenarios delayed original command | A+B; actual delayed provider C |
| 33 | Confirmation in [W,D) | M12 eligibility/late-warning and current-state suppression; noticeEligibility reads real W/D boundaries | A+B, partial combined evidence |
| 34 | Recovered open balance Session | M11 uncertain/terminal balance paths; recovery-domain balance keeps confirmed inventory | A+B |

The added `stripe-recovery-domain.test.ts` case “M19: accepts before D, confirms after
D…” calls actual acceptBooking, reconcileInitialAttempt and paymentPosition using
injected query replies. It verifies accepted 3000/7000 from total 10000, immutable
snapshot insertion once, original claim/hold/booking transfer arguments, one
capture/allocation despite replay, no create call, and OVERDUE/outstanding 7000 after
D. It does not execute SQL or establish atomic PostgreSQL behavior. Rendering of
accepted financial amounts is separately covered in M16/M18, not a fresh browser.

Partial or still missing combined acceptance evidence:
- Scenario 32 has source/fake dispatch timing coverage; fresh real DB proof of claim
  age versus provider creation and genuine delayed Session observations remain pending.
- Scenario 33 has W/D eligibility and scheduler assertions, but a single retained
  trace of initial confirmation inside [W,D), one prompt correctly worded warning,
  then suppression at D should be obtained in approved isolated integration QA.
- Late success after release without a competing new claimant needs explicit
  no-resurrection traceability in Run 2; competitor protection already has M10 tests.
- Actual database/provider financial results still require B/C as applicable. Mock verifier PASS
  never closes any Stage 2C blocker.

## 4. AM01–AM18 traceability

| Requirement | Assertion locations and scope | Evidence class |
| --- | --- | --- |
| AM01 | M14 AM01/AM02: private-use dates and exclusive departure | B |
| AM02 | M14 AM01/AM02: MAINTENANCE/OTHER, guest-safe projection; availability operator conflict | B |
| AM03 | M14 AM03: confirmed booking survives rejected block | B |
| AM04 | M14 AM04: aged reconciling hold stays blocking; guest hold cannot be released as operator block | B |
| AM05 | M14 AM05: independent connections and observed PostgreSQL blocking | B |
| AM06 | M14 AM06: block versus guest acceptance; losing transaction has no booking/provider command | B |
| AM07 | M14 AM07/AM09 and availability: adjacency/different units | B |
| AM08 | M14 AM08 and admin roles: finance/disabled/cross-unit rejection, durable audit; m19-security stub denials | A+B |
| AM09 | M14 AM07/AM09: concurrent same-key retry and changed-payload rejection | B |
| AM10 | M14 AM10: forced claim/audit failure rolls back block transaction | B |
| AM11 | M14 AM11/AM12: atomic repeated release, history retained | B |
| AM12 | M14 AM11/AM12 and AM04: no guest claim release | B |
| AM13 | M14 AM13: release versus two new claims, bounded contention | B |
| AM14 | M14 AM14: conflicting replacement rolls back original release | B |
| AM15 | M14 guest projection, cross-unit reads and AM01/AM02 redaction; public availability is boolean/reason only | B; browser privacy inspection pending |
| AM16 | M15 workspaces/calendar synthetic rendering, M18 source safeguards; browser matrix B12 | A, Browser pending |
| AM17 | M14 AM17/AM18 disable/config leaves operator claim; reference active tariff/snapshot immutability; M09 stale config | B, combined guest/ledger mutation case pending |
| AM18 | database single exclusion; M14 AM17/AM18; inherited payment/refund suites | B, full DB regression pending |

AM15 requires public and unauthorized-admin privacy evidence beyond authorized
calendar redaction. AM17's disable test protects a block claim; also retain explicit
before/after evidence for guest claims, ledgers and accepted snapshots after supported
configuration changes. Do not claim those combined cases solely from the AM17 title.

## 5. Exact suite inventory and import review

Default `npm test` and `npm run test:offline` now select the explicit offline config.
`npm run test:postgres` names the distinct preparation config, which always refuses
collection pending independent Run 2 preflight. No broad legacy npm test was run.

The allowlist is centralized in `tests/helpers/m19-suite-selection.ts`. Unknown or
nonallowlisted CLI paths/options reject before collection, including mixed selections.
A pre-resolution plugin also rejects imports of unreviewed test modules. Glob discovery,
watch, coverage, arbitrary setup/config and pool overrides are not admitted.

The static local import review conservatively followed 160 named files, including
type-only and mocked edges. It was not a repository fingerprint scan. Import/setup
review included the entire selected suites, their synthetic helpers, the source
modules they exercise, CLI entry checks and resource constructors. Important chains:

| Chain | Safety finding |
| --- | --- |
| M15–M18 -> presentation/routes | Service/session/db imports replaced with explicit synthetic fixtures before evaluation; no browser handlers executed by static rendering. |
| recovery-domain/enrollment -> actual writers/locks/reconciler | Pool types only; injected query replies, fake gateways, fake clocks; no default client. |
| acceptance -> run/trust/durable/handoff/collectors/verifier | Inert contracts and fake ports; forbidden operational imports and network traps retained. |
| automation preparation/hardening -> scripts/migrate/fixtures/application host | CLI main functions guarded by executable-entry checks; tests inject fake pools/Docker/migration ports. No command entry is launched. |
| prerequisites -> protected-fingerprint preparer | fs/promises wholly mocked; all credential strings and descriptor trees synthetic. No protected file exists/read through those fakes. |
| balance-smoke validation -> script | Explicit command/opt-in precede resource/config loading; tests use snapshot/query doubles. No smoke entry executed. |
| adapter -> stripe-adapter | SDK constructor/HTTP replaced with in-memory spies. |
| new signature suite -> Stripe static webhooks | Real SDK crypto, synthetic signing bytes, no client constructor/transport. |
| loader suite -> child process | Deferred entirely; it intentionally spawns Node and is outside this run's no-process boundary. |
| twelve DB suites -> seed/domain | Excluded before import. Each now calls m19DatabaseTarget before any pool construction, has no env-file read/application URL fallback, and retains actual DB assertions. |

Fresh per-suite results follow. These are overlapping with no other historical totals;
all are from this run, and their sum is the consolidated offline total.

| Included offline file | Fresh tests |
| --- | ---: |
| `tests/milestone15-calendar.test.tsx` | 6 |
| `tests/milestone15.test.tsx` | 46 |
| `tests/milestone16-presentation.test.tsx` | 10 |
| `tests/milestone16.test.ts` | 38 |
| `tests/milestone17.test.tsx` | 19 |
| `tests/milestone18.test.tsx` | 45 |
| `tests/stripe-acceptance-compatibility.test.ts` | 18 |
| `tests/stripe-acceptance-forwarding.test.ts` | 66 |
| `tests/stripe-acceptance-host.test.ts` | 56 |
| `tests/stripe-acceptance-integration.test.ts` | 125 |
| `tests/stripe-acceptance-remediation-a.test.ts` | 65 |
| `tests/stripe-acceptance-remediation-b.test.ts` | 103 |
| `tests/stripe-acceptance-remediation-c.test.ts` | 89 |
| `tests/stripe-acceptance-run.test.ts` | 97 |
| `tests/stripe-acceptance-scenarios.test.ts` | 47 |
| `tests/stripe-acceptance-supervision.test.ts` | 60 |
| `tests/stripe-acceptance-transport.test.ts` | 14 |
| `tests/stripe-acceptance-verifier.test.ts` | 92 |
| `tests/stripe-acceptance.test.ts` | 71 |
| `tests/stripe-adapter.test.ts` | 7 |
| `tests/stripe-automation-foundation.test.ts` | 79 |
| `tests/stripe-automation-hardening.test.ts` | 15 |
| `tests/stripe-automation-migration-diagnostics.test.ts` | 45 |
| `tests/stripe-automation-preparation.test.ts` | 56 |
| `tests/stripe-automation-prerequisites.test.ts` | 41 |
| `tests/stripe-automation-runtime.test.ts` | 21 |
| `tests/stripe-balance-smoke.test.ts` | 16 |
| `tests/stripe-recovery-domain.test.ts` | 29 |
| `tests/stripe-recovery-enrollment.test.ts` | 8 |
| `tests/stripe-recovery-scheduling.test.ts` | 15 |
| `tests/m19-test-safety.test.ts` | 65 |
| `tests/quote-math.test.ts` | 20 |
| `tests/cancellation-math.test.ts` | 15 |
| `tests/m19-security-boundaries.test.ts` | 19 |
| `tests/m19-webhook-signature.test.ts` | 5 |

Excluded before collection (`ISOLATED_DATABASE_APPROVAL_REQUIRED`):

- `tests/availability.test.ts`
- `tests/database.test.ts`
- `tests/milestone09.test.ts`
- `tests/milestone10.test.ts`
- `tests/milestone11.test.ts`
- `tests/milestone12.test.ts`
- `tests/milestone13.test.ts`
- `tests/milestone14.test.ts`
- `tests/milestone16-checkout-recovery.test.ts`
- `tests/milestone16-postgres.test.ts`
- `tests/quote.test.ts`
- `tests/reference.test.ts`

Deferred separately: `tests/stripe-automation-typescript-loader.test.ts` (subprocess).
Prepared `tests/stripe-automation-postgres.scenarios.ts` is not a Vitest suite and
remains outside discovery/authorization; no old host runner is repurposed.

## 6. Offline environment controls

- Verification starts with `env -i`, an explicit Node 24 PATH and NODE_ENV=test.
  No inherited operational values are read. Config also deletes nonessential
  environment keys without printing/reading their values; Vite envDir=false.
- Pool/Client, real Stripe construction and shared db/client are rejecting mocks.
  Reviewed individual suites may supply their established synthetic doubles.
- Socket/TLS/HTTP(S)/HTTP2/UDP/DNS operations and listeners reject before IO.
  Child-process calls, extra Workers, process.kill and loadEnvFile reject.
- Direct source/asset reads remain allowed; private env/credential/backup paths
  reject. Actual test-worker file writes and write-capable opens reject.
- Network/resource attempts are recorded; even a swallowed guard exception fails
  afterEach. The safety suite explicitly consumes only its intentional rejected probes.
- Vitest uses one isolated thread worker at a time, no coverage/watch/test-result
  cache; Vite cache root is /tmp/m19-run1/vite-cache; runner config loading avoids
  repository-local bundled config output. No snapshot generation or build.
- Guards are test controls, not an OS security sandbox. They depend on the explicit
  reviewed code/fixture set; arbitrary hostile code could replace globals or bypass
  JavaScript instrumentation. Filename exclusion alone is not the safety argument.

## 7. Future PostgreSQL boundary — preparation only

`m19-database-target.ts` validates strict target/approval objects with no connection
or default resource ports. Requires OWNER_APPROVED_RUN_2, a separately recorded
owner:m19:run2 reference, exact equal approved resource, <=4h approval window,
run/cluster UUIDs, 127.0.0.1 and port 55440–65535, derived never-reused database
`zemaitija_m19_<run UUID without hyphens>_dev`, distinct fixed migrator/runtime roles,
PostgreSQL 170006 and baseline-through-0035 profile. URLs must match every coordinate
and role, have separate decoded passwords and no query/hash/options. Errors are fixed
and redact all supplied values. Protected and retained names fail even if an approval
record contains them. No fallback to DATABASE_URL, MIGRATION_DATABASE_URL or pg defaults.

A supplied JSON record proves syntax/binding only. It cannot prove owner authority,
cluster freshness, schema contents, actual credentials or live session identity.
Therefore vitest.postgres.config.mts always refuses collection even after validation:
M19_RUN2_INDEPENDENT_RESOURCE_AND_SESSION_PREFLIGHT_REQUIRED. No runtime preflight,
provisioning/migration driver or connection wrapper is secretly supplied here.

Run 2 must authorize and implement that missing independent preflight first: actual
fresh resource identity and prior-use exclusions, pinned baseline ledger/constraints,
authenticated database/session/current roles, endpoint/server version/effective ACLs,
and exact isolated resource lifetime. Preserve separate migrator fixture setup and
runtime tests. Schema drift, target mismatch or missing proof prevents fixture work.
No Stage 2C supplemental SQL is authorized. Both zemaitija_dev and
zemaitija_stripe_automation_dev, their history/credentials/containers/volumes, and all
retained milestone databases remain excluded even for read-only acceptance checks.

Allowed future operations must be explicit: reviewed baseline setup, synthetic data,
existing test-owned mutations/faults, bounded queries/races; no provider transport.
Retain failed/uncertain commits, original keys/claims/ledgers and redacted diagnostics;
never infer rollback from a lost COMMIT reply, retry blindly, reset history or destroy
resources to obtain a pass. Cleanup/retention owner and expiration are approval inputs.

## 8. Changes and production scope

New configs: vitest.offline.config.mts, vitest.postgres.config.mts.
New helpers: m19-offline-safety.ts, m19-database-target.ts, m19-suite-selection.ts.
The third helper is justified by sharing a pure exact selection validator between
config and tests without importing an active Vite config in the test worker.
New focused suites: m19-test-safety, quote-math, cancellation-math,
m19-security-boundaries, m19-webhook-signature. New documentation: this report and
qa/M19_BROWSER_MATRIX.md.

Modified: package.json scripts; default vitest.config.mts; all twelve DB suites'
preconnection configuration only, except quote.test.ts also moves its existing five
pure calendar/money cases into quote-math.test.ts. Existing pure M11/M12 assertions
are retained as integrated-suite regressions. stripe-recovery-domain.test.ts receives
the combined D-boundary case using its existing transaction fixture; pre-existing
owner changes to that file remain intact.

No application/financial/authentication/UI/API services, migrations, SQL, accepted
policies, publication configuration, Stage 2C implementation/reports, design artifacts,
owner patches or dependencies are changed. No production defect was demonstrated.

## 9. Verification commands and outcomes

All commands used installed local binaries, not npx/downloaded tools. Prefix below
is exact (NO_COLOR is optional presentation data, not operational configuration):

```sh
env -i PATH=/home/paul/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin NODE_ENV=test NO_COLOR=1 ./node_modules/.bin/vitest run --config vitest.offline.config.mts --configLoader=runner --reporter=verbose
env -i PATH=/home/paul/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin NODE_ENV=test ./node_modules/.bin/tsc --noEmit --incremental false
```

Final fresh verification:

| Check | Result |
| --- | --- |
| Exact 35-suite offline run above | **1,523 passed, 35 files; zero failed/skipped suites**; 33.43 seconds. |
| Nonincremental TypeScript | Passed, no incremental artifact. |
| Targeted ESLint --no-cache --max-warnings 0 | Passed, zero errors/warnings. |
| Scoped tracked diff whitespace plus explicit new-file whitespace | Passed. |
| Mixed allowed+database selection | Expected exit 1, M19_OFFLINE_ARGUMENT_NOT_ALLOWLISTED before RUN/collection. |
| Mixed allowed+unknown selection | Expected exit 1, same fixed rejection before RUN/collection. |

Of the total, 124 cases are in the five new files: safety 65, quote-math 20
(including five moved existing cases), cancellation 15, security 19, signature 5.
One additional combined D-boundary case extends recovery-domain. Thus 120 newly
added cases plus five relocated cases are exercised alongside existing coverage.
No PostgreSQL, browser, genuine-provider or legal acceptance is included.

Exact additional commands (same clean environment prefix as above):

```sh
./node_modules/.bin/eslint --no-cache --max-warnings 0 vitest.config.mts vitest.offline.config.mts vitest.postgres.config.mts tests/helpers/m19-*.ts tests/m19-*.test.ts tests/quote-math.test.ts tests/cancellation-math.test.ts tests/stripe-recovery-domain.test.ts tests/availability.test.ts tests/database.test.ts tests/reference.test.ts tests/quote.test.ts tests/milestone09.test.ts tests/milestone10.test.ts tests/milestone11.test.ts tests/milestone12.test.ts tests/milestone13.test.ts tests/milestone14.test.ts tests/milestone16-postgres.test.ts tests/milestone16-checkout-recovery.test.ts
./node_modules/.bin/vitest run --config vitest.offline.config.mts --configLoader=runner tests/m19-test-safety.test.ts tests/database.test.ts
./node_modules/.bin/vitest run --config vitest.offline.config.mts --configLoader=runner tests/m19-test-safety.test.ts tests/unknown.test.ts
```

The last two are negative configuration probes only: no database/unknown suite was
collected or imported. Full logs remain local temporary artifacts under
/tmp/m19-run1; no secrets or genuine provider records were collected.

Initial harness verification truthfully retained: two six-suite collections and one
single-suite collection rejected all modules before tests because the resolver did
not normalize Vite's root-relative /tests/... identifiers. The plugin was corrected
without weakening the exact allowlist. A Vite envFile deprecation was replaced with
envDir:false. Then 150 tests / six focused suites passed; full offline run passed
1520 / 35; stronger Worker/file-write probes passed 1522 / 35. Initial tsc failures
were test-object ID narrowing and optional mock-call argument arrays; corrected only
test code. Initial lint had one unused fixture parameter warning; corrected.
Installed Stripe ESM sourcemaps refer to missing packaged source files and emit
warnings when inlined for crypto; no dependency was changed or warning relabelled a
failed assertion. No application/DB/provider failure was hidden by these corrections.

## 10. Fault injection and remaining evidence

| Fault | Fresh offline outcome |
| --- | --- |
| Unknown/mixed test path or unsafe CLI override | Rejected before suite collection. |
| Network/listener/process/Worker/env/private file/write probe | Guard throws before operation; intentional probes consumed; unexpected attempts fail teardown. |
| Protected/retained/mismatched target, role, URL, schema, approval, encoded-equal password | Pure fixed rejection; no connection constructed. |
| Raw signature tampering/staleness/wrong secret/missing signature | Actual SDK crypto/ingester rejects; query stub not called. |
| Missing/wrong scope/role/object/unit/MFA/one-use action | Existing guards deny; no session-use update; HTTP diagnostic/cookie/CSRF assertions pass. |
| Acceptance just before D, initial success after D, repeated reconciliation | Original split/claim retained, one allocation, overdue outstanding balance; injected SQL replies only. |
| Existing interrupted financial success/metadata completion, lease takeover, timeout/body failure, uncertain commit, duplicate/out-of-order event | Existing recovery/automation/acceptance suites pass with fakes; no genuine durability/concurrency claim. |

Still unexecuted: all actual PostgreSQL constraints, direct mutations, grants,
concurrency, locks/revocation races; full quote-to-browser recovery; emitted Next
HTTP/head/XML; browser zoom/reflow/contrast; Orca; actual OIDC/email; genuine Stripe
five-scenario acceptance and original independent capture/supervision evidence.
Do not sum older M15–M18/remediation totals with current results. F06 historical
Stage 2C provenance remains unavailable in this scope; no historical store inspected.

Priority is safe target/preflight, authorization/revocation and inventory/financial
races, then booking recovery and browser accessibility. Existing coverage is
substantial; missing runtime evidence is not itself proof of a production defect.

## 11. Run 2 approvals, accessibility, legal and publication

See [browser matrix](qa/M19_BROWSER_MATRIX.md) for exact isolated preview conditions.
Preview and PostgreSQL approvals are independent; unblock one without implicitly
approving the other. Genuine external-provider work is a third separate approval.
No preview, DB or provider operation is authorized by this documentation.

Native LT/EN/DE editorial and qualified Lithuanian legal reviews remain pending.
Controller/operator identity/contacts, lawful bases, recipients/transfers,
retention/deletion/rights, cookie/OSM suitability/disclosures and commercial
cancellation/refund/nonpayment/no-show details remain unresolved as in M18.
15:00 check-in and rates/fees/taxes/accessibility/property details remain provisional.
Do not change SYNTHETIC_TEST_TERMS_V1 or immutable accepted snapshots. No legal,
operating, certification, WCAG conformance or genuine payment acceptance claimed.
Approved canonical origin remains absent; sitemap empty and robots/noindex
restrictions remain. No production hostname/share image/indexing approval invented.

## 12. Preservation and final disposition

Initial status had 17 modified tracked files and 77 untracked entries, nothing staged.
Initial status and tracked diff were retained in /tmp/m19-run1 before edits. Only named
M19 files were written. Final status and scoped preservation checks follow below.
No repository-wide fingerprints, credential reads, SQL, PostgreSQL, Stripe, Docker,
systemd, external network, preview/listener/operational worker, installation, build,
Git staging/commit/push, deployment/indexing or M20 action occurred. Pure helpers and
in-memory orchestration use no operational services. Vitest's own worker thread is
local test infrastructure; additional worker creation rejects.

**Stop for independent review. M19 is not accepted. Stage 2C remains NOT_READY,
B01–B20 OPEN, automation inactive and G2/G3/G4 uninitiated.**

### Scoped preservation verification

Final Git status: **31 modified tracked files, 89 untracked entries, nothing staged**.
All 94 initial status entries remain. The fifteen M19-modified tracked files are
package.json, vitest.config.mts, the twelve database suites listed above and
stripe-recovery-domain.test.ts. Twelve new files comprise the two configs, three
helpers, five suites and two documents. The directory-collapsed docs/qa entry counts
as one untracked status entry.

All 16 unrelated pre-existing tracked diffs exactly match the initial retained
patch. The already-dirty recovery-domain test was reconstructed in memory from
HEAD plus the initial diff; removing only the added M19 imports/mock/test restores
that exact initial source. This verifies preservation of its prior owner changes.
Initial untracked entries were retained; their full byte identity was not audited
by a forbidden repository-wide fingerprint scan. No script wrote those files.
New files and the permitted tracked changes were checked explicitly for whitespace.

Final `git status --short` (directory-collapsed inventory):

```text
 M PRODUCT.md
 M next-env.d.ts
 M next.config.ts
 M package.json
 M src/app/accommodations/[slug]/page.tsx
 M src/app/accommodations/page.tsx
 M src/app/booking/return/page.tsx
 M src/app/booking/stay-form.tsx
 M src/app/experiences/page.tsx
 M src/app/explore/page.tsx
 M src/app/layout.tsx
 M src/app/page.tsx
 M src/app/public-ui/shell.tsx
 M src/app/public-ui/timber.css
 M src/i18n/catalog.ts
 M src/i18n/routing.ts
 M src/server/stripe-automation-runtime.ts
 M tests/availability.test.ts
 M tests/database.test.ts
 M tests/milestone09.test.ts
 M tests/milestone10.test.ts
 M tests/milestone11.test.ts
 M tests/milestone12.test.ts
 M tests/milestone13.test.ts
 M tests/milestone14.test.ts
 M tests/milestone16-checkout-recovery.test.ts
 M tests/milestone16-postgres.test.ts
 M tests/quote.test.ts
 M tests/reference.test.ts
 M tests/stripe-recovery-domain.test.ts
 M vitest.config.mts
?? .impeccable/build/
?? .impeccable/mocks/
?? ACCOMMODATION_MANAGEMENT_SPEC.md
?? docs/MILESTONE_18.md
?? docs/MILESTONE_19.md
?? docs/STRIPE_ACCEPTANCE_CONSOLIDATED_RUN_1.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A_1.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_B.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_C.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_2.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3B.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3C.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3D.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3E.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3F.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3G.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3H.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md
?? docs/STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md
?? docs/proposals/
?? docs/qa/
?? owner-accommodation-management-docs-fixed.patch
?? owner-accommodation-management-docs.patch
?? src/app/privacy/
?? src/app/robots.ts
?? src/app/sitemap.ts
?? src/app/terms/
?? src/i18n/content/legal.ts
?? src/i18n/publication.ts
?? src/server/stripe-acceptance-atomic-handoff.ts
?? src/server/stripe-acceptance-capture-provenance.ts
?? src/server/stripe-acceptance-collectors.ts
?? src/server/stripe-acceptance-durable.ts
?? src/server/stripe-acceptance-evidence-adapters.ts
?? src/server/stripe-acceptance-financial-capture.ts
?? src/server/stripe-acceptance-financial-evidence.ts
?? src/server/stripe-acceptance-fixtures.ts
?? src/server/stripe-acceptance-forwarding.ts
?? src/server/stripe-acceptance-fresh-database.ts
?? src/server/stripe-acceptance-fresh-runner.ts
?? src/server/stripe-acceptance-handoff-evidence.ts
?? src/server/stripe-acceptance-host.ts
?? src/server/stripe-acceptance-http.ts
?? src/server/stripe-acceptance-integration.ts
?? src/server/stripe-acceptance-launcher.ts
?? src/server/stripe-acceptance-monitoring.ts
?? src/server/stripe-acceptance-run.ts
?? src/server/stripe-acceptance-shutdown.ts
?? src/server/stripe-acceptance-status.ts
?? src/server/stripe-acceptance-supervision.ts
?? src/server/stripe-acceptance-trust.ts
?? src/server/stripe-acceptance-verifier-evidence.ts
?? src/server/stripe-acceptance-verifier.ts
?? src/server/stripe-acceptance.ts
?? tests/cancellation-math.test.ts
?? tests/helpers/m19-database-target.ts
?? tests/helpers/m19-offline-safety.ts
?? tests/helpers/m19-suite-selection.ts
?? tests/helpers/stripe-acceptance-forwarding-fixture.ts
?? tests/helpers/stripe-acceptance-integration-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-b-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-c-fixture.ts
?? tests/helpers/stripe-acceptance-remediation-fixture.ts
?? tests/helpers/stripe-acceptance-scenario-fixture.ts
?? tests/helpers/stripe-supervision-store.ts
?? tests/helpers/stripe-verifier-fixture.ts
?? tests/m19-security-boundaries.test.ts
?? tests/m19-test-safety.test.ts
?? tests/m19-webhook-signature.test.ts
?? tests/milestone18.test.tsx
?? tests/quote-math.test.ts
?? tests/stripe-acceptance-compatibility.test.ts
?? tests/stripe-acceptance-forwarding.test.ts
?? tests/stripe-acceptance-host.test.ts
?? tests/stripe-acceptance-integration.test.ts
?? tests/stripe-acceptance-remediation-a.test.ts
?? tests/stripe-acceptance-remediation-b.test.ts
?? tests/stripe-acceptance-remediation-c.test.ts
?? tests/stripe-acceptance-run.test.ts
?? tests/stripe-acceptance-scenarios.test.ts
?? tests/stripe-acceptance-supervision.test.ts
?? tests/stripe-acceptance-transport.test.ts
?? tests/stripe-acceptance-verifier.test.ts
?? tests/stripe-acceptance.test.ts
?? vitest.offline.config.mts
?? vitest.postgres.config.mts
```
