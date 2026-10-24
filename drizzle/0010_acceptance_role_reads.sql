-- Custom SQL migration file, put your code below! --
-- A fresh database does not inherit grants from the original development database.
GRANT USAGE ON SCHEMA public TO zemaitija_app;
--> statement-breakpoint
GRANT SELECT ON guests, accommodation_units, rate_schedule_versions, seasonal_rates,
  bookings, price_snapshots, price_snapshot_lines, payment_obligations,
  inventory_holds, inventory_claims, payment_attempts, provider_commands, audit_events
  TO zemaitija_app;
