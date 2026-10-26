-- Lock authentication identity without granting runtime UPDATE on administrator rows.
CREATE FUNCTION lock_admin_identity(p_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  PERFORM id FROM admin_users WHERE id=p_id FOR SHARE;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION lock_admin_identity(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION lock_admin_identity(uuid) TO zemaitija_app;
