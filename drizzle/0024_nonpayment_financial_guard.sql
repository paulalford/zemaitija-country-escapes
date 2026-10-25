-- Enforce terminal unpaid evidence and the zero-charge captured-funds liability at commit.
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
    IF b.status='CANCELLED_NONPAYMENT' AND (
      EXISTS (SELECT 1 FROM payment_obligations o JOIN payment_allocations pa ON pa.obligation_id=o.id
        WHERE o.booking_id=bid AND o.kind='BALANCE') OR
      EXISTS (SELECT 1 FROM payment_attempts a JOIN payment_obligations o ON o.id=a.obligation_id
        LEFT JOIN reconciliation_records r ON r.id=a.last_reconciliation_id
        WHERE o.booking_id=bid AND o.kind='BALANCE' AND
          (a.state NOT IN ('EXPIRED','FAILED') OR r.evidence_kind IS DISTINCT FROM 'STRIPE_CURRENT' OR
           r.result NOT IN ('TERMINAL_UNPAID','TERMINAL_FAILED'))) OR
      EXISTS (SELECT 1 FROM payment_records p WHERE p.booking_id=bid AND p.allocation_state='ALLOCATED'
        AND NOT EXISTS (SELECT 1 FROM refund_obligations ro WHERE ro.booking_id=bid
          AND ro.source_payment_record_id=p.id AND ro.reason='NONPAYMENT_ZERO_CHARGE'
          AND ro.amount_cents=p.captured_cents))
    ) THEN RAISE EXCEPTION 'nonpayment cancellation lacks terminal payment proof or full refund liability' USING ERRCODE='23514'; END IF;
    IF b.status NOT IN ('AWAITING_INITIAL_PAYMENT','CONFIRMED','EXPIRED','CANCELLED_NONPAYMENT') THEN
      RAISE EXCEPTION 'unsupported accepted booking state' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
