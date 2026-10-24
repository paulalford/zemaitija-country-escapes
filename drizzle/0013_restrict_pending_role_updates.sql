-- Custom SQL migration file, put your code below! --
-- Acceptance inserts these records once. Runtime edits are neither needed nor authorized.
REVOKE UPDATE ON price_snapshots, price_snapshot_lines, payment_obligations, audit_events FROM zemaitija_app;
