# Stage 2C — Consolidated Remediation B source review

**Verdict: NOT_READY. B01–B20 remain OPEN.** Source contracts and deterministic
in-memory adapters only. No trusted launcher, monitoring deployment, callable
operational runner entry point, actual capture adapter or genuine acceptance run
is installed. Stop for independent source review. No G2/G3/G4 or Milestone 18 work.

## Exact file inventory

Six added files; no pre-existing source, test, documentation, configuration,
proposal, migration or other working-tree file was modified:

- [capture provenance](../src/server/stripe-acceptance-capture-provenance.ts): shared detached observation schemas, fixed diagnostics, independent read capability and pinned-reader validation.
- [fresh-runner binding](../src/server/stripe-acceptance-fresh-runner.ts): non-operational inspection of the complete authority/target/dependency chain.
- [evidence collectors](../src/server/stripe-acceptance-collectors.ts): five separately pinned sources, exact per-item coverage and read-only integration with the existing verifier.
- [synthetic adapters](../tests/helpers/stripe-acceptance-remediation-b-fixture.ts): in-memory original capture packets, independent review pins and full request-reservation history.
- [focused tests](../tests/stripe-acceptance-remediation-b.test.ts): 103 deterministic cases with prohibited operational import/network traps and fake clocks.
- This report.

## Inspected execution boundaries

The existing `runStripeAutomationVerification` calls `stripeAutomationConfig`,
`refreshIsolatedTarget`, bounded pool/provider construction, actual database and
account guards, then `automationRecoveryProcessors`. The accepted config/target
helpers pin `zemaitija_stripe_automation_dev`; the old acceptance boundary and
unmounted HTTP adapter also pin that target. Runner scans are not fixture-filtered.
They cannot be supplied fresh names by overriding environment values, nor may
those old guards be relaxed. Both protected database identities remain excluded.
The hard-inactive internal endpoint still imports only the Stage 2A foundation.

The new binding inspector accepts an issued fresh run seal, issued independent
artifact review, strict source-only request and independently controlled read
capabilities. It accepts no URL, credentials, environment, target override,
factory, processor, gateway or execution callback. A structurally copied seal or
review is rejected. Derived names, fixed `stage-2c-fresh-pg17-v1`, exact artifact
hashes/review binding and current approval windows are required.

The checked sequence is:

`STATIC_INTEGRITY → APPROVAL → RESERVATION → DOCKER → POSTGRES → JOURNAL → BUDGET → HOST_LOCK → DATABASE_LOCK → STRIPE → DEPENDENCIES`.

Each observation is independently reader/record/digest-pinned by a separate host
review. Checks cover the committed exclusive resource reservation, exact Docker
image/container/network/volume and isolation, authenticated PostgreSQL identity,
roles/effective privilege attestations, all 36 pinned ledger entries, test account/
endpoint/API version, independent journal head, complete aggregate request history,
exclusive host path and pinned backend/session lock identity. Missing sources
remain pending; contradictory evidence rejects. Time, cancellation, lock validity
and all observation windows are rechecked after the final read.

Request-budget validation replays the existing anchoredEvidence outer fact shape:
sequence, previous digest, run/manifest binding, canonical fact digest, and exact
RESERVE/DISPATCH_INTENT/RESULT relationships. The independently protected budget
head must match the complete retained history. Reservations precede dispatch;
KNOWN settlements precede their original deadlines. Bootstrap remains charged
inside the total, invocation/request ceilings cannot reset, and uncertainty or
interrupted/unsettled requests block acceptance. Startup account evidence must
belong to the same invocation and follow acquisition of both execution locks.
No budget reservation, head append or lock acquisition occurs here.

This is proof-inspection order, not authority to make provider calls. A future G2
bootstrap needs its own owner-approved authority, actual durable budget reservation
and required locks before its account request, then independently retained evidence
before sealing. G3 worker/startup authority is separate. A SOURCE_REVIEW artifact
grant cannot become G3 authority by labelling observations RECORDED. Every actual
provider attempt must still pass the accepted aggregate transport reservation and
revalidation protocol, including hidden SDK attempts.

The dependency descriptor fixes the existing four lanes and their existing payment
inbox, Checkout, initial and balance recovery functions; boundedAutomationPool,
aggregateBoundedAcceptanceFetch/boundedAutomationFetch, AutomationScope, stable
persisted command keys/requests, 60-second invocation and 1-second provider bounds,
response cap, cancellation/observed cleanup and uncertain-outcome fencing. It binds
only fresh coordinates and one dedicated non-pipelined connection, with no shared
pool fallback. It is data, not a callable or an alternative runner/financial engine.

Even a complete RECORDED-shaped chain returns
`PENDING_EXTERNAL_AUTHORITY / TRUSTED_LAUNCHER_AND_REVIEWED_RUNNER_SEAM_REQUIRED`,
with ready, operations, scheduling and processor construction all false. No new
runner seam has been installed into the legacy runner. Future source approval must
cover the precise fresh-profile adaptation, then separately authorised launcher
construction and continuous live revalidation. These gaps deliberately prevent
source observations from becoming operational capabilities.

