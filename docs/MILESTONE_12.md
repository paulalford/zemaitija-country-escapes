# Milestone 12 — scheduled notices and governed nonpayment cancellation

The service functions are explicit calls only. Starting Next.js does not run jobs.
No public job route, production mail transport, refund execution, or live payment path is installed.

## Entry points

- `scheduleBalanceNotices(pool, { limit, dryRun, bookingId })` queues the T–21, T–14 and post-deadline notices. It selects by warning time and booking ID, and uses one stable key per scheduled event. `bookingId` scopes a manual run.
- `deliverOneSandboxNotice(pool, transport)` handles one due outbox row, including `BOOKING_CONFIRMED` and `PAID_IN_FULL` in the accepted LT/EN/DE locale. `recoverExpiredSandboxDelivery(pool, transport)` investigates an expired sending lease. Both support optional booking and provider-incident IDs for scoped execution. The supplied transport must declare `sandbox: true`, offer key lookup, and target only synthetic guest IDs or the operations sink. The included in-memory transport is for tests and local inspection only; it is not durable across processes.
- `previewNonpaymentCandidates(pool)` lists eligible bookings without changing them. `cancelUnpaidBooking(pool, gateway, bookingId)` performs one provider-reconciled cancellation only when the caller explicitly sets `approveProposedZeroChargePolicy: true`. This flag represents a separate commercial-policy gate; it must not be enabled by ordinary server startup. Clock override is test-only.

The accepted booking's `warning_at`, `balance_due_at`, and `grace_ends_at` are immutable UTC instants derived from local `Europe/Vilnius` calendar dates. W and D use local 15:00; G is 24 elapsed hours after D.

## Database changes

`0022` permits the narrow confirmed-to-nonpayment transition and grants the runtime role only the additional outbox, attempt, and assessment access needed by these jobs. `0023` corrects the consumed-hold guard for a released nonpayment claim. `0024` requires terminal unpaid balance evidence and a full refund obligation for every allocated capture before a nonpayment cancellation can commit. The common inventory exclusion constraint remains in force. These migrations do not edit existing booking or Stripe records.

`0025` preserves that entry requirement while permitting a historical attempt to succeed after committed cancellation when the verified capture is unallocatable and backed by matching reconciliation evidence, an operational incident, and a full refund obligation. It replaces only the existing trigger function and changes no grants or stored payment data. The installed deferred function is bound to bookings, claims, holds, attempts, and provider commands. Late reconciliation preserves provider success time in both the reconciliation evidence and capture record, keeps inventory released, and deduplicates by PaymentIntent identity.

No provider refund is made here. The proposed zero-charge outcome creates immutable refund obligations for captured funds. Milestone 13 must implement refund execution and any later policy review. Notification delivery failures leave booking and money unchanged. Unknown transport outcomes stay failed for investigation when lookup cannot prove whether the provider accepted a message.

Delivery completion and suppression require the exact latest unfinished attempt and an unexpired lease under the outbox lock. Recovery validates the same attempt and expired lease again after provider lookup. Confirmed acceptance becomes sent; all other recovery outcomes require investigation, because an absent provider record cannot rule out a still-running send. Stale completions append audit evidence without overwriting recovery state or starting another send.

## Operational incident notices and guest-update gap

`UNALLOCATABLE_CAPTURE` and `PAYMENT_EVIDENCE_MISMATCH` dispatch only to the operations sandbox sink. Their LT/EN/DE messages identify the internal incident or booking and direct operations to authoritative evidence, the refund obligation where applicable, and guest communication. They include no guest details, credentials, or raw provider responses. Operations notices bypass ordinary booking reminder suppression, including after cancellation or payment. Incident-owned outbox rows do not require a booking or price snapshot; failure alerts retain the original incident association. Stable keys, attempt tracking, retries and lease fencing apply to both booking-owned and incident-owned notices. No schema, permission, reconciliation, cancellation or inventory rule changes are required for this dispatch correction.

[Booking/payment specification §8](BOOKING_PAYMENT_SPEC.md#8-notification-contract) requires a guest status/update when money is affected, in addition to the operations alert. **That guest incident-notification workflow is still missing.** The current producers emit operations events only; an operations notice or cancellation notice does not fulfill the guest payment-status requirement. A known late balance incident can be associated with a booking through its source audit event, but a provider incident does not universally establish an authorized guest recipient. The worker does not infer a recipient or report a refund as completed.

Milestone 13 owns the missing incident/refund communication lifecycle: create an idempotent guest status outbox event in the incident transaction when the guest association is verified, use the accepted locale, retain refund-pending wording until provider confirmation, handle existing incidents without duplicate notices, and record investigation when no verified guest association exists. Milestone 14 owns any scoped manage-booking links and authenticated guest access used by those messages. This is an outstanding notification-contract requirement, not permission to omit guest updates in a deployed workflow; refund execution remains outside Milestone 12.

## Local verification

Apply migrations to the local development database with `npm run db:migrate`; then run `npm run db:check`, `npm run typecheck`, `npm run lint`, and `npm test`. The database tests require the restricted application role and synthetic fixtures. They do not call Stripe or a real mail provider.
