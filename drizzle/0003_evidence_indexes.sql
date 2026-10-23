-- Keep verified capture evidence immutable; only reservation and controlled allocation state are mutable.
CREATE OR REPLACE FUNCTION payment_record_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'payment capture evidence is immutable' USING ERRCODE='23514'; END IF;
  IF (to_jsonb(NEW) - 'refund_encumbered_cents' - 'allocation_state') IS DISTINCT FROM (to_jsonb(OLD) - 'refund_encumbered_cents' - 'allocation_state') THEN
    RAISE EXCEPTION 'payment capture evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX notification_delivery_attempts_provider_key ON notification_delivery_attempts (provider_message_id) WHERE provider_message_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX rate_schedule_versions_unit_version ON rate_schedule_versions (unit_id,version_no);
--> statement-breakpoint
CREATE INDEX guest_access_tokens_booking_expiry ON guest_access_tokens (booking_id,expires_at);
--> statement-breakpoint
CREATE INDEX inventory_holds_state_started ON inventory_holds (state,started_at);
--> statement-breakpoint
CREATE INDEX payment_obligations_booking ON payment_obligations (booking_id);
--> statement-breakpoint
CREATE INDEX payment_allocations_obligation ON payment_allocations (obligation_id);
--> statement-breakpoint
CREATE INDEX payment_records_booking ON payment_records (booking_id);
--> statement-breakpoint
CREATE INDEX refund_obligations_booking ON refund_obligations (booking_id);
--> statement-breakpoint
CREATE INDEX refund_attempts_obligation ON refund_attempts (obligation_id);
--> statement-breakpoint
CREATE INDEX provider_incidents_state_opened ON provider_incidents (state,opened_at);
--> statement-breakpoint
CREATE INDEX provider_commands_state_first_submitted ON provider_commands (state,first_submitted_at);
--> statement-breakpoint
CREATE INDEX stripe_webhook_events_object ON stripe_webhook_events (object_type,object_id);
--> statement-breakpoint
CREATE INDEX reconciliation_records_attempt_checked ON reconciliation_records (payment_attempt_id,checked_at DESC);
--> statement-breakpoint
CREATE INDEX reconciliation_records_refund_checked ON reconciliation_records (refund_attempt_id,checked_at DESC);
--> statement-breakpoint
CREATE INDEX reconciliation_records_incident_checked ON reconciliation_records (provider_incident_id,checked_at DESC);
--> statement-breakpoint
CREATE INDEX audit_events_booking_occurred ON audit_events (booking_id,occurred_at);
--> statement-breakpoint
CREATE INDEX audit_events_entity_occurred ON audit_events (entity_type,entity_id,occurred_at);
--> statement-breakpoint
CREATE INDEX notification_delivery_attempts_notification_started ON notification_delivery_attempts (notification_id,started_at);
