# Stage 2C consolidated Run 1 — Compatibility and trusted integration

**Operational verdict: NOT_READY. All 20 activation blockers remain OPEN.**
Baseline: `a4f4a22` plus the preserved accepted-source working tree. This package
implements source and deterministic offline verification under the owner's
consolidated request. It does not approve deployment, apply SQL, establish genuine
Stripe acceptance, authorise Git mutation or begin Milestone 18.

The [3I readiness review](STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md),
[evidence register](STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md) and
[runbook](STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md) remain historical review records.
This report updates their source-development assessment only. F01–F07, D01–D09,
G0–G4, the corrected I/D/R/A dependency separation and all unchecked operational
items are preserved. The current request supplies source-development authority;
it supplies none of G2, G3 or G4 operational authority.

## Exact changes and evidence boundary

| File | Change |
| --- | --- |
| [trust adapter](../src/server/stripe-acceptance-trust.ts) | New protected descriptor traversal, canonical manifest/approval readers, raw artifact reader, protected source-review assembly, supplemental hash binding and atomic inventory reservation algorithm |
| [fresh database adapters](../src/server/stripe-acceptance-fresh-database.ts) | New fresh-only connection coordinates, raw Docker isolation comparison, authenticated session checks, fixed parameterised evidence-cell SQL, separate baseline/supplemental ledger reader |
| [durable adapters](../src/server/stripe-acceptance-durable.ts) | New hash-chain evidence CAS with independent protected head and persistent fencing; accepted-v1 journal bridge; bootstrap-inclusive request accounting across invocations/restarts |
| [integration contracts](../src/server/stripe-acceptance-integration.ts) | New bounded HTTP accounting seam, budgeted account bootstrap, bracketed host/PostgreSQL advisory locks, explicitly DISABLED internal-host descriptor |
| [evidence adapters](../src/server/stripe-acceptance-evidence-adapters.ts) | New restricted SELECT-only snapshot capabilities, persisted-relationship/digest admission evidence recorder and approved fixture-writer/provenance interface; ingestion commit deliberately blocked |
| [run contract](../src/server/stripe-acceptance-run.ts) | Added static reviewed-manifest validation using the existing schema, artifact framing and exact pinned migration validation. This returns no issued seal; the original seal contract remains intact |
| [verifier](../src/server/stripe-acceptance-verifier.ts) | Replaced statement timestamp equality with transaction identity plus ordered statement times; bounded claim-transfer/recovery chronology; added separate retained-read evaluation entry point and report verificationMode |
| [verifier evidence](../src/server/stripe-acceptance-verifier-evidence.ts) | Added strict v2 archive review schema; original v1 review schema remains strict and unchanged |
| [integration tests](../tests/stripe-acceptance-integration.test.ts), [compatibility tests](../tests/stripe-acceptance-compatibility.test.ts), [synthetic helper](../tests/helpers/stripe-acceptance-integration-fixture.ts) | New deterministic adapter, fault, authority, isolation, accounting, reader and timestamp coverage; all external ports are fakes |
| [supplemental SQL proposal](proposals/STAGE_2C_CONSOLIDATED_RUN_1_EVIDENCE.sql) | New UNAPPROVED SQL artifact outside the migration chain; not applied |
| [PRODUCT.md](../PRODUCT.md) | Corrected three stale source/scaffolding assertions for F07; no commercial or visual design change |
| Three 3I documents and this report | Added source-follow-up references; retained original findings, blockers, gates, decisions, dependency order and unchecked operational lists |

There are no default filesystem, Docker, PostgreSQL, credential, Stripe or host-lock
implementations. Imports construct none. Tests inject descriptor trees, simulated
independent durable disks, raw Docker metadata, fixed SQL replies and in-process
HTTP Responses. Low-level port implementations and honest independent capability
providers remain external trust requirements, not facts established by TypeScript.
No fabricated status/paid flag can substitute for the independent verifier evidence.

## F01–F07 disposition

