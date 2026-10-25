-- Milestone 12: permit only the governed nonpayment transition for accepted bookings.
CREATE OR REPLACE FUNCTION guard_booking_acceptance_fields() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.id) THEN
      RAISE EXCEPTION 'accepted booking history cannot be deleted' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF ROW(NEW.guest_id,NEW.unit_id,NEW.arrival_date,NEW.departure_date,NEW.guest_count,NEW.accepted_at,NEW.check_in_local_time,NEW.property_zone,NEW.scheduled_arrival_at,NEW.warning_at,NEW.balance_due_at,NEW.grace_ends_at) IS DISTINCT FROM
     ROW(OLD.guest_id,OLD.unit_id,OLD.arrival_date,OLD.departure_date,OLD.guest_count,OLD.accepted_at,OLD.check_in_local_time,OLD.property_zone,OLD.scheduled_arrival_at,OLD.warning_at,OLD.balance_due_at,OLD.grace_ends_at) THEN
    RAISE EXCEPTION 'accepted booking fields are immutable' USING ERRCODE='23514'; END IF;
  IF EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.id) AND OLD.status<>NEW.status AND NOT
     ((OLD.status='AWAITING_INITIAL_PAYMENT' AND NEW.status IN ('CONFIRMED','EXPIRED')) OR
      (OLD.status='CONFIRMED' AND NEW.status IN ('CANCELLED_GUEST','CANCELLED_PROVIDER') AND NEW.cancelled_at IS NOT NULL AND length(NEW.cancellation_reason)>0) OR
      (OLD.status='CONFIRMED' AND NEW.status='CANCELLED_NONPAYMENT' AND NEW.cancelled_at IS NOT NULL
       AND NEW.cancelled_at>=OLD.grace_ends_at AND NEW.cancellation_reason='BALANCE_UNPAID_RECONCILED')) THEN
    RAISE EXCEPTION 'unsupported accepted booking transition' USING ERRCODE='23514'; END IF;
  IF OLD.status LIKE 'CANCELLED_%' AND ROW(NEW.cancelled_at,NEW.cancellation_reason) IS DISTINCT FROM ROW(OLD.cancelled_at,OLD.cancellation_reason) THEN
    RAISE EXCEPTION 'cancellation history is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;

--> statement-breakpoint
-- Correct consumed-hold invariant for the released nonpayment claim.
CREATE OR REPLACE FUNCTION check_accepted_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE hid uuid; bid uuid; old_hid uuid; new_hid uuid;
BEGIN
  IF TG_TABLE_NAME='inventory_holds' THEN
    new_hid:=NEW.id; IF TG_OP='UPDATE' THEN old_hid:=OLD.id; END IF;
  ELSE
    new_hid:=COALESCE(NEW.hold_id,NEW.origin_hold_id);
    IF TG_OP='UPDATE' THEN old_hid:=COALESCE(OLD.hold_id,OLD.origin_hold_id); END IF;
  END IF;
  FOR hid IN SELECT DISTINCT id FROM (VALUES (old_hid),(new_hid)) AS owners(id) WHERE id IS NOT NULL LOOP
    SELECT booking_id INTO bid FROM inventory_holds WHERE id=hid;
    IF bid IS NULL OR NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN bookings b ON b.id=h.booking_id
        JOIN payment_attempts a ON a.id=h.payment_attempt_id JOIN payment_obligations o ON o.id=a.obligation_id
        JOIN inventory_claims c ON c.hold_id=h.id OR c.origin_hold_id=h.id
      WHERE h.id=hid AND a.booking_id=bid AND a.hold_id=h.id AND o.booking_id=bid AND o.kind='INITIAL'
        AND a.expected_cents=o.amount_cents AND c.unit_id=b.unit_id
        AND c.arrival_date=b.arrival_date AND c.departure_date=b.departure_date AND
        ((h.state IN ('CREATING','ACTIVE','RECONCILING') AND c.hold_id=h.id AND c.released_at IS NULL) OR
         (h.state='CONSUMED' AND c.booking_id=bid AND c.origin_hold_id=h.id
           AND a.state='SUCCEEDED' AND (b.status='CONFIRMED' OR (b.status='CANCELLED_NONPAYMENT' AND c.released_at IS NOT NULL AND c.release_reason='NONPAYMENT_RECONCILED') OR (b.status IN ('CANCELLED_GUEST','CANCELLED_PROVIDER') AND c.released_at IS NOT NULL AND c.release_reason='CANCELLATION_RECONCILED'))) OR
         (h.state='RELEASED' AND c.hold_id=h.id AND c.released_at IS NOT NULL
           AND c.release_reason IN ('ABANDONED_BEFORE_DISPATCH','PROVIDER_TERMINAL_UNPAID')))
    ) THEN RAISE EXCEPTION 'accepted hold ownership mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;

