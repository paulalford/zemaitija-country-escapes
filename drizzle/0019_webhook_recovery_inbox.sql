ALTER TABLE "stripe_webhook_events" ADD COLUMN "processing_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "next_attempt_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "lease_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "stripe_webhook_events" ADD COLUMN "last_error_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE stripe_webhook_events ADD CONSTRAINT stripe_webhook_events_processing_valid CHECK (
  processing_state IN ('PENDING','RETRY','PROCESSING','PROCESSED','IGNORED','QUARANTINED','INVESTIGATE')
  AND processing_attempts >= 0
  AND (lease_owner IS NULL) = (lease_until IS NULL)
  AND (last_error_code IS NULL OR length(last_error_code) <= 64)
);
--> statement-breakpoint
CREATE INDEX stripe_webhook_events_due_recovery ON stripe_webhook_events
  (processing_state,next_attempt_at,lease_until,received_at)
  WHERE processing_state IN ('PENDING','RETRY','PROCESSING');