| Finding | Source disposition | Remaining approval/evidence |
| --- | --- | --- |
| F01 timestamp mismatch | **Corrected in source, pending independent review.** Reconciliation observation ≤ original claim transfer ≤ consumed-hold terminal time ≤ confirmation audit ≤ common as-of. Confirmation, reconciliation, payment, allocation, hold transition, claim transfer and outbox still require the same captured transaction identity. Recovery completion may follow its reconciliation observation within its real invocation/lease. Distinct-statement and negative chronology/transaction cases are tested | Genuine original transaction/claim capture remains unavailable. No financial clocks, engine, historical rows or timestamps were changed or invented |
| F02 pinned migrations versus extra schema | **Compatibility strategy proposed.** Preserve the exact 36 baseline migrations and aggregate/raw hashes. Independently approve a separately versioned supplemental artifact and raw SHA-256 in the protected integration review, then independently read its profile binding alongside the ordered baseline ledger | D02/D04 approval of proposed SQL, role/login model, capture/inbox handoff, effective privileges and actual fresh PostgreSQL acceptance. No baseline migration or manifest changed |
| F03 old target and fresh integration | **Fresh adapter path isolated; full execution integration incomplete.** Run-derived coordinates only, no URL/env/shared-pool fallback, actual role/database/address/version checks before use. Old boundary, old runner and public routes remain unchanged. A mismatched reader/database manifest rejects | Reviewed run-scoped domain processor/runner integration and actual fresh-cluster attestation. The old acceptance boundary/runner MUST NOT be invoked against retained history or repurposed by relaxing guards |
| F04 review window | **Separate source contract implemented.** Existing v1 remains current/in-window and rejects a v2 grant. Explicit verifyRetainedAcceptanceEvidence requires current v2 read authority, an independently immutable/closed archive frozen within the original run, ≤30-second original capture coherence and unchanged digest anchors. Report marks RETAINED_READ_ONLY_V2 | Owner D08 review of the new protocol, independently controlled archive and protected process-restart reconstruction. An issued run/plan is still required; copied/deserialised objects reject. No expired execution authority is extended |
| F05 bootstrap/accounting ordering | **Separate G2 bootstrap protocol and aggregate gate implemented; final evidence integration incomplete.** Static protected review precedes account identity; fresh reservation, target/capability authority and both locks precede one bootstrap allowance. Account response must match the independently approved expected account. Bootstrap and all later requests share a non-refundable total cap. New G3 authority must independently verify the account before normal requests | Review G2/G3 protocol, durable controller/head and actual HTTP seam placement. The accepted v1 journal still requires verified account before AUTHORITY. It is not used to authorise bootstrap. A reviewed combined bootstrap/request/journal evidence capture and independent verifier replay is still required; do not omit bootstrap from genuine evidence |
| F06 missing review/history provenance | **Recorded explicitly as unavailable in the reviewed scope.** The owner's accepted-source prerequisites are task authority, not independently supplied reviewer transcripts. The baseline subject cannot establish or refute a real historical run | Owner supplies attributable records under a new access scope or explicitly accepts their unavailability in final disposition. No protected historical store was inspected, no sign-off invented; B20 remains OPEN |
| F07 documentation drift | **Corrected current product summary.** PRODUCT now acknowledges application/server source and source-only NOT_READY acceptance. The old 3B transport warning remains historical and is superseded by accepted 3C | No rewrite of earlier reports or commercial/product policies; documentation is not operational evidence |

## Trusted interfaces and failure semantics

Protected IO resolves every path component relative to a held read-only no-follow
descriptor. Every parent must be root-owned and non-writable by group/others; files
must be regular, single-link, root-owned and mode 0400/0600. Before/after metadata,
byte count and canonical JSON checks reject changing records. Raw source/migration
bytes are separately bounded, copied and hashed; path traversal, extra/unreviewed
paths and any pinned baseline change reject. Independent review still must assess
the complete transitive source/dependency closure. A Boolean cannot discover it.
Descriptor-port implementation and OS enforcement require independent review.

