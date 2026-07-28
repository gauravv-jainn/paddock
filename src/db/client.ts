import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type Database = ReturnType<typeof drizzle>;

let sql: ReturnType<typeof postgres> | undefined;
let db: Database | undefined;

/**
 * Lazily-constructed Drizzle handle.
 *
 * Constructed on first use rather than at import time so that importing a
 * module's schema (for tests, or for drizzle-kit) does not require a live
 * database.
 */
export function getDb(): Database {
  if (!db) {
    const url = process.env["DATABASE_URL"];
    if (!url) {
      throw new Error("DATABASE_URL is not set");
    }
    sql = postgres(url, { max: 10, types: { bigint: postgres.BigInt } });
    db = drizzle(sql, { casing: "snake_case" });
  }
  return db;
}

/** Closes the pool. Test teardown and worker shutdown only. */
export async function closeDb(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = undefined;
    db = undefined;
  }
}
