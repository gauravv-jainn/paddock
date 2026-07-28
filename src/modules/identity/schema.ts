import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  customType,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Identity module tables — docs/04 §2.
 *
 * Session tokens are stored as hashes only. IP addresses are stored as HMACs
 * or not at all.
 */

/** CITEXT — case-insensitive text. The extension is created by migration 0002. */
const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});

export const USER_ROLES = ["user", "admin"] as const;
export const USER_STATUSES = ["active", "suspended", "deleted"] as const;

export const users = pgTable(
  "users",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: citext().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    displayName: text().notNull(),
    handle: citext().notNull().unique(),
    /** NULL is reserved for future OAuth-only accounts. Phase 0 always sets it. */
    passwordHash: text(),
    role: text().notNull().default("user"),
    /** Display only. Accounting currency is USD, on the wallet. */
    baseCurrency: char({ length: 3 }).notNull().default("GBP"),
    status: text().notNull().default("active"),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("users_role_check", sql`${t.role} in ('user','admin')`),
    check(
      "users_status_check",
      sql`${t.status} in ('active','suspended','deleted')`,
    ),
  ],
);

/**
 * Reserved by docs/04 §2 and owned by this module. No OAuth flow exists in
 * Phase 0 and nothing writes to this table — see the S3 assumptions.
 */
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    providerUid: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("oauth_accounts_provider_uid_key").on(t.provider, t.providerUid)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 of the token. The token itself is never stored. */
    tokenHash: text().notNull().unique(),
    userAgent: text(),
    /** HMAC of the client IP, or NULL. Never a raw address. */
    ipHash: text(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sessions_user_id_expires_at_idx").on(t.userId, t.expiresAt.desc()),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