--> statement-breakpoint
-- Permit fully accounted unallocatable success after committed cancellation.
-- The booking transition itself still requires terminal unpaid attempts.
CREATE OR REPLACE FUNCTION check_pending_booking_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_bid uuid; new_bid uuid; bid uuid; b record; entering_cancellation boolean:=false;
BEGIN
  IF TG_TABLE_NAME='bookings' THEN
    new_bid:=NEW.id; IF TG_OP='UPDATE' THEN
      old_bid:=OLD.id;
      entering_cancellation:=OLD.status='CONFIRMED' AND NEW.status LIKE 'CANCELLED_%';
    END IF;
  ELSIF TG_TABLE_NAME IN ('inventory_holds','payment_attempts') THEN
    new_bid:=NEW.booking_id; IF TG_OP='UPDATE' THEN old_bid:=OLD.booking_id; END IF;
  ELSIF TG_TABLE_NAME='provider_commands' THEN
    SELECT booking_id INTO new_bid FROM payment_attempts WHERE id=NEW.payment_attempt_id;
    IF TG_OP='UPDATE' THEN SELECT booking_id INTO old_bid FROM payment_attempts WHERE id=OLD.payment_attempt_id; END IF;
  ELSE
    IF NEW.hold_id IS NOT NULL THEN SELECT booking_id INTO new_bid FROM inventory_holds WHERE id=NEW.hold_id;
    ELSE new_bid:=NEW.booking_id; END IF;
    IF TG_OP='UPDATE' THEN
      IF OLD.hold_id IS NOT NULL THEN SELECT booking_id INTO old_bid FROM inventory_holds WHERE id=OLD.hold_id;
      ELSE old_bid:=OLD.booking_id; END IF;
    END IF;
  END IF;
  FOR bid IN SELECT DISTINCT id FROM (VALUES (old_bid),(new_bid)) AS owners(id) WHERE id IS NOT NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN CONTINUE; END IF;
    SELECT * INTO b FROM bookings WHERE id=bid;
    IF b.status='AWAITING_INITIAL_PAYMENT' AND NOT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN inventory_claims c ON c.hold_id=h.id
        JOIN payment_attempts a ON a.id=h.payment_attempt_id
      WHERE h.booking_id=bid AND c.released_at IS NULL AND
        ((h.state='CREATING' AND a.state='CREATING') OR
         (h.state='ACTIVE' AND a.state='OPEN') OR
         (h.state='RECONCILING' AND a.state='RECONCILING'))
    ) THEN RAISE EXCEPTION 'pending booking must own blocking hold and matching attempt' USING ERRCODE='23514'; END IF;
    IF b.status='CONFIRMED' AND NOT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN inventory_claims c ON c.booking_id=bid AND c.origin_hold_id=h.id
        JOIN payment_attempts a ON a.id=h.payment_attempt_id
        JOIN payment_records p ON p.attempt_id=a.id AND p.allocation_state='ALLOCATED'
        JOIN payment_allocations pa ON pa.payment_record_id=p.id AND pa.obligation_id=a.obligation_id
      WHERE h.booking_id=bid AND h.state='CONSUMED' AND a.state='SUCCEEDED' AND c.released_at IS NULL
        AND pa.amount_cents=a.expected_cents AND p.captured_cents=a.expected_cents
    ) THEN RAISE EXCEPTION 'confirmed booking lacks verified initial payment and claim' USING ERRCODE='23514'; END IF;
    IF b.status='EXPIRED' AND NOT EXISTS (
      SELECT 1 FROM inventory_holds h JOIN inventory_claims c ON c.hold_id=h.id
        JOIN payment_attempts a ON a.id=h.payment_attempt_id
        JOIN provider_commands pc ON pc.payment_attempt_id=a.id AND pc.kind='SESSION_CREATE'
      WHERE h.booking_id=bid AND h.state='RELEASED' AND h.terminal_at IS NOT NULL
        AND c.released_at IS NOT NULL AND a.state IN ('EXPIRED','SUCCEEDED') AND
        ((c.release_reason='ABANDONED_BEFORE_DISPATCH' AND pc.state='RESOLVED'
          AND pc.resolved_at IS NOT NULL AND pc.last_error_code='ABANDONED_BEFORE_DISPATCH'
          AND pc.first_submitted_at IS NULL AND pc.provider_request_id IS NULL
          AND pc.lease_generation=0 AND pc.attempt_count=0
          AND pc.lease_owner IS NULL AND pc.lease_expires_at IS NULL) OR
         (c.release_reason='PROVIDER_TERMINAL_UNPAID' AND EXISTS (
           SELECT 1 FROM reconciliation_records r WHERE r.id=a.last_reconciliation_id
             AND r.evidence_kind='STRIPE_CURRENT' AND r.result='TERMINAL_UNPAID'
             AND r.provider_state='expired')))
    ) THEN RAISE EXCEPTION 'expired booking lacks safe release proof' USING ERRCODE='23514'; END IF;
    IF b.status='CANCELLED_NONPAYMENT' AND NOT EXISTS (
      SELECT 1 FROM inventory_claims c JOIN cancellation_assessments ca ON ca.booking_id=bid
      WHERE c.booking_id=bid AND c.released_at=b.cancelled_at AND c.release_reason='NONPAYMENT_RECONCILED'
        AND ca.reason='NONPAYMENT' AND ca.state='NOT_REQUIRED' AND ca.cap_cents=0
    ) THEN RAISE EXCEPTION 'nonpayment cancellation lacks release and zero-charge assessment' USING ERRCODE='23514'; END IF;
    IF b.status='CANCELLED_NONPAYMENT' AND (
      EXISTS (SELECT 1 FROM payment_obligations o JOIN payment_allocations pa ON pa.obligation_id=o.id
        WHERE o.booking_id=bid AND o.kind='BALANCE') OR
      EXISTS (SELECT 1 FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id
        WHERE o.booking_id=bid AND o.kind='BALANCE' AND NOT EXISTS (
          SELECT 1 FROM reconciliation_records r WHERE r.id=a.last_reconciliation_id
            AND r.payment_attempt_id=a.id AND r.evidence_kind='STRIPE_CURRENT' AND (
              (a.state IN ('EXPIRED','FAILED') AND r.result IN ('TERMINAL_UNPAID','TERMINAL_FAILED')) OR
              (NOT entering_cancellation AND a.state='SUCCEEDED' AND r.result='UNALLOCATABLE'
                AND r.provider_state='complete' AND r.payment_status='paid'
                AND r.provider_object_id=a.stripe_session_id AND EXISTS (
                  SELECT 1 FROM payment_records p JOIN provider_incidents i ON i.id=p.provider_incident_id
                    JOIN refund_obligations ro ON ro.source_payment_record_id=p.id
                  WHERE p.stripe_payment_intent_id=a.stripe_payment_intent_id
                    AND p.allocation_state='UNALLOCATABLE' AND p.reconciliation_id=r.id
                    AND p.captured_cents=a.expected_cents AND p.currency=a.currency
                    AND p.provider_succeeded_at IS NOT DISTINCT FROM r.provider_success_at
                    AND i.kind='LATE_BALANCE_CAPTURE' AND i.stripe_payment_intent_id=a.stripe_payment_intent_id
                    AND i.stripe_session_id=a.stripe_session_id
                    AND ro.provider_incident_id=i.id AND ro.reason='UNALLOCATABLE_BALANCE_CAPTURE'
                    AND ro.amount_cents=p.captured_cents AND ro.currency=p.currency
                    AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_record_id=p.id)
                ))
            ))) OR
      EXISTS (SELECT 1 FROM payment_records p WHERE p.booking_id=bid AND p.allocation_state='ALLOCATED'
        AND NOT EXISTS (SELECT 1 FROM refund_obligations ro WHERE ro.booking_id=bid
          AND ro.source_payment_record_id=p.id AND ro.reason='NONPAYMENT_ZERO_CHARGE'
          AND ro.amount_cents=p.captured_cents))
    ) THEN RAISE EXCEPTION 'nonpayment cancellation lacks terminal payment proof or full refund liability' USING ERRCODE='23514'; END IF;
    IF b.status IN ('CANCELLED_GUEST','CANCELLED_PROVIDER') THEN
      PERFORM check_cancellation_finances(bid, TG_TABLE_NAME='bookings' AND TG_OP='UPDATE' AND entering_cancellation);
      CONTINUE;
    END IF;
    IF b.status NOT IN ('AWAITING_INITIAL_PAYMENT','CONFIRMED','EXPIRED','CANCELLED_NONPAYMENT') THEN
      RAISE EXCEPTION 'unsupported accepted booking state' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;

