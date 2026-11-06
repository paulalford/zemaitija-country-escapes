# Stage 2C-3I — Approval and execution runbook

Source-development follow-up: [Consolidated Run 1](STRIPE_ACCEPTANCE_CONSOLIDATED_RUN_1.md).
This 3I document remains the historical review snapshot; the follow-up records
source fixes and remaining integration gaps. Operational readiness remains
**NOT_READY**, all 20 blockers remain OPEN and operational approvals remain gated.

**PREPARATION ONLY — NOT AUTHORISED FOR EXECUTION. Readiness: NOT_READY.**

This document contains descriptive future procedures, not runnable commands. It
does not install a launcher, issue an approval, enable scheduling, provision a
cluster, apply SQL, access a secret or authorise a provider operation. No phase
below is executed in Stage 2C-3I. Milestone 18 remains excluded.

Use the [readiness report](STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md) for B01–B20,
F01–F07 and D01–D09; use the
[evidence register](STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md) for source paths and
the distinction between reported tests, source inspection and independent evidence.

## Authority checkpoints

| Gate | Scope requiring explicit owner approval | Current state |
| --- | --- | --- |
| G0 | Create/review the three 3I documents; read-only repository inspection and document checks | Only current authorised scope |
| G1 | Exact focused source/adapter, schema proposal and deterministic-test work packages; any change to accepted contracts separately reviewed | NOT AUTHORISED |
| G2 | Exact fresh infrastructure, credential generation/access, pinned migrations/approved DDL, live identity/permissions, test-account/endpoint configuration, disabled service installation and approved fault checks | NOT AUTHORISED |
| G3 | Exact synthetic fixture/amount plan, booking acceptance, scheduled runner/Checkout/provider requests, signed test delivery, evidence collection and any selected manual scheduling enablement | NOT AUTHORISED |
| G4 | Exact independent read-only evidence verification and final disposition; any investigation needing mutation requires its own additional scope | NOT AUTHORISED |

Record actual owner decisions only when supplied. Each future grant must bind the
reviewed artifact and schema versions, run/resource identities, permitted actions,
account/endpoint, validity window, request/invocation/monetary limits, operator and
halt responsibility. No example approval ID, reviewer signature or inferred consent
is provided. Source acceptance does not imply G2, G3 or G4 authority. Git staging,
commit and push require a distinct later decision and are never incidental cleanup.

## Phase 1 — Source completion — NOT AUTHORISED

Prerequisites: owner D01 decision, separately scoped G1 authority and the preserved
`a4f4a22` plus existing working-tree inventory. Do not change accepted sources merely
because this audit found a mismatch. Do not connect to infrastructure to aid design.

1. Prepare the compatibility/evidence-capture packet for F01–F05 and obtain separate
   review for accepted-contract changes. Preserve distinct real timestamps and commit
   equivalence, pinned-baseline integrity, verification windows and bootstrap accounting.
   These are source design decisions; no live evidence is required to review proposals.
2. Implement authority and packaging mechanisms, then the launcher contract/credential
   mechanism and reservation controller: I(B02), I(B03), I(B01), I(B18), I(B04).
   B03's final complete artifact approval follows assembly of the selected source;
   B01's initial injection contract does not require later adapters to have run.
3. Implement fresh provisioning/schema proposals, attestation adapters and durable
   journal/head/allowance storage against fake resources: I(B05), I(B06), I(B11).
   No SQL application, database connection or Docker access belongs in source work.
4. Implement lock contracts/loss handling first, disabled supervision second and the
   aggregate transport gate third: I(B12), I(B15), I(B13). Fake process/session lifetimes
   and provider responses suffice for source verification. Installed systemd or
   genuine account identity is not an implementation prerequisite.
5. Implement accounted test-account/endpoint verification, durable webhook admission
   and synthetic writer/original-ID capture: I(B07), I(B08), I(B09). Use only
   deterministic synthetic identities, requests, signature observations and stores;
   no actual provider request, genuine webhook, fixture or acceptance is authorised.