Resource reservations use complete inventory plus revision CAS. Both current and
retired run/resource identities collide; uncertainty fences the independent host
controller. The controller must fsync record and parent directory before DURABLE.
It must exist before provisioning: it is not stored in the database being created.
No resource provisioning or automatic reservation retry is implemented.

Fresh Docker metadata rejects image/container/network/volume replacement, public
ports, extra mounts, shared network, privileges and reused credentials. The proposed
fresh deployment has a sole data-volume mount and separately approved initialisation;
it does not inherit the old protected template's initializer mount. Connection
construction takes only derived private coordinates, a fixed purpose role and short
bounds; no caller URL, migration credentials, environment or shared client. Actual
SQL identity is checked in READ ONLY/ROLLBACK, authority before/after subsequent
queries, and the session is destroyed on exit. Connector cancellation and host-level
limits are explicit injected responsibilities, not hard-termination guarantees.

The supplemental evidence store uses fixed SQL and role, parameter values and exact
run/component keys. PostgreSQL bigint revisions are checked without lossy conversion.
Missing cells reject, never initialise. Append requires a valid existing full chain,
DB CAS acknowledgement AND an independent protected-head CAS acknowledgement.
A commit/head gap, corruption, lost acknowledgement or uncertain persistent fence
blocks restart. There is no automatic truncation, reconciliation, refund or reset.
The SQL proposal provides runtime append-only CAS and a one-way fence; its concurrency,
durability and effective privileges are NOT established by the memory tests.

The aggregate transport reserves before every underlying HTTP attempt, including
hidden SDK attempts, then revalidates authority, locks and deadline and durably
records dispatch intent. Its per-attempt scope ends at the earlier reserved/request
or parent deadline. The reused boundedAutomationFetch consumes the complete bounded
response before KNOWN settlement. No response/commit uncertainty refunds allowance.
Interrupted reservations block new requests after restart. NOT_STARTED is retained.
Only declared payment operations and the explicit bootstrap operation are allowed;
OTHER_AUTHORISED is denied. Stripe origin/method/path, redirect, cancellation,
Idempotency-Key and account bootstrap identity checks fail closed. No SDK or default
fetch is supplied. An injection marker is not an OS network sandbox.

Host locks use the fixed accepted path and an exclusive/nonblocking/no-follow port;
the PostgreSQL session lock uses the exact accepted supervision-derived 64-bit key.
Backend PID and pg_locks continuity are checked while the same session is retained;
no reconnect/resume exists. Release/session/host uncertainty rejects. A real flock
port and approved external descendant monitor are still missing. The internal-host
descriptor stays DISABLED, schedulingEnabled=false and operationsEnabled=false.

Admission evidence checks original booking/attempt/hold/command ownership and
persisted Session/PaymentIntent linkage, original request/key identity, exact event
ID/digest and supported type/object pair. Duplicates preserve the original digest;
conflicts and unsupported ownership stay in investigation. **recordEvidence is not
an inbox commit. commit always rejects ATOMIC_INBOX_HANDOFF_REQUIRED**, so this
partial adapter cannot acknowledge successful ingestion through the accepted 3E
API. No unscoped ingester fallback, payment processing or financial engine exists.

Restricted readers return only fixed SELECT-produced captured snapshots, with
repeatable-read/read-only transactions, exact fresh binding and normal evidence
schema checks. The verifier still independently authenticates each producer/digest,
not the application status. SQL storage cannot create genuine capture or prove
producer independence. The proposed runtime roles cannot populate the snapshots;
separately approved independent collectors/insert-only grants are still required.
The fresh database adapter's current operational review is not a G4 archive reader;
retrospective evaluation requires separate retained-reader/authority construction.

The fixture-writer interface accepts an issued plan, exact fixture and independent
G3 monetary/target/capture authority. It requires existing quoteStay/acceptBooking,
original runtime IDs and original commit evidence; validates amounts, namespace,
unique IDs and binding; and never automatically retries a lost acceptance response.
There is deliberately no default writer or guessed financial INSERT implementation.
Original transaction capture requires an approved integration at the domain commit
boundary; a later SELECT/transaction ID cannot establish it.