--> statement-breakpoint
ALTER TABLE assessment_revisions ADD COLUMN evidence jsonb;
--> statement-breakpoint
CREATE FUNCTION check_cancellation_finances(bid uuid, entering boolean) RETURNS void LANGUAGE plpgsql AS $$
DECLARE b bookings; a cancellation_assessments; total bigint;
BEGIN
  SELECT * INTO b FROM bookings WHERE id=bid;
  SELECT * INTO a FROM cancellation_assessments WHERE booking_id=bid;
  SELECT total_cents INTO total FROM price_snapshots WHERE booking_id=bid;
  IF a.id IS NULL OR a.cancelled_at<>b.cancelled_at OR NOT EXISTS(SELECT 1 FROM inventory_claims
    WHERE booking_id=bid AND released_at=b.cancelled_at AND release_reason='CANCELLATION_RECONCILED') OR
    NOT EXISTS(SELECT 1 FROM audit_events WHERE booking_id=bid AND action=CASE WHEN b.status='CANCELLED_GUEST' THEN 'booking.cancelled_guest' ELSE 'booking.cancelled_provider' END) THEN
    RAISE EXCEPTION 'cancellation requires assessment, release and audit' USING ERRCODE='23514'; END IF;
  IF b.status='CANCELLED_PROVIDER' THEN
    IF a.reason<>'PROVIDER' OR a.state<>'NOT_REQUIRED' OR a.cap_cents<>0 THEN RAISE EXCEPTION 'provider refund principle violated' USING ERRCODE='23514'; END IF;
  ELSIF b.cancelled_at<b.balance_due_at THEN
    IF a.reason<>'GUEST_EARLY' OR a.state<>'NOT_REQUIRED' OR a.cap_cents<>0 THEN RAISE EXCEPTION 'early cancellation must be free' USING ERRCODE='23514'; END IF;
  ELSE
    IF a.reason<>'GUEST_LATE' OR a.state NOT IN ('PENDING','FINAL','REVISION_PENDING') OR a.cap_cents<>floor(total::numeric*30/100) THEN RAISE EXCEPTION 'late cancellation assessment required' USING ERRCODE='23514'; END IF;
  END IF;
  IF a.state='NOT_REQUIRED' AND EXISTS(SELECT 1 FROM payment_records p WHERE p.booking_id=bid AND
    NOT EXISTS(SELECT 1 FROM refund_obligations ro WHERE ro.booking_id=bid AND ro.source_payment_record_id=p.id AND ro.amount_cents=p.captured_cents)) THEN
    RAISE EXCEPTION 'full captured refund liability required' USING ERRCODE='23514'; END IF;
  IF EXISTS(SELECT 1 FROM payment_attempts pa LEFT JOIN reconciliation_records r ON r.id=pa.last_reconciliation_id
    WHERE pa.booking_id=bid AND (pa.state NOT IN ('SUCCEEDED','EXPIRED','FAILED') OR
      (pa.state IN ('EXPIRED','FAILED') AND (r.result IS NULL OR r.result NOT IN ('TERMINAL_UNPAID','TERMINAL_FAILED'))))) THEN
    RAISE EXCEPTION 'cancellation has uncertain payments' USING ERRCODE='23514'; END IF;
  IF entering AND EXISTS(SELECT 1 FROM provider_commands pc JOIN payment_attempts pa ON pa.id=pc.payment_attempt_id
    WHERE pa.booking_id=bid AND pc.state<>'RESOLVED') THEN RAISE EXCEPTION 'cancellation has unresolved provider command' USING ERRCODE='23514'; END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guard_assessment_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF ROW(NEW.id,NEW.booking_id,NEW.cancelled_at,NEW.reason,NEW.cap_cents,NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id,OLD.booking_id,OLD.cancelled_at,OLD.reason,OLD.cap_cents,OLD.created_at) OR
    (OLD.state<>NEW.state AND NOT ((OLD.state IN ('PENDING','REVISION_PENDING') AND NEW.state='FINAL') OR (OLD.state='FINAL' AND NEW.state='REVISION_PENDING'))) THEN
    RAISE EXCEPTION 'invalid assessment transition or identity change' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER assessment_update_guard BEFORE UPDATE ON cancellation_assessments FOR EACH ROW EXECUTE FUNCTION guard_assessment_update();
