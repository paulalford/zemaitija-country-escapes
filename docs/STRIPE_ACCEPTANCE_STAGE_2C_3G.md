# Stage 2C-3G — Scheduler and supervision

Source implementation and deterministic simulation only, against the supplied
`a4f4a22` baseline plus the existing accepted-stage working tree. No operational
authority, launch command, timer, worker entry point or adapter implementation is
provided. Stage 2C-3H and Milestone 18 are outside this checkpoint.

## Changed files

Exactly four new files belong to this checkpoint:

- `src/server/stripe-acceptance-supervision.ts`
- `tests/stripe-acceptance-supervision.test.ts`
- `tests/helpers/stripe-supervision-store.ts`
- `docs/STRIPE_ACCEPTANCE_STAGE_2C_3G.md`

No pre-existing file is edited. Earlier-stage files already present as untracked
work and the pre-existing modifications to `next-env.d.ts`, automation runtime and
recovery-domain tests are preserved. Unrelated design, accommodation documents,
proposals and owner patches are preserved. No staging, commit or push occurs.

## Inspected and reusable guarantees

Read AGENTS.md, PRODUCT.md, Stage 2A, 2C-2 and 2C-3B through 3F documentation;
acceptance-run/host/boundary/forwarding/fixtures/status, automation runner/runtime,
settlement, recovery leases and the relevant deterministic test patterns.

The unchanged Stage 3B seal checks canonical manifest/artifact hashes, the pinned
migration chain, fresh derived target, approval reference, resource history, test
account and finite run budgets. Its in-process WeakSet proves issuance only. The
new binding reuses its canonical hashing and seal validation; locks are derived
from that exact run/profile. It imports no pool, provider SDK or Docker adapter.

The Stage 3D host returns `ready:false`, including for valid recorded attestations;
it supplies no operational authority. The new supervisor does not invoke it, the
Stage 2C-2 boundary, the HTTP adapter, the forwarder, fixture writer or runner.
Stage 3F plans remain inert and its read-only status remains separate.

The existing runner supplies cooperative 60-second invocation, admission/work-item
bounds, SQL/provider deadlines, a scope request cap and cleanup observations. Stage
3C correctly injects bounded transport into fresh startup/worker gateways. Scope
counts reset; aggregate accounting was absent. This checkpoint models the missing
durable allowance seam without changing the accepted transport/runner contracts.

Payment recovery generations and leases fence metadata completion, not whole-host
execution. Existing command persistence/original idempotency keys and financial
reconciliation remain authoritative. No new payment processor, recovery SQL,
financial constraint, inventory authority or notification operation is introduced.

## Disabled supervision and state machine

`SUPERVISION_POLICY` is frozen with scheduling/operations/execution false. There is
no enable/execute API, environment switch, scheduler, timer or worker callback.
`inspectSupervisionSimulation` always reports operational `state:DISABLED` and both
enablement flags false. Synthetic states appear only as `simulatedState`.
`appendSupervisionSimulation` appends model data to an injected fake store; its
result can never be used as a launcher credential. The future adapter interfaces
are type contracts only. There is no executable future invocation interface.

| Simulation state | Required evidence and effect |
| --- | --- |
| DISABLED | Empty verified journal; operational state remains here throughout |
| PENDING_AUTHORITY | OPEN records a unique invocation ID and bounded deadline |
| READY_FOR_AUTHORISED_INVOCATION | Model checks all eight independent authority dependencies and exact target binding |
| LOCKED | Host lock then database control lock both observed acquired |
| RUNNING | START after authority and both locks, before deadline |
| CANCELLING | Explicit cancellation or uncertain/cancelled/timed-out provider result; no new reservations |
| COMPLETED | Known successful worker, no pending/uncertain provider request, settled cleanup, both releases, before deadline |
| FAILED | Known worker failure or cooperative cancellation, with settled results/cleanup/releases |
| UNCERTAIN | Interrupted record stream, unknown provider/worker result or cleanup failure |
| HALTED | Lock contention/loss, invalid/unverifiable history or contradictory evidence |

All terminal records are immutable. Conflicting or repeated terminal events reject.
A new invocation requires the previous invocation to be durably finished, certain
and neither HALTED nor UNCERTAIN; total invocation count cannot exceed the seal.
No reconciliation/override API exists to clear an uncertain run. That needs
independent review and a separately designed durable reconciliation record.

## Complementary exclusive locks

The future Linux Mint launcher must use the fixed host-owned
`/run/lock/zec-acceptance/invocation.lock`, never a caller path. A root-owned,
non-writable-by-service parent directory and precreated root-owned regular file
(service group writable, mode 0660) must prevent replacement/unlink/symlink attacks.
Use descriptor-based no-follow validation and a nonblocking exclusive kernel flock.
The launcher retains its descriptor until all child work and cleanup settle; the
kernel releases it on process death. Descriptor inheritance must be controlled so
a surviving child cannot accidentally release or prolong authority. The launcher
must keep the worker in the same supervised process group/cgroup, terminate and
observe all descendants before a normal release. Never unlink the lock file.

