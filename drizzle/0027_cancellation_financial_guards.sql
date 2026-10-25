-- Add local cross-row financial proofs without altering existing records.
CREATE FUNCTION lock_refund_liability_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.booking_id IS NOT NULL THEN PERFORM 1 FROM bookings WHERE id=NEW.booking_id FOR UPDATE; END IF;
  IF NEW.source_payment_record_id IS NOT NULL THEN PERFORM 1 FROM payment_records WHERE id=NEW.source_payment_record_id FOR UPDATE; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_liability_owner_lock BEFORE INSERT ON refund_obligations FOR EACH ROW EXECUTE FUNCTION lock_refund_liability_owner();
--> statement-breakpoint
CREATE FUNCTION check_cancellation_liability() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid; ca cancellation_assessments; b bookings; p payment_records; total numeric; paid numeric; owed numeric; charge numeric; rev assessment_revisions;
BEGIN
  IF TG_TABLE_NAME='assessment_revisions' THEN SELECT booking_id INTO bid FROM cancellation_assessments WHERE id=NEW.assessment_id;
  ELSE bid:=NEW.booking_id; END IF;
  IF TG_TABLE_NAME='refund_obligations' AND NEW.source_payment_record_id IS NOT NULL THEN
    SELECT * INTO p FROM payment_records WHERE id=NEW.source_payment_record_id;
    IF p.booking_id IS DISTINCT FROM NEW.booking_id OR p.provider_incident_id IS DISTINCT FROM NEW.provider_incident_id OR
      (SELECT sum(amount_cents) FROM refund_obligations WHERE source_payment_record_id=p.id)>p.captured_cents THEN
      RAISE EXCEPTION 'refund liability source identity or budget mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF bid IS NULL OR NOT EXISTS(SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN RETURN NULL; END IF;
  SELECT * INTO b FROM bookings WHERE id=bid;
  SELECT * INTO ca FROM cancellation_assessments WHERE booking_id=bid;
  IF b.status NOT LIKE 'CANCELLED_%' THEN
    IF ca.id IS NOT NULL THEN RAISE EXCEPTION 'assessment requires committed cancellation' USING ERRCODE='23514'; END IF;
    RETURN NULL;
  END IF;
  IF ca.id IS NULL THEN RAISE EXCEPTION 'cancellation assessment missing' USING ERRCODE='23514'; END IF;
  SELECT total_cents INTO total FROM price_snapshots WHERE booking_id=bid;
  SELECT COALESCE(sum(captured_cents),0) INTO paid FROM payment_records WHERE booking_id=bid AND allocation_state='ALLOCATED';
  SELECT COALESCE(sum(amount_cents),0) INTO owed FROM refund_obligations WHERE booking_id=bid;
  IF ca.state IN ('FINAL','REVISION_PENDING') THEN
    SELECT * INTO rev FROM assessment_revisions WHERE assessment_id=ca.id AND revision_no=ca.current_revision_no;
    IF rev.id IS NULL OR ca.current_revision_no<>(SELECT max(revision_no) FROM assessment_revisions WHERE assessment_id=ca.id) OR
      rev.charge_cents>floor(total*30/100) OR rev.charge_cents>rev.supportable_loss_cents THEN
      RAISE EXCEPTION 'final assessment pointer or charge mismatch' USING ERRCODE='23514'; END IF;
    charge:=rev.charge_cents;
  ELSIF ca.state='NOT_REQUIRED' THEN
    IF ca.current_revision_no IS NOT NULL THEN RAISE EXCEPTION 'zero charge assessment cannot have revisions' USING ERRCODE='23514'; END IF;
    charge:=0;
  ELSE
    IF owed<>0 OR ca.current_revision_no IS NOT NULL THEN RAISE EXCEPTION 'pending assessment cannot settle funds' USING ERRCODE='23514'; END IF;
    RETURN NULL;
  END IF;
  IF owed<>greatest(0,paid-charge) THEN RAISE EXCEPTION 'cancellation refund liability differs from entitlement' USING ERRCODE='23514'; END IF;
  IF b.status IN ('CANCELLED_GUEST','CANCELLED_PROVIDER') THEN PERFORM check_cancellation_finances(bid,false); END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cancellation_liability_assessment AFTER INSERT OR UPDATE ON cancellation_assessments DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_cancellation_liability();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cancellation_liability_revision AFTER INSERT ON assessment_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_cancellation_liability();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER cancellation_liability_obligation AFTER INSERT ON refund_obligations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_cancellation_liability();
--> statement-breakpoint
CREATE FUNCTION check_refund_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a refund_attempts; p payment_records; c provider_commands; q jsonb;
BEGIN
  IF NEW.kind<>'REFUND_CREATE' THEN RETURN NULL; END IF;
  SELECT * INTO c FROM provider_commands WHERE id=NEW.id;
  SELECT * INTO a FROM refund_attempts WHERE id=c.refund_attempt_id;
  SELECT * INTO p FROM payment_records WHERE id=a.payment_record_id;
  q:=c.request_params;
  IF q IS NULL OR q->>'attemptId' IS DISTINCT FROM a.id::text OR q->>'commandId' IS DISTINCT FROM c.id::text OR
    q->>'obligationId' IS DISTINCT FROM a.obligation_id::text OR q->>'paymentRecordId' IS DISTINCT FROM p.id::text OR
    q->>'paymentIntentId' IS DISTINCT FROM p.stripe_payment_intent_id OR q->>'chargeId' IS DISTINCT FROM p.stripe_charge_id OR
    (q->>'amountCents')::numeric IS DISTINCT FROM a.requested_cents::numeric OR
    (q->>'captureCents')::numeric IS DISTINCT FROM p.captured_cents::numeric OR
    q->>'idempotencyKey' IS DISTINCT FROM c.stripe_idempotency_key OR
    (c.first_submitted_at IS NOT NULL AND (c.attempt_count=0 OR c.lease_generation=0)) THEN
    RAISE EXCEPTION 'refund command does not match exact original capture and operation' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refund_command_financial_identity AFTER INSERT OR UPDATE ON provider_commands DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_refund_command();
--> statement-breakpoint
-- Capture evidence is fully immutable; the only runtime UPDATE column is the refund reservation.
CREATE OR REPLACE FUNCTION payment_record_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-'refund_encumbered_cents') IS DISTINCT FROM (to_jsonb(OLD)-'refund_encumbered_cents') THEN
    RAISE EXCEPTION 'payment capture evidence is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_refund_command_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.kind='REFUND_CREATE' AND ((OLD.state IN ('SUBMITTED','UNKNOWN','QUARANTINED') AND NEW.state='PENDING') OR
    (NEW.state='PENDING' AND NEW.first_submitted_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'uncertain refund command cannot become pending' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_command_transition BEFORE UPDATE ON provider_commands FOR EACH ROW EXECUTE FUNCTION guard_refund_command_transition();
