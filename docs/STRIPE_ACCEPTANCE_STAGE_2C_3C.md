# Stage 2C-3C — Bounded Stripe transport correction

Source and deterministic tests only. No operational activation is provided.

## Root cause and correction

The Stage 2C-2 boundary constructed a gateway using raw `deps.fetch`, then supplied
`constructStripe: () => gateway` to the automation runner. The runner supplied a
bounded transport, but that callback ignored it. SDK requests could therefore bypass
the runner's scope cancellation, request timeout, response-size and request-count
checks. A previously cached startup account check could also replace fresh worker
account verification.

The corrected sequence is:

1. Validate authority, explicit test configuration and bearer; attest Docker and
   verify database identity/capabilities before any provider construction.
2. Construct a startup gateway using the existing `boundedAutomationFetch` and a
   separate 10-second `AutomationScope`. It retains the existing 1-second individual
   request bound, 1 MiB response cap and 12-request scope budget.
3. Verify declared and observed account identity and the startup deadline. Close
   the startup scope on success or failure. Its transport cannot make later HTTP
   requests. Existing StripeSdkGateway caches successful account verification;
   non-worker operations can reuse that evidence and verify signatures locally.
4. After separate automation authority checks, invoke the unchanged runner. Its
   Docker, SQL identity and capability checks precede worker gateway construction.
5. Pass the runner's supplied transport directly to a **fresh** gateway factory.
   Reject missing fetch, the raw dependency fetch, missing account verification,
   wrong declared account and reuse of the startup gateway object. There is no
   optional transport/default-client fallback in this boundary.
6. The runner verifies the new gateway's observed account before constructing its
   processors. All worker SDK requests must use this supplied transport, including
   account verification. Its dynamic scope follows the runner's current work item.

The shared Stripe adapter and automation runner are unchanged. Gateway factories
remain trusted injected capabilities: this is not a sandbox against malicious
factory code that ignores its argument or constructs a hidden client. A future
launcher must use the reviewed StripeSdkGateway with the supplied transport.

## Cancellation, uncertainty and cleanup

The existing transport already rejects expired/cancelled scopes. It now also rejects
an already-aborted caller signal **before** calling the underlying fetch. Such a
rejection is definitely not sent by this wrapper. Once fetch has been called,
cancellation cannot prove that Stripe did not receive or complete a request.

Timeouts signal abort through headers and body consumption where the injected
transport supports it. Unsupported cancellation may stall settlement and requires
external supervision; no new promise race claims a hard wall-clock guarantee.
Provider failures remain uncertain domain observations, not confirmed financial
failure. No replacement key, new attempt, automatic refund or inventory release is
introduced. Initial and balance Checkout tests replay the exact persisted request
and original key after a bounded-transport abort.

Startup pool cleanup failure previously disappeared behind an identity rejection.
It now raises the fixed `CLEANUP_UNCERTAIN` code, and the unmounted HTTP adapter maps
it to 503/UNCERTAIN without private errors. Worker cleanup still uses the existing
runner reporting: failed cleanup produces PARTIAL/cleanupFailed; stalled cleanup is
awaited and observed as requiring supervision. Neither case proves rollback.

## Budget limits and remaining gaps

Preserved: 60-second cooperative runner deadline, 15-second admission window,
10-second work scopes, individual provider/SQL timeouts, maximum work items per lane,
12 provider requests per scope, stable keys, submission-age restrictions, recovery
fencing and payment-only inbox processing. Scope changes reset request counts.
**There is no enforced aggregate provider-request budget across scopes, lanes or
invocations.** Stage 2C-3B manifest totals remain inert contracts pending separately
reviewed enforcement; this checkpoint does not claim to implement them.

The fresh-target profile, sealed manifest and their tests are unchanged. They are
not wired into Stage 2C-2. The old globally scanning target must not be activated
against preserved history. Trusted launcher/inventory, fresh infrastructure, live
attestation, webhook forwarding and scheduler remain separately gated work.

## Deterministic verification

Focused suites cover real-runner/fake-resource boundary wiring; startup and worker
account checks; pre-send rejection and possibly-sent cancellation; request exhaustion;
cleanup failure and stalled settlement; original-key replay for initial/balance
Checkout; payment-only filtering; inactive routes; unchanged manifest validation.
Fake transports return in-memory responses or reject on supplied abort signals.
No real SDK, database, Docker, external network, environment file or credential is
used. Actual sandbox acceptance and infrastructure behavior remain unverified.

Changes are limited to acceptance source/HTTP error mapping, the transport's pre-send
abort check, focused tests and this document. No financial engine, migration, target
guard, shared route or inactive implementation gate changes.

Verification: 325 tests passed across acceptance-transport, acceptance, acceptance-run,
automation-runtime, automation-foundation, recovery-domain and automation-hardening.
Nonincremental TypeScript and targeted ESLint (zero warnings) passed. Tracked and
scoped untracked-file whitespace checks were clean. No database, private credential,
Stripe, Docker, worker/scheduler, deployment, staging, commit or push operation ran.
