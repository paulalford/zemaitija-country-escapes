-- Custom SQL migration file, put your code below! --
-- Narrow row-lock capability without granting catalog UPDATE to the runtime role.
CREATE FUNCTION lock_acceptance_context(p_unit uuid, p_guest uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  PERFORM 1 FROM accommodation_units WHERE id=p_unit FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM guests WHERE id=p_guest FOR SHARE;
  PERFORM 1 FROM rate_schedule_versions WHERE unit_id=p_unit AND state='ACTIVE' FOR SHARE;
  RETURN true;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION lock_acceptance_context(uuid,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION lock_acceptance_context(uuid,uuid) TO zemaitija_app;
