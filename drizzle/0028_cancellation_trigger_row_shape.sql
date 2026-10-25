-- Isolate table-specific NEW fields in a separate PL/pgSQL branch.
CREATE OR REPLACE FUNCTION check_cancellation_liability() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid; ca cancellation_assessments; b bookings; p payment_records; total numeric; paid numeric; owed numeric; charge numeric; rev assessment_revisions;
BEGIN
  IF TG_TABLE_NAME='assessment_revisions' THEN SELECT booking_id INTO bid FROM cancellation_assessments WHERE id=NEW.assessment_id;
  ELSE bid:=NEW.booking_id; END IF;
  IF TG_TABLE_NAME='refund_obligations' THEN
   IF NEW.source_payment_record_id IS NOT NULL THEN
    SELECT * INTO p FROM payment_records WHERE id=NEW.source_payment_record_id;
    IF p.booking_id IS DISTINCT FROM NEW.booking_id OR p.provider_incident_id IS DISTINCT FROM NEW.provider_incident_id OR
      (SELECT sum(amount_cents) FROM refund_obligations WHERE source_payment_record_id=p.id)>p.captured_cents THEN
      RAISE EXCEPTION 'refund liability source identity or budget mismatch' USING ERRCODE='23514'; END IF;
  END IF;
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
