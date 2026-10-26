# Milestone 14 independent security review corrections

Scoped follow-up to the existing uncommitted Milestone 14 implementation, with committed baseline `78f368c`. No UI, policy, payment, inventory or dependency redesign. Synthetic fixtures and sandbox transports only.

## Findings and corrections

**A — Defect confirmed.** Revoking existing guest tokens did not invalidate queued issuance authorization. An older access notice could mint a fresh credential after revocation. A guest renewal could also authenticate before revocation and queue after it.

Migration `0033_guest_access_revocation_boundary` adds `guest_access_boundaries` (booking ID and monotonic generation) and `notification_outbox.guest_access_generation`. PostgreSQL stamps authorization when a guest notice is inserted; the captured generation is immutable. A transaction-scoped advisory lock per booking orders request authorization, token issuance and revocation. The token insertion trigger takes the same lock, including for the trusted direct issuer. No transport call occurs under the lock.

Operator revocation advances the generation and revokes all existing tokens and their sessions in the same audited, idempotent management transaction. The worker checks the exact active delivery attempt, unexpired lease and captured generation under the lock before inserting a token. If issuance commits first, subsequent revocation invalidates that token; even a later transport send cannot grant access. If revocation commits first, the old request cannot issue a token. Guest renewal rechecks the session after acquiring the lock and records a durable denial after rollback if it was revoked.

An old dedicated access delivery ends as `SUPPRESSED`, clears its lease, closes its attempt as `SUPPRESSED`, and records `GUEST_ACCESS_REVOKED` audit evidence. It does not enter transport retry. Ordinary payment/refund/status notices retain normal delivery but omit obsolete credentials. Ordinary notices queued after revocation also cannot implicitly restore access. A new explicit operator/trusted request in the current generation can issue fresh access. Replaying an older operation/idempotency key retains its original authorization. Existing lease ownership, unknown-send investigation, provider lookup and idempotency behavior remain in place; raw credentials stay out of persisted outbox/audit data.

**B — No uniqueness defect.** `drizzle/0001_invariants.sql:82` already creates:

```sql
CREATE UNIQUE INDEX admin_users_subject_key ON admin_users (external_subject);
```

Live `pg_index` inspection confirmed `indisunique=true`, `indisvalid=true` and exactly `external_subject` as the indexed column. Pre-change inspection found zero duplicate groups. Both the local provisioning CLI and controlled identity-management function write this same table, so the index covers both paths, including updates and concurrent provisioning. No identity migration, deletion or merge was necessary. Regression tests cover competing provisioning, duplicate direct inserts, conflicting identity updates and preservation of the original mapping.

**C — Defect confirmed.** `requireSession()` and signed administrator login accepted enabled historical roles without a positive allowlist. Individual booking access only checked units when the role was `operations`; booking lists/incidents also allowed any role with a unit grant.

Sessions now positively accept only `operations`, `finance`, `administrator` after the identity lock/recheck. Signed login applies the same allowlist before session creation. Individual booking access positively authorizes operations with its unit grant, or finance/administrator under their existing global booking-review permissions. Lists and incident notice queries explicitly condition unit grants on `operations`.

Pre-change role inspection found 79 administrator, 324 finance and 207 operations identities, with **zero unexpected roles**. No historical roles were changed or automatically normalized. A rollback-only PostgreSQL fixture temporarily removes the role check inside its transaction to reproduce a historical unknown role; actual session, booking, incident and signed OIDC login paths reject it even with a unit grant. Rollback restores the constraint and discards the fixture. This special fixture uses the migration connection because that login intentionally cannot assume the runtime role; normal authorization/concurrency tests use runtime credentials, and separate privilege tests remain in place.

## Forward migration and rollout

`0033` was explained before application and applied only to the existing localhost development database using migration credentials. Its journal entry and generated `0033_snapshot.json` accompany it. The access generation is separate from booking/financial rows; there are now 34 public model tables, including the six Milestone 14 access/management tables.

For migration compatibility, all existing guest notices capture generation zero. Three bookings had prior `guest.access_revoked` audit evidence. Their old concurrency ordering cannot be reconstructed reliably, so the migration conservatively establishes generation one, invalidates remaining access credentials/sessions, and appends `guest.access_fenced` audit evidence. A new explicit request is required for fresh access to these bookings. No identity, booking, inventory or financial history is rewritten.

Keep old workers/request processes quiescent during any later rollout, apply the migration and install the corrected code together, then resume processing. Old application code does not enforce the new generation check. No public deployment or background scheduler was activated here.

Runtime receives SELECT on the boundary table and EXECUTE on narrowly scoped lock/revoke functions, with fixed `public,pg_temp` search paths and PUBLIC execution revoked. Runtime cannot directly update the generation or insert/update/delete administrator identities. Existing restricted financial/inventory privileges remain unchanged.

## Verification

- Focused PostgreSQL security regressions: **9 passed** (also included in the full run).
- Complete Milestone 14 suite: **53 passed** (44 original plus 9 security regressions).
- Full repository suite: **227 passed in 12 files**.
- `npm run typecheck`, `npm run lint`, `npm run db:check`, `git diff --check`: passed.
- Migration metadata and applied SQL SHA-256 agree; no database reset or historical identity changes.
- Independent PostgreSQL connections and `pg_blocking_pids` prove both delivery/revocation orderings and renewal/revocation ordering. Tests also cover old queued renewals/operator requests, terminal suppression/attempt evidence, idempotent revocation/reissue, transient retry after revocation, redaction, payment/refund delivery, duplicate identities, unknown roles and cross-unit booking reads.
- Read-only integrity scan: zero active inventory overlaps, managed block/claim mismatches, capture/obligation refund reservation discrepancies, refund ledger discrepancies, duplicate subjects, unexpected roles, or unrevoked sessions under a booking-wide revocation.
- Pre-existing row fingerprints unchanged: **2,566 bookings; 1,950 payment records; 1,786 payment allocations; 605 refund obligations; 229 refund attempts; 143 refund records**. Test runs append isolated synthetic fixtures.
- All four protected files retain their original SHA-256: `next-env.d.ts`, root `ACCOMMODATION_MANAGEMENT_SPEC.md`, `owner-accommodation-management-docs-fixed.patch`, `owner-accommodation-management-docs.patch`.

Files changed in this correction: `src/server/access.ts`, `admin-auth.ts`, `admin-management.ts`, `guest-management.ts`, `sandbox-notification-worker.ts`; `src/db/schema/access.ts`, `operations.ts`; migration `0033` plus snapshot/journal; `tests/milestone14.test.ts`, `tests/database.test.ts`; this report and its link from `MILESTONE_14.md`.

No unresolved findings within A–C. External identity-provider setup, end-to-end provider QA and other original Milestone 14 deployment gates remain unchanged. A message already sent/in flight cannot be recalled; its revoked credential is unusable. No staging, commit or push was performed. Ready for another independent review, without claiming external certification.