## Activation blocker updates

OPEN means operational closure is not established, even when deterministic source
checks pass. I/D/R/A remain implementation, deployment, genuine-run and final-review
stages, as defined in the corrected 3I package. No output of a real run or final
verifier is an implementation prerequisite.

| Blocker | Status | New source progress | Remaining closure requirement |
| --- | --- | --- | --- |
| B01 trusted launcher | OPEN | Protected reader and source assembly algorithms; disabled host descriptor | Actual reviewed low-level IO, immutable runtime package and dedicated launcher |
| B02 independent authority | OPEN | Strict attributable review/scope/time/hash bindings and revocation seam | Independently controlled owner grants/revocation store and exact G2/G3/G4 approvals |
| B03 reviewed artifacts | OPEN | Exact protected index/paths/raw bytes, pinned baseline and supplemental validation | Complete independently reviewed transitive runtime package actually deployed |
| B04 resource reservation | OPEN | Atomic inventory algorithm with collision/tombstone/fence tests | Real durable host CAS, complete inventory and collision/crash acceptance |
| B05 fresh PostgreSQL | OPEN | Fixed-target role session factory and unapproved supplemental proposal | Approved provisioning, DDL, separate least-privilege logins, grants and actual constraint/ACL checks |
| B06 live attestation | OPEN | Raw Docker comparator, authenticated SQL identity and fixed ledger reader | Real restricted readers, current capabilities and exact approved fresh resources |
| B07 account/endpoint | OPEN | Budgeted initial expected-account match and G3 verified-account authority requirement | Genuine approved test account/endpoint/secret association and object test-mode proof |
| B08 admission/ownership | OPEN | Durable ownership/digest/investigation evidence algorithm; commit explicitly blocked | Reviewed atomic inbox/evidence transaction, SQL/grants and real concurrency/acknowledgement-loss acceptance |
| B09 fixtures/provenance | OPEN | Approved existing-domain writer interface and runtime capture validation | Actual restricted writer and independently captured original transaction/IDs/claims |
| B10 restricted readers | OPEN | Fixed-role SELECT-only snapshot adapters and separate retained review | Complete independent capture/roles, real denied-write checks and archive launcher |
| B11 durable journal/budgets | OPEN | Anchored CAS, protected-head comparison, persistent uncertainty fences and v1 bridge | Real controller/store durability, checkpoint protection and fault acceptance |
| B12 execution locks | OPEN | Bracketed host port and fixed PostgreSQL session lock/continuity queries | Actual OS flock, live session contention/loss and descendant lifetime evidence |
| B13 aggregate transport | OPEN | Bootstrap-inclusive durable allowances, dispatch intent and bounded SDK HTTP seam | Actual gateway wiring, combined journal/request receipts and genuine request/lock proof |
| B14 internal HTTP host | OPEN | Fixed fresh route/origin descriptor; no fallback or active handler | Approved raw-header host, authentication/signature ownership, tunnel and route isolation |
| B15 external supervision | OPEN | Disabled descriptor and cancellation/deadline/uncertainty seams | Approved external stop monitor, service artefacts and demonstrated bounded descendant termination |
| B16 fresh execution | OPEN | Fresh-only adapter contracts; old runner deliberately untouched | Reviewed run-scoped existing-domain runner/processor integration and genuine scheduled execution |
| B17 independent capture | OPEN | Strict snapshot/provenance interfaces, storage proposal and original-ID validation | Authentic independent provider/signature/commit/request/launch producers and protected common freeze barrier |
| B18 credentials | OPEN | No credential/env/default clients; independently protected broker/session ports required | Independently generated/access-controlled secrets, login design and approved endpoint binding |
| B19 incident recovery | OPEN | Persistent fences, retained uncertain requests, no blind replay/reset | Accountable approved reconciliation/resumption procedure and controlled genuine fault evidence |
| B20 final review | OPEN | Deterministic compatibility evidence and explicit F06 unavailability | Attributable independent disposition of every finding/blocker and genuine five-scenario evidence |

