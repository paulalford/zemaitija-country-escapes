CREATE TABLE "access_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"operation" text NOT NULL,
	"booking_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "access_rate_limits" (
	"bucket_hash" "bytea" PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"attempts" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"guest_token_id" uuid,
	"admin_user_id" uuid,
	"admin_version" integer,
	"scopes" text[] NOT NULL,
	"authenticated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "admin_unit_access" (
	"id" uuid PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "management_commands" (
	"operation_key" text PRIMARY KEY NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"fingerprint" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "auth_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_access_tokens" ADD COLUMN "consumed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "access_actions" ADD CONSTRAINT "access_actions_session_id_access_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."access_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_actions" ADD CONSTRAINT "access_actions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_sessions" ADD CONSTRAINT "access_sessions_guest_token_id_guest_access_tokens_id_fk" FOREIGN KEY ("guest_token_id") REFERENCES "public"."guest_access_tokens"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_sessions" ADD CONSTRAINT "access_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_unit_access" ADD CONSTRAINT "admin_unit_access_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_unit_access" ADD CONSTRAINT "admin_unit_access_unit_id_accommodation_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."accommodation_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "management_commands" ADD CONSTRAINT "management_commands_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX access_sessions_hash ON access_sessions(token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX access_actions_hash ON access_actions(token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX admin_unit_access_unique ON admin_unit_access(admin_user_id,unit_id);
--> statement-breakpoint
ALTER TABLE access_sessions ADD CONSTRAINT access_sessions_owner CHECK
  (num_nonnulls(guest_token_id,admin_user_id)=1 AND (admin_user_id IS NULL OR admin_version IS NOT NULL));
--> statement-breakpoint
ALTER TABLE access_sessions ADD CONSTRAINT access_sessions_lifetime CHECK
  (expires_at>authenticated_at AND expires_at<=authenticated_at+interval '1 hour');
--> statement-breakpoint
ALTER TABLE access_rate_limits ADD CONSTRAINT access_rate_positive CHECK (attempts>0);
--> statement-breakpoint
ALTER TABLE admin_users ADD CONSTRAINT admin_users_approved_role CHECK (role IN ('operations','finance','administrator')) NOT VALID;
--> statement-breakpoint
CREATE FUNCTION invalidate_admin_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  IF (NEW.role,NEW.enabled,NEW.disabled_at,NEW.external_subject) IS DISTINCT FROM (OLD.role,OLD.enabled,OLD.disabled_at,OLD.external_subject) THEN
    NEW.auth_version := OLD.auth_version+1;
    UPDATE access_sessions SET revoked_at=clock_timestamp() WHERE admin_user_id=OLD.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER admin_session_invalidation BEFORE UPDATE ON admin_users FOR EACH ROW EXECUTE FUNCTION invalidate_admin_sessions();
--> statement-breakpoint
CREATE FUNCTION lock_management_units(p_units uuid[]) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
  PERFORM id FROM accommodation_units WHERE id=ANY(p_units) ORDER BY id FOR UPDATE;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION lock_management_units(uuid[]) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION lock_management_units(uuid[]) TO zemaitija_app;
--> statement-breakpoint
-- Read identity and grants, but do not let request credentials provision administrators.
GRANT SELECT ON admin_users,admin_unit_access,operator_blocks TO zemaitija_app;
--> statement-breakpoint
GRANT SELECT,INSERT ON guest_access_tokens,access_sessions,access_actions,management_commands TO zemaitija_app;
--> statement-breakpoint
GRANT UPDATE(revoked_at,last_used_at,consumed_at) ON guest_access_tokens TO zemaitija_app;
--> statement-breakpoint
GRANT UPDATE(revoked_at,last_used_at) ON access_sessions TO zemaitija_app;
--> statement-breakpoint
GRANT UPDATE(consumed_at) ON access_actions TO zemaitija_app;
--> statement-breakpoint
GRANT SELECT,INSERT,UPDATE ON access_rate_limits TO zemaitija_app;
--> statement-breakpoint
GRANT INSERT ON operator_blocks TO zemaitija_app;
--> statement-breakpoint
GRANT UPDATE(released_at) ON operator_blocks TO zemaitija_app;
--> statement-breakpoint
-- Prevent in-place block rewriting even under privileged tooling; release/replace preserves history.
CREATE FUNCTION guard_operator_block_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.reason_code NOT IN ('PRIVATE_USE','MAINTENANCE','OTHER') THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'block history is immutable' USING ERRCODE='23514'; END IF;
  IF (NEW.id,NEW.unit_id,NEW.arrival_date,NEW.departure_date,NEW.reason_code,NEW.created_by_admin_id,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.unit_id,OLD.arrival_date,OLD.departure_date,OLD.reason_code,OLD.created_by_admin_id,OLD.created_at)
    OR (OLD.released_at IS NOT NULL AND NEW.released_at IS DISTINCT FROM OLD.released_at) THEN
    RAISE EXCEPTION 'release and replace block instead' USING ERRCODE='23514';
  END IF; RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER operator_block_history BEFORE UPDATE OR DELETE ON operator_blocks FOR EACH ROW EXECUTE FUNCTION guard_operator_block_history();
--> statement-breakpoint
-- Legacy synthetic test fixtures retain their previous contract. New controlled blocks
-- must have exactly one matching historical claim and identical release status.
CREATE FUNCTION check_managed_block_claim() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; b record; BEGIN
  bid := CASE WHEN TG_TABLE_NAME='operator_blocks' THEN NEW.id ELSE NEW.operator_block_id END;
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
CREATE CONSTRAINT TRIGGER managed_block_claim AFTER INSERT OR UPDATE ON operator_blocks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_managed_block_claim();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER managed_claim_block AFTER INSERT OR UPDATE ON inventory_claims
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_managed_block_claim();
--> statement-breakpoint
CREATE FUNCTION manage_admin_identity(p_session_hash bytea,p_target uuid,p_subject text,p_role text,p_enabled boolean,p_units uuid[],p_operation text,p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor uuid; target uuid; old_row admin_users; prior management_commands; fp text;
BEGIN
  SELECT a.id INTO actor FROM access_sessions s JOIN admin_users a ON a.id=s.admin_user_id WHERE s.token_hash=p_session_hash
    AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.last_used_at>clock_timestamp()-interval '30 minutes'
    AND s.authenticated_at>clock_timestamp()-interval '10 minutes' AND a.enabled AND a.disabled_at IS NULL
    AND a.auth_version=s.admin_version AND a.role='administrator';
  IF actor IS NULL THEN RAISE EXCEPTION 'identity administration denied' USING ERRCODE='42501'; END IF;
  IF p_role NOT IN ('operations','finance','administrator') OR length(p_subject)<3 OR length(p_subject)>500
    OR p_operation !~ '^[a-zA-Z0-9:_-]{8,150}$' OR length(trim(p_reason))<3 OR length(p_reason)>500 THEN
    RAISE EXCEPTION 'invalid identity command' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('management:'||p_operation,0));
  fp:=md5(jsonb_build_array(p_target,p_subject,p_role,p_enabled,p_units,p_reason)::text);
  SELECT * INTO prior FROM management_commands WHERE operation_key=p_operation;
  IF FOUND THEN
    IF prior.admin_user_id<>actor OR prior.fingerprint<>fp THEN RAISE EXCEPTION 'identity command conflict' USING ERRCODE='22023'; END IF;
    RETURN (prior.result->>'adminId')::uuid;
  END IF;
  target:=COALESCE(p_target,gen_random_uuid());
  SELECT * INTO old_row FROM admin_users WHERE id=target FOR UPDATE;
  -- A separate administrator must review changes to the acting identity.
  IF target=actor THEN RAISE EXCEPTION 'self privilege changes forbidden' USING ERRCODE='42501'; END IF;
  IF p_target IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'identity unavailable' USING ERRCODE='22023'; END IF;
  INSERT INTO admin_users(id,external_subject,role,enabled,disabled_at) VALUES(target,p_subject,p_role,p_enabled,CASE WHEN p_enabled THEN NULL ELSE clock_timestamp() END)
    ON CONFLICT(id) DO UPDATE SET external_subject=EXCLUDED.external_subject,role=EXCLUDED.role,enabled=EXCLUDED.enabled,disabled_at=EXCLUDED.disabled_at;
  DELETE FROM admin_unit_access WHERE admin_user_id=target;
  INSERT INTO admin_unit_access(id,admin_user_id,unit_id) SELECT gen_random_uuid(),target,u FROM unnest(p_units) u;
  UPDATE access_sessions SET revoked_at=clock_timestamp() WHERE admin_user_id=target AND revoked_at IS NULL;
  INSERT INTO management_commands(operation_key,admin_user_id,fingerprint,result) VALUES(p_operation,actor,fp,jsonb_build_object('adminId',target));
  INSERT INTO audit_events(id,actor_kind,admin_user_id,service_name,action,entity_type,entity_id,operation_key,reason_code,occurred_at,details)
    VALUES(gen_random_uuid(),'ADMIN',actor,'identity-management','admin.identity_changed','admin_user',target,p_operation,'EXPLICIT_IDENTITY_REVIEW',clock_timestamp(),
      jsonb_build_object('authorizationRef',(SELECT id FROM access_sessions WHERE token_hash=p_session_hash),'priorRole',old_row.role,'newRole',p_role,'enabled',p_enabled,'reason',p_reason));
  RETURN target;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION manage_admin_identity(bytea,uuid,text,text,boolean,uuid[],text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION manage_admin_identity(bytea,uuid,text,text,boolean,uuid[],text,text) TO zemaitija_app;
