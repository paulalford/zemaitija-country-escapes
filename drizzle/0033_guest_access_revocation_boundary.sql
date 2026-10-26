CREATE TABLE "guest_access_boundaries" (
	"booking_id" uuid PRIMARY KEY NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD COLUMN "guest_access_generation" integer;--> statement-breakpoint
ALTER TABLE "guest_access_boundaries" ADD CONSTRAINT "guest_access_boundaries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE guest_access_boundaries ADD CONSTRAINT guest_access_generation_nonnegative CHECK (generation>=0);
--> statement-breakpoint
-- Existing requests predate this fence. Conservatively fence every booking with a
-- historical revocation: old concurrency ordering cannot be proved retroactively.
UPDATE notification_outbox SET guest_access_generation=0 WHERE recipient_kind='GUEST' AND booking_id IS NOT NULL;
--> statement-breakpoint
INSERT INTO guest_access_boundaries(booking_id,generation)
  SELECT DISTINCT b.id,1 FROM bookings b JOIN audit_events a ON a.entity_id=b.id WHERE a.action='guest.access_revoked';
--> statement-breakpoint
UPDATE guest_access_tokens SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL
  AND booking_id IN (SELECT booking_id FROM guest_access_boundaries);
--> statement-breakpoint
UPDATE access_sessions s SET revoked_at=clock_timestamp() FROM guest_access_tokens t
  WHERE s.guest_token_id=t.id AND s.revoked_at IS NULL AND t.booking_id IN (SELECT booking_id FROM guest_access_boundaries);
--> statement-breakpoint
INSERT INTO audit_events(id,booking_id,actor_kind,service_name,action,entity_type,entity_id,reason_code,occurred_at,details)
  SELECT gen_random_uuid(),booking_id,'SERVICE','access-boundary-migration','guest.access_fenced','access',booking_id,
    'HISTORICAL_REVOCATION',clock_timestamp(),jsonb_build_object('generation',generation)
  FROM guest_access_boundaries;
--> statement-breakpoint
-- Lock before reading the generation. Every caller uses a short READ COMMITTED
-- transaction. No booking/inventory row lock and no provider call is involved.
CREATE FUNCTION lock_guest_access(p_booking uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_generation integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('guest-access:'||p_booking::text,0));
  INSERT INTO guest_access_boundaries(booking_id) VALUES(p_booking) ON CONFLICT DO NOTHING;
  SELECT generation INTO current_generation FROM guest_access_boundaries WHERE booking_id=p_booking;
  RETURN current_generation;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION lock_guest_access(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION lock_guest_access(uuid) TO zemaitija_app;
--> statement-breakpoint
GRANT SELECT ON guest_access_boundaries TO zemaitija_app;
--> statement-breakpoint
CREATE FUNCTION revoke_guest_access(p_booking uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM lock_guest_access(p_booking);
  UPDATE guest_access_boundaries SET generation=generation+1 WHERE booking_id=p_booking;
  UPDATE guest_access_tokens SET revoked_at=clock_timestamp() WHERE booking_id=p_booking AND revoked_at IS NULL;
  UPDATE access_sessions s SET revoked_at=clock_timestamp() FROM guest_access_tokens t
    WHERE s.guest_token_id=t.id AND t.booking_id=p_booking AND s.revoked_at IS NULL;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION revoke_guest_access(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION revoke_guest_access(uuid) TO zemaitija_app;
--> statement-breakpoint
CREATE FUNCTION stamp_guest_access_generation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.guest_access_generation:=NULL;
    IF NEW.recipient_kind='GUEST' AND NEW.booking_id IS NOT NULL THEN
      NEW.guest_access_generation:=lock_guest_access(NEW.booking_id);
      -- Ordinary financial/status events must not implicitly reauthorize access
      -- after revocation. Only a new explicit access request captures that generation.
      IF NEW.event_type<>'GUEST_ACCESS_LINK' AND NEW.guest_access_generation>0 THEN
        NEW.guest_access_generation:=NULL;
      END IF;
    END IF;
  ELSIF NEW.guest_access_generation IS DISTINCT FROM OLD.guest_access_generation THEN
    RAISE EXCEPTION 'notification access authorization is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER notification_guest_access_generation BEFORE INSERT OR UPDATE ON notification_outbox
  FOR EACH ROW EXECUTE FUNCTION stamp_guest_access_generation();
--> statement-breakpoint
CREATE FUNCTION serialize_guest_token_issuance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  PERFORM lock_guest_access(NEW.booking_id);
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER guest_token_issuance_boundary BEFORE INSERT ON guest_access_tokens
  FOR EACH ROW EXECUTE FUNCTION serialize_guest_token_issuance();
