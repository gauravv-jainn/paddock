import { sql } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, type Database } from "@/db/client";
import { settlements } from "./schema";

/**
 * The settlements table's constraints — declared AND actually present.
 *
 * The schema file is a drizzle literal that only feeds `drizzle-kit generate`;
 * the constraints that really exist come from the applied migration SQL.
 * Nothing stopped the two from drifting: the declaration could lose its unique
 * index and every test would stay green, because the database still has the
 * one an earlier migration created.
 *
 * That unique index IS the idempotence guarantee (docs/04 §7 — "UNIQUE
 * (bet_id, result_version) gives idempotent settlement for free"), so this
 * asserts both halves and that they agree.
 */
const url = process.env["TEST_DATABASE_URL"];

if (!url) {
  console.warn("\n  SKIPPED: settlement schema tests need TEST_DATABASE_URL.\n");
}

describe("settlements schema", () => {
  const config = getTableConfig(settlements);

  it("DECLARES the idempotence unique constraint", () => {
    // Column `name` here is the drizzle property name; the snake_case mapping
    // is applied at query time by `casing: "snake_case"`.
    const unique = config.uniqueConstraints.map((u) => ({
      name: u.name,
      columns: u.columns.map((c) => c.name).sort(),
    }));
    expect(unique).toContainEqual({
      name: "settlements_bet_id_result_version_is_reversal_key",
      columns: ["betId", "isReversal", "resultVersion"],
    });
  });

  it("DECLARES the indexes the read paths depend on", () => {
    const names = config.indexes.map((i) => i.config.name).sort();
    expect(names).toEqual([
      "settlements_needs_review_idx",
      "settlements_race_id_idx",
    ]);
  });

  it("DECLARES the outcome and non-negative-return checks", () => {
    const names = config.checks.map((c) => c.name).sort();
    expect(names).toEqual([
      "settlements_outcome_check",
      "settlements_return_non_negative",
    ]);
  });
});

describe.skipIf(!url)("settlements schema matches the database", () => {
  let db: Database;

  beforeAll(async () => {
    process.env["DATABASE_URL"] = url as string;
    db = getDb();
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    return async () => {
      await closeDb();
    };
  });

  it("has every DECLARED constraint actually present in PostgreSQL", async () => {
    const declared = [
      ...getTableConfig(settlements).uniqueConstraints.map((u) => u.name),
      ...getTableConfig(settlements).checks.map((c) => c.name),
    ].sort();

    const rows = await db.execute<{ conname: string }>(sql`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'settlements'::regclass AND contype IN ('u', 'c')
    `);
    const actual = rows.map((r) => r.conname);

    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(actual, `${name} is declared in schema.ts but missing from the database`)
        .toContain(name);
    }
  });

  it("has every DECLARED index actually present in PostgreSQL", async () => {
    const declared = getTableConfig(settlements).indexes.map((i) => i.config.name);
    const rows = await db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'settlements'
    `);
    const actual = rows.map((r) => r.indexname);

    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(actual, `${String(name)} is declared but missing from the database`)
        .toContain(name);
    }
  });

  it("has the foreign keys migration 0014 adds by hand", async () => {
    // Declared in SQL rather than in schema.ts, because the referenced tables
    // belong to other modules (.claude/rules/modules.md). Nothing else would
    // notice if that migration were dropped.
    const rows = await db.execute<{ conname: string }>(sql`
      SELECT conname FROM pg_constraint
       WHERE conrelid = 'settlements'::regclass AND contype = 'f'
    `);
    const names = rows.map((r) => r.conname).sort();
    expect(names).toEqual([
      "settlements_bet_id_bets_id_fk",
      "settlements_race_id_races_id_fk",
    ]);
  });
});