## Independent collection and verifier compatibility

A separate collector review pins both each entire capture packet and the existing
verifier envelope. Five distinct source readers/functions and producer identities
are required; no application status conversion or default reader exists.

| Channel | Trusted source boundary | Exact covered evidence |
| --- | --- | --- |
| bindings | Original booking-transaction capture observer | Fixture plan binding, original generated booking/snapshot/obligation/hold/claim/attempt/command IDs, native acceptance transaction and independent commit reference |
| database | Read-only original financial rows/capture observer | Full booking/payment/allocation/inventory/audit/notice history, original capture and settlement, exact native XID8/backend identity and eight ordered effects |
| webhooks | Independent atomic committed-row observer | Original admission, delivery, raw signature/account/endpoint provenance, original/incoming digests, ownership, governed inbox or durable incident, original and delivery transaction witnesses |
| provider | Independently archived authenticated Stripe test observation | Exact test account, Session/Intent/charge, request ownership, EUR cents, capture time and known/uncertain/incomplete outcome |
| supervision | Protected journal/lock/request-history reader | Complete journal/head, execution lock observations, reservations/results, cancellation/deadlines/cleanup and scheduled recovery evidence |

Each immutable packet includes run/source/migration/target binding, source system,
trusted reader and record identities, evidence class, capture time and collection
window, completeness/uncertainty and fixed nonsecret diagnostics. Every covered
item additionally has its row key/digest, capture time, original-versus-independent-
versus-retrospective origin, relevant native transaction and independent commit
reference. Run/source/reader/window provenance is explicitly inherited from its
pinned enclosing packet. Null transaction means not available or not applicable;
it is never replaced with a fabricated XID or commit timestamp. Original binding,
financial and handoff subjects require original transaction provenance and a
commit reference. Financial/handoff native identities and observer references must
match the actual original evidence, including backend identity.

The coverage projection describes existing evidence only. It cannot generate IDs,
commit witnesses, financial rows or provider events. Fake test adapters construct
synthetic packets explicitly; collector code never calls their rebuild/re-review
helpers. Detached copies prevent later readers from rewriting earlier snapshots.
Opaque reader failures become fixed diagnostics, with no raw error values returned.

Accepted envelopes feed `verifyAcceptanceEvidence` unchanged. No verifier schema,
financial algorithm, SQL, state machine, allocation/inventory/notice invariant or
Remediation A/A-1 contract changed. The no-inbox expected investigation remains
safe and unpaid; payment admission still requires its inbox and original financial
capture. Same-event digest conflicts preserve the original inbox/digest, retain a
separate incident and cannot produce a replacement financial effect. Retrospective
reconstruction cannot stand in for original capture. Existing signed and duplicate/
out-of-order scenarios remain valid.

The outer collection verdict combines provenance issues with the existing verifier
using FAIL > INVESTIGATION_REQUIRED > INCOMPLETE > PASS. Independently anchored
financial violations still reach the verifier even when per-item provenance is
incomplete. A nested verifier result assesses its envelopes; only the outer verdict
also assesses collection provenance. Neither conclusion permits operation. A
SIMULATED PASS is source evidence only; relabelling envelopes does not supply the
provider/signature authenticity required for RECORDED acceptance.

## Unconnected adapters, storage and privileges

No new DDL is added or applied. The 36-migration baseline, existing supplemental SQL
proposal and [Remediation A schema design](STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md)
remain unchanged, unapproved/unapplied where applicable. B2 packets and their
independently controlled pin records may be retained as separate protected archive
sidecars; the old verifier_snapshots table stores envelopes, not all new packet
metadata. A future archive writer/reader format and its protection/retention rules
require independent review and owner approval; no filesystem implementation exists.

The minimum additional original runtime-binding storage design is **UNAPPROVED AND
UNAPPLIED**: retain exact run/plan/fixture binding, domain-generated IDs, original
acceptance XID8/backend identity and mapping digest inside the existing acceptance
transaction, before COMMIT. Retain its independent post-commit row observation
separately. Whether this uses a reviewed evidence table/function or a protected
original capture mechanism remains an owner/schema decision. No existing audit
field or arbitrary transaction label is assumed to provide native XID8 provenance.
The B fake maps its own synthetic acceptance transaction consistently to native
identities; it does not upgrade historical captures or financial timestamps.

Future least privilege: collector readers need fixed scoped SELECT over original
rows/captures and no financial/recovery mutation, schema CREATE, sequence mutation
or unsafe definer execution. Native financial capture needs only its reviewed
run-bound insert operation on the SAME original financial session; original
booking capture similarly belongs on the original acceptance session. Neither
writer may assign paid state or manufacture generated domain IDs. Independent
observers and protected archive/head controllers require separate authority from
writers. Provider collectors require separately approved read-only test credentials
and prior durable request reservations. Actual PostgreSQL, Stripe, filesystem,
Docker, host-lock and session-lock implementations stay unconnected.

