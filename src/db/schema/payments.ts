import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, timestamp, char, type AnyPgColumn } from "drizzle-orm/pg-core";
import { bookings } from "./booking";
import { inventory_holds } from "./booking";
import { provider_incidents } from "./operations";
import { reconciliation_records } from "./operations";


export const payment_obligations = pgTable("payment_obligations", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }).notNull(),
  kind: text("kind").notNull(),
  amount_cents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  due_at: timestamp("due_at", { withTimezone: true }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payment_attempts = pgTable("payment_attempts", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }).notNull(),
  obligation_id: uuid("obligation_id").references((): AnyPgColumn => payment_obligations.id, { onDelete: "restrict" }).notNull(),
  hold_id: uuid("hold_id").references((): AnyPgColumn => inventory_holds.id, { onDelete: "restrict" }),
  state: text("state").notNull(),
  expected_cents: bigint("expected_cents", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  stripe_session_id: text("stripe_session_id"),
  stripe_payment_intent_id: text("stripe_payment_intent_id"),
  session_created_at: timestamp("session_created_at", { withTimezone: true }),
  session_expires_at: timestamp("session_expires_at", { withTimezone: true }),
  last_reconciliation_id: uuid("last_reconciliation_id").references((): AnyPgColumn => reconciliation_records.id, { onDelete: "restrict" }),
  version: integer("version").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payment_records = pgTable("payment_records", {
  id: uuid("id").primaryKey().notNull(),
  attempt_id: uuid("attempt_id").references((): AnyPgColumn => payment_attempts.id, { onDelete: "restrict" }),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }),
  obligation_id: uuid("obligation_id").references((): AnyPgColumn => payment_obligations.id, { onDelete: "restrict" }),
  provider_incident_id: uuid("provider_incident_id").references((): AnyPgColumn => provider_incidents.id, { onDelete: "restrict" }),
  stripe_payment_intent_id: text("stripe_payment_intent_id").notNull(),
  stripe_charge_id: text("stripe_charge_id"),
  captured_cents: bigint("captured_cents", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  provider_succeeded_at: timestamp("provider_succeeded_at", { withTimezone: true }),
  verified_at: timestamp("verified_at", { withTimezone: true }).notNull(),
  allocation_state: text("allocation_state").notNull(),
  refund_encumbered_cents: bigint("refund_encumbered_cents", { mode: "bigint" }).notNull().default(sql`0`),
  reconciliation_id: uuid("reconciliation_id").references((): AnyPgColumn => reconciliation_records.id, { onDelete: "restrict" }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const payment_allocations = pgTable("payment_allocations", {
  id: uuid("id").primaryKey().notNull(),
  payment_record_id: uuid("payment_record_id").references((): AnyPgColumn => payment_records.id, { onDelete: "restrict" }).notNull(),
  obligation_id: uuid("obligation_id").references((): AnyPgColumn => payment_obligations.id, { onDelete: "restrict" }).notNull(),
  amount_cents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

