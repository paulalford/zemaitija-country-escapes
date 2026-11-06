# Stage 2C — Source Audit Remediation A

**Readiness: NOT_READY. B01–B20 remain OPEN.** Source contracts, deterministic
synthetic tests and documentation only. No G2/G3/G4 activity, real database,
provider, webhook, fixture, worker, listener, infrastructure or Git mutation occurs.

The owner's remediation request supplies the two audit findings addressed here.
No separately named source-audit report was found in the reviewed documentation
paths. This package does not invent an independent reviewer, approval or genuine
execution record. The [3I readiness review](STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md),
[evidence register](STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md),
[runbook](STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md) and
[consolidated source report](STRIPE_ACCEPTANCE_CONSOLIDATED_RUN_1.md) remain unchanged
historical records. Their gates, owner decisions, findings and unchecked operational
lists are preserved. This report updates only the two scoped source gaps.

## Exact files

New:

- [stripe-acceptance-atomic-handoff.ts](../src/server/stripe-acceptance-atomic-handoff.ts):
  stronger source-level atomic admission/inbox transaction protocol composed with
  the existing raw-byte/authentication boundary.
- [stripe-acceptance-financial-evidence.ts](../src/server/stripe-acceptance-financial-evidence.ts):
  pure original-capture/settlement schemas, native-identity and provenance checks;
  no writer, SQL, processor or external adapter.
- [stripe-acceptance-financial-capture.ts](../src/server/stripe-acceptance-financial-capture.ts):
  future original-transaction staging port; never commits or invokes the engine.
- [stripe-acceptance-remediation-a.test.ts](../tests/stripe-acceptance-remediation-a.test.ts):
  focused synthetic handoff, fault, provenance and original-transaction cases.
- [stripe-acceptance-remediation-fixture.ts](../tests/helpers/stripe-acceptance-remediation-fixture.ts):
  fake atomic transaction store and distinct fake read-only commit observer.
- [schema design](STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md): unapproved Markdown
  relationship/DDL sketch, not an executable migration.
- This report.

Modified:

- [stripe-acceptance-evidence-adapters.ts](../src/server/stripe-acceptance-evidence-adapters.ts):
  journal-only recordEvidence now returns ADMISSION_JOURNAL_ONLY with
  processingInboxHandoff=NOT_IMPLEMENTED. Removed its misleading v1/durable receipt
  shape. Its old commit method still refuses ATOMIC_INBOX_HANDOFF_REQUIRED.
- [stripe-acceptance-verifier-evidence.ts](../src/server/stripe-acceptance-verifier-evidence.ts):
  database fixture snapshots may carry bounded originalTransactions. Missing or
  malformed original evidence is diagnosed independently rather than hiding an
  already established financial violation behind a rejected whole snapshot.
- [stripe-acceptance-verifier.ts](../src/server/stripe-acceptance-verifier.ts):
  requires complete original transaction evidence in addition to existing financial,
  inventory and notification proof; checks native identity, exact rows, statement
  chronology, source/target binding and independent settlement.
- [stripe-verifier-fixture.ts](../tests/helpers/stripe-verifier-fixture.ts):
  constructs explicit synthetic original captures at fixture creation, separately
  from later snapshot reanchoring. Uses pg-xid8 labels and separate fake collector/
  observer identities; no genuine native transaction is claimed.
- [stripe-acceptance-verifier.test.ts](../tests/stripe-acceptance-verifier.test.ts):
  allowlists the additional pure read-only evidence validator import.
- [stripe-acceptance-compatibility.test.ts](../tests/stripe-acceptance-compatibility.test.ts):
  valid distinct-statement timestamp case now supplies corresponding explicit
  original capture evidence instead of changing a later snapshot alone.
- [stripe-acceptance-integration.test.ts](../tests/stripe-acceptance-integration.test.ts):
  checks that the old journal-only output lacks ingestion receipt version/durability.

No public route, hard-inactive endpoint, financial engine, reconciliation/recovery
SQL, existing trigger, pinned migration, original proposal, configuration,
PRODUCT/design/accommodation document or owner patch is changed.

## Root causes and actual existing boundaries

