import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/**
 * Demo-data detection — S15.
 *
 * Keyed on the DATA, not on configuration.
 *
 * The first version of this tested `ARCHIVE_ROOT`, on the theory that an unset
 * archive meant seeded data. That was wrong in practice: `.env.example` ships
 * `ARCHIVE_ROOT=./archive`, so it is set on essentially every install, and the
 * banner never appeared — including on a database full of invented horses.
 * Verified by running the app, not by reading the code.
 *
 * `scripts/seed-demo.ts` writes its races with `provider_id = 'demo'`, and
 * nothing else does. That is an unforgeable marker: if a demo race is in the
 * catalogue, the user can see invented data and must be told so.
 *
 * A database error resolves to TRUE — showing the warning. A demo without the
 * banner looks like it is quoting real racing, which is the exact failure
 * CLAUDE.md's no-fabricated-data rule exists to prevent. A real install that
 * shows it is merely untidy.
 */

export const DEMO_PROVIDER_ID = "demo";

export async function isDemoData(): Promise<boolean> {
  try {
    const rows = await getDb().execute<{ present: boolean }>(
      sql`SELECT EXISTS (
            SELECT 1 FROM races WHERE provider_id = ${DEMO_PROVIDER_ID}
          ) AS present`,
    );
    return rows[0]?.present ?? true;
  } catch {
    return true;
  }
}
