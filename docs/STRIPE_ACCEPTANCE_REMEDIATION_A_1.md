# Stage 2C — Remediation A-1 source review package

**NOT_READY. B01–B20 remain OPEN.** Deterministic synthetic source verification
only. No G2, G3 or G4 activity or operational readiness claim. Stop for independent
source review; Remediation B and operational integration require separate approval.

## Root cause and correction

The atomic handoff permits an INVESTIGATION admission with a null payment inbox
and a durable incident. The verifier unconditionally joined every delivery to an
inbox, then required an INVESTIGATE/QUARANTINED inbox for the investigation
scenario. Its synthetic fixture manufactured that inbox and concealed the mismatch.

The verifier now branches by the independently observed original admission and
incoming disposition. It reuses the atomic handoff's exact schemas through a pure
read-only module. It does not import the atomic writer or invoke admission,
reconciliation or recovery. The atomic facade preserves all existing exports and
writer behavior; only schema definitions move.

## Evidence requirements

Payment admission requires the original admission and original INSERT delivery,
exact fresh-run/source/migration/target binding, verified event/digest and account/
endpoint signature evidence, persisted booking/obligation/command/attempt/hold/
Session/PaymentIntent relationships, the governed inbox, and an independent
committed-row witness matching the native transaction and immutable plan digest.
Existing provider, original financial capture, allocation, inventory, state
machine, notification and supervision checks still apply independently.

Investigation-only admission requires the original admission/delivery and native
commit witness, signature/account/event/digest evidence, exact run association,
a durable matching incident and NONE processing lane. Ownership may be explicitly
unresolved; that produces INVESTIGATION_REQUIRED. The expected unsupported-event
scenario can satisfy safety checks without any inbox, while retaining its hold
and having no payment, allocation, confirmation or confirmation notice. It never
sets paidBookingVerified. Missing or contradictory evidence prevents PASS.

The webhook snapshot's optional `handoffObservations` permits missing evidence to
be diagnosed without discarding independent financial violations. Its contents
are exact `INDEPENDENT_COMMITTED_HANDOFF` observations, not forwarding receipts.
Protected independent producers/anchors and reviewed reader identity remain
external trust requirements. A schema cannot authenticate an injected reader.

Identical duplicates retain the original admission and inbox. Conflicting same-ID
deliveries retain the original digest/inbox and acquire a separate incident for
the incoming digest. Both original INSERT and conflicting delivery observations
are required; the conflict stays in NONE lane and produces investigation. Inbox
identity is checked against the original event, not the conflicting object.
No verifier path writes an allocation; any second allocation remains FAIL.
Verdict precedence is unchanged: FAIL > INVESTIGATION_REQUIRED > INCOMPLETE > PASS.

## Exact changed files

Modified relative to the A-1 starting tree (these already appeared untracked in Git):

- [atomic facade](../src/server/stripe-acceptance-atomic-handoff.ts): imports/re-exports shared schema definitions; unchanged writer behavior.
- [verifier evidence](../src/server/stripe-acceptance-verifier-evidence.ts): nullable delivery inbox and optional independently committed handoff observations.
- [verifier](../src/server/stripe-acceptance-verifier.ts): independently validates both durable paths and original-versus-incoming conflict identity.
- [synthetic verifier fixture](../tests/helpers/stripe-verifier-fixture.ts): no investigation inbox; original handoff witnesses captured once, never recreated by reanchoring; provider event seconds preserved.
- [verifier tests](../tests/stripe-acceptance-verifier.test.ts): 24 added cases and updated investigation/idempotency fixture expectations and read-only import checks.
- [Remediation A tests](../tests/stripe-acceptance-remediation-a.test.ts): two added cases consume the actual simulated atomic store's payment and investigation witnesses using the shared verifier schema.
- [unapproved schema design](STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md): documents existing relationship compatibility and future independent read-projection requirements; no additional DDL.

New:

- [pure handoff evidence schemas](../src/server/stripe-acceptance-handoff-evidence.ts): extracted unchanged schema definitions and evidence types; imports only Zod and the pure financial evidence contract.
- This report.

## Verification and preservation

- Focused offline Vitest: **223 passed**, three suites: verifier (92), Remediation A (65), forwarding (66). This includes 26 added cases. Existing signed, duplicate/out-of-order, original-capture and retrospective-reconstruction checks remain passing.
- Nonincremental TypeScript checking: passed.
- Targeted ESLint across all seven changed TypeScript files, zero warnings: passed.
- Tracked and new-file whitespace checks: passed.
- Preservation fingerprints: all pre-existing non-secret files outside the seven scoped modifications unchanged; two scoped files added, none removed. Environment files were excluded from the final comparison; see the deviation below.
- Final Git status: four pre-existing tracked modifications and 57 untracked entries; no staged changes. The four tracked modifications are PRODUCT.md, next-env.d.ts, src/server/stripe-automation-runtime.ts and tests/stripe-recovery-domain.test.ts. None was changed by A-1. All nine A-1 files appear as untracked because the starting work was uncommitted.

No database, Stripe, Docker, systemd, network, genuine webhook or operational
service was accessed. No credential was used for a connection. No migration, financial engine, recovery SQL,
trigger, public route, inactive endpoint, original financial capture contract,
.impeccable content, accommodation work, proposal or owner patch changed.
No staging, commit or push occurred.

**Read-restriction deviation:** the initial broad preservation hash scan
inadvertently read `.env.local` and `.env.local.backup` to calculate hashes. This
violated the explicit read prohibition. Their contents were not displayed or
used for any connection, and neither file was modified. Their hash entries were
removed from the temporary inventory; all subsequent checks exclude environment
files. This is a process deviation, not an operational acceptance result.

## Remaining deployment gaps and stop point

The [A schema sketch](STRIPE_ACCEPTANCE_REMEDIATION_A_SCHEMA.md) already represents
nullable investigation inboxes and preserved original admissions on conflict.
No additional schema inconsistency was found in this scoped compatibility review;
no new DDL is proposed or applied. The sketch is still unapproved/unapplied and
incomplete for deployment. Independent read projections must compare actual rows
and native identities with immutable plans; protected observation retention,
reviewed database functions/ACLs and production-quality adapters remain future
work. No live adapter or original financial-engine seam is installed here.

The historical [readiness package](STRIPE_ACCEPTANCE_STAGE_2C_3I_READINESS.md),
[runbook](STRIPE_ACCEPTANCE_STAGE_2C_3I_RUNBOOK.md) and
[evidence register](STRIPE_ACCEPTANCE_STAGE_2C_3I_EVIDENCE.md) remain unchanged,
including F01–F07, D01–D09, G0–G4, every OPEN blocker and unchecked operational item.
This correction closes only the source compatibility defect described above.
Independent source review is the next step; no operational work is authorised.
