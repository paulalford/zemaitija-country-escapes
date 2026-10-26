-- Function correction: distinct trigger row shapes must use PL/pgSQL branches.
CREATE OR REPLACE FUNCTION check_managed_block_claim() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; b record; BEGIN
  IF TG_TABLE_NAME='operator_blocks' THEN bid:=NEW.id; ELSE bid:=NEW.operator_block_id; END IF;
  IF bid IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO b FROM operator_blocks WHERE id=bid;
  IF NOT FOUND OR b.reason_code NOT IN ('PRIVATE_USE','MAINTENANCE','OTHER') THEN RETURN NULL; END IF;
  IF NOT EXISTS(SELECT 1 FROM inventory_claims c WHERE c.operator_block_id=bid AND c.hold_id IS NULL
    AND c.booking_id IS NULL AND c.unit_id=b.unit_id AND c.arrival_date=b.arrival_date AND c.departure_date=b.departure_date
    AND c.released_at IS NOT DISTINCT FROM b.released_at) THEN
    RAISE EXCEPTION 'operator block claim mismatch' USING ERRCODE='23514';
  END IF; RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_managed_claim_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.operator_block_id IS NULL OR NOT EXISTS(SELECT 1 FROM operator_blocks WHERE id=OLD.operator_block_id AND reason_code IN ('PRIVATE_USE','MAINTENANCE','OTHER')) THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'managed claim history is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.unit_id,NEW.arrival_date,NEW.departure_date,NEW.operator_block_id,NEW.hold_id,NEW.booking_id,NEW.origin_hold_id)
    IS DISTINCT FROM (OLD.id,OLD.unit_id,OLD.arrival_date,OLD.departure_date,OLD.operator_block_id,OLD.hold_id,OLD.booking_id,OLD.origin_hold_id)
    OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at) THEN
    RAISE EXCEPTION 'managed claim cannot change ownership or dates' USING ERRCODE='23514';
  END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER managed_claim_history BEFORE UPDATE OR DELETE ON inventory_claims FOR EACH ROW EXECUTE FUNCTION guard_managed_claim_history();