## Proposed SQL and decisions still needed

The proposed supplemental file is **not** 0036 and must not enter the pinned
migration journal. It proposes a separately bound schema, profile identity, evidence
cells, original-runtime/snapshot storage, NOLOGIN purpose roles and limited
SECURITY DEFINER CAS/read/fence functions owned by zemaitija_migrator. Runtime writer
has function execution only; readers have their respective SELECTs and verifier
baseline/profile read access. No function grants to PUBLIC or financial table writes
are proposed. Existing domain schemas, constraints, triggers and history are untouched.

Owner D02/D04 must approve the version, exact bytes, initialisation, purpose-role
login/authentication strategy, effective inherited PUBLIC permissions, independent
collector writes, protected-head controller and atomic inbox handoff before applying
anything. NOLOGIN roles and missing capture grants are intentional deployment
blockers, not an operationally complete privilege installation. Profile-binding rows
alone cannot attest that DDL/constraints actually match; independent capability/ACL
inspection remains mandatory. Provisioning, credentials, migration execution and
secret access remain outside this source run.

## Dependency-ordered remaining work

1. Independent source review of this package; resolve remaining source integration
   together: protected low-level ports and launcher/stop monitor; approved DDL/login/
   capture strategy; atomic admission-to-inbox handoff; original transaction/claim
   capture; combined bootstrap/provider/v1 journal verification; fresh run-scoped
   wiring to existing domain processors; current and retained reader launchers.
   Use synthetic evidence only. Preserve the corrected source order:
   B02 → B03 → B01 → B18 → B04 → B05 → B06 → B11 → B12 → B15 → B13 → B07 → B08 → B09 → B17 → B10 → B14 → B16 → B19 → B20.
2. Obtain exact G2/D02–D05/D07 owner approval for a single reserved fresh resource
   set, independently generated credentials, pinned baseline plus approved supplement,
   effective roles/capabilities, protected authority/head stores, disabled host/monitor,
   lock/store fault checks and dedicated Stripe test endpoint. Bootstrap requires
   durable allowance, both locks and verified fresh authority before the initial
   provider read. Leave all execution disabled until the next gate.
3. Obtain separate G3/D06/D07 monetary/fixture/provider/delivery/scheduled-run approval.
   Activate independent original-ID/transaction/request capture before fixtures; use
   existing quote/acceptance and financial processors only. Execute the five scenarios
   with all allowances, locks, deadline/stop controls and uncertainty preservation.
4. Under separate G4/D08 read authority, freeze and independently verify genuine
   RECORDED evidence and preservation. Dispose every blocker/finding explicitly; any
   missing/uncertain/failed criterion prevents operational acceptance. Expected safe
   investigation remains distinct from paid-booking success.
5. Only after explicit owner acceptance, separately scope Milestone 18. No deployment,
   activation or Git action is implied by a verifier PASS or by this plan. D09 still
   requires separate exact staging/commit/push permission.

## Verification and preservation

Final verification results and status follow below.
Only explicit deterministic offline suites, nonincremental TypeScript, targeted
ESLint with zero warnings, documentation/source preservation and Git whitespace/
status checks are permitted. No full test discovery, live PostgreSQL scenario,
application build, migration, fixture/booking execution, worker/listener, Docker,
systemd, network, credential or genuine Stripe operation is performed.

The starting status contained three unrelated tracked modifications and 39
untracked entries, including prior Stage sources, .impeccable output, accommodation
work and owner patches. A 537-file source/evidence/design fingerprint snapshot
records their initial content. Only the exact scoped files above may differ;
protected routes/engines/migrations, earlier owner work and the original inactive
boundary remain byte-identical. Nothing is staged, committed or pushed.

