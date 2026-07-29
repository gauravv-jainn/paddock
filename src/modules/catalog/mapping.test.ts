import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import type {
  MeetingStatus,
  RaceStatus,
  RaceType,
  Runner,
} from "@/modules/providers";
import {
  datesInRange,
  meetingStatus,
  oddsToNumeric,
  raceStatus,
  raceType,
  runnerStatus,
} from "./mapping";

describe("datesInRange", () => {
  it("is inclusive at both ends", () => {
    expect(datesInRange("2024-06-01", "2024-06-03")).toEqual([
      "2024-06-01",
      "2024-06-02",
      "2024-06-03",
    ]);
  });

  it("returns a single day when from equals to", () => {
    expect(datesInRange("2024-06-01", "2024-06-01")).toEqual(["2024-06-01"]);
  });

  it("covers a whole month", () => {
    expect(datesInRange("2024-06-01", "2024-06-30")).toHaveLength(30);
  });

  /**
   * Run in a child process with TZ forced to Europe/London.
   *
   * Asserting this in-process proves nothing: the implementation is UTC-based,
   * so on a host that does not observe the transition (this one is UTC+08, no
   * DST) a local-time implementation produces identical output and the test
   * passes either way. The only way to test the claim is to be in a timezone
   * that has the transition.
   *
   * 2024-10-27 is the BST->GMT change: local midnight to local midnight is 25
   * hours, so a local-time loop stepping 24h at a time repeats a date.
   */
  it("crosses a British Summer Time boundary without losing or repeating a day", () => {
    const script =
      'import {datesInRange} from "./src/modules/catalog/mapping.ts";' +
      'console.log(JSON.stringify(datesInRange("2024-10-25","2024-10-29")));';

    const out = execFileSync("pnpm", ["exec", "tsx", "-e", script], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: { ...process.env, TZ: "Europe/London" },
    });

    expect(JSON.parse(out.trim().split("\n").at(-1) ?? "[]")).toEqual([
      "2024-10-25",
      "2024-10-26",
      "2024-10-27",
      "2024-10-28",
      "2024-10-29",
    ]);
  }, 60_000);

  it("handles a leap day", () => {
    expect(datesInRange("2024-02-28", "2024-03-01")).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
  });

  it("rejects a reversed or unparseable range", () => {
    expect(() => datesInRange("2024-06-03", "2024-06-01")).toThrow(RangeError);
    expect(() => datesInRange("nonsense", "2024-06-01")).toThrow(RangeError);
  });
});

/**
 * Exhaustive by construction. These are typed as Record<Union, string>, so
 * adding a member to any of the canonical unions makes this file fail to
 * compile until the new mapping is stated — the previous version asserted 8 of
 * 22 values while claiming to cover "every canonical value".
 */
const MEETING: Record<MeetingStatus, string> = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "inprogress",
  COMPLETED: "completed",
  ABANDONED: "abandoned",
};

const RACE: Record<RaceStatus, string> = {
  SCHEDULED: "scheduled",
  OPEN: "open",
  SUSPENDED: "suspended",
  OFF: "off",
  RESULT: "result",
  VOID: "void",
  ABANDONED: "abandoned",
  POSTPONED: "postponed",
};

const TYPE: Record<RaceType, string> = {
  FLAT: "flat",
  HURDLE: "hurdle",
  CHASE: "chase",
  NTF: "ntf",
  HARNESS: "harness",
};

const RUNNER: Record<Runner["status"], string> = {
  DECLARED: "declared",
  NON_RUNNER: "non_runner",
  WITHDRAWN: "withdrawn",
  RESERVE: "reserve",
};

describe("status mapping", () => {
  it("maps every canonical meeting status", () => {
    for (const [canonical, column] of Object.entries(MEETING)) {
      expect(meetingStatus(canonical as MeetingStatus)).toBe(column);
    }
  });

  it("maps every canonical race status", () => {
    for (const [canonical, column] of Object.entries(RACE)) {
      expect(raceStatus(canonical as RaceStatus)).toBe(column);
    }
  });

  it("maps every canonical race type, and null", () => {
    for (const [canonical, column] of Object.entries(TYPE)) {
      expect(raceType(canonical as RaceType)).toBe(column);
    }
    expect(raceType(null)).toBeNull();
  });

  it("maps every canonical runner status", () => {
    for (const [canonical, column] of Object.entries(RUNNER)) {
      expect(runnerStatus(canonical as Runner["status"])).toBe(column);
    }
  });

  it("produces distinct column values within each enumeration", () => {
    // A mapping that collapsed two statuses onto one value would still satisfy
    // the loops above if both expectations were edited together.
    for (const table of [MEETING, RACE, TYPE, RUNNER]) {
      const values = Object.values(table);
      expect(new Set(values).size).toBe(values.length);
    }
  });
});

describe("oddsToNumeric", () => {
  it("renders to the NUMERIC(10,3) scale", () => {
    expect(oddsToNumeric(4.5)).toBe("4.500");
    expect(oddsToNumeric(2.375)).toBe("2.375");
    expect(oddsToNumeric(null)).toBeNull();
  });
});
