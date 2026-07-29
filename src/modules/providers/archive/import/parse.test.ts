import { describe, expect, it } from "vitest";
import {
  localToIsoInstant,
  parseDistanceYards,
  parseFinishPosition,
  parseHorseName,
  parseStartingPrice,
  parseWeightLb,
} from "./parse";

function value<T>(r: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!r.ok) throw new Error(`expected ok, got refusal: ${r.reason}`);
  return r.value;
}
function reason<T>(r: { ok: true; value: T } | { ok: false; reason: string }): string {
  if (r.ok) throw new Error(`expected refusal, got ${JSON.stringify(r.value)}`);
  return r.reason;
}

describe("parseStartingPrice — SETTLEMENT INPUT, refuses", () => {
  it.each([
    ["5/1", 6],
    ["10/1", 11],
    ["1/2", 1.5],
    ["5/2", 3.5],
    ["11/10", 2.1],
    ["100/1", 101],
    ["Evens", 2],
    ["EVS", 2],
    ["evens", 2],
  ])("%s -> %s", (raw, expected) => {
    expect(value(parseStartingPrice(raw))).toBeCloseTo(expected, 10);
  });

  it("treats a blank price as absent, not as an error", () => {
    for (const blank of ["", "  ", "-", "NA", null, undefined]) {
      expect(value(parseStartingPrice(blank))).toBeNull();
    }
  });

  it("refuses anything it cannot read rather than guessing", () => {
    expect(reason(parseStartingPrice("SP"))).toMatch(/unparseable/);
    expect(reason(parseStartingPrice("5//1"))).toMatch(/unparseable/);
    expect(reason(parseStartingPrice("1/0"))).toMatch(/zero denominator/);
  });

  it("refuses a decimal that is not a price", () => {
    // Decimal odds are strictly greater than 1; 0.83 is an implied probability,
    // which is how the rejected hwaitt dataset stores its prices.
    expect(reason(parseStartingPrice("0.83"))).toMatch(/must exceed 1/);
    expect(reason(parseStartingPrice("1"))).toMatch(/must exceed 1/);
  });
});

describe("parseFinishPosition — a non-finisher is not an error", () => {
  it.each(["1", "2", "17"])("%s is a placing", (raw) => {
    expect(value(parseFinishPosition(raw)).position).toBe(Number(raw));
  });

  it("reads dead-heat notation", () => {
    expect(value(parseFinishPosition("1=")).position).toBe(1);
    expect(value(parseFinishPosition("=1")).position).toBe(1);
  });

  it.each(["F", "PU", "UR", "BD", "RR", "SU", "RO"])(
    "%s did not finish — no position, not disqualified",
    (raw) => {
      const p = value(parseFinishPosition(raw));
      expect(p.position).toBeNull();
      expect(p.disqualified).toBe(false);
    },
  );

  it("distinguishes disqualification from failing to finish", () => {
    // A DSQ ran and was disqualified; a PU never completed. settle() treats
    // them the same way today, but conflating them in the DATA is lossy.
    const dsq = value(parseFinishPosition("DSQ"));
    expect(dsq.disqualified).toBe(true);
    expect(value(parseFinishPosition("PU")).disqualified).toBe(false);
  });

  it("refuses an unrecognised code", () => {
    expect(reason(parseFinishPosition("WAT"))).toMatch(/unparseable/);
    expect(reason(parseFinishPosition("0"))).toMatch(/must be positive/);
  });
});

describe("decorative fields degrade to null, they do not refuse", () => {
  it("parses weight in stones-pounds", () => {
    expect(parseWeightLb("9-7")).toBe(133);
    expect(parseWeightLb("10-0")).toBe(140);
  });

  it("returns null for a weight it cannot read", () => {
    expect(parseWeightLb("nonsense")).toBeNull();
    expect(parseWeightLb("9-20")).toBeNull(); // 20lb is not a valid remainder
    expect(parseWeightLb(null)).toBeNull();
  });

  it("parses distance to yards", () => {
    expect(parseDistanceYards("1m")).toBe(1760);
    expect(parseDistanceYards("5f")).toBe(1100);
    // 1760 + (2 x 220) + 110
    expect(parseDistanceYards("1m 2f 110y")).toBe(2310);
  });

  it("returns null for a distance it cannot read", () => {
    expect(parseDistanceYards("about a mile")).toBeNull();
    expect(parseDistanceYards(undefined)).toBeNull();
  });
});

describe("parseHorseName — breeding suffix, not a country (docs/08 D6)", () => {
  it("splits the suffix off", () => {
    expect(parseHorseName("Charyn (IRE)")).toEqual({
      name: "Charyn",
      breedingSuffix: "IRE",
    });
    expect(parseHorseName("Baaeed")).toEqual({
      name: "Baaeed",
      breedingSuffix: null,
    });
  });

  it("leaves a name with brackets that are not a suffix alone", () => {
    expect(parseHorseName("Something (Longer Name)").breedingSuffix).toBeNull();
  });
});

describe("localToIsoInstant — the DST trap", () => {
  it("resolves a GMT off time", () => {
    // 2024-01-13 is winter: Europe/London is UTC+0.
    expect(value(localToIsoInstant("2024-01-13", "14:30", "Europe/London"))).toBe(
      "2024-01-13T14:30:00.000Z",
    );
  });

  it("resolves a BST off time an hour earlier in UTC", () => {
    // 2024-06-19 is summer: Europe/London is UTC+1, so a 14:30 local off time
    // is 13:30Z. Pasting a "Z" on the local time would be an hour out — and an
    // hour is the difference between two races on the same card.
    expect(value(localToIsoInstant("2024-06-19", "14:30", "Europe/London"))).toBe(
      "2024-06-19T13:30:00.000Z",
    );
  });

  it("handles both sides of the March transition", () => {
    // BST starts 2024-03-31 at 01:00 GMT.
    expect(value(localToIsoInstant("2024-03-30", "14:00", "Europe/London"))).toBe(
      "2024-03-30T14:00:00.000Z",
    );
    expect(value(localToIsoInstant("2024-03-31", "14:00", "Europe/London"))).toBe(
      "2024-03-31T13:00:00.000Z",
    );
  });

  it("handles both sides of the October transition", () => {
    // BST ends 2024-10-27 at 02:00 BST.
    expect(value(localToIsoInstant("2024-10-26", "14:00", "Europe/London"))).toBe(
      "2024-10-26T13:00:00.000Z",
    );
    expect(value(localToIsoInstant("2024-10-28", "14:00", "Europe/London"))).toBe(
      "2024-10-28T14:00:00.000Z",
    );
  });

  it("uses the meeting's own zone, so Irish cards resolve correctly", () => {
    expect(value(localToIsoInstant("2024-06-19", "14:30", "Europe/Dublin"))).toBe(
      "2024-06-19T13:30:00.000Z",
    );
  });

  it("refuses malformed input", () => {
    expect(reason(localToIsoInstant("19/06/2024", "14:30", "Europe/London"))).toMatch(/bad date/);
    expect(reason(localToIsoInstant("2024-06-19", "2.30pm", "Europe/London"))).toMatch(/bad off time/);
    expect(reason(localToIsoInstant("2024-06-19", "14:30", "Mars/Olympus"))).toMatch(/unknown time zone/);
  });
});
