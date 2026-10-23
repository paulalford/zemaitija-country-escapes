import { pgTable, uuid, text, integer, smallint, bigint, boolean, date, timestamp, char, jsonb, type AnyPgColumn } from "drizzle-orm/pg-core";
import { bookings } from "./booking";


export const accommodation_units = pgTable("accommodation_units", {
  id: uuid("id").primaryKey().notNull(),
  unit_key: text("unit_key").notNull(),
  capacity: smallint("capacity").notNull(),
  enabled: boolean("enabled").notNull(),
  config_version: integer("config_version").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rate_schedule_versions = pgTable("rate_schedule_versions", {
  id: uuid("id").primaryKey().notNull(),
  unit_id: uuid("unit_id").references((): AnyPgColumn => accommodation_units.id, { onDelete: "restrict" }).notNull(),
  version_no: integer("version_no").notNull(),
  state: text("state").notNull(),
  activated_at: timestamp("activated_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const seasonal_rates = pgTable("seasonal_rates", {
  id: uuid("id").primaryKey().notNull(),
  rate_schedule_version_id: uuid("rate_schedule_version_id").references((): AnyPgColumn => rate_schedule_versions.id, { onDelete: "restrict" }).notNull(),
  start_date: date("start_date", { mode: "string" }).notNull(),
  end_date: date("end_date", { mode: "string" }).notNull(),
  day_class: text("day_class").notNull(),
  nightly_cents: bigint("nightly_cents", { mode: "bigint" }).notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const price_snapshots = pgTable("price_snapshots", {
  id: uuid("id").primaryKey().notNull(),
  booking_id: uuid("booking_id").references((): AnyPgColumn => bookings.id, { onDelete: "restrict" }).notNull(),
  rate_schedule_version_id: uuid("rate_schedule_version_id").references((): AnyPgColumn => rate_schedule_versions.id, { onDelete: "restrict" }),
  accepted_at: timestamp("accepted_at", { withTimezone: true }).notNull(),
  terms_version: text("terms_version").notNull(),
  policy_version: text("policy_version").notNull(),
  locale: text("locale").notNull(),
  currency: char("currency", { length: 3 }).notNull(),
  total_cents: bigint("total_cents", { mode: "bigint" }).notNull(),
  initial_cents: bigint("initial_cents", { mode: "bigint" }).notNull(),
  balance_cents: bigint("balance_cents", { mode: "bigint" }).notNull(),
  split_basis: text("split_basis").notNull(),
  quote_operation_key: text("quote_operation_key").notNull(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const price_snapshot_lines = pgTable("price_snapshot_lines", {
  id: uuid("id").primaryKey().notNull(),
  snapshot_id: uuid("snapshot_id").references((): AnyPgColumn => price_snapshots.id, { onDelete: "restrict" }).notNull(),
  line_no: integer("line_no").notNull(),
  kind: text("kind").notNull(),
  description_key: text("description_key").notNull(),
  quantity: integer("quantity").notNull(),
  unit_cents: bigint("unit_cents", { mode: "bigint" }).notNull(),
  amount_cents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  details: jsonb("details"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