`ingestStripeWebhook` in [stripe-webhooks.ts](../src/server/stripe-webhooks.ts)
verifies raw signature/account/test mode, then separately INSERTs into
**stripe_webhook_events**. Its event-ID ON CONFLICT only increments delivery_count;
it does not compare conflicting payload digests or persist acceptance-run ownership.
The accepted 3E `createAcceptanceWebhookIngestion` delegates admission to an injected
AtomicAcceptanceAdmission capability. Consolidated `restrictedAcceptanceAdmission`
records a separate anchored journal and deliberately rejects its commit API. Its
recordEvidence output nevertheless resembled a successful v1 durable ingestion
receipt. Neither composing separate commits nor relabelling that receipt could
establish atomic admission plus processing-inbox handoff.

The existing governed payment lane is **processPaymentWebhookInbox**, not the legacy
refund-capable processWebhookInbox. It claims the five accepted payment event/type
pairs from stripe_webhook_events, uses existing lease/fencing/retry rules, locates
the persisted attempt and calls the existing initial/balance reconciliation. The
new contract hands off to this exact existing inbox. It does not call a worker,
retrieve provider records, mark anything paid or create another reconciliation lane.

Financially, **reconcileInitialAttempt → recordSuccess → withInitialLock** in
[payment-reconciliation.ts](../src/server/payment-reconciliation.ts) and
[payment-locks.ts](../src/server/payment-locks.ts) already owns the governed initial
success transaction. Under the existing unit/booking/hold/claim/attempt/command locks,
it writes VERIFIED_INITIAL reconciliation, payment record and allocation, transfers
the original claim, consumes its hold, confirms the booking, appends the confirmation
audit and queues BOOKING_CONFIRMED. Existing PostgreSQL exclusion, unique provider/
allocation/outbox keys and deferred credit/inventory constraints remain authoritative.

The missing guarantee is **capture**, not another financial transaction. The engine
returns a domain result, not original native transaction provenance and all generated
row IDs. Allocation and notification UUIDs are generated inline. It does not export
the original claim transition/history or a complete captured effect tuple before
COMMIT. A later SELECT transaction, matching transaction-label strings or equal
statement times cannot fill this gap. Existing separate clock_timestamp calls remain
untouched and are not assumed equal.

## Proposed atomic handoff protocol

`createAtomicAcceptanceWebhookIngestion` is unmounted source composition of the
accepted 3E authentication, signature-header/size/expiry and original-byte checks.
Construction starts nothing. Every result explicitly identifies SIMULATED or RECORDED
and operationsEnabled=false. A RECORDED path rejects a simulated signature proof.

1. A trusted endpoint signature capability receives an exact byte copy, original
   signature and sealed expected account/endpoint. Its verified metadata and proof
   must match the locally computed **raw-byte** digest, expected test account and
   dedicated endpoint. No JSON reserialization, secret access or SDK is introduced.
   This capability must ultimately adapt the existing configured verifyEvent, which
   calls Stripe's normal constructEvent; its endpoint/secret association still needs
   independent approval. The tests use a clearly simulated capability only.
2. Before any transaction, derive and check exact fresh run/manifest/source/migration/
   target/database binding. Existing authority gates precede body/credential use;
   current authority is revalidated before staging and expiry before commit. A proof
   is retained only in that delivery's closure, not a reusable event/digest cache.
3. Begin one injected future transaction. Serialize event-ID admission, including an
   absent event; read any original disposition and persisted financial ownership on
   that same session. Check booking, obligation, command, attempt, hold, original
   key/request digest, Session and PI relationships. A PI event needs its matching
   PI and a bound Session. Metadata alone is not an ownership source.
4. Stage the complete explicit plan: immutable original admission plus delivery and
   an existing PENDING stripe_webhook_events row, **or** an approved durable
   investigation. Original transaction identity is POSTGRES_XID8 plus original backend
   and exact fresh-cluster binding. A staging echo alone permits no acknowledgement.
5. Identical deliveries preserve the original digest, inbox ID and processing state;
   add delivery evidence only. A later governed PI binding can be recorded without
   rewriting the originally unbound PI. A different original PI or original Session/
   key/command cannot be substituted. Digest conflict or unsupported/unknown/foreign
   ownership stays outside payment and retains an investigation. Conflicting payload
   bytes never overwrite the original inbox/admission. An orphaned original handoff
   is not repaired or adopted automatically.
6. Attempt COMMIT once. Only a known matching COMMITTED identity proceeds to a
   **distinct independently controlled read-only commit reader**. It must observe the
   exact immutable committed plan/digest/native identity and actual required inbox
   or investigation rows. Mutable inbox processing state may advance; immutable
   event/type/object/digest/provider-created identity must still match.
