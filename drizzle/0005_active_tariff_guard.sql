-- An activated tariff and its bands are historical reference evidence.
CREATE FUNCTION guard_rate_schedule_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'rate schedule deletion is forbidden' USING ERRCODE='23514'; END IF;
  IF NEW.id <> OLD.id OR NEW.unit_id <> OLD.unit_id OR NEW.version_no <> OLD.version_no OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'rate schedule identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state = 'DRAFT' AND NEW.state = 'ACTIVE' AND OLD.activated_at IS NULL AND NEW.activated_at IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD.state = 'ACTIVE' AND NEW.state = 'RETIRED' AND NEW.activated_at = OLD.activated_at THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid rate schedule transition' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE TRIGGER rate_schedule_version_guard BEFORE UPDATE OR DELETE ON rate_schedule_versions FOR EACH ROW EXECUTE FUNCTION guard_rate_schedule_version();
--> statement-breakpoint
CREATE FUNCTION guard_seasonal_rate() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE schedule_state text; BEGIN
  IF TG_OP = 'UPDATE' AND NEW.rate_schedule_version_id <> OLD.rate_schedule_version_id THEN
    RAISE EXCEPTION 'rate band cannot move between versions' USING ERRCODE='23514';
  END IF;
  SELECT state INTO schedule_state FROM rate_schedule_versions WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.rate_schedule_version_id ELSE NEW.rate_schedule_version_id END FOR UPDATE;
  IF schedule_state <> 'DRAFT' THEN RAISE EXCEPTION 'activated tariff bands are immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER seasonal_rate_guard BEFORE INSERT OR UPDATE OR DELETE ON seasonal_rates FOR EACH ROW EXECUTE FUNCTION guard_seasonal_rate();
--> statement-breakpoint
ALTER TABLE rate_schedule_versions ADD CONSTRAINT rate_schedule_state_valid CHECK (state IN ('DRAFT','ACTIVE','RETIRED') AND ((state='DRAFT' AND activated_at IS NULL) OR (state IN ('ACTIVE','RETIRED') AND activated_at IS NOT NULL)));
