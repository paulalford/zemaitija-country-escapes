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
           AND a.state='SUCCEEDED' AND (b.status='CONFIRMED' OR (b.status='CANCELLED_NONPAYMENT' AND c.released_at IS NOT NULL AND c.release_reason='NONPAYMENT_RECONCILED'))) OR
         (h.state='RELEASED' AND c.hold_id=h.id AND c.released_at IS NOT NULL
           AND c.release_reason IN ('ABANDONED_BEFORE_DISPATCH','PROVIDER_TERMINAL_UNPAID')))
    ) THEN RAISE EXCEPTION 'accepted hold ownership mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
