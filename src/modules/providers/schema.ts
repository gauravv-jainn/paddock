import { sql } from "drizzle-orm";
import {
  check,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Raw provider payloads — docs/04 §7.
 *
 * Persisted VERBATIM, before normalising, with the sha256 of the body. This is
 * what makes a settlement replayable: `settlements.payload_hash` names the
 * exact bytes an answer was derived from, so a dispute is resolved by
 * re-running settle() against the stored payload rather than against whatever
 * the provider serves today.
 *
 * The body is never edited. A corrected result from the provider is a new row
 * with a different hash, not an update to this one.
 */
export const PAYLOAD_KINDS = ["racecard", "odds", "result"] as const;

export const providerPayloads = pgTable(
  "provider_payloads",
  {
    id: uuid().primaryKey().defaultRandom(),
    providerId: text().notNull(),
    kind: text().notNull(),
    /** The provider's own reference for whatever this describes. */
    entityRef: text().notNull(),
    body: jsonb().notNull(),
    bodySha256: text().notNull(),
    fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "provider_payloads_kind_check",
      sql`${t.kind} in ('racecard','odds','result')`,
    ),
    // Re-fetching an unchanged payload is a no-op, not a duplicate row.
    unique("provider_payloads_provider_id_kind_entity_ref_body_sha256_key").on(
      t.providerId,
      t.kind,
      t.entityRef,
      t.bodySha256,
    ),
  ],
);

export type ProviderPayload = typeof providerPayloads.$inferSelect;
