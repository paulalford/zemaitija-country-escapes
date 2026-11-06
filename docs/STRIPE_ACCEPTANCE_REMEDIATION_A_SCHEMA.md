# Remediation A — Unapproved evidence-schema design

**NON-EXECUTABLE DESIGN ARTIFACT. NOT AN APPROVED MIGRATION. DO NOT APPLY.**

This Markdown sketch supports [Remediation A](STRIPE_ACCEPTANCE_REMEDIATION_A.md).
It is intentionally incomplete as deployable SQL: admission/capture functions,
deferred validation, effective ACL acceptance and login provisioning require
independent source review and owner approval. No SQL is run by this checkpoint.

The exact 36 migrations through 0035, their journal/raw hashes and the existing
[consolidated supplemental proposal](proposals/STAGE_2C_CONSOLIDATED_RUN_1_EVIDENCE.sql)
remain unchanged. This design is a separately versioned, separately hash-reviewed
extension. D02/D04 must decide how the future protected artifact profile binds the
additional design/implementation; the current supplemental-profile approval does
not silently authorise it. No 0036 entry or production migration is introduced.

## Required relationships and transaction boundaries

| Record | Immutable identity / uniqueness | References and transaction requirement |
| --- | --- | --- |
| Webhook admission | admission UUID; globally unique Stripe event ID within the fresh cluster; original event type/object/account/endpoint/digest; exact run/source/migration/target binding | Original native XID8 and backend identity; approved fixture/booking/obligation/command/attempt/hold/Session/PaymentIntent relationships for PAYMENT; required existing inbox UUID or approved investigation UUID |
| Delivery | distinct delivery UUID for every observed delivery; original admission UUID; incoming digest and signature-evidence reference | First admission, delivery and required inbox/investigation are inserted in ONE transaction; duplicate delivery preserves original admission/inbox; digest conflict adds investigation without changing original |
| Investigation | investigation UUID; admission/delivery reference; reason, incoming/original digest, retained nonsecret ownership conflict evidence | Insert before acknowledging unknown/conflicting/unsupported delivery; never eligible for payment processing; no implicit recovery, refund or confirmation |
| Financial capture | capture UUID; unique (run, fixture, original XID8, capture kind); exact immutable capture digest | Actual reconciliation/payment/allocation/claim/hold/booking/audit/notice IDs and their original transaction; INSERT inside the SAME governed financial transaction before COMMIT |
| Financial effects | unique (capture UUID, ordinal), unique (capture UUID, effect kind) | Eight required effect kinds in actual engine order; actual statement timestamps where stored, otherwise NULL plus ordinal; no invented commit timestamp |
| Settlement observation | immutable observation UUID and source reference; capture ID/digest and original transaction identity | Independently retained COMMITTED/REJECTED/UNCERTAIN observations; COMMITTED requires original capture visible and matching all identity/digest links; never overwrite an uncertain observation with success |

The existing processing inbox is **public.stripe_webhook_events**, consumed by
**processPaymentWebhookInbox**. It is not a new outbox or a second reconciliation
queue. Its existing event uniqueness and governed lease/processing/retry state
remain authoritative. The legacy unscoped ingestStripeWebhook cannot be used as a
fallback: its ON CONFLICT increments delivery_count without checking original
digest and it is not atomic with acceptance evidence.

The future admission function must serialize by globally scoped event identity
(including an absent original row), then use the existing unit/booking/attempt/
command lock ordering to validate ownership on that same authenticated session.
A transaction-scoped advisory lock or reviewed equivalent is needed for the absent
row case; the existing unique event key alone does not lock a missing admission.
It must also reject a legacy/orphan inbox event without a matching original
admission. Do not adopt, repair, replace or reset that history automatically.

## Illustrative table shapes only

The following excerpts omit the mandatory reviewed functions and deferred guards;
they are relationship sketches, not runnable migration content. New constraints
apply only to proposed evidence tables. No existing financial/inventory trigger,
constraint or reconciliation statement is changed.

