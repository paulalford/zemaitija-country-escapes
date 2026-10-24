-- Milestone 9 correction. Keep the 0006-0013 history intact. A later provider-backed
-- claim transfer must replace this provisional accepted-pending ownership guard.
-- One Session-create command per attempt prevents a second uncertain command
-- from hiding behind a separate never-dispatched command at release time.
CREATE UNIQUE INDEX provider_commands_one_session_create_per_attempt
  ON provider_commands (payment_attempt_id) WHERE kind='SESSION_CREATE';
--> statement-breakpoint
CREATE FUNCTION guard_accepted_pending_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_accepted boolean; new_accepted boolean;
BEGIN
  IF TG_TABLE_NAME='inventory_holds' THEN
    SELECT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.booking_id) INTO old_accepted;
    SELECT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=NEW.booking_id) INTO new_accepted;
    IF (old_accepted OR new_accepted) AND
       ROW(NEW.id,NEW.booking_id) IS DISTINCT FROM ROW(OLD.id,OLD.booking_id) THEN
      RAISE EXCEPTION 'accepted hold ownership is immutable' USING ERRCODE='23514';
    END IF;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN price_snapshots s ON s.booking_id=h.booking_id WHERE h.id=OLD.hold_id
    ) OR EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.booking_id) INTO old_accepted;
    SELECT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN price_snapshots s ON s.booking_id=h.booking_id WHERE h.id=NEW.hold_id
    ) OR EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=NEW.booking_id) INTO new_accepted;
    IF (old_accepted OR new_accepted) AND
       ROW(NEW.id,NEW.hold_id,NEW.booking_id,NEW.operator_block_id,NEW.origin_hold_id)
         IS DISTINCT FROM ROW(OLD.id,OLD.hold_id,OLD.booking_id,OLD.operator_block_id,OLD.origin_hold_id) THEN
      RAISE EXCEPTION 'accepted claim ownership is immutable pending provider transfer' USING ERRCODE='23514';
    END IF;
    IF old_accepted AND OLD.released_at IS NOT NULL AND
       ROW(NEW.released_at,NEW.release_reason) IS DISTINCT FROM ROW(OLD.released_at,OLD.release_reason) THEN
      RAISE EXCEPTION 'accepted claim release evidence is immutable' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accepted_hold_ownership BEFORE UPDATE ON inventory_holds FOR EACH ROW EXECUTE FUNCTION guard_accepted_pending_ownership();
--> statement-breakpoint
CREATE TRIGGER accepted_claim_ownership BEFORE UPDATE ON inventory_claims FOR EACH ROW EXECUTE FUNCTION guard_accepted_pending_ownership();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_provider_command_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.lease_generation < OLD.lease_generation OR NEW.attempt_count < OLD.attempt_count OR
     (OLD.first_submitted_at IS NOT NULL AND NEW.first_submitted_at IS DISTINCT FROM OLD.first_submitted_at) OR
     (OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id) OR
     (OLD.state='RESOLVED' AND NEW.state<>'RESOLVED') THEN
    RAISE EXCEPTION 'provider command evidence cannot regress' USING ERRCODE='23514'; END IF;
  IF NEW.kind='SESSION_CREATE' AND NEW.state='RESOLVED' AND NEW.first_submitted_at IS NULL AND
     (NEW.lease_generation<>0 OR NEW.attempt_count<>0 OR NEW.lease_owner IS NOT NULL OR
      NEW.lease_expires_at IS NOT NULL OR NEW.provider_request_id IS NOT NULL OR
      NEW.resolved_at IS NULL OR NEW.last_error_code IS DISTINCT FROM 'ABANDONED_BEFORE_DISPATCH') THEN
    RAISE EXCEPTION 'pre-dispatch resolution lacks non-dispatch proof' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_accepted_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hid uuid; bid uuid; old_hid uuid; new_hid uuid;
