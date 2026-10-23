import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, smallint, boolean, date, time, timestamp, customType, type AnyPgColumn } from "drizzle-orm/pg-core";
import { accommodation_units } from "./catalog";
import { payment_attempts } from "./payments";

const bytea = customType<{ data: Buffer }>({ dataType() { return "bytea"; } });
const daterange = customType<{ data: string }>({ dataType() { return "daterange"; } });

export const guests = pgTable("guests", {
  id: uuid("id").primaryKey().notNull(),
  email_ciphertext: bytea("email_ciphertext").notNull(),
  email_lookup_digest: bytea("email_lookup_digest"),
  name_ciphertext: bytea("name_ciphertext"),
  preferred_locale: text("preferred_locale").notNull(),
  retention_state: text("retention_state").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bookings = pgTable("bookings", {
  id: uuid("id").primaryKey().notNull(),
  guest_id: uuid("guest_id").references((): AnyPgColumn => guests.id, { onDelete: "restrict" }).notNull(),
  unit_id: uuid("unit_id").references((): AnyPgColumn => accommodation_units.id, { onDelete: "restrict" }).notNull(),
  arrival_date: date("arrival_date", { mode: "string" }).notNull(),
  departure_date: date("departure_date", { mode: "string" }).notNull(),
  guest_count: smallint("guest_count").notNull(),
  status: text("status").notNull(),
  version: integer("version").notNull(),
  accepted_at: timestamp("accepted_at", { withTimezone: true }).notNull(),
  check_in_local_time: time("check_in_local_time").notNull(),
  property_zone: text("property_zone").notNull(),
  scheduled_arrival_at: timestamp("scheduled_arrival_at", { withTimezone: true }).notNull(),
  warning_at: timestamp("warning_at", { withTimezone: true }).notNull(),
  balance_due_at: timestamp("balance_due_at", { withTimezone: true }).notNull(),
  grace_ends_at: timestamp("grace_ends_at", { withTimezone: true }).notNull(),
  cancelled_at: timestamp("cancelled_at", { withTimezone: true }),
  cancellation_reason: text("cancellation_reason"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const guest_access_tokens = pgTable("guest_access_tokens", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }).notNull(),
  token_hash: bytea("token_hash").notNull(),
  scope: text("scope").notNull(),
  expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
  revoked_at: timestamp("revoked_at", { withTimezone: true }),
  last_used_at: timestamp("last_used_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventory_holds = pgTable("inventory_holds", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }).notNull(),
  payment_attempt_id: uuid("payment_attempt_id").references((): AnyPgColumn => payment_attempts.id, { onDelete: "restrict" }),
  state: text("state").notNull(),
  started_at: timestamp("started_at", { withTimezone: true }).notNull(),
  terminal_at: timestamp("terminal_at", { withTimezone: true }),
  version: integer("version").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const operator_blocks = pgTable("operator_blocks", {
  id: uuid("id").primaryKey().notNull(),
  unit_id: uuid("unit_id").references((): AnyPgColumn => accommodation_units.id, { onDelete: "restrict" }).notNull(),
  arrival_date: date("arrival_date", { mode: "string" }).notNull(),
  departure_date: date("departure_date", { mode: "string" }).notNull(),
  reason_code: text("reason_code").notNull(),
  created_by_admin_id: uuid("created_by_admin_id").references((): AnyPgColumn => admin_users.id, { onDelete: "restrict" }).notNull(),
  released_at: timestamp("released_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventory_claims = pgTable("inventory_claims", {
  id: uuid("id").primaryKey().notNull(),
  unit_id: uuid("unit_id").references((): AnyPgColumn => accommodation_units.id, { onDelete: "restrict" }).notNull(),
  arrival_date: date("arrival_date", { mode: "string" }).notNull(),
  departure_date: date("departure_date", { mode: "string" }).notNull(),
  stay: daterange("stay").generatedAlwaysAs(sql`daterange(arrival_date, departure_date, '[)')`).notNull(),
  hold_id: uuid("hold_id").references((): AnyPgColumn => inventory_holds.id, { onDelete: "restrict" }),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }),
  operator_block_id: uuid("operator_block_id").references((): AnyPgColumn => operator_blocks.id, { onDelete: "restrict" }),
  origin_hold_id: uuid("origin_hold_id").references((): AnyPgColumn => inventory_holds.id, { onDelete: "restrict" }),
  released_at: timestamp("released_at", { withTimezone: true }),
  release_reason: text("release_reason"),
  version: integer("version").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const admin_users = pgTable("admin_users", {
  id: uuid("id").primaryKey().notNull(),
  external_subject: text("external_subject").notNull(),
  role: text("role").notNull(),
  enabled: boolean("enabled").notNull(),
  disabled_at: timestamp("disabled_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

