-- PostgreSQL-specific Milestone 3 baseline. Provider truth and authorization remain later workflows.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE inventory_claims ADD CONSTRAINT inventory_claims_dates_valid CHECK (arrival_date < departure_date);
--> statement-breakpoint
ALTER TABLE inventory_claims ADD CONSTRAINT inventory_claims_exactly_one_owner CHECK (num_nonnulls(hold_id, booking_id, operator_block_id) = 1);
--> statement-breakpoint
ALTER TABLE inventory_claims ADD CONSTRAINT inventory_claims_no_overlap EXCLUDE USING gist (unit_id WITH =, stay WITH &&) WHERE (released_at IS NULL) DEFERRABLE INITIALLY IMMEDIATE;
--> statement-breakpoint
ALTER TABLE bookings ADD CONSTRAINT bookings_valid_stay CHECK (arrival_date < departure_date AND guest_count > 0 AND version > 0 AND property_zone = 'Europe/Vilnius');
--> statement-breakpoint
ALTER TABLE operator_blocks ADD CONSTRAINT operator_blocks_valid_stay CHECK (arrival_date < departure_date);
--> statement-breakpoint
ALTER TABLE accommodation_units ADD CONSTRAINT accommodation_units_positive_capacity CHECK (capacity > 0 AND config_version > 0);
--> statement-breakpoint
ALTER TABLE seasonal_rates ADD CONSTRAINT seasonal_rates_valid CHECK (start_date < end_date AND nightly_cents >= 0 AND currency = 'EUR' AND day_class IN ('WEEKDAY','WEEKEND'));
--> statement-breakpoint
ALTER TABLE seasonal_rates ADD CONSTRAINT seasonal_rates_no_overlap EXCLUDE USING gist (rate_schedule_version_id WITH =, day_class WITH =, daterange(start_date,end_date,'[)') WITH &&);
--> statement-breakpoint
ALTER TABLE price_snapshots ADD CONSTRAINT price_snapshots_valid CHECK (currency = 'EUR' AND locale IN ('lt','en','de') AND total_cents >= 0 AND initial_cents >= 0 AND balance_cents >= 0 AND initial_cents::numeric + balance_cents::numeric = total_cents AND split_basis IN ('ADVANCE','FULL') AND (split_basis <> 'FULL' OR balance_cents = 0) AND (split_basis <> 'ADVANCE' OR initial_cents = floor((total_cents::numeric * 30 + 50) / 100)));
--> statement-breakpoint
ALTER TABLE price_snapshot_lines ADD CONSTRAINT price_snapshot_lines_valid CHECK (line_no > 0 AND quantity > 0 AND kind IN ('NIGHT','EXTRA','FEE','TAX','DISCOUNT') AND amount_cents::numeric = quantity::numeric * unit_cents::numeric AND (kind = 'DISCOUNT' OR amount_cents >= 0));
--> statement-breakpoint
ALTER TABLE payment_obligations ADD CONSTRAINT payment_obligations_valid CHECK (kind IN ('INITIAL','BALANCE') AND amount_cents >= 0 AND currency = 'EUR');
--> statement-breakpoint
ALTER TABLE payment_attempts ADD CONSTRAINT payment_attempts_valid CHECK (expected_cents > 0 AND currency = 'EUR' AND version > 0 AND state IN ('CREATING','OPEN','RECONCILING','SUCCEEDED','FAILED','EXPIRED') AND (session_created_at IS NULL OR session_expires_at IS NULL OR session_expires_at > session_created_at));
--> statement-breakpoint
ALTER TABLE payment_records ADD CONSTRAINT payment_records_valid CHECK (captured_cents > 0 AND currency = 'EUR' AND refund_encumbered_cents >= 0 AND refund_encumbered_cents <= captured_cents AND allocation_state IN ('ALLOCATED','UNALLOCATABLE') AND ((attempt_id IS NOT NULL AND booking_id IS NOT NULL AND obligation_id IS NOT NULL AND provider_incident_id IS NULL) OR (attempt_id IS NULL AND booking_id IS NULL AND obligation_id IS NULL AND provider_incident_id IS NOT NULL AND allocation_state = 'UNALLOCATABLE')));
--> statement-breakpoint
ALTER TABLE payment_allocations ADD CONSTRAINT payment_allocations_positive CHECK (amount_cents > 0);
--> statement-breakpoint
ALTER TABLE refund_obligations ADD CONSTRAINT refund_obligations_valid CHECK (num_nonnulls(booking_id,provider_incident_id) = 1 AND amount_cents > 0 AND currency = 'EUR' AND refund_encumbered_cents >= 0 AND refund_encumbered_cents <= amount_cents AND (provider_incident_id IS NULL OR source_payment_record_id IS NOT NULL));
--> statement-breakpoint
ALTER TABLE refund_attempts ADD CONSTRAINT refund_attempts_valid CHECK (requested_cents > 0 AND version > 0 AND state IN ('REQUESTED','PROCESSING','SUCCEEDED','FAILED'));
--> statement-breakpoint
ALTER TABLE refund_records ADD CONSTRAINT refund_records_valid CHECK (num_nonnulls(booking_id,provider_incident_id) = 1 AND refunded_cents > 0 AND currency = 'EUR');
--> statement-breakpoint
ALTER TABLE provider_commands ADD CONSTRAINT provider_commands_valid CHECK (num_nonnulls(payment_attempt_id,refund_attempt_id) = 1 AND ((kind IN ('SESSION_CREATE','SESSION_EXPIRE') AND payment_attempt_id IS NOT NULL) OR (kind = 'REFUND_CREATE' AND refund_attempt_id IS NOT NULL)) AND (lease_owner IS NULL) = (lease_expires_at IS NULL) AND lease_generation >= 0 AND attempt_count >= 0 AND state IN ('PENDING','SUBMITTED','UNKNOWN','QUARANTINED','RESOLVED'));
--> statement-breakpoint
ALTER TABLE reconciliation_records ADD CONSTRAINT reconciliation_records_one_subject CHECK (num_nonnulls(payment_attempt_id,refund_attempt_id,provider_incident_id) = 1);
--> statement-breakpoint
ALTER TABLE notification_outbox ADD CONSTRAINT notification_outbox_valid CHECK (num_nonnulls(booking_id,provider_incident_id) = 1 AND locale IN ('lt','en','de') AND state IN ('QUEUED','SENDING','RETRY_WAIT','SENT','FAILED','SUPPRESSED'));
--> statement-breakpoint
ALTER TABLE guests ADD CONSTRAINT guests_locale CHECK (preferred_locale IN ('lt','en','de'));
--> statement-breakpoint
ALTER TABLE bookings ADD CONSTRAINT bookings_status CHECK (status IN ('AWAITING_INITIAL_PAYMENT','CONFIRMED','EXPIRED','CANCELLED_GUEST','CANCELLED_NONPAYMENT','CANCELLED_PROVIDER','COMPLETED'));
--> statement-breakpoint
ALTER TABLE inventory_holds ADD CONSTRAINT inventory_holds_state CHECK (state IN ('CREATING','ACTIVE','RECONCILING','CONSUMED','RELEASED') AND version > 0);
--> statement-breakpoint
ALTER TABLE cancellation_assessments ADD CONSTRAINT cancellation_assessments_state CHECK (state IN ('NOT_REQUIRED','PENDING','FINAL','REVISION_PENDING') AND reason IN ('GUEST_EARLY','GUEST_LATE','NONPAYMENT','PROVIDER') AND cap_cents >= 0);
--> statement-breakpoint
ALTER TABLE assessment_revisions ADD CONSTRAINT assessment_revisions_amounts CHECK (revision_no > 0 AND charge_cents >= 0 AND supportable_loss_cents >= 0 AND charge_cents <= supportable_loss_cents AND (avoided_costs_cents IS NULL OR avoided_costs_cents >= 0) AND (recovered_revenue_cents IS NULL OR recovered_revenue_cents >= 0));
--> statement-breakpoint
CREATE UNIQUE INDEX rate_schedule_versions_one_active ON rate_schedule_versions (unit_id) WHERE state = 'ACTIVE';
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_holds_one_active ON inventory_holds (booking_id) WHERE state IN ('CREATING','ACTIVE','RECONCILING');
--> statement-breakpoint
CREATE UNIQUE INDEX payment_attempts_one_usable ON payment_attempts (obligation_id) WHERE state IN ('CREATING','OPEN','RECONCILING');
--> statement-breakpoint
CREATE UNIQUE INDEX refund_attempts_one_inflight ON refund_attempts (obligation_id) WHERE state IN ('REQUESTED','PROCESSING');
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_claims_hold_key ON inventory_claims (hold_id);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_claims_booking_key ON inventory_claims (booking_id);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_claims_block_key ON inventory_claims (operator_block_id);
--> statement-breakpoint
CREATE UNIQUE INDEX inventory_claims_origin_hold_key ON inventory_claims (origin_hold_id);
--> statement-breakpoint
CREATE UNIQUE INDEX accommodation_units_unit_key ON accommodation_units (unit_key);
--> statement-breakpoint
CREATE UNIQUE INDEX rate_schedule_versions_version_key ON rate_schedule_versions (unit_id,version_no);
--> statement-breakpoint
CREATE UNIQUE INDEX price_snapshots_booking_key ON price_snapshots (booking_id);
--> statement-breakpoint
CREATE UNIQUE INDEX price_snapshots_operation_key ON price_snapshots (quote_operation_key);
--> statement-breakpoint
CREATE UNIQUE INDEX price_snapshot_lines_line_key ON price_snapshot_lines (snapshot_id,line_no);
--> statement-breakpoint
CREATE UNIQUE INDEX guest_access_tokens_hash_key ON guest_access_tokens (token_hash);
--> statement-breakpoint
CREATE UNIQUE INDEX admin_users_subject_key ON admin_users (external_subject);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_obligations_kind_key ON payment_obligations (booking_id,kind);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_attempts_session_key ON payment_attempts (stripe_session_id);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_attempts_intent_key ON payment_attempts (stripe_payment_intent_id);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_records_attempt_key ON payment_records (attempt_id);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_records_incident_key ON payment_records (provider_incident_id);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_records_intent_key ON payment_records (stripe_payment_intent_id);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_records_charge_key ON payment_records (stripe_charge_id);
--> statement-breakpoint
CREATE UNIQUE INDEX payment_allocations_pair_key ON payment_allocations (payment_record_id,obligation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX cancellation_assessments_booking_key ON cancellation_assessments (booking_id);
--> statement-breakpoint
CREATE UNIQUE INDEX assessment_revisions_number_key ON assessment_revisions (assessment_id,revision_no);
--> statement-breakpoint
CREATE UNIQUE INDEX refund_obligations_business_key ON refund_obligations (business_key);
--> statement-breakpoint
CREATE UNIQUE INDEX refund_obligations_revision_key ON refund_obligations (assessment_revision_id);
--> statement-breakpoint
CREATE UNIQUE INDEX refund_attempts_provider_key ON refund_attempts (stripe_refund_id);
--> statement-breakpoint
CREATE UNIQUE INDEX refund_records_attempt_key ON refund_records (refund_attempt_id);
--> statement-breakpoint
CREATE UNIQUE INDEX refund_records_provider_key ON refund_records (stripe_refund_id);
--> statement-breakpoint
CREATE UNIQUE INDEX provider_incidents_intent_key ON provider_incidents (stripe_payment_intent_id);
--> statement-breakpoint
CREATE UNIQUE INDEX provider_commands_logical_key ON provider_commands (logical_key);
--> statement-breakpoint
CREATE UNIQUE INDEX provider_commands_stripe_key ON provider_commands (stripe_idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX stripe_webhook_events_event_key ON stripe_webhook_events (stripe_event_id);
--> statement-breakpoint
CREATE UNIQUE INDEX notification_outbox_idempotency_key ON notification_outbox (idempotency_key);
--> statement-breakpoint
CREATE UNIQUE INDEX notification_outbox_provider_key ON notification_outbox (provider_message_id);
--> statement-breakpoint
CREATE UNIQUE INDEX notification_delivery_attempts_number_key ON notification_delivery_attempts (notification_id,attempt_no);
--> statement-breakpoint
CREATE UNIQUE INDEX audit_events_operation_key ON audit_events (operation_key) WHERE operation_key IS NOT NULL AND action = 'quote.accepted';
--> statement-breakpoint
CREATE INDEX bookings_unit_dates ON bookings (unit_id,arrival_date,departure_date);
--> statement-breakpoint
CREATE INDEX bookings_status_due ON bookings (status,balance_due_at);
--> statement-breakpoint
CREATE INDEX bookings_status_grace ON bookings (status,grace_ends_at);
--> statement-breakpoint
CREATE INDEX inventory_claims_unit_release ON inventory_claims (unit_id,released_at);
--> statement-breakpoint
CREATE INDEX payment_attempts_state_expiry ON payment_attempts (state,session_expires_at);
--> statement-breakpoint
CREATE INDEX provider_commands_due ON provider_commands (state,next_attempt_at,lease_expires_at);
--> statement-breakpoint
CREATE INDEX stripe_webhook_events_processing ON stripe_webhook_events (processing_state,received_at);
--> statement-breakpoint
CREATE INDEX notification_outbox_due ON notification_outbox (state,due_at);
--> statement-breakpoint
CREATE INDEX notification_outbox_lease ON notification_outbox (state,lease_until);
--> statement-breakpoint
-- Ingestion preserves immutable provider/evidence facts; mutable counters remain on parent rows.
CREATE FUNCTION reject_immutable_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '23514'; END $$;
--> statement-breakpoint
CREATE TRIGGER price_snapshots_immutable BEFORE UPDATE OR DELETE ON price_snapshots FOR EACH ROW EXECUTE FUNCTION reject_immutable_row();
--> statement-breakpoint
CREATE TRIGGER price_snapshot_lines_immutable BEFORE UPDATE OR DELETE ON price_snapshot_lines FOR EACH ROW EXECUTE FUNCTION reject_immutable_row();
--> statement-breakpoint
CREATE TRIGGER refund_records_immutable BEFORE UPDATE OR DELETE ON refund_records FOR EACH ROW EXECUTE FUNCTION reject_immutable_row();
--> statement-breakpoint
CREATE TRIGGER reconciliation_records_immutable BEFORE UPDATE OR DELETE ON reconciliation_records FOR EACH ROW EXECUTE FUNCTION reject_immutable_row();
--> statement-breakpoint
CREATE TRIGGER assessment_revisions_immutable BEFORE UPDATE OR DELETE ON assessment_revisions FOR EACH ROW EXECUTE FUNCTION reject_immutable_row();
--> statement-breakpoint
CREATE TRIGGER audit_events_immutable BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_row();
--> statement-breakpoint
CREATE FUNCTION payment_record_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP = 'DELETE' OR NEW.id <> OLD.id OR NEW.attempt_id IS DISTINCT FROM OLD.attempt_id OR NEW.booking_id IS DISTINCT FROM OLD.booking_id OR NEW.obligation_id IS DISTINCT FROM OLD.obligation_id OR NEW.provider_incident_id IS DISTINCT FROM OLD.provider_incident_id OR NEW.stripe_payment_intent_id <> OLD.stripe_payment_intent_id OR NEW.captured_cents <> OLD.captured_cents OR NEW.currency <> OLD.currency THEN RAISE EXCEPTION 'payment capture evidence is immutable' USING ERRCODE = '23514'; END IF; RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER payment_records_evidence_guard BEFORE UPDATE OR DELETE ON payment_records FOR EACH ROW EXECUTE FUNCTION payment_record_evidence_guard();
--> statement-breakpoint
-- Serialize all allocation writers on obligation then capture parent rows, including moves and deletes.
CREATE FUNCTION lock_allocation_parents() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  PERFORM 1 FROM payment_obligations WHERE id IN (CASE WHEN TG_OP = 'INSERT' THEN NEW.obligation_id ELSE OLD.obligation_id END, CASE WHEN TG_OP = 'DELETE' THEN OLD.obligation_id ELSE NEW.obligation_id END) ORDER BY id FOR UPDATE;
  PERFORM 1 FROM payment_records WHERE id IN (CASE WHEN TG_OP = 'INSERT' THEN NEW.payment_record_id ELSE OLD.payment_record_id END, CASE WHEN TG_OP = 'DELETE' THEN OLD.payment_record_id ELSE NEW.payment_record_id END) ORDER BY id FOR UPDATE;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
--> statement-breakpoint
CREATE TRIGGER payment_allocations_parent_lock BEFORE INSERT OR UPDATE OR DELETE ON payment_allocations FOR EACH ROW EXECUTE FUNCTION lock_allocation_parents();
--> statement-breakpoint
CREATE FUNCTION check_allocation_budget() RETURNS trigger LANGUAGE plpgsql AS $$ DECLARE r record; BEGIN
  FOR r IN SELECT DISTINCT pr.id AS payment_id, po.id AS obligation_id FROM payment_allocations pa JOIN payment_records pr ON pr.id=pa.payment_record_id JOIN payment_obligations po ON po.id=pa.obligation_id WHERE pa.payment_record_id IN (CASE WHEN TG_OP='INSERT' THEN NEW.payment_record_id ELSE OLD.payment_record_id END, CASE WHEN TG_OP='DELETE' THEN OLD.payment_record_id ELSE NEW.payment_record_id END) OR pa.obligation_id IN (CASE WHEN TG_OP='INSERT' THEN NEW.obligation_id ELSE OLD.obligation_id END, CASE WHEN TG_OP='DELETE' THEN OLD.obligation_id ELSE NEW.obligation_id END) LOOP
    IF EXISTS (SELECT 1 FROM payment_records p JOIN payment_obligations o ON o.id=r.obligation_id WHERE p.id=r.payment_id AND (p.booking_id IS DISTINCT FROM o.booking_id OR p.allocation_state <> 'ALLOCATED')) THEN RAISE EXCEPTION 'allocation identity mismatch' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM payment_records p WHERE (SELECT COALESCE(sum(a.amount_cents),0) FROM payment_allocations a WHERE a.payment_record_id=p.id) > p.captured_cents) OR EXISTS (SELECT 1 FROM payment_obligations o WHERE (SELECT COALESCE(sum(a.amount_cents),0) FROM payment_allocations a WHERE a.obligation_id=o.id) > o.amount_cents) THEN RAISE EXCEPTION 'allocation exceeds budget' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER payment_allocations_budget AFTER INSERT OR UPDATE OR DELETE ON payment_allocations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_allocation_budget();