--> statement-breakpoint
CREATE FUNCTION check_assessment_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a cancellation_assessments; prior bigint; gross numeric; recovered numeric;
BEGIN
  SELECT * INTO a FROM cancellation_assessments WHERE id=NEW.assessment_id;
  SELECT charge_cents INTO prior FROM assessment_revisions WHERE assessment_id=a.id AND revision_no=NEW.revision_no-1;
  IF a.reason<>'GUEST_LATE' OR NEW.charge_cents>a.cap_cents OR (NEW.revision_no>1 AND (prior IS NULL OR NEW.charge_cents>prior)) OR
     NEW.evidence IS NULL OR NEW.evidence_ref IS NULL OR NEW.avoided_costs_cents IS NULL OR NEW.recovered_revenue_cents IS NULL OR
     NOT EXISTS(SELECT 1 FROM admin_users WHERE id=NEW.reviewed_by_admin_id AND enabled AND disabled_at IS NULL AND role IN ('finance','administrator')) THEN
    RAISE EXCEPTION 'unsupported assessment revision' USING ERRCODE='23514'; END IF;
  gross:=(NEW.evidence->>'documentedLossCents')::numeric;
  SELECT COALESCE(sum((x->>'recoveredCents')::numeric),0) INTO recovered FROM jsonb_array_elements(NEW.evidence->'replacements') x;
  IF gross IS NULL OR gross<0 OR recovered<>NEW.recovered_revenue_cents OR
     NEW.supportable_loss_cents<>greatest(0,gross-NEW.avoided_costs_cents-recovered) OR
     a.current_revision_no IS DISTINCT FROM (SELECT max(revision_no) FROM assessment_revisions WHERE assessment_id=a.id) OR a.state<>'FINAL' THEN
    RAISE EXCEPTION 'assessment net loss or revision pointer mismatch' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER assessment_revision_finances AFTER INSERT ON assessment_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_assessment_revision();