6. Implement independent collectors/output contracts before restricted readers:
   I(B17), then I(B10). Existing reviewed history/launch/request schemas and synthetic
   execution receipts establish the source input contracts. Neither a successful
   runner invocation nor a final verifier conclusion is needed to implement collectors.
7. Implement the restricted host/routing and fresh-target existing-runner integration:
   I(B14), then I(B16). Consume the already defined collector/reader contracts. Keep
   public routes, old-target allowlists and inactive barriers unchanged pending any
   separately approved change; no competing payment engine or default raw transport.
8. Complete incident/recovery handling and final-review protocol: I(B19), I(B20).
   Exercise source behavior with deterministic synthetic evidence only under future
   G1 scope. Source success does not close any live blocker or grant deployment authority.

### Dependency stages and deployment handoff

The readiness register's typed fields are canonical: **I** means source prerequisites,
**D** deployment prerequisites, **R** genuine observations to collect, and **A** final
independent acceptance. Only I fields define source sequencing. The order above is
acyclic; R/A outputs must never be fed back as requirements for implementing their
producers. All B01–B20 remain OPEN until their actual closure evidence and approvals.

The corrected cycles are B07↔B13, B12↔B15, B10↔B17 and
B16→B10→B17→B16. Source sequencing is respectively I(B13) before I(B07), I(B12)
before I(B15), and I(B17) before I(B10) before I(B16). This moves genuine identity,
lock-loss/termination and run/verifier proof to their appropriate D/R/A stages;
it removes no security requirement.

At deployment, install approved lock adapters before the disabled monitor; perform
joint real lock-loss/termination checks only after both are installed and explicitly
approved. Install the durable budget gate with dispatch disabled before initial
account verification. Every actual provider preflight still needs independently
verified, separately approved bootstrap authority and a prior durable reservation;
F05 must be resolved before that first call, and normal worker/payment authority
still requires verified test-account identity. There is no unbudgeted setup exception.

Deploy approved collectors and restricted readers before authorised runner activity.
G3 produces actual runner/collector evidence; G4 evaluates it. Installation consumes
accepted source/contracts rather than a prior successful run or final verifier PASS.
No synthetic record may be relabelled genuine to satisfy a deployment or approval gate.

Exit gate: separately attributable source review and deterministic verification
under a future G1 scope; exact artifact/schema proposal and operational procedures
accepted for later consideration. Interface/fake acceptance leaves live blockers open.
No application, SQL or configuration changes are made by this current runbook.

Halt/rollback: stop on source-contract ambiguity, authority sharing or fabricated
evidence assumptions. Keep execution disabled. Any future reviewed source rollback
must preserve unrelated work, old history and immutable evidence; do not reset Git.

## Phase 2 — Controlled infrastructure preparation — NOT AUTHORISED

Prerequisites: G1 outputs accepted, explicit G2 owner D02–D05/D07 scope, complete
approved artifacts and schema plan, protected credentials mechanism and reviewed
reservation controller/proposal. Actual reservation occurs only within the approved
G2 procedure and before provisioning; it is not a prerequisite to granting G2 scope.
Source/design, deployment, genuine-run evidence and final acceptance remain separate;
no final B16/B17 run result is needed to install their approved mechanisms.

### Trusted host, protected manifest and credentials

Use a dedicated fixed service identity and fixed protected host-owned roots outside
application/repository write authority, as proposed in 3B/3D. The launcher must verify
descriptor-based no-follow reads, regular single-link files, restrictive permissions,
protected parents and exact reviewed artifact bytes/path closure. No caller path,
environment fallback, symlink, pending host result or in-process seal is authority.

Independently generate and privately inject separate app/migrator/read-only/internal
bearer/Stripe test/webhook credentials only under G2. Never read or reuse `.env.local`,
protected existing database credentials or signing secrets as a convenience. Do not
publish resolved configuration, raw secrets, fingerprints or private URLs in Git,
logs, chat, process arguments or evidence bundles. Signing-secret access is confined
to the approved verifier/ingestion capability; distinguish the registered endpoint
secret from another destination's or CLI forwarding secret.

### Fresh resources and exclusions

