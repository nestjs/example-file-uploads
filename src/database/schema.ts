import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const at = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
// Byte counts: a 32-bit integer stops at 2 GiB.
const bytes = (name: string) => bigint(name, { mode: 'number' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    // What the user's files take up, and how much they may store: 100 MiB unless changed.
    storageUsed: bytes('storage_used').notNull().default(0),
    storageQuota: bytes('storage_quota')
      .notNull()
      .default(100 * 1024 * 1024),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [check('users_storage_used_not_negative', sql`${table.storageUsed} >= 0`)],
);

export const files = pgTable(
  'files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Where the bytes are on the disk. The server picks it, never the client.
    key: text('key').notNull().unique(),
    // The client's file name, for downloads only.
    name: text('name').notNull(),
    // Detected from the bytes, not taken from the client.
    contentType: text('content_type').notNull(),
    size: bytes('size').notNull(),
    createdAt: at('created_at').notNull().defaultNow(),
  },
  (table) => [index('files_owner_id_created_at_idx').on(table.ownerId, table.createdAt)],
);

// What @nestjs/authentication keeps for refresh tokens, stored by their SHA-256.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: text('id').primaryKey(),
    familyId: text('family_id').notNull(),
    userId: text('user_id').notNull(),
    createdAt: at('created_at').notNull(),
    expiresAt: at('expires_at').notNull(),
    familyExpiresAt: at('family_expires_at').notNull(),
    usedAt: at('used_at'),
    // A family is revoked when any of its tokens is.
    revoked: boolean('revoked').notNull().default(false),
    claims: jsonb('claims').$type<Record<string, unknown>>(),
  },
  (table) => [
    index('refresh_tokens_family_id_idx').on(table.familyId),
    index('refresh_tokens_user_id_idx').on(table.userId),
    index('refresh_tokens_family_expires_at_idx').on(table.familyExpiresAt),
  ],
);

export type StoredFile = typeof files.$inferSelect;
