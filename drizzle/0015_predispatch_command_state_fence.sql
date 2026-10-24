-- Unknown/submitted Session creation cannot be recast as a never-dispatched draft.
-- Milestone 10 may add provider-evidence-backed recovery transitions separately.
CREATE OR REPLACE FUNCTION guard_provider_command_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.lease_generation < OLD.lease_generation OR NEW.attempt_count < OLD.attempt_count OR
     (OLD.first_submitted_at IS NOT NULL AND NEW.first_submitted_at IS DISTINCT FROM OLD.first_submitted_at) OR
     (OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id) OR
     (OLD.state='RESOLVED' AND NEW.state<>'RESOLVED') THEN
    RAISE EXCEPTION 'provider command evidence cannot regress' USING ERRCODE='23514'; END IF;
  IF OLD.kind='SESSION_CREATE' AND OLD.state IN ('SUBMITTED','UNKNOWN','QUARANTINED') AND
     NEW.state='PENDING' THEN
    RAISE EXCEPTION 'uncertain Session command cannot become pending' USING ERRCODE='23514'; END IF;
  IF NEW.kind='SESSION_CREATE' AND NEW.state='RESOLVED' AND NEW.first_submitted_at IS NULL AND
     (OLD.state NOT IN ('PENDING','RESOLVED') OR NEW.lease_generation<>0 OR NEW.attempt_count<>0 OR
      NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR
      NEW.provider_request_id IS NOT NULL OR NEW.resolved_at IS NULL OR
      NEW.last_error_code IS DISTINCT FROM 'ABANDONED_BEFORE_DISPATCH') THEN
    RAISE EXCEPTION 'pre-dispatch resolution lacks non-dispatch proof' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