Reserve a never-used run UUID and the eight exact 3B identities atomically, retaining
complete prior-use tombstones. For S = run UUID without hyphens, use only the reviewed
fresh project `zec-acceptance-S`, container `zec-acceptance-S-db`, network
`zec-acceptance-S-internal`, volume `zec_acceptance_S_data` and database
`zec_acceptance_S`. Service is acceptance-db, connection is exact attested private
IPv4:5432 with no published PostgreSQL ports. These names are rules, not resources
that this checkpoint claims to have created.

Both `zemaitija_dev` and `zemaitija_stripe_automation_dev`, their containers/volumes,
credentials and Stage 2B-3C financial history are excluded from all live operations,
including read-only verification. Never copy old bookings/events/fixtures or use the
old acceptance boundary, migrations/fixtures launcher or old scanner as a fallback.

### Docker/PostgreSQL attestation and schema

Collect authorised restricted live Docker metadata: exact approved image ID and
postgres:17.6 tag, container/network IDs, independent protected volume identity,
sole internal bridge/network/mounts and privilege restrictions. Do not grant the web
application unrestricted Docker socket access. A recorded snapshot or tag/name alone
cannot establish the current resource.

After static target checks, independently authenticate actual PostgreSQL sessions
and verify database/current/session role, exact endpoint and 170006 version, primary
status, migrator ownership, app prohibitions, function owner/search_path/ACLs,
enabled/validated financial/inventory/enrollment guards and approved ledger. Apply
only the reviewed pinned 36-entry baseline through 0035 plus the separately approved
F02 supplemental design, under distinct migration authority. No DDL is authorised
merely because a reader interface names a role. Validate status/verifier roles have
no mutation/recovery/function-membership path; collect independent effective grants.
No booking/Checkout activity belongs in this phase.

### Provider preflight, durable authority and disabled supervision

Only a separately authorised accounted provider preflight may establish the genuine
test account/API-version/endpoint identity. F05 must already define how initial
identity calls receive durable allowances before complete execution authority exists.
Every provider call, including setup/read checks, needs its own approved scope and
budget treatment; none is implicitly free because it occurs before G3.

Register/configure a dedicated test-mode webhook destination only under the explicit
G2 provider scope. The reviewed 3E forwarding mapping is run-specific, ultimately
pointing to the dedicated loopback host at 127.0.0.1:3101; the old HTTP adapter is not
that host. No signed payment deliveries, public-route mounting or generic proxy is
authorised by endpoint setup. Receive infrastructure-control evidence only as scoped.

Establish actual durable journal/head/budget storage and independent checkpoints.
After separately approved deployment, demonstrate durable acknowledgements, CAS
contention, restarts and uncertain-write fencing without fabricating journal entries
as live worker history. Establish a fixed protected host flock and a distinct
run/profile PostgreSQL session advisory lock, held through startup, worker and cleanup;
resource reservation and payment recovery leases do not replace either lock.

Deploy supervision only under explicit G2 permission and keep scheduling disabled.
3G commented examples are non-installable; do not copy them as an approved service.
Review actual oneshot start/stop limits, cgroup descendants, monotonic inner deadlines,
SIGTERM grace, external termination and SIGKILL recovery with the installed host
version. A cooperative AbortSignal or awaited pool closure alone is insufficient.

Exit gate: independently verified fresh identities/schema/ACLs, protected authority,
account/endpoint, real persistence/lock/shutdown evidence, approved collector and
transport wiring ready for consideration of G3. Genuine payment evidence remains
pending. Halt on any mismatch, missing approval, collision, secret exposure, grant
uncertainty, ambiguous SQL/cleanup or unaccounted provider request. Quarantine and
retain fresh resources; never reset/drop a volume, repair protected environments,
retry uncertain migration/POST or claim rollback without new explicit authority.

## Phase 3 — Supervised acceptance execution — NOT AUTHORISED

Prerequisites: explicit exact-run G3 D06 decision; G2 pre-execution gates independently
satisfied; B16/B17 runner/collector source and deployed mechanisms approved; genuine
run evidence still pending. Approve scenario subset/all-five objective, monetary
ceilings, max invocations/items/requests and halt owner. Agree verification timing
before starting; current 3H cannot complete after the approved run window expires.
No final acceptance is assumed from permission to collect its evidence.

