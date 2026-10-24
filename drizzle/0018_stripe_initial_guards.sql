-- Milestone 10: provider-backed initial payment transitions. Earlier migrations
-- remain applied and unchanged; historical rows without snapshots stay exempt.
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
     (OLD.status='AWAITING_INITIAL_PAYMENT' AND NEW.status IN ('CONFIRMED','EXPIRED')) THEN
    RAISE EXCEPTION 'unsupported accepted booking transition' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_accepted_attempt_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid;
BEGIN
  IF TG_TABLE_NAME='payment_attempts' THEN
    bid:=OLD.booking_id;
    IF NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN RETURN NEW; END IF;
    IF ROW(NEW.booking_id,NEW.obligation_id,NEW.hold_id,NEW.expected_cents,NEW.currency) IS DISTINCT FROM
       ROW(OLD.booking_id,OLD.obligation_id,OLD.hold_id,OLD.expected_cents,OLD.currency) OR
       (OLD.stripe_session_id IS NOT NULL AND NEW.stripe_session_id IS DISTINCT FROM OLD.stripe_session_id) OR
       (OLD.stripe_payment_intent_id IS NOT NULL AND NEW.stripe_payment_intent_id IS DISTINCT FROM OLD.stripe_payment_intent_id) OR
       (OLD.checkout_url IS NOT NULL AND NEW.checkout_url IS DISTINCT FROM OLD.checkout_url) THEN
      RAISE EXCEPTION 'accepted attempt identity is immutable' USING ERRCODE='23514'; END IF;
    IF OLD.state<>NEW.state AND NOT (
      (OLD.state='CREATING' AND NEW.state IN ('OPEN','RECONCILING','EXPIRED')) OR
      (OLD.state='OPEN' AND NEW.state IN ('RECONCILING','SUCCEEDED','EXPIRED','FAILED')) OR
      (OLD.state='RECONCILING' AND NEW.state IN ('OPEN','SUCCEEDED','EXPIRED','FAILED')) OR
      (OLD.state IN ('EXPIRED','FAILED') AND NEW.state='SUCCEEDED')
    ) THEN RAISE EXCEPTION 'unsupported accepted attempt transition' USING ERRCODE='23514'; END IF;
    IF NEW.state='OPEN' AND (NEW.stripe_session_id IS NULL OR NEW.checkout_url IS NULL OR
       NEW.session_created_at IS NULL OR NEW.session_expires_at IS NULL) THEN
      RAISE EXCEPTION 'open attempt lacks Checkout evidence' USING ERRCODE='23514'; END IF;
    IF NEW.state='SUCCEEDED' AND NOT EXISTS (
      SELECT 1 FROM payment_records p WHERE p.stripe_payment_intent_id=NEW.stripe_payment_intent_id
        AND p.captured_cents=NEW.expected_cents AND p.currency=NEW.currency
    ) THEN RAISE EXCEPTION 'succeeded attempt lacks verified ledger evidence' USING ERRCODE='23514'; END IF;
  ELSE
    IF ROW(NEW.kind,NEW.payment_attempt_id,NEW.refund_attempt_id,NEW.logical_key,NEW.stripe_idempotency_key,NEW.request_fingerprint) IS DISTINCT FROM
       ROW(OLD.kind,OLD.payment_attempt_id,OLD.refund_attempt_id,OLD.logical_key,OLD.stripe_idempotency_key,OLD.request_fingerprint) THEN
      RAISE EXCEPTION 'provider command identity is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_provider_command_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF NEW.lease_generation < OLD.lease_generation OR NEW.attempt_count < OLD.attempt_count OR
     (OLD.first_submitted_at IS NOT NULL AND NEW.first_submitted_at IS DISTINCT FROM OLD.first_submitted_at) OR
     (OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS DISTINCT FROM OLD.provider_request_id) OR
     (OLD.request_params IS NOT NULL AND NEW.request_params IS DISTINCT FROM OLD.request_params) OR
     (OLD.state='RESOLVED' AND NEW.state<>'RESOLVED') THEN
    RAISE EXCEPTION 'provider command evidence cannot regress' USING ERRCODE='23514'; END IF;
  IF OLD.kind='SESSION_CREATE' AND OLD.state IN ('SUBMITTED','UNKNOWN','QUARANTINED') AND NEW.state='PENDING' THEN
    RAISE EXCEPTION 'uncertain Session command cannot become pending' USING ERRCODE='23514'; END IF;
  IF NEW.kind='SESSION_CREATE' AND NEW.first_submitted_at IS NOT NULL AND
     (NEW.request_params IS NULL OR NEW.lease_generation=0 OR NEW.attempt_count=0) THEN
    RAISE EXCEPTION 'submission lacks durable request and lease' USING ERRCODE='23514'; END IF;
  IF NEW.kind='SESSION_CREATE' AND NEW.state='RESOLVED' AND NEW.first_submitted_at IS NULL AND
     (OLD.state NOT IN ('PENDING','RESOLVED') OR NEW.lease_generation<>0 OR NEW.attempt_count<>0 OR
      NEW.lease_owner IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.provider_request_id IS NOT NULL OR
      NEW.resolved_at IS NULL OR NEW.last_error_code IS DISTINCT FROM 'ABANDONED_BEFORE_DISPATCH') THEN
    RAISE EXCEPTION 'pre-dispatch resolution lacks non-dispatch proof' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_pending_hold_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF OLD.state=NEW.state OR NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.booking_id) THEN RETURN NEW; END IF;
  IF NEW.state='RECONCILING' AND OLD.state IN ('CREATING','ACTIVE') AND NEW.terminal_at IS NULL THEN RETURN NEW; END IF;
  IF NEW.state='ACTIVE' AND OLD.state IN ('CREATING','RECONCILING') AND NEW.terminal_at IS NULL AND EXISTS (
    SELECT 1 FROM payment_attempts a WHERE a.id=NEW.payment_attempt_id AND a.state='OPEN'
      AND a.stripe_session_id IS NOT NULL AND a.session_expires_at>clock_timestamp()
  ) THEN RETURN NEW; END IF;
  IF NEW.state='CONSUMED' AND OLD.state IN ('CREATING','ACTIVE','RECONCILING') AND NEW.terminal_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM payment_attempts a JOIN payment_records p ON p.attempt_id=a.id
    WHERE a.id=NEW.payment_attempt_id AND a.state='SUCCEEDED' AND p.allocation_state='ALLOCATED'
  ) THEN RETURN NEW; END IF;
  IF NEW.state='RELEASED' AND OLD.state IN ('CREATING','ACTIVE','RECONCILING') AND NEW.terminal_at IS NOT NULL AND (
    EXISTS (SELECT 1 FROM provider_commands c WHERE c.payment_attempt_id=OLD.payment_attempt_id
      AND c.kind='SESSION_CREATE' AND c.state='RESOLVED' AND c.first_submitted_at IS NULL
      AND c.provider_request_id IS NULL AND c.lease_generation=0 AND c.attempt_count=0
      AND c.resolved_at IS NOT NULL AND c.last_error_code='ABANDONED_BEFORE_DISPATCH') OR
    EXISTS (SELECT 1 FROM payment_attempts a JOIN reconciliation_records r ON r.id=a.last_reconciliation_id
      WHERE a.id=NEW.payment_attempt_id AND a.state='EXPIRED' AND r.result='TERMINAL_UNPAID'
        AND r.evidence_kind='STRIPE_CURRENT' AND r.provider_state='expired')
  ) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'hold transition lacks provider or pre-dispatch proof' USING ERRCODE='23514';
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_accepted_pending_ownership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_accepted boolean; new_accepted boolean; transfer boolean:=false;
BEGIN
  IF TG_TABLE_NAME='inventory_holds' THEN
    SELECT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.booking_id) INTO old_accepted;
    SELECT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=NEW.booking_id) INTO new_accepted;
    IF (old_accepted OR new_accepted) AND ROW(NEW.id,NEW.booking_id) IS DISTINCT FROM ROW(OLD.id,OLD.booking_id) THEN
      RAISE EXCEPTION 'accepted hold ownership is immutable' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT EXISTS (SELECT 1 FROM inventory_holds h JOIN price_snapshots s ON s.booking_id=h.booking_id WHERE h.id=OLD.hold_id)
      OR EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=OLD.booking_id) INTO old_accepted;
    SELECT EXISTS (SELECT 1 FROM inventory_holds h JOIN price_snapshots s ON s.booking_id=h.booking_id WHERE h.id=NEW.hold_id)
      OR EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=NEW.booking_id) INTO new_accepted;
    IF old_accepted AND OLD.hold_id IS NOT NULL AND OLD.released_at IS NULL AND
       NEW.hold_id IS NULL AND NEW.booking_id IS NOT NULL AND NEW.operator_block_id IS NULL AND
       NEW.origin_hold_id=OLD.hold_id AND NEW.released_at IS NULL AND
       ROW(NEW.id,NEW.unit_id,NEW.arrival_date,NEW.departure_date) IS NOT DISTINCT FROM
       ROW(OLD.id,OLD.unit_id,OLD.arrival_date,OLD.departure_date) AND
       EXISTS (SELECT 1 FROM inventory_holds h JOIN payment_attempts a ON a.id=h.payment_attempt_id
         JOIN payment_records p ON p.attempt_id=a.id AND p.allocation_state='ALLOCATED'
         WHERE h.id=OLD.hold_id AND h.booking_id=NEW.booking_id AND a.state='SUCCEEDED') THEN transfer:=true; END IF;
    IF (old_accepted OR new_accepted) AND NOT transfer AND
       ROW(NEW.id,NEW.hold_id,NEW.booking_id,NEW.operator_block_id,NEW.origin_hold_id)
       IS DISTINCT FROM ROW(OLD.id,OLD.hold_id,OLD.booking_id,OLD.operator_block_id,OLD.origin_hold_id) THEN
      RAISE EXCEPTION 'accepted claim ownership is immutable without verified transfer' USING ERRCODE='23514'; END IF;
    IF old_accepted AND OLD.released_at IS NOT NULL AND
       ROW(NEW.released_at,NEW.release_reason) IS DISTINCT FROM ROW(OLD.released_at,OLD.release_reason) THEN
      RAISE EXCEPTION 'accepted claim release evidence is immutable' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
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
           AND a.state='SUCCEEDED' AND b.status='CONFIRMED') OR
         (h.state='RELEASED' AND c.hold_id=h.id AND c.released_at IS NOT NULL
           AND c.release_reason IN ('ABANDONED_BEFORE_DISPATCH','PROVIDER_TERMINAL_UNPAID')))
    ) THEN RAISE EXCEPTION 'accepted hold ownership mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_accepted_child_delete() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE bid uuid; BEGIN
  IF TG_TABLE_NAME='inventory_claims' THEN
    IF OLD.hold_id IS NOT NULL THEN SELECT booking_id INTO bid FROM inventory_holds WHERE id=OLD.hold_id;
    ELSE bid:=OLD.booking_id; END IF;
  ELSE bid:=OLD.booking_id; END IF;
  IF EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN
    RAISE EXCEPTION 'accepted booking child history cannot be deleted' USING ERRCODE='23514'; END IF;
  RETURN OLD;
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
    IF b.status NOT IN ('AWAITING_INITIAL_PAYMENT','CONFIRMED','EXPIRED') THEN
      RAISE EXCEPTION 'unsupported accepted booking state' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE FUNCTION check_accepted_initial_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bid uuid; pr record;