Schema validation cannot sandbox a supplied JS reader, establish independent OS
control or authenticate a self-signed pin record. A separately approved trusted
controller must supply the capabilities and pins from protected attributable
records, compare actual rows/native identities with immutable captures/plans,
verify ACLs and archive integrity, and revalidate live authority continuously before
any future execution. None of those deployment facts is claimed here.

## Verification and preservation

- Focused offline tests: **326 passed in four suites**: new B (103), verifier (92), Remediation A (65), forwarding (66).
- Nonincremental TypeScript: `tsc --noEmit --incremental false` passed.
- Targeted ESLint on the five added TypeScript files, `--max-warnings 0`: passed.
- Tracked/new-file whitespace and report-link checks: passed.
- Git status recorded before editing and after checks. Final status: four pre-existing tracked modifications, 63 untracked entries, no staged changes. The six new files above account for the difference; pre-existing status entries are preserved.

Only the six named new files were written. No repository-wide fingerprint scan
was performed. No .env.local, backup credential, token or signing secret was read,
hashed or inspected during B. No protected database, financial record, Stripe
resource, Docker/systemd resource, network or operational service was accessed.
No listener, worker, timer, scheduler, launcher, monitoring deployment or background
service was started. No public route, internal inactive endpoint, financial engine,
recovery SQL, constraint, trigger, migration, .impeccable content, next-env.d.ts,
accommodation work, owner patch, proposal or existing source contract was changed.
No staging, commit or push occurred. Nonsecret migration/proposal source reads in
the deterministic helpers do not apply SQL or access any database.

## Updated blocker assessment

The historical [readiness register](STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md),
[runbook](STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md) and
[evidence register](STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md) remain unchanged,
including F01–F07, D01–D09, G0–G4 and unchecked operational checklists.

| Blocker | State | B source contribution and remaining gap |
| --- | --- | --- |
| B01 trusted launcher | OPEN | Explicit complete binding sequence; no launcher, protected live configuration implementation or deployment |
| B02 independent authority | OPEN | Separate pinned authority/readers; real issuer, protected storage and attributable owner grant absent |
| B03 source packaging | OPEN | Exact issued review/source binding required; full final dependency-closure artifact approval outstanding |
| B04 resource reservation | OPEN | Independently observed exclusive reservation required; no real CAS/fsync reservation or resource allocation |
| B05 PostgreSQL provisioning | OPEN | Exact role/version/ledger/privilege evidence required; no provisioning, SQL or actual ACL validation |
| B06 live attestation | OPEN | Matching Docker/PostgreSQL snapshots checked; no connected live attestation reader |
| B07 account/endpoint | OPEN | Test identity linked to budgeted bootstrap/startup observations; no genuine provider evidence or endpoint operation |
| B08 admission DDL | OPEN | A/A-1 handoff evidence retained; approved functions/DDL/atomic production adapter absent |
| B09 original IDs | OPEN | Original native transaction and generated-ID provenance required; real booking/financial capture seams and storage require review |
| B10 restricted readers | OPEN | Collector-to-verifier snapshot compatibility; actual roles, connected readers and ACL acceptance absent |
| B11 journal/budget durability | OPEN | Complete request facts/head validated; real durable stores and crash/ack-loss acceptance absent |
| B12 execution locks | OPEN | Host/session identity and lifetime evidence required; real locks/continuity/loss tests absent |
| B13 aggregate allowance | OPEN | Existing transport contract retained and reservation history checked; no live transport/budget construction or enforcement claim |
| B14 internal host/routing | OPEN | No HTTP adapter/forwarder mounted; dedicated restricted host still absent |
| B15 supervision/termination | OPEN | Disabled result, cancellation/expiry checks; no systemd or external stop/descendant monitor |
| B16 fresh runner | OPEN | Non-operational fresh binding contract; legacy runner remains protected-target-only, reviewed fresh seam and scheduled execution absent |
| B17 independent collection | OPEN | Five independently pinned collector contracts and deterministic adapters; actual original capture, independent archive and genuine collection absent |
| B18 credential management | OPEN | No credential dependency accepted/read here; approved external credential custody and endpoint signing control absent |
| B19 failure investigation | OPEN | Synthetic failure/conflict/uncertainty regressions; real controlled fault/recovery evidence absent |
| B20 final acceptance | OPEN | Independent source review pending; no genuine run, G4 disposition or operational go/no-go |

**NOT_READY. Stop for independent source review.** Trusted launcher/monitoring,
actual adapters, operational acceptance, G2/G3/G4, commits/pushes and Milestone 18
require separate approval.
