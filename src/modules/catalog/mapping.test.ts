import { describe, expect, it } from "vitest";
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

  it("crosses a British Summer Time boundary without losing or repeating a day", () => {
    // BST starts 2024-03-31. A local-time loop would produce 23- or 25-hour
    // days here and drop or duplicate one.
    const dates = datesInRange("2024-03-29", "2024-04-02");
    expect(dates).toEqual([
      "2024-03-29",
      "2024-03-30",
      "2024-03-31",
      "2024-04-01",
      "2024-04-02",
    ]);
  });

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

describe("status mapping", () => {
  it("maps every canonical value to its catalogue value", () => {
    expect(meetingStatus("IN_PROGRESS")).toBe("inprogress");
    expect(meetingStatus("ABANDONED")).toBe("abandoned");
    expect(raceStatus("RESULT")).toBe("result");
    expect(raceStatus("POSTPONED")).toBe("postponed");
    expect(raceType("FLAT")).toBe("flat");
    expect(raceType(null)).toBeNull();
    expect(runnerStatus("NON_RUNNER")).toBe("non_runner");
    expect(runnerStatus("WITHDRAWN")).toBe("withdrawn");
  });
});

describe("oddsToNumeric", () => {
  it("renders to the NUMERIC(10,3) scale", () => {
    expect(oddsToNumeric(4.5)).toBe("4.500");
    expect(oddsToNumeric(2.375)).toBe("2.375");
    expect(oddsToNumeric(null)).toBeNull();
  });
});
