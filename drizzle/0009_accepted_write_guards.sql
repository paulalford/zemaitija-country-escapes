-- Custom SQL migration file, put your code below! --
CREATE FUNCTION check_accepted_financial_row() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; s record; BEGIN
  IF TG_OP='DELETE' THEN bid:=OLD.booking_id; ELSE bid:=NEW.booking_id; END IF;
  SELECT * INTO s FROM price_snapshots WHERE booking_id=bid;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF (SELECT count(*) FROM payment_obligations WHERE booking_id=bid)<>2 OR
     (SELECT amount_cents FROM payment_obligations WHERE booking_id=bid AND kind='INITIAL') IS DISTINCT FROM s.initial_cents OR
     (SELECT amount_cents FROM payment_obligations WHERE booking_id=bid AND kind='BALANCE') IS DISTINCT FROM s.balance_cents THEN
    RAISE EXCEPTION 'accepted obligation mismatch' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM payment_attempts a JOIN inventory_holds h ON h.id=a.hold_id WHERE h.booking_id=bid AND
    (a.booking_id<>bid OR h.payment_attempt_id<>a.id OR a.obligation_id IS DISTINCT FROM
     (SELECT id FROM payment_obligations WHERE booking_id=bid AND kind='INITIAL') OR a.expected_cents<>s.initial_cents)) THEN
    RAISE EXCEPTION 'accepted attempt mismatch' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER accepted_obligations_guard AFTER INSERT OR UPDATE OR DELETE ON payment_obligations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accepted_financial_row();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER accepted_attempts_guard AFTER INSERT OR UPDATE OR DELETE ON payment_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accepted_financial_row();
--> statement-breakpoint
CREATE FUNCTION guard_accepted_child_delete() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; BEGIN
  IF TG_TABLE_NAME='inventory_claims' THEN
    IF OLD.hold_id IS NULL THEN RETURN OLD; END IF;
    SELECT booking_id INTO bid FROM inventory_holds WHERE id=OLD.hold_id;
  ELSIF TG_TABLE_NAME='inventory_holds' THEN bid:=OLD.booking_id;
  ELSE bid:=OLD.booking_id; END IF;
  IF EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN RAISE EXCEPTION 'accepted booking child history cannot be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER accepted_claim_no_delete BEFORE DELETE ON inventory_claims FOR EACH ROW EXECUTE FUNCTION guard_accepted_child_delete();
--> statement-breakpoint
CREATE TRIGGER accepted_hold_no_delete BEFORE DELETE ON inventory_holds FOR EACH ROW EXECUTE FUNCTION guard_accepted_child_delete();
--> statement-breakpoint
CREATE TRIGGER accepted_attempt_no_delete BEFORE DELETE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION guard_accepted_child_delete();
--> statement-breakpoint
CREATE TRIGGER accepted_obligation_no_delete BEFORE DELETE ON payment_obligations FOR EACH ROW EXECUTE FUNCTION guard_accepted_child_delete();
--> statement-breakpoint
CREATE FUNCTION guard_accepted_attempt_command() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; BEGIN
  IF TG_TABLE_NAME='payment_attempts' THEN
    bid:=OLD.booking_id;
    IF NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN RETURN NEW; END IF;
    IF ROW(NEW.booking_id,NEW.obligation_id,NEW.hold_id,NEW.expected_cents,NEW.currency) IS DISTINCT FROM
       ROW(OLD.booking_id,OLD.obligation_id,OLD.hold_id,OLD.expected_cents,OLD.currency) THEN
      RAISE EXCEPTION 'accepted attempt identity is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.state<>NEW.state AND NOT (OLD.state='CREATING' AND NEW.state IN ('RECONCILING','EXPIRED')) THEN
      RAISE EXCEPTION 'unsupported accepted attempt transition' USING ERRCODE='23514'; END IF;
  ELSE
    IF ROW(NEW.kind,NEW.payment_attempt_id,NEW.refund_attempt_id,NEW.logical_key,NEW.stripe_idempotency_key,NEW.request_fingerprint) IS DISTINCT FROM
       ROW(OLD.kind,OLD.payment_attempt_id,OLD.refund_attempt_id,OLD.logical_key,OLD.stripe_idempotency_key,OLD.request_fingerprint) THEN
      RAISE EXCEPTION 'provider command identity is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER accepted_attempt_transition BEFORE UPDATE ON payment_attempts FOR EACH ROW EXECUTE FUNCTION guard_accepted_attempt_command();
--> statement-breakpoint
CREATE TRIGGER provider_command_identity BEFORE UPDATE ON provider_commands FOR EACH ROW EXECUTE FUNCTION guard_accepted_attempt_command();
