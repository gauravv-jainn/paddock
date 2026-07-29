import path from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArchiveProvider } from "@/modules/providers";
import { ingestRange } from "./ingest";
import { getRacecard, listMeetings } from "./read";

/**
 * End-to-end ingestion: archive files in, catalogue rows out, read model back.
 *
 * Uses the adapter's structural fixtures — invented placeholders, not racing
 * data. This proves the pipeline moves fields to the right columns. It proves
 * nothing about settlement; that is what tests/golden/ is for.
 *
 * Requires TEST_DATABASE_URL. This suite TRUNCATEs the catalogue tables.
 */
const url = process.env["TEST_DATABASE_URL"];

if (!url) {
  console.warn(
    "\n  SKIPPED: catalogue ingestion tests need TEST_DATABASE_URL.\n" +
      "  Ingestion and the racecard read model are UNVERIFIED without one.\n",
  );
}

const ARCHIVE_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "providers",
  "archive",
  "__fixtures__",
);

describe.skipIf(!url)("archive ingestion", () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    client = postgres(url as string, {
      max: 1,
      types: { bigint: postgres.BigInt },
    });
    db = drizzle(client, { casing: "snake_case" });
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    await db.execute(
      sql`truncate table runners, races, meetings, tracks, horses, people cascade`,
    );
  });

  afterAll(async () => {
    await client?.end({ timeout: 5 });
  });

  const provider = createArchiveProvider({ root: ARCHIVE_ROOT });

  it("writes meetings, races and runners", async () => {
    const report = await ingestRange(
      { provider, from: "2024-01-02", to: "2024-01-02", regions: ["GB"] },
      db,
    );

    expect(report.skipped).toEqual([]);
    expect(report.meetings).toBe(1);
    expect(report.races).toBe(2);
    expect(report.runners).toBe(6);
    expect(report.results).toBe(1);
  });

  it("is idempotent — re-running the same range does not duplicate rows", async () => {
    await ingestRange(
      { provider, from: "2024-01-02", to: "2024-01-02", regions: ["GB"] },
      db,
    );

    const meetings = await listMeetings(undefined, db);
    expect(meetings).toHaveLength(1);
    expect(meetings[0]?.races).toHaveLength(2);
  });

  it("carries the settlement inputs through to the catalogue", async () => {
    const meetings = await listMeetings(undefined, db);
    const summary = meetings[0]?.races.find((r) => r.status === "result");
    expect(summary).toBeDefined();

    const card = await getRacecard(summary!.raceId, db);
    expect(card?.isHandicap).toBe(true);
    expect(card?.actualRunners).toBe(3);
    expect(card?.declaredRunners).toBe(4);
    expect(card?.rule4Pence).toBe(10);
  });

  it("records the dead heat, the non-runner and the withdrawal price", async () => {
    const meetings = await listMeetings(undefined, db);
    const summary = meetings[0]?.races.find((r) => r.status === "result");
    const card = await getRacecard(summary!.raceId, db);

    const first = card?.runners.find((r) => r.clothNumber === 1);
    expect(first?.finishPosition).toBe(1);
    expect(first?.deadHeatCount).toBe(2);

    const withdrawn = card?.runners.find((r) => r.clothNumber === 4);
    expect(withdrawn?.status).toBe("non_runner");
    expect(withdrawn?.withdrawnAtOdds).toBe("2.500");
  });

  it("leaves actual_runners null for a race that has not been run", async () => {
    const meetings = await listMeetings(undefined, db);
    const summary = meetings[0]?.races.find((r) => r.status === "scheduled");
    const card = await getRacecard(summary!.raceId, db);
    expect(card?.actualRunners).toBeNull();
  });

  it("reports rather than stores a race it cannot describe", async () => {
    const malformed = createArchiveProvider({
      root: path.join(ARCHIVE_ROOT, "malformed"),
    });
    const report = await ingestRange(
      { provider: malformed, from: "2024-01-03", to: "2024-01-03", regions: ["GB"] },
      db,
    );

    expect(report.races).toBe(0);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.reason).toMatch(/isHandicap/);
  });

  it("refuses a region the provider does not supply", async () => {
    const gbOnly = createArchiveProvider({
      root: ARCHIVE_ROOT,
      capabilities: { ...provider.capabilities, supportedRegions: ["GB"] },
    });
    await expect(
      ingestRange(
        { provider: gbOnly, from: "2024-01-02", to: "2024-01-02", regions: ["IE"] },
        db,
      ),
    ).rejects.toThrow(/does not supply region/);
  });
});