1. Revalidate protected approval, complete artifact/schema hashes, exclusive fresh
   reservation, live Docker/PostgreSQL identities, test account/endpoint and clocks.
   No changed target, copied seal, pending 3D result or synthetic approval can proceed.
2. Acquire the fixed host-owned process-lifetime lock and then pinned control-session
   lock using the approved bootstrap/authority protocol. Recover/verify durable
   journal/head/budget first. Unfinished, corrupt or uncertain prior history prevents
   any new invocation, even if locks can be newly acquired. No implicit reconnect.
3. Activate approved original-ID/history/commit collectors before any accepted data
   is created. Invoke only the narrowly approved synthetic reference/guest writer.
   Bind its namespace, guest/unit/scenario IDs, dates, EUR cents and approved exposure
   to the exact immutable plan. Never assign financial IDs to domain acceptance.
4. Use existing quoteStay and acceptBooking for each approved synthetic booking with
   explicit terms/amount acknowledgement. Compare accepted amounts, record actual IDs,
   both obligations, original claim and command/request/idempotency provenance. A changed
   quote/ownership/amount or uncertain commit halts; do not build competing INSERT logic.
5. Only a separately authorised recorded scheduled invocation may call the existing
   runner on the fresh target. Revalidate identity and scope before admitting lanes.
   Checkout dispatch uses the existing command lock/lease/generation/submission gate
   and original persisted key/request. No caller request, return navigation, fixture
   writer or final verifier performs Checkout or declares payment success.
6. Reserve each underlying Stripe HTTP allowance durably before dispatch, then recheck
   locks/authority/time/abort and use bounded transport. Record every actual outcome,
   including account verification, Session/Intent/charge lookups and retries. Count
   uncertain, cancelled, timed-out and definitely unstarted allowances against both
   invocation/run caps. Unknown accounting blocks further provider activity.
7. Collect genuine test-mode payment and exact raw signed webhook evidence only within
   G3 delivery scope. Dedicated ingestion independently checks signature/account,
   persisted ownership and original event digest, then commits admission/incident
   records before receipt. No generic shared ingester fallback. A 200 investigation
   receipt means retained evidence, never paid booking or completed financial handling.
8. Observe all five scenario conditions independently: signed completion; duplicate
   and out-of-order no-extra-effects; missing-webhook recovery through scheduled
   reconciliation with no webhook contribution; delayed original command; durable
   investigation without false confirmation. Do not manually reconcile to manufacture
   missing-webhook success, replay expired signed bytes or invent launch evidence.
9. Finish only from actual worker, provider, cleanup and lock-release observations.
   Preserve every request/response reference, journal sequence/head and original
   financial/audit/claim/outbox fact. Do not report success merely because a promise
   resolved or a process exited. Release locks normally only after observed settlement
   of all descendants under the approved lifetime contract.

Exit gate: independent retained genuine evidence with complete launch/identity/
signature/request/financial/inventory/notification provenance, incident dispositions
and preservation report. This can close live-evidence portions of B16/B17; it does
not close B20 or grant any permission to rerun, reset or issue refunds.

## Phase 4 — Final read-only verification and disposition — NOT AUTHORISED

Prerequisites: G4 owner scope, F01 compatibility decision resolved, F04 verification
window/reconstruction satisfied, independently protected common-watermark snapshots,
complete journal/head and approved restricted readers. Source/collector test outcomes
must remain distinct from actual RECORDED observations.

Use the independent verifier solely to read the five anchored source sets. Require
matching run/source/migration/plan/target identities, authority/reservation and actual
producer provenance. Reject missing/stale/malformed/foreign evidence; never relabel
simulation as recorded, rewrite real statement timestamps or infer transaction IDs.
The reviewer must not dispatch a request, mutate data, repair history, append to the
journal or invoke reconciliation to confirm its own booking.

