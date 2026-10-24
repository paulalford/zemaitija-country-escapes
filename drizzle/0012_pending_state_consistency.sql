-- Custom SQL migration file, put your code below! --
CREATE FUNCTION check_pending_booking_state() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; b record; BEGIN
  IF TG_TABLE_NAME='bookings' THEN bid:=NEW.id;
  ELSIF TG_TABLE_NAME='inventory_holds' OR TG_TABLE_NAME='payment_attempts' THEN bid:=NEW.booking_id;
  ELSE
    IF NEW.hold_id IS NULL THEN RETURN NULL; END IF;
    SELECT booking_id INTO bid FROM inventory_holds WHERE id=NEW.hold_id;
  END IF;
  IF bid IS NULL OR NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN RETURN NULL; END IF;
  SELECT * INTO b FROM bookings WHERE id=bid;
  IF b.status='AWAITING_INITIAL_PAYMENT' AND NOT EXISTS (
    SELECT 1 FROM inventory_holds h JOIN inventory_claims c ON c.hold_id=h.id JOIN payment_attempts a ON a.id=h.payment_attempt_id
    WHERE h.booking_id=bid AND c.released_at IS NULL AND
      ((h.state='CREATING' AND a.state='CREATING') OR (h.state='RECONCILING' AND a.state='RECONCILING'))
  ) THEN RAISE EXCEPTION 'pending booking must own blocking hold and matching attempt' USING ERRCODE='23514'; END IF;
  IF b.status='EXPIRED' AND NOT EXISTS (
    SELECT 1 FROM inventory_holds h JOIN inventory_claims c ON c.hold_id=h.id JOIN payment_attempts a ON a.id=h.payment_attempt_id
      JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE'
    WHERE h.booking_id=bid AND h.state='RELEASED' AND c.released_at IS NOT NULL AND a.state='EXPIRED' AND
      pc.state='RESOLVED' AND pc.first_submitted_at IS NULL AND pc.lease_generation=0 AND pc.attempt_count=0
  ) THEN RAISE EXCEPTION 'expired draft lacks pre-dispatch release proof' USING ERRCODE='23514'; END IF;
  IF b.status NOT IN ('AWAITING_INITIAL_PAYMENT','EXPIRED') THEN RAISE EXCEPTION 'unsupported accepted booking state' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pending_booking_state_guard AFTER INSERT OR UPDATE ON bookings DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pending_booking_state();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pending_hold_state_guard AFTER INSERT OR UPDATE ON inventory_holds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pending_booking_state();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pending_attempt_state_guard AFTER INSERT OR UPDATE ON payment_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pending_booking_state();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pending_claim_state_guard AFTER INSERT OR UPDATE ON inventory_claims DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pending_booking_state();