```sql
-- Sketch: every writer-controlled provenance column must actually be filled by
-- the restricted function from protected run identity and the ORIGINAL session.
-- pg_current_xact_id() supplies XID8; it supplies no commit time or commit LSN.
CREATE TABLE zec_acceptance.webhook_admissions_v1 (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  manifest_digest text NOT NULL,
  source_digest text NOT NULL,
  migration_digest text NOT NULL,
  target_digest text NOT NULL,
  stripe_event_id text NOT NULL UNIQUE,
  original_payload_digest bytea NOT NULL
    CHECK (octet_length(original_payload_digest)=32),
  event_type text NOT NULL,
  object_type text NOT NULL,
  object_id text NOT NULL,
  account_id text NOT NULL,
  endpoint_id text NOT NULL,
  native_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  original_backend_pid integer NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('PAYMENT','INVESTIGATION')),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE RESTRICT,
  obligation_id uuid REFERENCES public.payment_obligations(id) ON DELETE RESTRICT,
  command_id uuid REFERENCES public.provider_commands(id) ON DELETE RESTRICT,
  attempt_id uuid REFERENCES public.payment_attempts(id) ON DELETE RESTRICT,
  hold_id uuid REFERENCES public.inventory_holds(id) ON DELETE RESTRICT,
  session_id text,
  payment_intent_id text,
  inbox_id uuid UNIQUE REFERENCES public.stripe_webhook_events(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  investigation_id uuid,
  CHECK ((disposition='PAYMENT' AND inbox_id IS NOT NULL
    AND investigation_id IS NULL AND booking_id IS NOT NULL
    AND obligation_id IS NOT NULL AND command_id IS NOT NULL
    AND attempt_id IS NOT NULL AND hold_id IS NOT NULL AND session_id IS NOT NULL)
    OR (disposition='INVESTIGATION' AND inbox_id IS NULL
      AND investigation_id IS NOT NULL))
);

CREATE TABLE zec_acceptance.webhook_deliveries_v1 (
  id uuid PRIMARY KEY,
  admission_id uuid NOT NULL REFERENCES zec_acceptance.webhook_admissions_v1(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  incoming_payload_digest bytea NOT NULL CHECK (octet_length(incoming_payload_digest)=32),
  signature_evidence_ref text NOT NULL,
  native_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  result text NOT NULL CHECK (result IN ('INGESTED','DUPLICATE','INVESTIGATION')),
  plan_digest text NOT NULL,
  immutable_plan jsonb NOT NULL
);

CREATE TABLE zec_acceptance.webhook_investigations_v1 (
  id uuid PRIMARY KEY,
  admission_id uuid NOT NULL REFERENCES zec_acceptance.webhook_admissions_v1(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  delivery_id uuid NOT NULL UNIQUE REFERENCES zec_acceptance.webhook_deliveries_v1(id)
    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  native_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  reason text NOT NULL,
  retained_evidence jsonb NOT NULL
);
-- Required further evidence-only FK: admission.investigation_id ->
-- webhook_investigations_v1(id), DEFERRABLE INITIALLY DEFERRED, ON DELETE RESTRICT.

CREATE TABLE zec_acceptance.financial_captures_v1 (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL,
  fixture_id uuid NOT NULL,
  manifest_digest text NOT NULL,
  source_digest text NOT NULL,
  migration_digest text NOT NULL,
  target_digest text NOT NULL,
  native_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  original_backend_pid integer NOT NULL,
  origin text NOT NULL CHECK (origin='ORIGINAL_DOMAIN_TRANSACTION'),
  capture_digest text NOT NULL,
  reconciliation_id uuid NOT NULL REFERENCES public.reconciliation_records(id) ON DELETE RESTRICT,
  payment_id uuid NOT NULL REFERENCES public.payment_records(id) ON DELETE RESTRICT,
  allocation_id uuid NOT NULL REFERENCES public.payment_allocations(id) ON DELETE RESTRICT,
  claim_id uuid NOT NULL REFERENCES public.inventory_claims(id) ON DELETE RESTRICT,
  hold_id uuid NOT NULL REFERENCES public.inventory_holds(id) ON DELETE RESTRICT,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  confirmation_audit_id uuid NOT NULL REFERENCES public.audit_events(id) ON DELETE RESTRICT,
  confirmation_notice_id uuid NOT NULL REFERENCES public.notification_outbox(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents>0),
  currency char(3) NOT NULL CHECK (currency='EUR'),
  immutable_capture jsonb NOT NULL,
  UNIQUE (run_id,fixture_id,native_xid)
);

CREATE TABLE zec_acceptance.financial_capture_effects_v1 (
  capture_id uuid NOT NULL REFERENCES zec_acceptance.financial_captures_v1(id) ON DELETE RESTRICT,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 8),
  kind text NOT NULL,
  row_id uuid NOT NULL,
  native_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
  statement_at timestamptz,
  PRIMARY KEY (capture_id,ordinal), UNIQUE (capture_id,kind)
);
```

Mandatory additional function/deferred-validation design before approval:

- Bind every row to the single independently approved fresh profile/run and exact
  source/migration/supplemental/target identities. Prevent arbitrary provenance
  overrides; DEFAULT expressions alone do not stop a caller supplying false values.
- Verify persisted booking → obligation/attempt/hold → command and original
  request/key, plus persisted Session/PaymentIntent identity. Nullable PaymentIntent
  means explicitly not yet bound, not a metadata ownership shortcut. An unknown
  Session cannot enter the payment lane. A PI event requires the matching PI and
  its bound Session. Wrong event/type/object/account/endpoint goes outside payment.
- For an initial PAYMENT admission, cross-check inbox event ID, type/object/ID,
  provider-created time and original digest, and record same original XID8. The
  inbox INSERT is PENDING only once. Preserve mutable processing state on duplicate;
  no reset of PROCESSED, leases, attempts or financial history. A conflicting digest
  may not update or hand off that incoming payload to the original payment row.
- Require the admission, delivery and first inbox/investigation to share the
  original transaction identity. Duplicates/conflicts write their new delivery/
  incident in a new transaction while referencing the unchanged original one.
