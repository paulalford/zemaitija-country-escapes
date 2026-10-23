# Milestone 5 — Next.js and PostgreSQL foundation

**Status:** Infrastructure and persistence baseline only. The business behavior in [Milestone 2](BOOKING_PAYMENT_SPEC.md), database contract in [Milestone 3](MILESTONE_03.md), and [Milestone 4](MILESTONE_04.md) architecture remain authoritative. This milestone adds no booking, payment, refund, admin or notification workflows. The site is a fictional portfolio placeholder; no real guest data or live provider credentials belong here.

## Versions and structure

The exact versions are in `package.json` and locked by `package-lock.json`: Node 24, Next.js 16.4.2, React 19.3.1, TypeScript 5.9.3, Tailwind 4.3.3, ESLint 9.39.2, Zod 4.6.7, Vitest 5.0.5, PostgreSQL driver `pg` 8.23.1, Drizzle ORM 0.45.4 and Drizzle Kit 0.31.11. These versions provide the requested stable App Router, strict TypeScript and migration stack without an authentication, email, Stripe or queue integration. `server-only` prevents database modules from entering client bundles. Webpack is selected for `next dev` and `next build` because Turbopack's CSS worker could not bind a local process port in this development environment; this changes no runtime architecture. Next's `agentRules: false` prevents its dev server from editing the project's authoritative `AGENTS.md`.

- `src/app/`: minimal accessible fictional-demo heading and disclosure; no guest workflow or accommodation design.
- `src/db/schema/`: five typed modules containing exactly the 28 Milestone 3 tables; `index.ts` exports them. The generated Drizzle migration supplies columns and restrict-delete FKs. PostgreSQL-only SQL migrations add the safety constraints, indexes and triggers.
- `src/db/client.ts`, `src/db/env.ts`: server-only connection and Zod URL validation. Runtime and migration URLs are distinct.
- `drizzle/`: versioned `0000` Drizzle table migration, `0001` inventory/financial constraints and initial guards, `0002` parent budget triggers, `0003` evidence/index hardening, and generated `0004` correcting `refund_attempts.obligation_id` to reference `refund_obligations.id`, plus Drizzle journal/snapshots. The already-applied `0000` is retained as history; `0004` drops its incorrect FK and adds the correct one. Never use `drizzle-kit push` in place of reviewed migrations.
- `db/init/01-roles.sh`, `docker-compose.yml`: local-only PostgreSQL 17.6, persistent volume, health check, loopback port, separate bootstrap/migration/application roles. The application role has schema usage and table SELECT only; it cannot mutate bookings at this stage. Migration role owns the local database and tables. Review grants before later application writes.
- `tests/database.test.ts`: direct SQL integration tests using real PostgreSQL. Fixtures contain only synthetic IDs and are removed; tests require a localhost database ending `_dev`.

## Local setup and verification

Use Node 24 through NVM. `docker-compose` is supported here (the installed Docker Compose is the standalone command); if your machine has the plugin, `docker compose` is equivalent. Run from the repository root:

```sh
cp .env.example .env.local
cp .env.example .env
# Edit local development passwords and matching URLs in both ignored files before use.
npm ci
docker-compose up -d db
npm run db:migrate
npm run db:migrate  # safe repeat
npm run db:check
npm run test
npm run typecheck
npm run lint
npm run build
npm run dev
```

`.env.local` is read by Next/Drizzle; standalone Compose reads `.env` or shell variables. The checked-in Compose defaults are development-only placeholders. If you change passwords, update both files consistently. The init script runs **only when the volume is first created**; changing passwords later requires an explicit role-password change or a new disposable local volume, not merely editing env files.

`DATABASE_URL` is for the read-only application role. `MIGRATION_DATABASE_URL` is for Drizzle Kit and the integration tests; it must never be exposed to browser code. `npm run db:generate` reviews schema changes into a new migration, then add PostgreSQL-specific SQL with `npm run db:generate -- --custom --name <name>`; review SQL/journal, run `npm run db:check`, then migrate. The current schema includes custom SQL constraints that are intentionally outside Drizzle's generated snapshot; future schema changes must check for drift against the live catalog and preserve those custom objects. `docker-compose down` stops local services without deleting the data volume. No public database port or production host is configured.

