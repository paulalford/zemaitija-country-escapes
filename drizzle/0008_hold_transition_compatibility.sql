-- Custom SQL migration file, put your code below! --
-- Older read-only availability fixtures have no accepted snapshot or command.
CREATE OR REPLACE FUNCTION guard_pending_hold_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.state=NEW.state OR NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.booking_id) THEN RETURN NEW; END IF;
  IF OLD.state='CREATING' AND NEW.state='RECONCILING' AND NEW.terminal_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.state='CREATING' AND NEW.state='RELEASED' AND NEW.terminal_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM provider_commands c JOIN payment_attempts a ON a.id=c.payment_attempt_id
    WHERE a.id=OLD.payment_attempt_id AND c.kind='SESSION_CREATE' AND c.state='RESOLVED' AND c.first_submitted_at IS NULL AND c.lease_generation=0 AND c.attempt_count=0 AND c.resolved_at IS NOT NULL) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'hold transition requires provider integration or pre-dispatch proof' USING ERRCODE='23514';
END $$;
