import { describe, expect, it } from "vitest";
import { deriveIsHandicap } from "./handicap";

/** Narrowing helpers so a wrong branch fails loudly rather than reading undefined. */
function handicapOf(name: string): boolean {
  const r = deriveIsHandicap(name);
  if (!r.ok) throw new Error(`expected a decision for ${name!}, got refusal: ${r.reason}`);
  return r.isHandicap;
}
function refusalOf(name: string): string {
  const r = deriveIsHandicap(name);
  if (r.ok) throw new Error(`expected a refusal for ${name}, got ${r.isHandicap}`);
  return r.reason;
}

describe("rule 1 — handicap markers", () => {
  it.each([
    "Betfair Handicap",
    "Sky Bet Handicap Chase",
    "Racing TV H'cap Hurdle",
    "Coral H’cap",           // typographic apostrophe
    "totesport.com Hcap",
    "Old Newton Cup Handicap Stakes",
    "Ladbrokes HANDICAP",
    "Weatherbys Handicaps",  // plural
  ])("%s -> handicap", (name) => {
    expect(handicapOf(name)).toBe(true);
  });
});

describe("rule 1 wins over rule 2 — the ordering is load-bearing", () => {
  it.each([
    "Novice Handicap Chase",
    "Maiden Handicap",
    "Selling Handicap Hurdle",
    "Class 4 Handicap Stakes",
    "Classified Handicap",
  ])("%s -> handicap, not caught by the non-handicap marker", (name) => {
    // Every one of these also contains a rule 2 word. Checking rule 2 first
    // would call them non-handicaps and pay the wrong number of places.
    expect(handicapOf(name)).toBe(true);
  });
});

describe("rule 2 — non-handicap markers", () => {
  it.each([
    "British Stallion Studs EBF Maiden Stakes",
    "Novice Stakes",
    "Weatherbys Claiming Stakes",
    "Selling Stakes",
    "EBF Auction Stakes",
    "Conditions Stakes",
    "Coronation Group 1 Stakes",
    "Listed Race",
    "Classified Stakes",
    "Standard Open National Hunt Flat Race",
    "Mares Bumper",
    "NHF Race",
  ])("%s -> not handicap", (name) => {
    expect(handicapOf(name)).toBe(false);
  });
});

describe("rule 3 — refuses rather than defaulting", () => {
  it("refuses a bare nursery, naming why", () => {
    expect(refusalOf("Byerley Stud Nursery")).toMatch(/unsourced/);
  });

  it("still resolves a nursery that says handicap", () => {
    // Rule 1 runs before the ambiguity check, so the common naming works.
    expect(handicapOf("Byerley Stud Nursery Handicap")).toBe(true);
  });

  it.each([
    "The Racing Post Trophy",
    "Sponsor Name Race",
    "Apprentice Riders Race",
    "Champion Hurdle",
  ])("%s -> refused, not defaulted", (name) => {
    expect(refusalOf(name)).toMatch(/refusing rather than defaulting/);
  });

  it("refuses an empty or whitespace name", () => {
    expect(refusalOf("")).toMatch(/empty/);
    expect(refusalOf("   ")).toMatch(/empty/);
  });

  it("never silently returns false for an unrecognised name", () => {
    // The failure mode D3 exists to prevent: "the feed did not say" becoming
    // "not a handicap". An unmatched name must not produce a decision at all.
    const r = deriveIsHandicap("Completely Unrecognisable 3.40");
    expect(r.ok).toBe(false);
  });
});

describe("the derivation reports which rule fired", () => {
  it("names the rule and the matched marker", () => {
    const r = deriveIsHandicap("Sky Bet Handicap Chase");
    expect(r).toMatchObject({ ok: true, rule: "1-handicap-marker", matched: "handicap" });

    const n = deriveIsHandicap("Novice Stakes");
    expect(n).toMatchObject({ ok: true, rule: "2-non-handicap-marker" });
  });

  it("does not match a marker inside another word", () => {
    // Word boundaries matter: a sponsor called "Stakeholder" is not a stakes
    // race, and "Handicapped" in prose is not a handicap marker we want.
    expect(deriveIsHandicap("Stakeholder Trophy").ok).toBe(false);
  });
});