## Enforced PostgreSQL guarantees

- Exactly 28 tables, typed columns, primary keys, restrict-delete FKs, local `date` stay boundaries, `timestamptz` instants and `bigint` EUR cents. Core state values, amount bounds, identity shape and lease-owner/expiry pairing have SQL checks. Accepted snapshot amounts use numeric intermediates and the approved 30% rounding check.
- The **single** active inventory domain is `inventory_claims_no_overlap`: a partial GiST exclusion on `(unit_id, stay)` with generated half-open `daterange(arrival_date,departure_date,'[)')`, predicate `released_at IS NULL` and `btree_gist`. Hold, booking and operator-block owners use the same table. Clock time does not remove an active claim; only an explicit release update does.
- Core unique business identities cover price acceptance, usable attempts, Stripe Session/Intent/refund/Event IDs, command keys, provider incidents, refund revisions, notice keys and delivery attempts. `refund_attempts.obligation_id` now has a restrict-delete FK to `refund_obligations.id`; `payment_attempts.obligation_id` still references `payment_obligations.id`. Partial indexes limit active holds and in-flight refund attempts. Operator blocks and seasonal rates have separate appropriate checks; seasonal-rate exclusion is **not** a second inventory domain.
- Accepted price snapshots/lines, assessment revisions, refund records, reconciliation records and audit events reject update/delete. Verified capture evidence rejects change while its refund reservation and controlled allocation state remain mutable. These database guards cannot prove an external provider response is genuine.
- Allocation insert/update/delete takes obligation and capture parent locks in deterministic class/ID order before deferred budget checks; direct SQL over-allocation is rejected under `READ COMMITTED`. Parent amount reductions are guarded by deferred checks. Refund reservation counters have row-local bounds, while full cross-row refund accounting remains a later workflow.
- The local application DB login is read-only; the migration login owns schema changes. No real guest or payment credentials are stored in the repository.

## Deferred guarantees and gates

These guarantees are **not** claimed by the migration baseline: a signed, current Stripe payment; authoritative provider reconciliation before claim release; final booking/hold/claim owner-state consistency; immutable accepted calendar fields on bookings; complete state-transition/evidence guards; price-line and obligation aggregate checks; payment-attempt/obligation same-booking checks; capture/refund source identity across rows; latest-assessment/refund-liability arithmetic; operation authorization/audit presence; notification transport idempotency. They require the later domain transactions, provider adapters, role-limited write routines and deferred cross-row triggers specified by Milestones 2–4. Until then, the runtime application role cannot write these records. **Do not treat this schema as safe for live bookings.** Milestone 6 configures synthetic rates/units; Milestones 7–14 implement and test the workflows and cross-row guards. The provisional 15:00 check-in, proposed unapproved nonpayment default, D19 asynchronous methods, legal/privacy review, authentication/email/provider selection and sufficiently frequent scheduler remain open gates.

The ten integration tests cover table/constraint presence, adjacent and conflicting inventory ranges, owner kinds, released claims, invalid money and foreign keys, the corrected refund FK with valid and invalid attempts, direct SQL allocation over-budget rejection, and competing €60 allocations against a €100 obligation under `READ COMMITTED`. The allocation test commits synthetic append-only capture evidence to the disposable local development database; it does not remove immutable payment records during teardown. One concurrent inventory race is retained; full booking/payment concurrency and crash recovery remain assigned to later milestones. The application build and startup are verified separately.

`npm ci` reports nine audit findings in installed **development-tooling** paths: four moderate in the Drizzle Kit/esbuild chain and five high in the Next.js ESLint chain. These tools run during local development, migrations, linting and builds, so their exposure must be reevaluated periodically as compatible upstream fixes appear. `npm audit --omit=dev` found zero production-dependency advisories at this check; run it again before any public deployment and review the full toolchain audit then. No dependency version or override is changed solely to silence an advisory. No live Stripe keys, PHP, public deployment, booking API, migrations from `push`, or Git commit are involved.
