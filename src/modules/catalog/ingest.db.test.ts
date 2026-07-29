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

  async function rowCounts() {
    const [row] = await db.execute<{
      meetings: string;
      races: string;
      runners: string;
      horses: string;
      tracks: string;
    }>(sql`
      select
        (select count(*) from meetings)::text as meetings,
        (select count(*) from races)::text    as races,
        (select count(*) from runners)::text  as runners,
        (select count(*) from horses)::text   as horses,
        (select count(*) from tracks)::text   as tracks
    `);
    return {
      meetings: Number(row?.meetings ?? 0),
      races: Number(row?.races ?? 0),
      runners: Number(row?.runners ?? 0),
      horses: Number(row?.horses ?? 0),
      tracks: Number(row?.tracks ?? 0),
    };
  }

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
    // Self-contained on purpose. This used to depend on the previous test
    // having ingested: run alone it was a *first* run, and one meeting with two
    // races is exactly what a first run produces, so it passed without
    // re-running anything.
    const range = {
      provider,
      from: "2024-01-02",
      to: "2024-01-02",
      regions: ["GB"] as const,
    };

    const run1 = await ingestRange({ ...range, regions: ["GB"] }, db);
    const after1 = await rowCounts();

    const run2 = await ingestRange({ ...range, regions: ["GB"] }, db);
    const after2 = await rowCounts();

    // The second run must SUCCEED and change nothing. Asserting only that the
    // counts are unchanged is not enough: ingestRange collects per-race errors
    // into `skipped`, so a second run that blew up on every race would also
    // leave the counts alone.
    expect(run2.skipped).toEqual([]);
    expect(run2.races).toBe(run1.races);
    expect(run2.runners).toBe(run1.runners);
    expect(after2).toEqual(after1);
    // And the counts are what the fixture actually contains, so a run that
    // silently wrote nothing at all cannot satisfy this either.
    expect(after1).toEqual({
      meetings: 1,
      races: 2,
      runners: 6,
      horses: 6,
      tracks: 1,
    });
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