--> statement-breakpoint
CREATE FUNCTION guard_refund_obligation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF (to_jsonb(NEW)-'refund_encumbered_cents') IS DISTINCT FROM (to_jsonb(OLD)-'refund_encumbered_cents') THEN
    RAISE EXCEPTION 'refund liability is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_obligation_immutable BEFORE UPDATE ON refund_obligations FOR EACH ROW EXECUTE FUNCTION guard_refund_obligation();
--> statement-breakpoint
CREATE FUNCTION guard_refund_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF ROW(NEW.id,NEW.obligation_id,NEW.payment_record_id,NEW.requested_cents,NEW.created_at) IS DISTINCT FROM
    ROW(OLD.id,OLD.obligation_id,OLD.payment_record_id,OLD.requested_cents,OLD.created_at) OR
    (OLD.stripe_refund_id IS NOT NULL AND NEW.stripe_refund_id IS DISTINCT FROM OLD.stripe_refund_id) OR
    (OLD.state<>NEW.state AND NOT ((OLD.state='REQUESTED' AND NEW.state IN ('PROCESSING','SUCCEEDED','FAILED')) OR (OLD.state='PROCESSING' AND NEW.state IN ('SUCCEEDED','FAILED')))) THEN
    RAISE EXCEPTION 'refund attempt history cannot regress' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_attempt_guard BEFORE UPDATE ON refund_attempts FOR EACH ROW EXECUTE FUNCTION guard_refund_attempt();