7. Only after these checks and settled cleanup return the existing compatible
   ingestion receipt. Missing inbox/incident, mismatched source/run/transaction,
   unknown COMMIT or cleanup, cancellation/expiry, missing observer or writer echo
   produces no successful acknowledgement. Fence the run on transaction uncertainty/
   rejection or contract failure; preserve records. Do not roll back after a COMMIT
   attempt, infer rollback from an exception, retry automatically or reset history.

The 3E acknowledgement receipt is a protocol result under these injected trust
assumptions. It is not independent operational acceptance. A durable flag, source
object, hash or different reader-name string does not prove actual PostgreSQL
commit/ACLs or independent control. Real transaction/observer adapter construction,
native identity recording, constrained SQL, privileges and durable read behaviour
remain mandatory external acceptance requirements. Unknown dependencies cannot
safely be replaced by the old unscoped ingester or the journal-only recorder.

Provider redelivery remains the delivery recovery mechanism under valid new
signature, authority and ownership. A fenced or unknown run needs explicit
independent investigation before any resumption. No implicit retries, refunds or
financial repairs are introduced.

## Original financial capture mechanism and precise future seam

The selected proposed mechanism is **native PostgreSQL XID8**, read from the actual
original financial session, with its original backend and the sealed fresh-cluster
binding. The normalized transaction label must be pg-xid8:XID8. It is a transaction
identity, **not** a commit timestamp, COMMIT WAL position or proof of success.

A future minimally scoped change must explicitly expose the real IDs/effects from
recordSuccess's existing withInitialLock callback before that helper attempts COMMIT:

- retain the actual generated reconciliation/payment/allocation/audit/outbox IDs;
- record each actual claim/hold/booking mutation, native transaction and ordinal;
- call the proposed staging seam on **that same connection**, after the complete
  governed effect tuple is known, and before the existing COMMIT;
- derive native identity from the connection and INSERT immutable capture/effects
  with the original transaction; do not accept caller-supplied provenance overrides;
- propagate capture failure to the transaction owner, then separately retain the
  acknowledged/rejected/uncertain transaction outcome without assuming a lost reply
  means rollback. No best-effort late capture or new capture transaction is valid.

**This checkpoint does not install that seam or change that engine/helper.** Its
future insertion and PostgreSQL adapter need separate approval. No SQL interception,
new financial transaction, retrospectively inferred commit or replacement engine
is implemented. Same-session queries may assist the future original recorder while
that transaction is open, but cannot substitute for recording which effects actually
occurred at their original mutation points.

`stageOriginalFinancialCapture` accepts only an original-transaction port and exact
bound capture. It checks the native identity before and after staging and validates
the eight effect kinds/ordinals and same transaction. It returns **STAGED,
commitVerified=false**. The port has no commit, payment, booking or provider method.
There is no default adapter or call from any engine, route, worker or launcher.

The immutable capture binds fixture, booking, obligation, command, attempt, original
hold/claim, provider account, Session/PI/charge, exact EUR cents, VERIFIED_INITIAL
outcome and eight effect IDs in real engine order. Stored statement times are
compared chronologically; effects lacking a stored clock field may use NULL plus
explicit ordinal. No missing clock is manufactured and no commit timestamp is added.
Exactly one logical confirmation notice is linked; PAID_IN_FULL or other notices do
not count as duplicate booking confirmations.

A separate independently anchored settlement observation binds capture ID/digest,
original native transaction/backend and fresh source/target, observer/evidence
reference and COMMITTED/REJECTED/UNCERTAIN outcome. A committed observation must see
the original immutable capture row, not merely the later financial rows. Rejected
capture may be absent because its transaction rolled back; absence alone proves
neither rollback nor failed Stripe payment. Uncertain outcomes remain uncertain.
Independent capture/observer capability control and real native recording are
external requirements; simulated assertions cannot establish those facts.

## Read-only verifier and compatibility

The verifier imports only the new **pure evidence validator**, not the staging port,
engine, inbox worker or database adapter. It never records, repairs or reconciles.
Existing financial, inventory, provider, notification, webhook and supervision
checks all remain. Current database snapshot transactionId is not treated as the
original transaction.

