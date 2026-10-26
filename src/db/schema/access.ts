import { pgTable, uuid, text, integer, timestamp, customType, jsonb } from 'drizzle-orm/pg-core';
import { admin_users, guest_access_tokens, bookings } from './booking';
import { accommodation_units } from './catalog';
const bytea = customType<{ data: Buffer }>({ dataType() { return 'bytea'; } });
export const guest_access_boundaries = pgTable('guest_access_boundaries', {
  booking_id: uuid('booking_id').primaryKey().references(() => bookings.id, { onDelete: 'restrict' }),
  generation: integer('generation').notNull().default(0),
});
export const access_sessions = pgTable('access_sessions', {
  id: uuid('id').primaryKey(), token_hash: bytea('token_hash').notNull(),
  guest_token_id: uuid('guest_token_id').references(() => guest_access_tokens.id),
  admin_user_id: uuid('admin_user_id').references(() => admin_users.id),
  admin_version: integer('admin_version'), scopes: text('scopes').array().notNull(),
  authenticated_at: timestamp('authenticated_at', { withTimezone: true }).notNull().defaultNow(),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  last_used_at: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
});
export const access_actions = pgTable('access_actions', {
  id: uuid('id').primaryKey(), session_id: uuid('session_id').notNull().references(() => access_sessions.id),
  token_hash: bytea('token_hash').notNull(), operation: text('operation').notNull(),
  booking_id: uuid('booking_id').references(() => bookings.id),
  expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumed_at: timestamp('consumed_at', { withTimezone: true }),
});
export const access_rate_limits = pgTable('access_rate_limits', {
  bucket_hash: bytea('bucket_hash').primaryKey(), window_start: timestamp('window_start', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull(),
});
export const admin_unit_access = pgTable('admin_unit_access', {
  id: uuid('id').primaryKey(), admin_user_id: uuid('admin_user_id').notNull().references(() => admin_users.id),
  unit_id: uuid('unit_id').notNull().references(() => accommodation_units.id),
});
export const management_commands = pgTable('management_commands', {
  operation_key: text('operation_key').primaryKey(), admin_user_id: uuid('admin_user_id').notNull().references(() => admin_users.id),
  fingerprint: text('fingerprint').notNull(), result: jsonb('result').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
