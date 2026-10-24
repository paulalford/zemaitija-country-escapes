-- A possibly dispatched command must not be replaced with fresh non-dispatch
-- evidence for the same accepted attempt. Historical fixtures remain deletable.
CREATE FUNCTION guard_accepted_session_command_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.kind='SESSION_CREATE' AND EXISTS (
    SELECT 1 FROM payment_attempts a JOIN price_snapshots s ON s.booking_id=a.booking_id
    WHERE a.id=OLD.payment_attempt_id
  ) THEN
    RAISE EXCEPTION 'accepted Session command history cannot be deleted' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
END $$;
--> statement-breakpoint
CREATE TRIGGER accepted_session_command_no_delete BEFORE DELETE ON provider_commands
  FOR EACH ROW EXECUTE FUNCTION guard_accepted_session_command_delete();
