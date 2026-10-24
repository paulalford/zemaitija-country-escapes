ALTER TABLE "payment_attempts" ADD COLUMN "checkout_url" text;--> statement-breakpoint
ALTER TABLE "provider_commands" ADD COLUMN "request_params" jsonb;