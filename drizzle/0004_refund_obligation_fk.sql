ALTER TABLE "refund_attempts" DROP CONSTRAINT "refund_attempts_obligation_id_payment_obligations_id_fk";
--> statement-breakpoint
ALTER TABLE "refund_attempts" ADD CONSTRAINT "refund_attempts_obligation_id_refund_obligations_id_fk" FOREIGN KEY ("obligation_id") REFERENCES "public"."refund_obligations"("id") ON DELETE restrict ON UPDATE no action;