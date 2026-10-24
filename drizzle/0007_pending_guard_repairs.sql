-- Custom SQL migration file, put your code below! --
-- Preserve older schema-fixture cleanup while protecting accepted commercial history.
CREATE OR REPLACE FUNCTION guard_booking_acceptance_fields() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.id) THEN RAISE EXCEPTION 'accepted booking history cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.guest_id,NEW.unit_id,NEW.arrival_date,NEW.departure_date,NEW.guest_count,NEW.accepted_at,NEW.check_in_local_time,NEW.property_zone,NEW.scheduled_arrival_at,NEW.warning_at,NEW.balance_due_at,NEW.grace_ends_at) IS DISTINCT FROM
     ROW(OLD.guest_id,OLD.unit_id,OLD.arrival_date,OLD.departure_date,OLD.guest_count,OLD.accepted_at,OLD.check_in_local_time,OLD.property_zone,OLD.scheduled_arrival_at,OLD.warning_at,OLD.balance_due_at,OLD.grace_ends_at) THEN
    RAISE EXCEPTION 'accepted booking fields are immutable' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.id) AND OLD.status<>NEW.status AND NOT (OLD.status='AWAITING_INITIAL_PAYMENT' AND NEW.status='EXPIRED') THEN
    RAISE EXCEPTION 'unsupported accepted booking transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_accepted_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE sid uuid; s record; b record; BEGIN
  IF TG_TABLE_NAME='price_snapshots' THEN sid:=NEW.id; ELSE sid:=NEW.snapshot_id; END IF;
  SELECT * INTO s FROM price_snapshots WHERE id=sid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO b FROM bookings WHERE id=s.booking_id;
  IF b.accepted_at <> s.accepted_at OR s.rate_schedule_version_id IS NULL OR s.policy_version <> 'PROVISIONAL_D17_TEST_ONLY' OR s.terms_version <> 'SYNTHETIC_TEST_TERMS_V1' THEN
    RAISE EXCEPTION 'accepted snapshot metadata mismatch' USING ERRCODE='23514'; END IF;
  IF (SELECT COALESCE(sum(amount_cents),0) FROM price_snapshot_lines WHERE snapshot_id=sid) <> s.total_cents OR
     (SELECT count(*) FROM price_snapshot_lines WHERE snapshot_id=sid) <> (b.departure_date-b.arrival_date) OR
     EXISTS (SELECT 1 FROM price_snapshot_lines WHERE snapshot_id=sid AND (kind <> 'NIGHT' OR details->>'localNight' IS NULL OR details->>'rateId' IS NULL)) THEN
    RAISE EXCEPTION 'accepted snapshot lines do not reconcile' USING ERRCODE='23514'; END IF;
  IF (SELECT count(*) FROM payment_obligations WHERE booking_id=b.id) <> 2 OR
     (SELECT amount_cents FROM payment_obligations WHERE booking_id=b.id AND kind='INITIAL') IS DISTINCT FROM s.initial_cents OR
     (SELECT amount_cents FROM payment_obligations WHERE booking_id=b.id AND kind='BALANCE') IS DISTINCT FROM s.balance_cents THEN
    RAISE EXCEPTION 'accepted obligations do not reconcile' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_accepted_hold() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; hid uuid; BEGIN
  IF TG_TABLE_NAME='inventory_holds' THEN bid:=NEW.booking_id; hid:=NEW.id;
  ELSE hid:=NEW.hold_id; IF hid IS NULL THEN RETURN NULL; END IF; SELECT booking_id INTO bid FROM inventory_holds WHERE id=hid; END IF;
  IF bid IS NULL OR NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM inventory_holds h JOIN bookings b ON b.id=h.booking_id JOIN payment_attempts a ON a.id=h.payment_attempt_id JOIN payment_obligations o ON o.id=a.obligation_id
      JOIN inventory_claims c ON c.hold_id=h.id
      WHERE h.id=hid AND a.booking_id=bid AND a.hold_id=h.id AND o.booking_id=bid AND o.kind='INITIAL' AND a.expected_cents=o.amount_cents
        AND c.unit_id=b.unit_id AND c.arrival_date=b.arrival_date AND c.departure_date=b.departure_date AND
       ((h.state IN ('CREATING','RECONCILING') AND c.released_at IS NULL) OR (h.state='RELEASED' AND c.released_at IS NOT NULL))) THEN
    RAISE EXCEPTION 'accepted hold ownership mismatch' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