BEGIN
  IF TG_TABLE_NAME='payment_records' THEN
    IF TG_OP='DELETE' THEN bid:=OLD.booking_id; ELSE bid:=NEW.booking_id; END IF;
  ELSE
    IF TG_OP='DELETE' THEN
      SELECT booking_id INTO bid FROM payment_records WHERE id=OLD.payment_record_id;
    ELSE
      SELECT booking_id INTO bid FROM payment_records WHERE id=NEW.payment_record_id;
    END IF;
  END IF;
  IF bid IS NULL OR NOT EXISTS (SELECT 1 FROM price_snapshots WHERE booking_id=bid) THEN RETURN NULL; END IF;
  FOR pr IN SELECT p.* FROM payment_records p WHERE p.booking_id=bid AND p.allocation_state='ALLOCATED' LOOP
    IF NOT EXISTS (SELECT 1 FROM payment_attempts a JOIN payment_allocations pa ON pa.payment_record_id=pr.id
      WHERE a.id=pr.attempt_id AND a.booking_id=bid AND a.obligation_id=pa.obligation_id
        AND a.expected_cents=pr.captured_cents AND pa.amount_cents=pr.captured_cents
        AND a.stripe_payment_intent_id=pr.stripe_payment_intent_id AND a.state='SUCCEEDED') THEN
      RAISE EXCEPTION 'accepted initial credit and allocation mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER accepted_initial_credit_guard AFTER INSERT OR UPDATE ON payment_records
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accepted_initial_credit();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER accepted_initial_allocation_guard AFTER INSERT OR UPDATE OR DELETE ON payment_allocations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_accepted_initial_credit();
--> statement-breakpoint
GRANT SELECT, INSERT ON payment_records, payment_allocations, reconciliation_records, provider_incidents,
  refund_obligations, notification_outbox TO zemaitija_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON stripe_webhook_events TO zemaitija_app;
