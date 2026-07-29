import { describe, expect, it } from "vitest";
import { createArchiveProvider } from "../adapter";
import { buildDayFiles, type CourseMap, type RaceformRow } from "./raceform";

const COURSES: CourseMap = {
  Ascot: { region: "GB", timeZone: "Europe/London" },
  Leopardstown: { region: "IE", timeZone: "Europe/Dublin" },
};

function row(over: Partial<RaceformRow> = {}): RaceformRow {
  return {
    date: "2024-06-19",
    course: "Ascot",
    race_id: "r1",
    off: "14:30",
    race_name: "Test Handicap Stakes",
    type: "Flat",
    class: "1",
    dist: "1m",
    going: "Good",
    ran: 3,
    num: 1,
    pos: "1",
    sp: "5/1",
    horse: "Alpha (IRE)",
    jockey: "A Jockey",
    trainer: "A Trainer",
    wgt: "9-7",
    ...over,
  };
}

/** A clean 3-runner race. */
const CLEAN: RaceformRow[] = [
  row({ num: 1, pos: "1", sp: "5/1", horse: "Alpha (IRE)" }),
  row({ num: 2, pos: "2", sp: "2/1", horse: "Beta" }),
  row({ num: 3, pos: "3", sp: "10/1", horse: "Gamma" }),
];

describe("buildDayFiles — the happy path", () => {
  const { dayFiles, skipped } = buildDayFiles(CLEAN, COURSES);
  const day = dayFiles.get("GB/2024-06-19");
  const race = (day?.meetings[0]?.["races"] as Record<string, unknown>[])[0];

  it("produces one day file keyed by region and date", () => {
    expect(skipped).toEqual([]);
    expect([...dayFiles.keys()]).toEqual(["GB/2024-06-19"]);
    expect(day?.region).toBe("GB");
  });

  it("takes actual_runners from `ran`, not from a row count", () => {
    // The whole reason this dataset was chosen over the alternative.
    expect(race?.["actualRunners"]).toBe(3);
  });

  it("resolves the off time through the meeting's zone", () => {
    // 14:30 local on a June day at a London course is 13:30Z.
    expect(race?.["offTime"]).toBe("2024-06-19T13:30:00.000Z");
  });

  it("derives is_handicap and emits Rule 4 as zero (docs/08 D20)", () => {
    expect(race?.["isHandicap"]).toBe(true);
    expect(race?.["rule4DeductionPence"]).toBe(0);
  });

  it("splits the breeding suffix off the horse name (docs/08 D6)", () => {
    const runners = race?.["runners"] as Record<string, unknown>[];
    expect((runners[0]?.["horse"] as Record<string, unknown>)["name"]).toBe("Alpha");
    expect((runners[0]?.["horse"] as Record<string, unknown>)["breedingSuffix"]).toBe("IRE");
    expect((runners[1]?.["horse"] as Record<string, unknown>)["breedingSuffix"]).toBeNull();
  });

  it("converts fractional SP to decimal", () => {
    const runners = race?.["runners"] as Record<string, unknown>[];
    expect(runners.map((r) => r["startingPrice"])).toEqual([6, 3, 11]);
  });

  it("files an Irish meeting under IE with its own zone", () => {
    const { dayFiles: d } = buildDayFiles(
      CLEAN.map((r) => ({ ...r, course: "Leopardstown", race_id: "ir1" })),
      COURSES,
    );
    expect([...d.keys()]).toEqual(["IE/2024-06-19"]);
    expect(d.get("IE/2024-06-19")?.meetings[0]?.["timezone"]).toBe("Europe/Dublin");
  });
});

