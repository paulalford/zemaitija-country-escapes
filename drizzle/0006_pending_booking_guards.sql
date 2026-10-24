-- Custom SQL migration file, put your code below! --
-- Milestone 9: guards for accepted synthetic drafts. Existing baseline fixture rows
-- without a snapshot predate acceptance and remain outside aggregate enforcement.
CREATE FUNCTION guard_booking_acceptance_fields() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'booking history cannot be deleted' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.guest_id,NEW.unit_id,NEW.arrival_date,NEW.departure_date,NEW.guest_count,NEW.accepted_at,NEW.check_in_local_time,NEW.property_zone,NEW.scheduled_arrival_at,NEW.warning_at,NEW.balance_due_at,NEW.grace_ends_at) IS DISTINCT FROM
     ROW(OLD.guest_id,OLD.unit_id,OLD.arrival_date,OLD.departure_date,OLD.guest_count,OLD.accepted_at,OLD.check_in_local_time,OLD.property_zone,OLD.scheduled_arrival_at,OLD.warning_at,OLD.balance_due_at,OLD.grace_ends_at) THEN
    RAISE EXCEPTION 'accepted booking fields are immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status='AWAITING_INITIAL_PAYMENT' AND NEW.status IN ('AWAITING_INITIAL_PAYMENT','EXPIRED') THEN RETURN NEW; END IF;
  IF OLD.status=NEW.status THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'unsupported booking transition' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER bookings_acceptance_fields BEFORE UPDATE OR DELETE ON bookings FOR EACH ROW EXECUTE FUNCTION guard_booking_acceptance_fields();
--> statement-breakpoint
CREATE FUNCTION check_accepted_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE sid uuid; s record; b record; BEGIN
  sid := CASE WHEN TG_TABLE_NAME='price_snapshots' THEN NEW.id ELSE NEW.snapshot_id END;
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
CREATE CONSTRAINT TRIGGER accepted_snapshot_complete AFTER INSERT ON price_snapshots DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accepted_snapshot();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER accepted_snapshot_line_complete AFTER INSERT ON price_snapshot_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accepted_snapshot();
--> statement-breakpoint
CREATE FUNCTION check_accepted_hold() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; BEGIN
  bid := CASE WHEN TG_TABLE_NAME='inventory_holds' THEN NEW.booking_id ELSE (SELECT booking_id FROM inventory_holds WHERE id=NEW.hold_id) END;
  IF bid IS NULL OR NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM inventory_holds h JOIN bookings b ON b.id=h.booking_id JOIN payment_attempts a ON a.id=h.payment_attempt_id JOIN payment_obligations o ON o.id=a.obligation_id
      WHERE h.booking_id=bid AND (a.booking_id<>bid OR a.hold_id<>h.id OR o.booking_id<>bid OR o.kind<>'INITIAL' OR a.expected_cents<>o.amount_cents OR
      NOT EXISTS (SELECT 1 FROM inventory_claims c WHERE c.hold_id=h.id AND c.unit_id=b.unit_id AND c.arrival_date=b.arrival_date AND c.departure_date=b.departure_date AND
       ((h.state IN ('CREATING','RECONCILING') AND c.released_at IS NULL) OR (h.state='RELEASED' AND c.released_at IS NOT NULL))))) THEN
    RAISE EXCEPTION 'accepted hold ownership mismatch' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER accepted_hold_complete AFTER INSERT OR UPDATE ON inventory_holds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accepted_hold();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER accepted_claim_complete AFTER INSERT OR UPDATE ON inventory_claims DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accepted_hold();
--> statement-breakpoint
CREATE FUNCTION guard_pending_hold_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.state=NEW.state THEN RETURN NEW; END IF;
  IF OLD.state='CREATING' AND NEW.state='RECONCILING' AND NEW.terminal_at IS NULL THEN RETURN NEW; END IF;
  IF OLD.state='CREATING' AND NEW.state='RELEASED' AND NEW.terminal_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM provider_commands c JOIN payment_attempts a ON a.id=c.payment_attempt_id
    WHERE a.id=OLD.payment_attempt_id AND c.kind='SESSION_CREATE' AND c.state='RESOLVED' AND c.first_submitted_at IS NULL AND c.lease_generation=0 AND c.attempt_count=0 AND c.resolved_at IS NOT NULL) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'hold transition requires provider integration or pre-dispatch proof' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER pending_hold_transition BEFORE UPDATE ON inventory_holds FOR EACH ROW EXECUTE FUNCTION guard_pending_hold_transition();
--> statement-breakpoint
CREATE FUNCTION guard_provider_command_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.lease_generation < OLD.lease_generation OR NEW.attempt_count < OLD.attempt_count OR
     (OLD.first_submitted_at IS NOT NULL AND NEW.first_submitted_at IS DISTINCT FROM OLD.first_submitted_at) OR
     (OLD.state='RESOLVED' AND NEW.state<>'RESOLVED') THEN
    RAISE EXCEPTION 'provider command evidence cannot regress' USING ERRCODE='23514'; END IF;
  IF OLD.kind='SESSION_CREATE' AND OLD.state='PENDING' AND NEW.state='RESOLVED' AND NEW.first_submitted_at IS NULL AND
     (OLD.lease_generation<>0 OR OLD.attempt_count<>0 OR OLD.lease_owner IS NOT NULL OR OLD.lease_expires_at IS NOT NULL) THEN
    RAISE EXCEPTION 'leased command cannot be treated as never dispatched' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER provider_command_fence BEFORE UPDATE ON provider_commands FOR EACH ROW EXECUTE FUNCTION guard_provider_command_fence();
--> statement-breakpoint
GRANT INSERT, UPDATE ON bookings, price_snapshots, price_snapshot_lines, payment_obligations, inventory_holds, inventory_claims, payment_attempts, provider_commands, audit_events TO zemaitija_app;
--> statement-breakpoint
GRANT SELECT ON guests, accommodation_units, rate_schedule_versions, seasonal_rates TO zemaitija_app;
