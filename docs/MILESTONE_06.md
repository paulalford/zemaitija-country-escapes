# Milestone 6 — Accommodation and pricing reference data

**Status:** Synthetic development fixture only. [Milestone 3](MILESTONE_03.md) defines the schema and [Milestone 5](MILESTONE_05.md) supplies the database foundation. These rates are illustrative portfolio values, **provisional and not commercially approved**. The units are fictional; their names do not claim real facilities, a lake frontage, an address or an operating property.

## Accommodation catalog

| Stable key | Fictional display name | Maximum guests |
| --- | --- | ---: |
| `forest-cottage` | Forest Cottage | 2 |
| `lakeside-cabin` | Lakeside Cabin | 2 |
| `family-cottage` | Family Cottage | 6 |

The existing `accommodation_units` table stores key, capacity, enabled flag and configuration version. No amenity, accessibility, coordinate or address field is added because none is approved. IDs are deterministic UUIDs derived from fixture keys. Each unit has tariff version 1, activated after all ten bands are validated.

## Provisional 2027 nightly pricing

All values are **EUR per night**, stored as integer cents. Each cell is weekday / weekend. The same bands apply to all three units, with half-open local date ranges `[start, end)`; a departure date is exclusive. The last band ends on 2028-01-01. Weekend classification and exact pricing rules are for the later quote engine.

| Season | Arrival-date bands | Forest Cottage | Lakeside Cabin | Family Cottage |
| --- | --- | ---: | ---: | ---: |
| Low | 2027-01-01–2027-05-01; 2027-11-01–2028-01-01 | €90 / €110 | €100 / €120 | €150 / €180 |
| Shoulder | 2027-05-01–2027-07-01; 2027-09-01–2027-11-01 | €120 / €140 | €140 / €160 | €200 / €230 |
| High | 2027-07-01–2027-09-01 | €160 / €190 | €190 / €220 | €260 / €300 |

The fixture covers every local date in calendar year 2027 for both day classes. Dates outside that year have **no seeded rate** and must not be silently priced. There are no taxes, fees, extras or minimum-stay assumptions in this fixture.

## Seed and validation

Run migrations first against a disposable local `*_dev` PostgreSQL database, then explicitly run:

```sh
npm run db:migrate
ALLOW_DEV_REFERENCE_SEED=1 npm run db:seed:dev
ALLOW_DEV_REFERENCE_SEED=1 npm run db:seed:dev
npm run test
```

`MIGRATION_DATABASE_URL` comes from `.env.local`; use a dedicated disposable database for tests when practical. The seed is never run at application startup. It rejects non-local hosts, database names outside `*_dev`, and runs without the explicit opt-in. It takes a transaction-scoped advisory lock, inserts deterministic IDs, validates existing unit/version/rate values and counts, then activates draft version 1. Repeated runs leave values and counts unchanged. Any drift aborts the transaction rather than overwriting catalog or accepted financial evidence. The script does not reset tables or delete bookings or payments.

PostgreSQL retains the unique unit key, unique tariff version per unit, one active version per unit, valid-date/EUR/nonnegative checks, and GiST exclusion of overlapping bands within a version and day class. Forward migration `0005_active_tariff_guard` prevents changes to an activated or retired tariff and its bands. Draft bands remain editable for future version preparation. Accepted snapshots remain append-only and refer to their tariff version; creating a later tariff requires a new version.

## Verification and later gates

On a dedicated fresh local database, the full versioned migration chain and 15 PostgreSQL tests passed. Tests cover the three stable keys/capacities, all 30 deterministic EUR-cent bands, repeated seed execution, adjacent and overlapping ranges, invalid prices/dates, activated-tariff immutability and accepted-snapshot preservation. The existing inventory and payment tests remain in the suite.

D01's three fictional units are represented; D12's 15:00 check-in time remains provisional and is not part of this seed. D17 still requires approved amenities, accessibility, pets, fees, taxes, minimum stays, production rates and a complete business configuration. Before a quote engine, decide weekend-night classification, missing-rate behavior outside seeded dates, tariff publication/version switch procedure, locale copy and any legally reviewed price display. No live booking, availability or payment behavior is implemented here.