--> statement-breakpoint
CREATE FUNCTION lock_refund_parents() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM 1 FROM payment_records WHERE id=NEW.payment_record_id FOR UPDATE;
  PERFORM 1 FROM refund_obligations WHERE id=NEW.obligation_id FOR UPDATE;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER refund_attempt_parent_lock BEFORE INSERT OR UPDATE ON refund_attempts FOR EACH ROW EXECUTE FUNCTION lock_refund_parents();
--> statement-breakpoint
CREATE FUNCTION check_refund_finances() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a refund_attempts; o refund_obligations; p payment_records; r reconciliation_records; enc numeric;
BEGIN
  IF TG_TABLE_NAME='refund_attempts' THEN SELECT * INTO a FROM refund_attempts WHERE id=NEW.id;
  ELSIF TG_TABLE_NAME='refund_records' THEN SELECT * INTO a FROM refund_attempts WHERE id=NEW.refund_attempt_id;
  END IF;
  IF a.id IS NOT NULL THEN
    SELECT * INTO o FROM refund_obligations WHERE id=a.obligation_id;
    SELECT * INTO p FROM payment_records WHERE id=a.payment_record_id;
    IF o.booking_id IS DISTINCT FROM p.booking_id OR o.provider_incident_id IS DISTINCT FROM p.provider_incident_id OR
      (o.source_payment_record_id IS NOT NULL AND o.source_payment_record_id<>p.id) THEN RAISE EXCEPTION 'refund identity mismatch' USING ERRCODE='23514'; END IF;
    IF a.state IN ('SUCCEEDED','FAILED') THEN
      SELECT * INTO r FROM reconciliation_records WHERE id=a.reconciliation_id;
      IF r.id IS NULL OR r.refund_attempt_id IS DISTINCT FROM a.id OR r.provider_object_id IS DISTINCT FROM a.stripe_refund_id OR
        r.evidence_kind<>'STRIPE_CURRENT' OR r.amount_cents<>a.requested_cents OR r.currency<>'EUR' OR
        (a.state='SUCCEEDED' AND (r.result<>'REFUND_SUCCEEDED' OR r.provider_state<>'succeeded')) OR
        (a.state='FAILED' AND (r.result<>'REFUND_FAILED' OR r.provider_state NOT IN ('failed','canceled'))) THEN
        RAISE EXCEPTION 'terminal refund lacks authoritative evidence' USING ERRCODE='23514'; END IF;
    END IF;
    IF a.state='SUCCEEDED' AND NOT EXISTS(SELECT 1 FROM refund_records rr WHERE rr.refund_attempt_id=a.id AND rr.refunded_cents=a.requested_cents AND rr.reconciliation_id=a.reconciliation_id) THEN
      RAISE EXCEPTION 'succeeded refund lacks ledger debit' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='refund_records' THEN
    IF a.state<>'SUCCEEDED' OR NEW.stripe_refund_id IS DISTINCT FROM a.stripe_refund_id OR NEW.payment_record_id<>p.id OR
      NEW.booking_id IS DISTINCT FROM o.booking_id OR NEW.provider_incident_id IS DISTINCT FROM o.provider_incident_id OR NEW.refunded_cents<>a.requested_cents THEN
      RAISE EXCEPTION 'refund debit identity mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF TG_TABLE_NAME='payment_records' THEN SELECT * INTO p FROM payment_records WHERE id=NEW.id; END IF;
  IF TG_TABLE_NAME='refund_obligations' THEN SELECT * INTO o FROM refund_obligations WHERE id=NEW.id; END IF;
  IF p.id IS NOT NULL THEN
    SELECT COALESCE(sum(requested_cents),0) INTO enc FROM refund_attempts WHERE payment_record_id=p.id AND state IN ('REQUESTED','PROCESSING','SUCCEEDED');
    IF enc>p.captured_cents OR enc<>p.refund_encumbered_cents THEN RAISE EXCEPTION 'capture refund budget drift' USING ERRCODE='23514'; END IF;
  END IF;
  IF o.id IS NOT NULL THEN
    SELECT COALESCE(sum(requested_cents),0) INTO enc FROM refund_attempts WHERE obligation_id=o.id AND state IN ('REQUESTED','PROCESSING','SUCCEEDED');
    IF enc>o.amount_cents OR enc<>o.refund_encumbered_cents THEN RAISE EXCEPTION 'obligation refund budget drift' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refund_attempt_finances AFTER INSERT OR UPDATE ON refund_attempts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_refund_finances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER refund_record_finances AFTER INSERT ON refund_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_refund_finances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER capture_refund_budget AFTER UPDATE ON payment_records DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_refund_finances();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER obligation_refund_budget AFTER UPDATE ON refund_obligations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_refund_finances();