For cross-machine exclusion, acquire a dedicated PostgreSQL **session** advisory
lock after the host lock. `controlLockKey` is the first 64 SHA-256 bits of
`zec-supervisor-v1:PROFILE:RUN_UUID`; a future adapter must map its two unsigned
32-bit halves to signed PostgreSQL int32 arguments without numeric precision loss.
It is a separate namespace from recovery leases and inventory reservations.
Hold the same pinned authenticated session, without pooling/reconnect, throughout
startup checks, worker activity and cleanup. Revalidate fresh cluster identity and
role before acquiring; each host must connect to that same approved cluster.
Fresh-run resource reservation still prevents two distinct runs sharing resources.

Any dropped session, unknown ownership or failed liveness check cancels admission
and halts. Reconnecting does not restore authority. A partitioned former holder may
still have an external request in flight: a new holder must verify the durable
journal and refuse unfinished/uncertain work, even if PostgreSQL grants the lock.
Locks alone do not fence a remote provider request already delivered.

`FutureExclusiveLocks` specifies acquisition/check/release observations. Test-only
registries simulate process death, session loss, same-host contention and remote
database contention. No OS lock or PostgreSQL advisory lock is acquired here.

## Durable journal, accounting and recovery

`DurableSupervisionStore` is a single linearizable authority for journal AND request
budget. Each ordered entry includes run/invocation IDs, manifest/source/migration
hashes, approval reference, fresh target digest/database/control key, UTC timestamp,
event, sequence, previous digest and SHA-256 digest of canonical entry core bytes.
OPEN supplies the invocation deadline. LOCK, RESERVE, PROVIDER_RESULT, CANCEL,
WORKER, CLEANUP and FINISH record the corresponding observations and completion
timestamp. Event enums/reasons deterministically reconstruct fixed diagnostic
codes; no provider exception, credential, guest information or raw payload is stored.

The store must durably acknowledge only after append, budget update and protected
head checkpoint commit atomically. No acknowledged in-memory-only write qualifies.
Snapshot reads must be complete, durable, current and bound to the independently
protected sequence/head. Sequence gaps, wrong hashes/bindings, backwards time,
missing tail, invalid transitions and conflicting terminal records reject. A hash
chain alone cannot detect an attacker replacing the entire chain or rolling back
its head: protected checkpoints, access control and independent evidence retention
are mandatory future adapter responsibilities, not a property proved by this fake.

The model validates a proposed append then uses sequence/head compare-and-append.
Only one competing CAS wins; losers dispatch nothing. Unknown read/write or commit
acknowledgement fences the run until independent reconciliation. A local WeakSet
also prevents reuse of a failed adapter; durable fencing across new adapters and
processes is the store's mandatory responsibility. A replacement adapter must not
turn unknown persistence into an empty run.

On restart, verify the entire durable stream and checkpoint before doing anything.
Any unfinished invocation reconstructs UNCERTAIN, even if the worker never started
or already reported success. A missing FINISH is never inferred as successful.
Worker observations distinguish DEFINITELY_NOT_STARTED, STARTED_KNOWN_RESULT and
STARTED_UNCERTAIN_RESULT. Unknown history reports the conservative last category.
Invocation state is evidence about execution, never payment success or failure.

Every underlying provider HTTP attempt must first durably append one RESERVE with
a unique request UUID and operation category: startup account verification, worker
account verification, Checkout dispatch, payment-status recovery, reconciliation
or another independently authorised operation. Usage is the count of reservations,
not a volatile counter. It must satisfy both per-invocation and complete-run caps.
The original manifest's invocation cap is enforced too; restart cannot reset either.

After dispatch, append its known/uncertain/cancelled/timed-out/not-started outcome.
All reservations permanently consume one allowance, including definitely unstarted
requests. This conservative design avoids refunds racing uncertain dispatch; actual
usage may be less than the charged allowance. Missing outcomes block completion.
Uncertain outcomes block normal completion and further admission. Never reuse a
request UUID for another HTTP attempt, including automatic SDK retries.

`FutureAggregateProviderGate` describes where a later reviewed transport must reserve
before sending and record afterward. It must wrap the underlying fetch beneath the
existing bounded transport, covering both account checks and every retry/scope/lane.
After awaiting reservation, recheck authority, locks, deadline and abort signal
immediately before actual dispatch. Denied/unknown reservation means no dispatch.
The existing bounded transport remains responsible for its tighter scope/time/body
limits. This source-only model **cannot enforce real Stripe budgets** until the
approved transport, durable store and trusted launcher are connected and reviewed.

The test helper's explicitly simulated committed image survives new fake adapters.
It simulates CAS and pre/post-commit acknowledgement loss with a persistent fence.
This proves algorithm behavior, not OS persistence, fsync, database atomicity,
crash recovery on real storage or live concurrency safety.

## Windows, cancellation and shutdown