Apply FAIL > INVESTIGATION_REQUIRED > INCOMPLETE > PASS, retaining every diagnostic
and scenario-specific verdict. Require genuine exact capture, one credit/allocation,
original inventory transfer, approved confirmation and one logical notice; a paid
flag/status object is insufficient. Verify actual scheduled recovery, original delayed
command and all duplicate/out-of-order effects. Expected investigation safety may
pass its own scenario while paidBookingVerified=false; unresolved money still requires
investigation and blocks ordinary operational acceptance.

Independently review evidence and remaining blockers/findings, then request an exact
owner final disposition. Any FAIL, INCOMPLETE, unexpected investigation or unresolved
provider/resource/cleanup outcome is a no-go. Preserve the report and source anchors;
any corrective action or fresh run requires separately reviewed approval. An offline
verifier report grants no scheduling or provider authority by itself.

## Universal stop, halt and rollback rules

| Trigger | Required future response under approved supervision | Forbidden shortcut |
| --- | --- | --- |
| Missing/expired/revoked authority, artifact drift or foreign target/fixture | Stop admission before construction/dispatch; preserve rejection evidence and request scoped review | Environment override, protected-target fallback, copied seal or modified hash allowlist |
| Lock loss/unknown ownership or session drop | Cancel cooperative work, halt further processing, preserve uncertain in-flight facts; use approved external monitor | Reconnect/reacquire and resume as if authority never broke |
| Journal/head corruption, missing durable acknowledgement, allowance exhaustion/ambiguity | Prevent new provider work and preserve independent incident evidence; reconcile store before any new grant | Reset counters/head, delete entries, refund allowance or create empty history on restart |
| Provider timeout/cancellation or lost SQL COMMIT reply | Record uncertainty and charged allowance, retain exact key/request/claims/liabilities; independently investigate | Declare payment failed/rolled back, blindly retry POST, replace attempt/key or release inventory by time |
| Deadline/run-window expiry, SIGTERM or host shutdown | Stop admission at inner bound; abort cooperatively, observe cleanup; externally terminate descendants after approved grace if needed | Treat a timeout race as cancellation of actual IO or successful cleanup |
| SIGKILL, stalled worker or failed cleanup | Preserve interrupted journal and resource ownership uncertainty; block new invocation pending independent reconciliation | Mark missing FINISH successful or erase state because OS released a lock |
| Wrong amount/currency/account/signature/digest/ownership | Preserve/quarantine through approved durable incident path; prevent financial admission | Fabricate metadata ownership or acknowledgement, disable guards or reconcile from verifier |
| Any acceptance failure | Disable new admission/scheduling under approved scope, isolate and retain evidence; explicitly review next action | Database reset, volume deletion, history edits, automatic refund, unapproved down migration or repeated fixtures |

Rollback means stopping future actions and preserving outcomes, not reversing an
external payment or erasing history. Neither deleting source nor terminating a
connection proves that a previous provider request or COMMIT did not succeed.
Existing financial reconciliation stays authoritative; mutating investigation,
refunds, cancellations and destructive resource retirement need separate authority.

## Evidence retention and handoff

Retain the exact owner grants, artifact/source/path/migration/supplemental hashes,
resource reservation and lifecycle tombstones; fresh identity/role/ACL/ledger
attestations; synthetic plan and original runtime bindings; command/key/request/
lease/generation chronology; genuine test provider and raw-signature verification
references; immutable delivery/original digest/admission/incident records; complete
journal, protected head and every allowance/receipt; actual lock/launch/cleanup/
termination observations; reconciliation/payment/allocation/inventory/audit/logical
notification facts; all five verifier findings and final independent disposition.

Keep secrets and raw private payloads outside public Git reports. Protect evidence
storage independently, retain original producers/time/watermarks/digests and record
uncertain outcomes without overwriting them. Retention/destruction policies, storage
ownership and access controls require explicit owner decisions, not improvised cleanup.
No historical record, generation, idempotency key, liability or protected Stage 2B
financial history may be removed to make a later verifier pass.

Current handoff: documentation only, NOT_READY, all operational checklist items open.
Highest-priority proposed package is source-only compatibility and evidence-capture
design review (F01–F05), followed by explicitly approved trusted-adapter work. No
implementation, provisioning, genuine Stripe testing or Git mutation follows from
this handoff.
