-- Balance attempts use the existing scheduled obligation and confirmed booking claim.
-- No additional inventory hold may be attached to a balance attempt.
CREATE FUNCTION guard_scheduled_attempt_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE obligation record;
BEGIN
  SELECT o.booking_id,o.kind,o.amount_cents,o.currency,b.status
    INTO obligation FROM payment_obligations o JOIN bookings b ON b.id=o.booking_id
    WHERE o.id=NEW.obligation_id;
  IF obligation.booking_id IS NULL OR NOT EXISTS
      (SELECT 1 FROM price_snapshots WHERE booking_id=obligation.booking_id) THEN RETURN NEW; END IF;
  IF NEW.booking_id IS DISTINCT FROM obligation.booking_id OR
     NEW.expected_cents IS DISTINCT FROM obligation.amount_cents OR
     NEW.currency IS DISTINCT FROM obligation.currency OR
     (obligation.kind='INITIAL' AND NEW.hold_id IS NULL) OR
     (obligation.kind='BALANCE' AND (NEW.hold_id IS NOT NULL OR obligation.amount_cents=0)) THEN
    RAISE EXCEPTION 'accepted attempt does not match scheduled obligation' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND obligation.kind='BALANCE' AND obligation.status<>'CONFIRMED' THEN
    RAISE EXCEPTION 'balance collection requires confirmed booking' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER scheduled_attempt_identity BEFORE INSERT OR UPDATE ON payment_attempts
  FOR EACH ROW EXECUTE FUNCTION guard_scheduled_attempt_identity();