| Evidence | Result under established precedence |
| --- | --- |
| Original capture absent; retrospective reconstruction; required effect missing or malformed | INCOMPLETE, with ORIGINAL_TRANSACTION_MISSING or ORIGINAL_CAPTURE_INCOMPLETE |
| Native identity/effect/settlement/source/run/digest/row links conflict; repeated original captures; same collector and observer | INVESTIGATION_REQUIRED, ORIGINAL_TRANSACTION_CONFLICT |
| Financial transaction outcome uncertain or visibility unknown | INVESTIGATION_REQUIRED, FINANCIAL_TRANSACTION_UNCERTAIN |
| Rejected original transaction supplied for an expected successful financial scenario | FAIL, FINANCIAL_TRANSACTION_REJECTED; this is not a provider payment-failure assertion |
| Proven invalid chronological order | FAIL under the established invariant rules |
| Complete original committed capture AND all earlier independent invariants | Eligible for PASS; never operational permission |

The database wire schema accepts optional bounded originalTransactions so missing
capture does not erase already established financial violations. PASS nevertheless
requires exactly one complete original record for every normal scenario. Existing
captures labelled retrospective cannot be promoted by renaming a snapshot's
transaction. FAIL still outranks investigation/incompleteness. The expected safe
investigation scenario retains its existing no-payment/no-confirmation rules.

The original 3E forwarding/ingestion APIs remain unchanged and unmounted. The new
factory is an explicit stronger composition; it must be selected by a future approved
launcher. The old journal-only commit stays blocked, and its record-only result no
longer matches the ingestion receipt schema. Native evidence is an intentional
strengthening of the verifier; older bundles without capture become INCOMPLETE.
Existing synthetic helpers now explicitly model the additional original evidence.
No original source acceptance or genuine acceptance is inferred from those fakes.

## DDL and remaining owners

The [non-executable schema design](STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md) identifies
admission/delivery/investigation, original capture/effect and independent settlement
storage; unique keys, restrictive/deferred foreign keys, native-identity constraints,
transaction boundaries, append-only versus mutable state, least privileges and
retention. The pinned migration baseline and older supplemental SQL are unchanged.

- **Owner and independent source/schema reviewer:** approve the new artifact/profile,
  D02/D04 version/grants/retention decisions and original-engine seam scope. No DDL,
  role or financial change is approved merely by this report.
- **Future restricted adapter maintainer:** implement exact fresh-only atomic SQL,
  absent-event serialization, original relationship locks, complete same-transaction
  inbox handoff, original native identity derivation, actual rollback/commit/cleanup
  semantics and independent readback. No real adapter exists in this checkpoint.
- **Financial engine maintainer, after separate approval:** expose original IDs and
  mutation provenance in the existing transaction and attach the staging seam;
  preserve financial SQL/state/locks/constraints and no new reconciliation engine.
- **Independent evidence controller/reviewer:** establish genuinely separate capture/
  settlement producers, immutable storage/common snapshot barrier and retained
  provenance; independently review genuine outcomes only after later authorisation.
- **Owner/operator:** separately authorise any G2/G3/G4 activity. Fresh runner,
  launcher/monitor, deployment, credentials, providers and Milestone 18 are excluded.

## Blocker assessment

All closure requires independent deployment/run evidence and owner authority;
source tests do not close activation blockers.

| Blocker | Status | Remediation A assessment |
| --- | --- | --- |
| B01 | OPEN | Launcher unchanged; explicitly outside scope |
| B02 | OPEN | Existing authority gates reused; real independent grants remain required |
| B03 | OPEN | Added source needs future reviewed artifact packaging; no real package approved |
| B04 | OPEN | Resource reservation unchanged; no reservation/provisioning occurs |
| B05 | OPEN | Additional unapproved schema/privileges design; actual adapter and DDL acceptance missing |
| B06 | OPEN | No live Docker/PostgreSQL attestation performed |
| B07 | OPEN | Exact account/endpoint proof binding added to the handoff contract; genuine association unverified |
| B08 | OPEN | Atomic admission/inbox/investigation source protocol and fault tests added; real SQL/concurrency/durability unverified |
| B09 | OPEN | Original financial capture staging contract added; required actual engine insertion and native recording not installed |
| B10 | OPEN | Read-only verifier now rejects missing/conflicting original proof; restricted genuine readers still required |
| B11 | OPEN | Transaction uncertainty fences retained; actual durable controllers/journals unchanged/unverified |
| B12 | OPEN | No host/session execution-lock installation or live proof |
| B13 | OPEN | Aggregate provider accounting unchanged; no provider calls authorised |
| B14 | OPEN | Unmounted composition only; no operational HTTP host or route changes |
| B15 | OPEN | No launcher/monitor/scheduler development or activation |
| B16 | OPEN | Fresh runner integration explicitly excluded |
| B17 | OPEN | Original/retrospective provenance differentiated; genuine independent capture and common evidence freeze missing |
| B18 | OPEN | No secrets read or credentials provisioned; dedicated protected association remains external |
| B19 | OPEN | No acknowledgement/retry/rollback shortcut after uncertainty; real incident disposition/resumption remains separately gated |
| B20 | OPEN | Await independent review and genuine evidence under later authority; NOT_READY preserved |