--> statement-breakpoint
CREATE UNIQUE INDEX provider_commands_one_refund_create ON provider_commands(refund_attempt_id) WHERE kind='REFUND_CREATE';
--> statement-breakpoint
GRANT SELECT, INSERT ON assessment_revisions, refund_attempts, refund_records TO zemaitija_app;
--> statement-breakpoint
GRANT UPDATE(state,current_revision_no) ON cancellation_assessments TO zemaitija_app;
--> statement-breakpoint
GRANT UPDATE(state,stripe_refund_id,reconciliation_id,version) ON refund_attempts TO zemaitija_app;
--> statement-breakpoint
GRANT UPDATE(refund_encumbered_cents) ON payment_records, refund_obligations TO zemaitija_app;
--> statement-breakpoint
-- Guest association is derived from internal booking/attempt/audit relationships, never provider metadata alone.
CREATE FUNCTION queue_guest_money_update(nid uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE n notification_outbox; a audit_events; b record; op text;
BEGIN
  SELECT * INTO n FROM notification_outbox WHERE id=nid FOR UPDATE;
  IF n.event_type NOT IN ('UNALLOCATABLE_CAPTURE','PAYMENT_EVIDENCE_MISMATCH') OR n.recipient_kind<>'OPERATIONS' THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM notification_outbox WHERE idempotency_key='guest-money-status:'||n.idempotency_key) THEN RETURN; END IF;
  SELECT * INTO a FROM audit_events WHERE id=n.source_audit_event_id;
  SELECT bk.id,bk.guest_id,s.locale INTO b FROM bookings bk JOIN price_snapshots s ON s.booking_id=bk.id
    WHERE bk.id=a.booking_id AND EXISTS(SELECT 1 FROM payment_attempts pa WHERE pa.booking_id=bk.id AND
      ((a.entity_type='payment_attempt' AND pa.id=a.entity_id) OR
       (a.entity_type='incident' AND EXISTS(SELECT 1 FROM provider_incidents pi WHERE pi.id=a.entity_id AND pi.stripe_payment_intent_id=pa.stripe_payment_intent_id))));
  IF b.id IS NOT NULL THEN
    INSERT INTO notification_outbox(id,booking_id,source_audit_event_id,event_type,recipient_kind,recipient_ref,locale,idempotency_key,due_at,state)
      VALUES(gen_random_uuid(),b.id,a.id,'GUEST_PAYMENT_UPDATE','GUEST',b.guest_id,b.locale,'guest-money-status:'||n.idempotency_key,clock_timestamp(),'QUEUED')
      ON CONFLICT(idempotency_key) DO NOTHING;
  ELSE
    op:='guest-money-investigation:'||nid::text;
    IF NOT EXISTS(SELECT 1 FROM audit_events WHERE operation_key=op) THEN
      INSERT INTO audit_events(id,actor_kind,service_name,action,entity_type,entity_id,operation_key,reason_code,occurred_at)
        VALUES(gen_random_uuid(),'SERVICE','financial-notifications','incident.guest_association_investigation','notification',nid,op,'NO_VERIFIED_GUEST',clock_timestamp());
    END IF;
  END IF;
END $$;
--> statement-breakpoint
CREATE FUNCTION guest_money_update_trigger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM queue_guest_money_update(NEW.id); RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER financial_incident_guest_notice AFTER INSERT ON notification_outbox DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guest_money_update_trigger();
