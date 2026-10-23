CREATE FUNCTION check_allocation_parent_budget() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_TABLE_NAME = 'payment_records' AND (SELECT COALESCE(sum(amount_cents),0) FROM payment_allocations WHERE payment_record_id=NEW.id) > NEW.captured_cents THEN RAISE EXCEPTION 'capture allocation exceeds budget' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME = 'payment_obligations' AND (SELECT COALESCE(sum(amount_cents),0) FROM payment_allocations WHERE obligation_id=NEW.id) > NEW.amount_cents THEN RAISE EXCEPTION 'obligation allocation exceeds budget' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_records_budget AFTER UPDATE OF captured_cents ON payment_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_allocation_parent_budget();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_obligations_budget AFTER UPDATE OF amount_cents ON payment_obligations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_allocation_parent_budget();