## Verification and preservation

Final verification and Git status are recorded below. Only explicit focused offline
tests, nonincremental TypeScript, targeted ESLint, whitespace and read-only status/
source-preservation checks are used. No application build, broad test discovery,
PostgreSQL scenario, genuine webhook/provider call, booking/fixture/Checkout,
worker/listener, Docker/systemd/network, credential or migration operation runs.


Final results:

- **340 tests passed across five explicit offline suites**, including **63 new
  Remediation A cases**. Suites: remediation-a, acceptance-forwarding,
  acceptance-verifier, acceptance-compatibility and acceptance-integration. New
  tests trap pg, Stripe SDK, shared pool, financial engine/worker and infrastructure
  imports and forbid default network transport; all clocks/timers are synthetic.
- Nonincremental TypeScript (`tsc --noEmit --incremental false`) passed.
- Targeted ESLint on all six changed/new source modules and six relevant test/helper
  files passed with `--max-warnings 0`.
- Git tracked/scoped new-file whitespace, local documentation links/fences and all
  20 OPEN blocker rows passed. One trailing blank line was removed from a new file
  during the whitespace check; no semantic source changes followed the passing tests.
- A 557-file initial fingerprint comparison confirms exactly seven scoped existing
  files changed and **550 initial files remain byte-identical**. Seven new files
  complete the 14-file package. All 36 raw migration hashes still match the pinned
  manifest. All unrelated work, protected engine/route/SQL source, existing proposals,
  owner patches, next-env.d.ts and .impeccable (including hook cache) are preserved.
- No protected resource, financial record, genuine provider object, credential or
  infrastructure was accessed or modified. No stage, commit or push occurred.

Final `git status --short`: four pre-existing tracked modifications are unchanged;
55 untracked entries (48 initial and seven new). All edited Stage sources/tests
were already untracked, so their modified contents remain represented by `??`.
There are no staged paths. Exact observed working-tree status:

```text
 M PRODUCT.md
 M next-env.d.ts
 M src/server/stripe-automation-runtime.ts
 M tests/stripe-recovery-domain.test.ts
?? .impeccable/build/
?? .impeccable/mocks/
?? ACCOMMODATION_MANAGEMENT_SPEC.md
?? docs/STRIPE_ACCEPTANCE_CONSOLIDATED_RUN_1.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A.md
?? docs/STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md
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
?? src/server/stripe-acceptance-atomic-handoff.ts
?? src/server/stripe-acceptance-durable.ts
?? src/server/stripe-acceptance-evidence-adapters.ts
?? src/server/stripe-acceptance-financial-capture.ts
?? src/server/stripe-acceptance-financial-evidence.ts
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
?? tests/helpers/stripe-acceptance-remediation-fixture.ts
?? tests/helpers/stripe-acceptance-scenario-fixture.ts
?? tests/helpers/stripe-supervision-store.ts
?? tests/helpers/stripe-verifier-fixture.ts
?? tests/stripe-acceptance-compatibility.test.ts
?? tests/stripe-acceptance-forwarding.test.ts
?? tests/stripe-acceptance-host.test.ts
?? tests/stripe-acceptance-integration.test.ts
?? tests/stripe-acceptance-remediation-a.test.ts
?? tests/stripe-acceptance-run.test.ts
?? tests/stripe-acceptance-scenarios.test.ts
?? tests/stripe-acceptance-supervision.test.ts
?? tests/stripe-acceptance-transport.test.ts
?? tests/stripe-acceptance-verifier.test.ts
?? tests/stripe-acceptance.test.ts
```

Readiness remains **NOT_READY**. All **B01–B20 remain OPEN**. Stop after source
implementation and verification for independent review; no fresh runner,
launcher/monitor, infrastructure, genuine acceptance or Git operation follows.