BEGIN
  -- On UPDATE, inspect both identities. An accepted owner cannot disappear by
  -- changing the claim's hold_id or the hold's booking_id.
  IF TG_TABLE_NAME='inventory_holds' THEN
    new_hid:=NEW.id;
    IF TG_OP='UPDATE' THEN old_hid:=OLD.id; END IF;
  ELSE
    new_hid:=NEW.hold_id;
    IF TG_OP='UPDATE' THEN old_hid:=OLD.hold_id; END IF;
  END IF;
  FOR hid IN SELECT DISTINCT id FROM (VALUES (old_hid),(new_hid)) AS owners(id) WHERE id IS NOT NULL LOOP
    SELECT booking_id INTO bid FROM inventory_holds WHERE id=hid;
    IF bid IS NULL OR NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN bookings b ON b.id=h.booking_id
        JOIN payment_attempts a ON a.id=h.payment_attempt_id
        JOIN payment_obligations o ON o.id=a.obligation_id
        JOIN inventory_claims c ON c.hold_id=h.id
      WHERE h.id=hid AND a.booking_id=bid AND a.hold_id=h.id AND o.booking_id=bid
        AND o.kind='INITIAL' AND a.expected_cents=o.amount_cents
        AND c.unit_id=b.unit_id AND c.arrival_date=b.arrival_date AND c.departure_date=b.departure_date
        AND ((h.state IN ('CREATING','RECONCILING') AND c.released_at IS NULL)
          OR (h.state='RELEASED' AND c.released_at IS NOT NULL AND
              c.release_reason='ABANDONED_BEFORE_DISPATCH'))
    ) THEN RAISE EXCEPTION 'accepted hold ownership mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_pending_booking_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_bid uuid; new_bid uuid; bid uuid; b record;
BEGIN
  IF TG_TABLE_NAME='bookings' THEN
    new_bid:=NEW.id;
    IF TG_OP='UPDATE' THEN old_bid:=OLD.id; END IF;
  ELSIF TG_TABLE_NAME IN ('inventory_holds','payment_attempts') THEN
    new_bid:=NEW.booking_id;
    IF TG_OP='UPDATE' THEN old_bid:=OLD.booking_id; END IF;
  ELSIF TG_TABLE_NAME='provider_commands' THEN
    SELECT booking_id INTO new_bid FROM payment_attempts WHERE id=NEW.payment_attempt_id;
    IF TG_OP='UPDATE' THEN
      SELECT booking_id INTO old_bid FROM payment_attempts WHERE id=OLD.payment_attempt_id;
    END IF;
  ELSE
    IF NEW.hold_id IS NOT NULL THEN
      SELECT booking_id INTO new_bid FROM inventory_holds WHERE id=NEW.hold_id;
    ELSE new_bid:=NEW.booking_id; END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.hold_id IS NOT NULL THEN
        SELECT booking_id INTO old_bid FROM inventory_holds WHERE id=OLD.hold_id;
      ELSE old_bid:=OLD.booking_id; END IF;
    END IF;
  END IF;
  FOR bid IN SELECT DISTINCT id FROM (VALUES (old_bid),(new_bid)) AS owners(id) WHERE id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN CONTINUE; END IF;
    SELECT * INTO b FROM bookings WHERE id=bid;
    IF b.status='AWAITING_INITIAL_PAYMENT' AND NOT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN inventory_claims c ON c.hold_id=h.id
        JOIN payment_attempts a ON a.id=h.payment_attempt_id
      WHERE h.booking_id=bid AND c.released_at IS NULL AND
        ((h.state='CREATING' AND a.state='CREATING') OR
         (h.state='RECONCILING' AND a.state='RECONCILING'))
    ) THEN RAISE EXCEPTION 'pending booking must own blocking hold and matching attempt' USING ERRCODE='23514'; END IF;
    IF b.status='EXPIRED' AND NOT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN inventory_claims c ON c.hold_id=h.id
        JOIN payment_attempts a ON a.id=h.payment_attempt_id
        JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE'
      WHERE h.booking_id=bid AND h.state='RELEASED' AND h.terminal_at IS NOT NULL
        AND c.released_at IS NOT NULL AND c.release_reason='ABANDONED_BEFORE_DISPATCH'
        AND a.state='EXPIRED' AND pc.state='RESOLVED' AND pc.resolved_at IS NOT NULL
        AND pc.last_error_code='ABANDONED_BEFORE_DISPATCH'
        AND pc.first_submitted_at IS NULL AND pc.provider_request_id IS NULL
        AND pc.lease_generation=0 AND pc.attempt_count=0
        AND pc.lease_owner IS NULL AND pc.lease_expires_at IS NULL
    ) THEN RAISE EXCEPTION 'expired draft lacks pre-dispatch release proof' USING ERRCODE='23514'; END IF;
    IF b.status NOT IN ('AWAITING_INITIAL_PAYMENT','EXPIRED') THEN
      RAISE EXCEPTION 'unsupported accepted booking state' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER pending_command_state_guard AFTER INSERT OR UPDATE ON provider_commands
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_pending_booking_state();
