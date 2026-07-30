import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, type Executor } from "@/db/client";
import { providerPayloads, type ProviderPayload } from "./schema";

/**
 * Persisting raw payloads — docs/03 §5, step 1.
 *
 * "persist raw payload + sha256 hash ← immutable, enables replay". This runs
 * BEFORE normalising, so a payload the adapter cannot parse is still on disk
 * and the failure is diagnosable.
 */

export type PayloadKind = "racecard" | "odds" | "result";

/**
 * The hash is over a CANONICAL serialisation, not `JSON.stringify` of the
 * object as it happens to be ordered.
 *
 * Two payloads with the same content but keys in a different order are the
 * same payload, and must produce the same hash — otherwise re-fetching an
 * unchanged result inserts a second row and looks like an amendment. Object
 * keys are sorted recursively; arrays keep their order, because order is
 * content in a finishing order.
 */
export function canonicalise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalise(v)}`).join(",")}}`;
}

export function sha256OfPayload(body: unknown): string {
  return createHash("sha256").update(canonicalise(body), "utf8").digest("hex");
}

export interface PersistPayloadInput {
  providerId: string;
  kind: PayloadKind;
  entityRef: string;
  body: unknown;
}

export interface PersistedPayload {
  id: string;
  bodySha256: string;
  /** False when this exact payload was already stored. */
  inserted: boolean;
}

/**
 * Stores a payload and returns its hash.
 *
 * Idempotent on (provider, kind, ref, hash): re-fetching an unchanged result
 * returns the existing row rather than inserting a duplicate. That is what
 * makes a polling loop safe to run as often as you like.
 */
export async function persistPayload(
  input: PersistPayloadInput,
  tx?: Executor,
): Promise<PersistedPayload> {
  const bodySha256 = sha256OfPayload(input.body);
  const db = tx ?? getDb();

  const inserted = await db
    .insert(providerPayloads)
    .values({
      providerId: input.providerId,
      kind: input.kind,
      entityRef: input.entityRef,
      body: input.body as never,
      bodySha256,
    })
    .onConflictDoNothing()
    .returning({ id: providerPayloads.id });

  if (inserted[0]) {
    return { id: inserted[0].id, bodySha256, inserted: true };
  }

  const existing = await db
    .select({ id: providerPayloads.id })
    .from(providerPayloads)
    .where(
      and(
        eq(providerPayloads.providerId, input.providerId),
        eq(providerPayloads.kind, input.kind),
        eq(providerPayloads.entityRef, input.entityRef),
        eq(providerPayloads.bodySha256, bodySha256),
      ),
    )
    .limit(1);

  if (!existing[0]) {
    throw new Error(
      `payload insert conflicted but no matching row exists for ` +
        `${input.providerId}/${input.kind}/${input.entityRef}`,
    );
  }
  return { id: existing[0].id, bodySha256, inserted: false };
}

/** The stored bytes behind a hash. Replay reads this, never the live feed. */
export async function getPayloadByHash(
  bodySha256: string,
  tx?: Executor,
): Promise<ProviderPayload | null> {
  const rows = await (tx ?? getDb())
    .select()
    .from(providerPayloads)
    .where(eq(providerPayloads.bodySha256, bodySha256))
    .orderBy(desc(providerPayloads.fetchedAt))
    .limit(1);
  return rows[0] ?? null;
}

/** Most recent payload of a kind for one entity. */
export async function getLatestPayload(
  providerId: string,
  kind: PayloadKind,
  entityRef: string,
  tx?: Executor,
): Promise<ProviderPayload | null> {
  const rows = await (tx ?? getDb())
    .select()
    .from(providerPayloads)
    .where(
      and(
        eq(providerPayloads.providerId, providerId),
        eq(providerPayloads.kind, kind),
        eq(providerPayloads.entityRef, entityRef),
      ),
    )
    .orderBy(desc(providerPayloads.fetchedAt), desc(sql`id`))
    .limit(1);
  return rows[0] ?? null;
}
