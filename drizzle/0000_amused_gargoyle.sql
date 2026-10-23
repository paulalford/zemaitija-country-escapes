CREATE TABLE "accommodation_units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_key" text NOT NULL,
	"capacity" smallint NOT NULL,
	"enabled" boolean NOT NULL,
	"config_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshot_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"description_key" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cents" bigint NOT NULL,
	"amount_cents" bigint NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "price_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"rate_schedule_version_id" uuid,
	"accepted_at" timestamp with time zone NOT NULL,
	"terms_version" text NOT NULL,
	"policy_version" text NOT NULL,
	"locale" text NOT NULL,
	"currency" char(3) NOT NULL,
	"total_cents" bigint NOT NULL,
	"initial_cents" bigint NOT NULL,
	"balance_cents" bigint NOT NULL,
	"split_basis" text NOT NULL,
	"quote_operation_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_schedule_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"state" text NOT NULL,
	"activated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasonal_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"rate_schedule_version_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"day_class" text NOT NULL,
	"nightly_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"external_subject" text NOT NULL,
	"role" text NOT NULL,
	"enabled" boolean NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"guest_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"guest_count" smallint NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	"check_in_local_time" time NOT NULL,
	"property_zone" text NOT NULL,
	"scheduled_arrival_at" timestamp with time zone NOT NULL,
	"warning_at" timestamp with time zone NOT NULL,
	"balance_due_at" timestamp with time zone NOT NULL,
	"grace_ends_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guest_access_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"scope" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email_ciphertext" "bytea" NOT NULL,
	"email_lookup_digest" "bytea",
	"name_ciphertext" "bytea",
	"preferred_locale" text NOT NULL,
	"retention_state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"stay" daterange GENERATED ALWAYS AS (daterange(arrival_date, departure_date, '[)')) STORED NOT NULL,
	"hold_id" uuid,
	"booking_id" uuid,
	"operator_block_id" uuid,
	"origin_hold_id" uuid,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"payment_attempt_id" uuid,
	"state" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"terminal_at" timestamp with time zone,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operator_blocks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"unit_id" uuid NOT NULL,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"reason_code" text NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_record_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"obligation_id" uuid NOT NULL,
	"hold_id" uuid,
	"state" text NOT NULL,
	"expected_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"stripe_session_id" text,
	"stripe_payment_intent_id" text,
	"session_created_at" timestamp with time zone,
	"session_expires_at" timestamp with time zone,
	"last_reconciliation_id" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_obligations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"attempt_id" uuid,
	"booking_id" uuid,
	"obligation_id" uuid,
	"provider_incident_id" uuid,
	"stripe_payment_intent_id" text NOT NULL,
	"stripe_charge_id" text,
	"captured_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"provider_succeeded_at" timestamp with time zone,
	"verified_at" timestamp with time zone NOT NULL,
	"allocation_state" text NOT NULL,
	"refund_encumbered_cents" bigint DEFAULT 0 NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assessment_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assessment_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"charge_cents" bigint NOT NULL,
	"supportable_loss_cents" bigint NOT NULL,
	"avoided_costs_cents" bigint,
	"recovered_revenue_cents" bigint,
	"replacement_booking_id" uuid,
	"evidence_ref" text,
	"rationale" text NOT NULL,
	"reviewed_by_admin_id" uuid NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cancellation_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid NOT NULL,
	"state" text NOT NULL,
	"cancelled_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"cap_cents" bigint NOT NULL,
	"current_revision_no" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"obligation_id" uuid NOT NULL,
	"payment_record_id" uuid NOT NULL,
	"state" text NOT NULL,
	"requested_cents" bigint NOT NULL,
	"stripe_refund_id" text,
	"reconciliation_id" uuid,
	"version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_obligations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid,
	"provider_incident_id" uuid,
	"source_payment_record_id" uuid,
	"assessment_revision_id" uuid,
	"reason" text NOT NULL,
	"amount_cents" bigint NOT NULL,
	"refund_encumbered_cents" bigint DEFAULT 0 NOT NULL,
	"business_key" text NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refund_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"refund_attempt_id" uuid NOT NULL,
	"payment_record_id" uuid NOT NULL,
	"booking_id" uuid,
	"provider_incident_id" uuid,
	"stripe_refund_id" text NOT NULL,
	"refunded_cents" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"provider_succeeded_at" timestamp with time zone,
	"verified_at" timestamp with time zone NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid,
	"unit_id" uuid,
	"actor_kind" text NOT NULL,
	"admin_user_id" uuid,
	"guest_id" uuid,
	"service_name" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"prior_state" text,
	"new_state" text,
	"amount_cents" bigint,
	"operation_key" text,
	"reason_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_delivery_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"notification_id" uuid NOT NULL,
	"attempt_no" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"result" text NOT NULL,
	"provider_message_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_outbox" (
	"id" uuid PRIMARY KEY NOT NULL,
	"booking_id" uuid,
	"provider_incident_id" uuid,
	"source_audit_event_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"recipient_kind" text NOT NULL,
	"recipient_ref" uuid,
	"locale" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"state" text NOT NULL,
	"lease_until" timestamp with time zone,
	"suppression_reason" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_commands" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payment_attempt_id" uuid,
	"refund_attempt_id" uuid,
	"logical_key" text NOT NULL,
	"stripe_idempotency_key" text NOT NULL,
	"request_fingerprint" "bytea" NOT NULL,
	"first_submitted_at" timestamp with time zone,
	"provider_request_id" text,
	"state" text NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"lease_generation" bigint DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone,
	"last_error_code" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_session_id" text,
	"source_webhook_event_id" uuid,
	"observed_cents" bigint,
	"currency" char(3),
	"state" text NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reconciliation_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_attempt_id" uuid,
	"refund_attempt_id" uuid,
	"provider_incident_id" uuid,
	"webhook_event_id" uuid,
	"checked_at" timestamp with time zone NOT NULL,
	"provider_object_id" text,
	"provider_state" text NOT NULL,
	"payment_status" text,
	"amount_cents" bigint,
	"currency" char(3),
	"provider_success_at" timestamp with time zone,
	"evidence_kind" text NOT NULL,
	"result" text NOT NULL,
	"evidence_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"stripe_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"object_type" text NOT NULL,
	"object_id" text NOT NULL,
	"provider_created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"payload_digest" "bytea" NOT NULL,
	"processing_state" text NOT NULL,
	"processed_at" timestamp with time zone,
	"delivery_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "price_snapshot_lines" ADD CONSTRAINT "price_snapshot_lines_snapshot_id_price_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."price_snapshots"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_rate_schedule_version_id_rate_schedule_versions_id_fk" FOREIGN KEY ("rate_schedule_version_id") REFERENCES "public"."rate_schedule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rate_schedule_versions" ADD CONSTRAINT "rate_schedule_versions_unit_id_accommodation_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."accommodation_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasonal_rates" ADD CONSTRAINT "seasonal_rates_rate_schedule_version_id_rate_schedule_versions_id_fk" FOREIGN KEY ("rate_schedule_version_id") REFERENCES "public"."rate_schedule_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_accommodation_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."accommodation_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_access_tokens" ADD CONSTRAINT "guest_access_tokens_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_claims" ADD CONSTRAINT "inventory_claims_unit_id_accommodation_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."accommodation_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_claims" ADD CONSTRAINT "inventory_claims_hold_id_inventory_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."inventory_holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_claims" ADD CONSTRAINT "inventory_claims_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_claims" ADD CONSTRAINT "inventory_claims_operator_block_id_operator_blocks_id_fk" FOREIGN KEY ("operator_block_id") REFERENCES "public"."operator_blocks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_claims" ADD CONSTRAINT "inventory_claims_origin_hold_id_inventory_holds_id_fk" FOREIGN KEY ("origin_hold_id") REFERENCES "public"."inventory_holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_holds" ADD CONSTRAINT "inventory_holds_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_blocks" ADD CONSTRAINT "operator_blocks_unit_id_accommodation_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."accommodation_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_blocks" ADD CONSTRAINT "operator_blocks_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_record_id_payment_records_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_obligation_id_payment_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_obligation_id_payment_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_hold_id_inventory_holds_id_fk" FOREIGN KEY ("hold_id") REFERENCES "public"."inventory_holds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_last_reconciliation_id_reconciliation_records_id_fk" FOREIGN KEY ("last_reconciliation_id") REFERENCES "public"."reconciliation_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_obligations" ADD CONSTRAINT "payment_obligations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_obligation_id_payment_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_provider_incident_id_provider_incidents_id_fk" FOREIGN KEY ("provider_incident_id") REFERENCES "public"."provider_incidents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_records" ADD CONSTRAINT "payment_records_reconciliation_id_reconciliation_records_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliation_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_revisions" ADD CONSTRAINT "assessment_revisions_assessment_id_cancellation_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."cancellation_assessments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_revisions" ADD CONSTRAINT "assessment_revisions_replacement_booking_id_bookings_id_fk" FOREIGN KEY ("replacement_booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assessment_revisions" ADD CONSTRAINT "assessment_revisions_reviewed_by_admin_id_admin_users_id_fk" FOREIGN KEY ("reviewed_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cancellation_assessments" ADD CONSTRAINT "cancellation_assessments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_obligation_id_payment_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."payment_obligations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_payment_record_id_payment_records_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_reconciliation_id_reconciliation_records_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliation_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_provider_incident_id_provider_incidents_id_fk" FOREIGN KEY ("provider_incident_id") REFERENCES "public"."provider_incidents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_source_payment_record_id_payment_records_id_fk" FOREIGN KEY ("source_payment_record_id") REFERENCES "public"."payment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_obligations" ADD CONSTRAINT "refund_obligations_assessment_revision_id_assessment_revisions_id_fk" FOREIGN KEY ("assessment_revision_id") REFERENCES "public"."assessment_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_refund_attempt_id_refund_attempts_id_fk" FOREIGN KEY ("refund_attempt_id") REFERENCES "public"."refund_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_payment_record_id_payment_records_id_fk" FOREIGN KEY ("payment_record_id") REFERENCES "public"."payment_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_provider_incident_id_provider_incidents_id_fk" FOREIGN KEY ("provider_incident_id") REFERENCES "public"."provider_incidents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_records" ADD CONSTRAINT "refund_records_reconciliation_id_reconciliation_records_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliation_records"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_unit_id_accommodation_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."accommodation_units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_guest_id_guests_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."guests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_delivery_attempts" ADD CONSTRAINT "notification_delivery_attempts_notification_id_notification_outbox_id_fk" FOREIGN KEY ("notification_id") REFERENCES "public"."notification_outbox"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_provider_incident_id_provider_incidents_id_fk" FOREIGN KEY ("provider_incident_id") REFERENCES "public"."provider_incidents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_source_audit_event_id_audit_events_id_fk" FOREIGN KEY ("source_audit_event_id") REFERENCES "public"."audit_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_commands" ADD CONSTRAINT "provider_commands_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_commands" ADD CONSTRAINT "provider_commands_refund_attempt_id_refund_attempts_id_fk" FOREIGN KEY ("refund_attempt_id") REFERENCES "public"."refund_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_incidents" ADD CONSTRAINT "provider_incidents_source_webhook_event_id_stripe_webhook_events_id_fk" FOREIGN KEY ("source_webhook_event_id") REFERENCES "public"."stripe_webhook_events"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_refund_attempt_id_refund_attempts_id_fk" FOREIGN KEY ("refund_attempt_id") REFERENCES "public"."refund_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_provider_incident_id_provider_incidents_id_fk" FOREIGN KEY ("provider_incident_id") REFERENCES "public"."provider_incidents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_webhook_event_id_stripe_webhook_events_id_fk" FOREIGN KEY ("webhook_event_id") REFERENCES "public"."stripe_webhook_events"("id") ON DELETE restrict ON UPDATE no action;