- Validate native identities and eight original financial effects at their actual
  domain mutation points. Foreign keys establish existence, not original atomicity.
  A JSON payload or a later SELECT of matching rows cannot establish this property.
- Append-only UPDATE/DELETE denial for new evidence; deferred evidence-only guards
  for the XOR handoff/investigation requirement, reference ownership and complete
  effect set. Guard code is not supplied or installed by this sketch.

Settlement observations need a separate independently controlled append-only
journal/table. It must bind run/source/target, original XID8/backend, attempted
capture ID/digest, observer and retained evidence reference. It must not require an
FK to a committed capture for REJECTED or UNCERTAIN: a rolled-back capture row is
absent. Missing rows alone prove neither rollback nor failed payment. A COMMITTED
observation requires the actual original capture row and digest after commit.
No state is overwritten and no automatic promotion of UNCERTAIN is allowed.

## Permissions, retention and approval

A future dedicated admission role should execute only a bounded reviewed admission
function and read required scoped ownership data. It must have no financial
mutation, migration, provisioning or arbitrary inbox reset capability. Its login
and inclusion in a fresh-role adapter require separate review; this checkpoint
creates no role or real database adapter.

The future original capture seam must use the **existing original application
connection**, never migration credentials or a second transaction. A narrowly
reviewed append-only capture function may be granted to that fresh application
role. It must derive native identity/provenance internally, validate actual effects
and change no financial row. A separate independently controlled reader supplies
settlement observations. The restricted verifier reader gets bounded SELECT only
on immutable capture/effect/admission/observation records, with no mutation or
writer-function execution. PUBLIC, owner, role membership and inherited privileges
must be independently accepted; no grants in this design are applied.

If admission staging fails, the owner transaction rolls back the entire new
admission/inbox/delivery/incident set. A lost COMMIT reply remains UNCERTAIN even if
some records might exist; retain and fence, do not retry automatically. Provider
redelivery remains the normal external delivery mechanism under valid fresh
signature and authority. Fence removal or any incident reconciliation needs new
explicit authority.

The proposed capture INSERT rolls back with a rejected financial transaction; an
independent attempted-outcome record must be retained separately. A rejected SQL
transaction is not a failed Stripe payment and never releases inventory by itself.
Do not delete retained bookings, financial rows, idempotency keys, claims, evidence
or resources as rollback. Once any evidence is committed, down migration or
retirement requires a separately reviewed retention plan. No cleanup, rollback SQL
or automatic repair is authorised here.

## A-1 read-only investigation compatibility correction

[Remediation A-1](STRIPE_ACCEPTANCE_REMEDIATION_A_1.md) reuses the exact pure
`atomicHandoffPlanSchema` and `witnessSchema` now located in
`src/server/stripe-acceptance-handoff-evidence.ts`. The atomic facade re-exports
its existing public types/schema. This extraction changes no writer behavior,
SQL or operational authority.

The verifier webhook snapshot now carries optional `handoffObservations` holding
these independently retained committed witnesses. Absence is representable for
an INCOMPLETE result; an ACK or writer echo is insufficient. Each observed plan
must match its original admission, delivery, signature account/endpoint, native
transaction identity, exact fresh-run binding and required independently visible
inbox or investigation. The original INSERT delivery must also be retained.
The future reviewed read projection must compare actual admission/delivery/native
identity columns and required rows with `immutable_plan`, rather than merely
returning that JSON or the admission writer's commit response. Restricted reader
identity, protected snapshot anchors and independently retained observation
provenance remain launcher/review requirements; schema validation alone cannot
establish that a supplied reader is trustworthy.

| Durable path | Original admission | Incoming delivery | Required observed relationship |
| --- | --- | --- | --- |
| PAYMENT | PAYMENT, owned booking/obligation/command/attempt/hold/provider links, original digest, nonnull inbox | INGESTED or identical DUPLICATE, PAYMENT lane | Original governed inbox and independent committed witness; original financial capture remains separately mandatory for paid verification |
| Investigation only | INVESTIGATION, exact run association, nullable ownership, null inbox, nonnull investigation | INVESTIGATION, NONE lane, signature/account/event/digest proof | Durable incident matching the incoming delivery and independent committed witness; no payment inbox requirement |
| Conflicting duplicate | Preserve original admission, digest, ownership and any original payment inbox | Same event ID, distinct incoming digest, INVESTIGATION, NONE lane, new incident | Original INSERT observation plus conflicting delivery observation and matching incident; original inbox remains bound to original digest |

`deliveries[].inboxId` is nullable only to describe the investigation-only path.
For a conflict against a payment admission it still identifies the original inbox;
it never authorises processing the conflicting payload. Explicit unresolved
ownership remains investigation, not expected-safe unsupported-event acceptance.
The expected unsupported-event scenario can pass its safety checks while its
booking remains unpaid and unconfirmed.

No additional proposed DDL is needed: the existing admission XOR constraint,
per-delivery immutable plan, incident references and separately retained commit
observations represent both paths. This sketch remains **unapproved and
unapplied**, and still requires reviewed functions, ACLs, guards and real read
adapters before deployment. No migration or existing supplemental proposal changes.
