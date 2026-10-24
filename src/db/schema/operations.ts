import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, timestamp, char, jsonb, customType, type AnyPgColumn } from "drizzle-orm/pg-core";
import { accommodation_units } from "./catalog";
import { admin_users } from "./booking";
import { bookings } from "./booking";
import { guests } from "./booking";
import { payment_attempts } from "./payments";
import { refund_attempts } from "./refunds";

const bytea = customType<{ data: Buffer }>({ dataType() { return "bytea"; } });

export const provider_incidents = pgTable("provider_incidents", {
  id: uuid("id").primaryKey().notNull(),
  kind: text("kind").notNull(),
  stripe_payment_intent_id: text("stripe_payment_intent_id"),
  stripe_session_id: text("stripe_session_id"),
  source_webhook_event_id: uuid("source_webhook_event_id").references((): AnyPgColumn => stripe_webhook_events.id, { onDelete: "restrict" }),
  observed_cents: bigint("observed_cents", { mode: "bigint" }),
  currency: char("currency", { length: 3 }),
  state: text("state").notNull(),
  opened_at: timestamp("opened_at", { withTimezone: true }).notNull(),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
  resolution_code: text("resolution_code"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const provider_commands = pgTable("provider_commands", {
  id: uuid("id").primaryKey().notNull(),
  kind: text("kind").notNull(),
  payment_attempt_id: uuid("payment_attempt_id").references((): AnyPgColumn => payment_attempts.id, { onDelete: "restrict" }),
  refund_attempt_id: uuid("refund_attempt_id").references((): AnyPgColumn => refund_attempts.id, { onDelete: "restrict" }),
  logical_key: text("logical_key").notNull(),
  stripe_idempotency_key: text("stripe_idempotency_key").notNull(),
  request_fingerprint: bytea("request_fingerprint").notNull(),
  request_params: jsonb("request_params"),
  first_submitted_at: timestamp("first_submitted_at", { withTimezone: true }),
  provider_request_id: text("provider_request_id"),
  state: text("state").notNull(),
  lease_owner: text("lease_owner"),
  lease_expires_at: timestamp("lease_expires_at", { withTimezone: true }),
  lease_generation: bigint("lease_generation", { mode: "bigint" }).notNull().default(sql`0`),
  attempt_count: integer("attempt_count").notNull().default(0),
  last_attempt_at: timestamp("last_attempt_at", { withTimezone: true }),
  next_attempt_at: timestamp("next_attempt_at", { withTimezone: true }),
  last_error_code: text("last_error_code"),
  resolved_at: timestamp("resolved_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stripe_webhook_events = pgTable("stripe_webhook_events", {
  id: uuid("id").primaryKey().notNull(),
  stripe_event_id: text("stripe_event_id").notNull(),
  event_type: text("event_type").notNull(),
  object_type: text("object_type").notNull(),
  object_id: text("object_id").notNull(),
  provider_created_at: timestamp("provider_created_at", { withTimezone: true }).notNull(),
  received_at: timestamp("received_at", { withTimezone: true }).notNull(),
  payload_digest: bytea("payload_digest").notNull(),
  processing_state: text("processing_state").notNull(),
  processed_at: timestamp("processed_at", { withTimezone: true }),
  delivery_count: integer("delivery_count").notNull(),
  processing_attempts: integer("processing_attempts").notNull().default(0),
  next_attempt_at: timestamp("next_attempt_at", { withTimezone: true }),
  lease_owner: text("lease_owner"),
  lease_until: timestamp("lease_until", { withTimezone: true }),
  last_error_code: text("last_error_code"),
  last_error_at: timestamp("last_error_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reconciliation_records = pgTable("reconciliation_records", {
  id: uuid("id").primaryKey().notNull(),
  payment_attempt_id: uuid("payment_attempt_id").references((): AnyPgColumn => payment_attempts.id, { onDelete: "restrict" }),
  refund_attempt_id: uuid("refund_attempt_id").references((): AnyPgColumn => refund_attempts.id, { onDelete: "restrict" }),
  provider_incident_id: uuid("provider_incident_id").references((): AnyPgColumn => provider_incidents.id, { onDelete: "restrict" }),
  webhook_event_id: uuid("webhook_event_id").references((): AnyPgColumn => stripe_webhook_events.id, { onDelete: "restrict" }),
  checked_at: timestamp("checked_at", { withTimezone: true }).notNull(),
  provider_object_id: text("provider_object_id"),
  provider_state: text("provider_state").notNull(),
  payment_status: text("payment_status"),
  amount_cents: bigint("amount_cents", { mode: "bigint" }),
  currency: char("currency", { length: 3 }),
  provider_success_at: timestamp("provider_success_at", { withTimezone: true }),
  evidence_kind: text("evidence_kind").notNull(),
  result: text("result").notNull(),
  evidence_ref: text("evidence_ref"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notification_outbox = pgTable("notification_outbox", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }),
  provider_incident_id: uuid("provider_incident_id").references((): AnyPgColumn => provider_incidents.id, { onDelete: "restrict" }),
  source_audit_event_id: uuid("source_audit_event_id").references((): AnyPgColumn => audit_events.id, { onDelete: "restrict" }).notNull(),
  event_type: text("event_type").notNull(),
  recipient_kind: text("recipient_kind").notNull(),
  recipient_ref: uuid("recipient_ref"),
  locale: text("locale").notNull(),
  idempotency_key: text("idempotency_key").notNull(),
  due_at: timestamp("due_at", { withTimezone: true }).notNull(),
  state: text("state").notNull(),
  lease_until: timestamp("lease_until", { withTimezone: true }),
  suppression_reason: text("suppression_reason"),
  provider_message_id: text("provider_message_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notification_delivery_attempts = pgTable("notification_delivery_attempts", {
  id: uuid("id").primaryKey().notNull(),
  notification_id: uuid("notification_id").references((): AnyPgColumn => notification_outbox.id, { onDelete: "restrict" }).notNull(),
  attempt_no: integer("attempt_no").notNull(),
  started_at: timestamp("started_at", { withTimezone: true }).notNull(),
  finished_at: timestamp("finished_at", { withTimezone: true }),
  result: text("result").notNull(),
  provider_message_id: text("provider_message_id"),
  error_code: text("error_code"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const audit_events = pgTable("audit_events", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }),
  unit_id: uuid("unit_id").references((): AnyPgColumn => accommodation_units.id, { onDelete: "restrict" }),
  actor_kind: text("actor_kind").notNull(),
  admin_user_id: uuid("admin_user_id").references((): AnyPgColumn => admin_users.id, { onDelete: "restrict" }),
  guest_id: uuid("guest_id").references((): AnyPgColumn => guests.id, { onDelete: "restrict" }),
  service_name: text("service_name"),
  action: text("action").notNull(),
  entity_type: text("entity_type").notNull(),
  entity_id: uuid("entity_id"),
  prior_state: text("prior_state"),
  new_state: text("new_state"),
  amount_cents: bigint("amount_cents", { mode: "bigint" }),
  operation_key: text("operation_key"),
  reason_code: text("reason_code"),
  occurred_at: timestamp("occurred_at", { withTimezone: true }).notNull(),
  details: jsonb("details"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