Preservation exception: the installed edit hook automatically updated the ignored
`.impeccable/hook.cache.json` edit counters. No design workflow or design changes
were invoked; all other Impeccable artifacts remain byte-identical. The initial
cache was fingerprinted without a content backup, so exact restoration could not
be established. It was left intact rather than replaced with guessed content.
This is an automatic tooling side effect, not a requested source change.


Final deterministic verification: **750 tests passed across 13 explicit offline
suites**, including **143 new cases** and the 607 earlier focused cases. The suites
are integration, compatibility, acceptance-run, host, forwarding, scenarios,
supervision, verifier, transport, acceptance, automation-foundation,
automation-runtime and recovery-domain. No PostgreSQL scenario export or live
entry point ran. Nonincremental `tsc --noEmit --incremental false` passed. Targeted
ESLint on all eight changed/new source modules and three new test/helper files
passed with `--max-warnings 0`. Git tracked/scoped whitespace, local Markdown links,
fence/checklist/blocker consistency, source dependency ordering and final status
checks passed. No genuine acceptance or OS/SQL/provider durability is established.

Fingerprint comparison: of 537 initial files, 529 are unchanged, seven have the
scoped changes listed above, and the ignored hook cache is the single automatic
exception. No source/configuration/dependency/SQL file outside the scoped list was
changed. The baseline migrations and unrelated pre-existing modifications are
byte-identical to their initial state. All 20 blockers are OPEN; no operational
checkbox is checked.

Final `git status --short`: four tracked modifications (PRODUCT is this run;
next-env, automation-runtime and recovery-domain were pre-existing), 48 untracked
entries (39 initial, nine additional visible entries; the supplemental SQL is inside
the already-untracked proposals directory). No staged paths. Exact observed status:

```text
 M PRODUCT.md
 M next-env.d.ts
 M src/server/stripe-automation-runtime.ts
 M tests/stripe-recovery-domain.test.ts
?? .impeccable/build/
?? .impeccable/mocks/
?? ACCOMMODATION_MANAGEMENT_SPEC.md
?? docs/STRIPE_ACCEPTANCE_CONSOLIDATED_RUN_1.md
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
?? owner-accommodation-management-docs-fixed.patch
?? owner-accommodation-management-docs.patch
?? src/server/stripe-acceptance-durable.ts
?? src/server/stripe-acceptance-evidence-adapters.ts
?? src/server/stripe-acceptance-fixtures.ts
?? src/server/stripe-acceptance-forwarding.ts
?? src/server/stripe-acceptance-fresh-database.ts
?? src/server/stripe-acceptance-host.ts
?? src/server/stripe-acceptance-http.ts
?? src/server/stripe-acceptance-integration.ts
?? src/server/stripe-acceptance-run.ts
?? src/server/stripe-acceptance-status.ts
?? src/server/stripe-acceptance-supervision.ts
?? src/server/stripe-acceptance-trust.ts
?? src/server/stripe-acceptance-verifier-evidence.ts
?? src/server/stripe-acceptance-verifier.ts
?? src/server/stripe-acceptance.ts
?? tests/helpers/stripe-acceptance-forwarding-fixture.ts
?? tests/helpers/stripe-acceptance-integration-fixture.ts
?? tests/helpers/stripe-acceptance-scenario-fixture.ts
?? tests/helpers/stripe-supervision-store.ts
?? tests/helpers/stripe-verifier-fixture.ts
?? tests/stripe-acceptance-compatibility.test.ts
?? tests/stripe-acceptance-forwarding.test.ts
?? tests/stripe-acceptance-host.test.ts
?? tests/stripe-acceptance-integration.test.ts
?? tests/stripe-acceptance-run.test.ts
?? tests/stripe-acceptance-scenarios.test.ts
?? tests/stripe-acceptance-supervision.test.ts
?? tests/stripe-acceptance-transport.test.ts
?? tests/stripe-acceptance-verifier.test.ts
?? tests/stripe-acceptance.test.ts
```

Stop here for independent source review and explicit owner approval. No operational
execution or Milestone 18 work follows from this package.