describe("dead heats are derived from shared finishing positions", () => {
  it("marks both tied runners, and neither of the untied ones", () => {
    const { dayFiles } = buildDayFiles(
      [
        row({ num: 1, pos: "1", horse: "Alpha" }),
        row({ num: 2, pos: "1", horse: "Beta" }),
        row({ num: 3, pos: "3", horse: "Gamma" }),
      ],
      COURSES,
    );
    const race = (
      dayFiles.get("GB/2024-06-19")?.meetings[0]?.["races"] as Record<string, unknown>[]
    )[0];
    const positions = (race?.["result"] as Record<string, unknown>)["positions"] as Array<
      Record<string, unknown>
    >;
    expect(positions.find((p) => p["runnerId"] === "1")?.["deadHeatWith"]).toEqual(["2"]);
    expect(positions.find((p) => p["runnerId"] === "2")?.["deadHeatWith"]).toEqual(["1"]);
    expect(positions.find((p) => p["runnerId"] === "3")?.["deadHeatWith"]).toEqual([]);
  });
});

describe("refuses rather than defaulting — the whole race, not the row", () => {
  const skipReason = (rows: RaceformRow[], courses = COURSES): string => {
    const { dayFiles, skipped } = buildDayFiles(rows, courses);
    expect(dayFiles.size).toBe(0);
    expect(skipped).toHaveLength(1);
    return skipped[0]!.reason;
  };

  it("refuses a race whose handicap status cannot be derived", () => {
    expect(
      skipReason(CLEAN.map((r) => ({ ...r, race_name: "The Sponsor Trophy" }))),
    ).toMatch(/is_handicap/);
  });

  it("refuses a course that is not in the course map", () => {
    expect(skipReason(CLEAN.map((r) => ({ ...r, course: "Nowhere" })))).toMatch(
      /not in the course map/,
    );
  });

  it("refuses a race with no usable runner count", () => {
    expect(skipReason(CLEAN.map((r) => ({ ...r, ran: "" })))).toMatch(/place-terms row/);
  });

  it("refuses the whole race when ONE runner's SP is unreadable", () => {
    // A partially-understood race is worse than an absent one: it looks
    // complete. So one bad price drops all three runners.
    const rows = [...CLEAN];
    rows[1] = { ...rows[1]!, sp: "not-a-price" };
    expect(skipReason(rows)).toMatch(/unparseable starting price/);
  });

  it("refuses a race where nobody finished", () => {
    expect(skipReason(CLEAN.map((r) => ({ ...r, pos: "PU" })))).toMatch(
      /nothing to settle against/,
    );
  });

  it("keeps the good races when only one race in the batch is bad", () => {
    const bad = CLEAN.map((r) => ({ ...r, race_id: "r2", race_name: "Sponsor Trophy" }));
    const { dayFiles, skipped } = buildDayFiles([...CLEAN, ...bad], COURSES);
    expect(skipped).toHaveLength(1);
    const races = dayFiles.get("GB/2024-06-19")?.meetings[0]?.["races"] as unknown[];
    expect(races).toHaveLength(1);
  });
});

describe("the output is readable by the archive adapter that consumes it", () => {
  it("round-trips through the real adapter", async () => {
    // The importer's only job is to produce files the adapter accepts. Asserting
    // the shape by hand would let the two drift; this asserts against the actual
    // consumer, including its Zod validation.
    const { dayFiles } = buildDayFiles(CLEAN, COURSES);
    const day = dayFiles.get("GB/2024-06-19")!;

    const { mkdtemp, mkdir, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = (await import("node:path")).default;

    const root = await mkdtemp(path.join(tmpdir(), "paperhorse-import-"));
    await mkdir(path.join(root, "GB"), { recursive: true });
    await writeFile(
      path.join(root, "GB", "2024-06-19.json"),
      JSON.stringify(day, null, 2),
    );

    const provider = createArchiveProvider({ root });
    const meetings = await provider.listMeetings({ date: "2024-06-19", region: "GB" });
    expect(meetings).toHaveLength(1);

    const card = await provider.getRaceCard({ raceRef: meetings[0]!.races[0]!.raceRef });
    expect(card.isHandicap).toBe(true);
    expect(card.actualRunners).toBe(3);
    expect(card.runners).toHaveLength(3);
    expect(card.runners[0]?.horse.breedingSuffix).toBe("IRE");

    const result = await provider.getResult({
      raceRef: meetings[0]!.races[0]!.raceRef,
    });
    expect(result?.positions).toHaveLength(3);
    expect(result?.rule4DeductionPence).toBe(0);
  });
});
