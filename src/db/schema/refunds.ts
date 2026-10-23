import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, timestamp, char, type AnyPgColumn } from "drizzle-orm/pg-core";
import { admin_users } from "./booking";
import { bookings } from "./booking";
import { payment_records } from "./payments";
import { provider_incidents } from "./operations";
import { reconciliation_records } from "./operations";


export const cancellation_assessments = pgTable("cancellation_assessments", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }).notNull(),
  state: text("state").notNull(),
  cancelled_at: timestamp("cancelled_at", { withTimezone: true }).notNull(),
  reason: text("reason").notNull(),
  cap_cents: bigint("cap_cents", { mode: "bigint" }).notNull(),
  current_revision_no: integer("current_revision_no"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const assessment_revisions = pgTable("assessment_revisions", {
  id: uuid("id").primaryKey().notNull(),
  assessment_id: uuid("assessment_id").references((): AnyPgColumn => cancellation_assessments.id, { onDelete: "restrict" }).notNull(),
  revision_no: integer("revision_no").notNull(),
  charge_cents: bigint("charge_cents", { mode: "bigint" }).notNull(),
  supportable_loss_cents: bigint("supportable_loss_cents", { mode: "bigint" }).notNull(),
  avoided_costs_cents: bigint("avoided_costs_cents", { mode: "bigint" }),
  recovered_revenue_cents: bigint("recovered_revenue_cents", { mode: "bigint" }),
  replacement_booking_id: uuid("replacement_booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }),
  evidence_ref: text("evidence_ref"),
  rationale: text("rationale").notNull(),
  reviewed_by_admin_id: uuid("reviewed_by_admin_id").references((): AnyPgColumn => admin_users.id, { onDelete: "restrict" }).notNull(),
  approved_at: timestamp("approved_at", { withTimezone: true }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refund_obligations = pgTable("refund_obligations", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }),
  provider_incident_id: uuid("provider_incident_id").references((): AnyPgColumn => provider_incidents.id, { onDelete: "restrict" }),
  source_payment_record_id: uuid("source_payment_record_id").references((): AnyPgColumn => payment_records.id, { onDelete: "restrict" }),
  assessment_revision_id: uuid("assessment_revision_id").references((): AnyPgColumn => assessment_revisions.id, { onDelete: "restrict" }),
  reason: text("reason").notNull(),
  amount_cents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  refund_encumbered_cents: bigint("refund_encumbered_cents", { mode: "bigint" }).notNull().default(sql`0`),
  business_key: text("business_key").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refund_attempts = pgTable("refund_attempts", {
  id: uuid("id").primaryKey().notNull(),
  obligation_id: uuid("obligation_id").references((): AnyPgColumn => refund_obligations.id, { onDelete: "restrict" }).notNull(),
  payment_record_id: uuid("payment_record_id").references((): AnyPgColumn => payment_records.id, { onDelete: "restrict" }).notNull(),
  state: text("state").notNull(),
  requested_cents: bigint("requested_cents", { mode: "bigint" }).notNull(),
  stripe_refund_id: text("stripe_refund_id"),
  reconciliation_id: uuid("reconciliation_id").references((): AnyPgColumn => reconciliation_records.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const refund_records = pgTable("refund_records", {
  id: uuid("id").primaryKey().notNull(),
  refund_attempt_id: uuid("refund_attempt_id").references((): AnyPgColumn => refund_attempts.id, { onDelete: "restrict" }).notNull(),
  payment_record_id: uuid("payment_record_id").references((): AnyPgColumn => payment_records.id, { onDelete: "restrict" }).notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }),
  provider_incident_id: uuid("provider_incident_id").references((): AnyPgColumn => provider_incidents.id, { onDelete: "restrict" }),
  stripe_refund_id: text("stripe_refund_id").notNull(),
  refunded_cents: bigint("refunded_cents", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  provider_succeeded_at: timestamp("provider_succeeded_at", { withTimezone: true }),
  verified_at: timestamp("verified_at", { withTimezone: true }).notNull(),
  reconciliation_id: uuid("reconciliation_id").references((): AnyPgColumn => reconciliation_records.id, { onDelete: "restrict" }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

