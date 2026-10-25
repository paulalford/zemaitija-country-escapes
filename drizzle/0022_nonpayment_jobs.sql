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
      (OLD.status='CONFIRMED' AND NEW.status='CANCELLED_NONPAYMENT' AND NEW.cancelled_at IS NOT NULL
       AND NEW.cancelled_at>=OLD.grace_ends_at AND NEW.cancellation_reason='BALANCE_UNPAID_RECONCILED')) THEN
    RAISE EXCEPTION 'unsupported accepted booking transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Reuse the existing deferred ownership checks with one additional terminal state.
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
         (h.state='CONSUMED' AND c.booking_id=bid AND c.origin_hold_id=h.id AND c.released_at IS NULL
           AND a.state='SUCCEEDED' AND (b.status='CONFIRMED' OR (b.status='CANCELLED_NONPAYMENT' AND c.released_at IS NOT NULL AND c.release_reason='NONPAYMENT_RECONCILED'))) OR
         (h.state='RELEASED' AND c.hold_id=h.id AND c.released_at IS NOT NULL
           AND c.release_reason IN ('ABANDONED_BEFORE_DISPATCH','PROVIDER_TERMINAL_UNPAID')))
    ) THEN RAISE EXCEPTION 'accepted hold ownership mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION check_pending_booking_state() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_bid uuid; new_bid uuid; bid uuid; b record;
BEGIN
  IF TG_TABLE_NAME='bookings' THEN
    new_bid:=NEW.id; IF TG_OP='UPDATE' THEN old_bid:=OLD.id; END IF;
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
    IF b.status NOT IN ('AWAITING_INITIAL_PAYMENT','CONFIRMED','EXPIRED','CANCELLED_NONPAYMENT') THEN
      RAISE EXCEPTION 'unsupported accepted booking state' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
GRANT SELECT, UPDATE ON notification_outbox TO zemaitija_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON notification_delivery_attempts TO zemaitija_app;
--> statement-breakpoint
GRANT SELECT ON refund_obligations, cancellation_assessments TO zemaitija_app;
--> statement-breakpoint
GRANT INSERT ON cancellation_assessments TO zemaitija_app;