OPEN must occur inside the sealed run window and its deadline must be positive,
at most 60 seconds after OPEN, and no later than run expiry. Admission at the exact
deadline rejects. Timestamps must be safe integer UTC milliseconds and nondecreasing.
Post-deadline writes may preserve outcomes/cleanup/cancellation evidence; they may
never admit work or declare COMPLETED. A future launcher must combine trusted UTC
window checks with monotonic elapsed deadlines so clock changes cannot extend work.

Run-window expiry, invocation deadline, SIGTERM/host shutdown, stalled worker and
operator cancellation stop admission and signal cooperative abort to the unchanged
runner/scopes. Provider timeout/cancellation after dispatch means uncertain delivery,
never payment failure. A reserved but unresolved request retains its allowance.
Lock loss or unverifiable journal prevents further processing. Journal failure must
trigger external evidence preservation because it cannot reliably record its own
failure. Failure/stall of cleanup cannot be reported as successful rollback.

This model creates no wall-clock timers and cannot terminate a stalled dependency.
Existing cooperative cancellation and `PENDING_EXTERNAL_SUPERVISION` settlement
observations remain necessary but insufficient for hard termination. A future
external monitor must cancel on window/deadline/lock/journal failure, then terminate
the complete service cgroup after a short reviewed grace and preserve uncertainty.
SIGKILL cannot append FINISH; recovery sees interrupted execution and blocks.
Releasing a process lock after death does not clear journal uncertainty or establish
that a PostgreSQL COMMIT or Stripe operation failed.

## Illustrative disabled Linux Mint units — NON-INSTALLABLE DOCUMENTATION

Every line below is a comment. No unit files, installation commands, executable
launcher or enablement action are supplied. No `[Install]` section exists. Paths
and limits require independent deployment review; the launcher path does not exist.

```ini
# zec-acceptance.service — ILLUSTRATIVE ONLY, DISABLED
# [Unit]
# Description=Separately approved isolated acceptance invocation
# ConditionPathExists=/var/lib/zec-acceptance/approved/EXTERNAL-REVIEW-GATE
# [Service]
# Type=oneshot
# User=zec-acceptance
# Group=zec-acceptance
# ExecStart=/NOT-INSTALLED/independently-reviewed-trusted-launcher
# TimeoutStartSec=65s
# TimeoutStopSec=5s
# KillMode=control-group
# KillSignal=SIGTERM
# SendSIGKILL=yes
# Restart=no
# NoNewPrivileges=yes
# PrivateTmp=yes
# ProtectSystem=strict
# ProtectHome=yes
# ReadWritePaths=/var/lib/zec-acceptance/journal /run/lock/zec-acceptance
#
# zec-acceptance.timer — ILLUSTRATIVE ONLY, DISABLED
# [Unit]
# Description=Disabled acceptance schedule design
# [Timer]
# OnCalendar=*-*-* *:0/5:00
# Persistent=false
# RandomizedDelaySec=0
# Unit=zec-acceptance.service
```

For a oneshot service `TimeoutStartSec` bounds the invocation; `RuntimeMaxSec` and
a cooperative watchdog alone must not be assumed to enforce it. The example's
65-second outer limit allows a 60-second inner bound plus cleanup grace; the launcher
must stop admission at the earlier sealed run expiry. External monitoring of lock
and journal health is required. Dedicated service identity creation and protected
directories/credentials, network permissions and exact systemd-version behavior
remain separate deployment gates. Do not give the service an unrestricted Docker
socket merely to satisfy identity checks; review a restricted attestation capability.

Manual activation would require separate source/adapter review, exact run/operation
approval, independently protected artifacts, atomic resource reservation, verified
fresh Docker/PostgreSQL and Stripe test-account identity, durable journal/budget
store, both locks and external shutdown supervision. Synthetic records, seals,
environment flags or a recorded `ready:false` host result satisfy none of these
operational gates. Rollback means disable admission/scheduling, stop cooperatively,
settle/terminate under supervision and preserve all uncertain/financial evidence.
It never means resetting a database, deleting history or refunding automatically.

## Verification and boundaries

539 tests passed across ten focused suites: supervision (60 cases), scenarios,
forwarding, host, run, transport, acceptance, automation foundation/runtime and
recovery domain. Nonincremental TypeScript and targeted ESLint with zero warnings
passed. Git tracked and four scoped new-file whitespace checks passed. These and
Git status are the only verification commands. Tests use synthetic clocks,
source-byte inspection and in-memory adapters; no live account verification or
operational acceptance is claimed.

Still missing: independently approved trusted launcher, protected authority/artifact
readers, live identity and reservation adapters, real process/session locks, durable
journal/checkpoint and budget store, reviewed transport connection, external monitor
and independently authorised reconciliation of interrupted invocations. No existing
Stage 2C-3B through 3F contract was changed and no demonstrated defect in them was
assumed or repaired.

No PostgreSQL connection, Stripe request, Docker operation, systemd operation,
credential/environment-file read, listener, worker, scheduler, fixture, booking
acceptance, Checkout command, webhook delivery, migration, DDL, financial change,
deployment or operational execution occurs. Existing financial evidence, protected
databases and unrelated working-tree files remain unchanged.
