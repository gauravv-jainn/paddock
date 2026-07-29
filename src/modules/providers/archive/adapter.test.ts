import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { canAutoSettle, canSubscribeOdds } from "../capabilities";
import {
  CapabilityUnavailableError,
  ProviderNotFoundError,
  ProviderPayloadError,
} from "../errors";
import type { ProviderCapabilities, RacingDataProvider } from "../types";
import {
  ARCHIVE_CAPABILITIES,
  createArchiveProvider,
} from "./adapter";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "__fixtures__");
const MALFORMED = path.join(ROOT, "malformed");

const provider = createArchiveProvider({ root: ROOT });
const RACE_1 = "GB/2024-01-02/test-course/r1";
const RACE_2 = "GB/2024-01-02/test-course/r2";

function withCapabilities(
  overrides: Partial<ProviderCapabilities>,
  root = ROOT,
) {
  return createArchiveProvider({
    root,
    capabilities: { ...ARCHIVE_CAPABILITIES, ...overrides },
  });
}

describe("listMeetings", () => {
  it("normalises a day file into canonical meetings", async () => {
    const meetings = await provider.listMeetings({
      date: "2024-01-02",
      region: "GB",
    });

    expect(meetings).toHaveLength(1);
    const meeting = meetings[0]!;
    expect(meeting.trackName).toBe("Test Course");
    expect(meeting.region).toBe("GB");
    expect(meeting.timezone).toBe("Europe/London");
    expect(meeting.meetingRef).toBe("GB/2024-01-02/test-course");
    expect(meeting.races.map((r) => r.raceRef)).toEqual([RACE_1, RACE_2]);
  });

  it("returns nothing for a day the archive does not hold", async () => {
    expect(
      await provider.listMeetings({ date: "1999-12-31", region: "GB" }),
    ).toEqual([]);
  });

  it("rejects a date that is not YYYY-MM-DD", async () => {
    await expect(
      provider.listMeetings({ date: "2 Jan 2024", region: "GB" }),
    ).rejects.toThrow(ProviderPayloadError);
  });
});

describe("getRaceCard", () => {
  it("normalises a card, with money as bigint minor units", async () => {
    const card = await provider.getRaceCard({ raceRef: RACE_1 });

    expect(card.name).toBe("Structural Fixture Handicap");
    expect(card.isHandicap).toBe(true);
    expect(card.actualRunners).toBe(3);
    expect(card.declaredRunners).toBe(4);
    expect(card.rule4DeductionPence).toBe(10);
    expect(card.prizeMinor).toBe(1_234_500n);
    expect(typeof card.prizeMinor).toBe("bigint");
    expect(card.runners).toHaveLength(4);
  });

  it("carries the withdrawal price through, as Rule 4 needs it", async () => {
    const card = await provider.getRaceCard({ raceRef: RACE_1 });
    const withdrawn = card.runners.find((r) => r.status === "WITHDRAWN");
    expect(withdrawn?.withdrawnAtOdds).toBe(2.5);
  });

  it("allows a null actual_runners before the race is run", async () => {
    const card = await provider.getRaceCard({ raceRef: RACE_2 });
    expect(card.status).toBe("SCHEDULED");
    expect(card.actualRunners).toBeNull();
  });

  it("raises for a race the archive does not hold", async () => {
    await expect(
      provider.getRaceCard({ raceRef: "GB/2024-01-02/test-course/nope" }),
    ).rejects.toThrow(ProviderNotFoundError);
  });

  it("rejects a malformed reference", async () => {
    for (const ref of ["", "GB/2024-01-02", "XX/2024-01-02/a/b", "GB/nope/a/b"]) {
      await expect(provider.getRaceCard({ raceRef: ref })).rejects.toThrow(
        ProviderPayloadError,
      );
    }
  });

  it("refuses a reference that would escape the archive root", async () => {
    await expect(
      provider.getRaceCard({ raceRef: "GB/2024-01-02/../../etc/passwd" }),
    ).rejects.toThrow(ProviderPayloadError);
  });
});

describe("payload validation", () => {
  const malformed = createArchiveProvider({ root: MALFORMED });

  it("rejects a card that does not state whether it is a handicap", async () => {
    await expect(
      malformed.getRaceCard({ raceRef: "GB/2024-01-03/test-course/r1" }),
    ).rejects.toThrow(/isHandicap/);
  });

  it("rejects a withdrawn runner with no withdrawal price", async () => {
    await expect(
      malformed.getRaceCard({ raceRef: "GB/2024-01-04/test-course/r1" }),
    ).rejects.toThrow(/withdrawnAtOdds/);
  });

  it("rejects a finished race with no starter count", async () => {
    await expect(
      malformed.getRaceCard({ raceRef: "GB/2024-01-05/test-course/r1" }),
    ).rejects.toThrow(/actualRunners/);
  });

  it("rejects money supplied as a JSON number", async () => {
    await expect(
      malformed.getRaceCard({ raceRef: "GB/2024-01-06/test-course/r1" }),
    ).rejects.toThrow(/prizeMinor/);
  });
});

describe("getOdds", () => {
  it("returns the recorded snapshot", async () => {
    const snapshot = await provider.getOdds({ raceRef: RACE_1 });
    expect(snapshot.source).toBe("SP");
    expect(snapshot.prices).toHaveLength(3);
    expect(snapshot.prices[0]).toEqual({
      runnerId: "1",
      marketType: "WIN",
      priceDecimal: 3.5,
    });
  });

  it("raises rather than inventing a price when none was recorded", async () => {
    await expect(provider.getOdds({ raceRef: RACE_2 })).rejects.toThrow(
      ProviderNotFoundError,
    );
  });
});

describe("getResult", () => {
  it("returns dead heats, non-runners and the Rule 4 deduction", async () => {
    const result = await provider.getResult({ raceRef: RACE_1 });

    expect(result).not.toBeNull();
    expect(result!.status).toBe("RESULT");
    expect(result!.nonRunners).toEqual(["4"]);
    expect(result!.rule4DeductionPence).toBe(10);
    expect(result!.positions.find((p) => p.runnerId === "1")?.deadHeatWith).toEqual(
      ["2"],
    );
  });

  it("hashes the source payload so a replay is verifiable", async () => {
    const result = await provider.getResult({ raceRef: RACE_1 });
    const raw = await readFile(path.join(ROOT, "GB", "2024-01-02.json"));
    expect(result!.providerPayloadHash).toBe(
      createHash("sha256").update(raw).digest("hex"),
    );
  });

  it("returns null for a race with no result yet", async () => {
    expect(await provider.getResult({ raceRef: RACE_2 })).toBeNull();
  });
});

describe("capabilities are enforced, not described", () => {
  it("refuses a region outside supportedRegions", async () => {
    // The default archive declares IE, so an IE call is merely empty, not an
    // error. Narrowing the capability is what turns it into a refusal — which
    // is the flag doing the work rather than a hardcoded region list.
    expect(ARCHIVE_CAPABILITIES.supportedRegions).toContain("IE");
    expect(
      await provider.listMeetings({ date: "2024-01-02", region: "IE" }),
    ).toEqual([]);

    const gbOnly = withCapabilities({ supportedRegions: ["GB"] });
    await expect(
      gbOnly.listMeetings({ date: "2024-01-02", region: "IE" }),
    ).rejects.toThrow(CapabilityUnavailableError);
    await expect(
      gbOnly.getRaceCard({ raceRef: "IE/2024-01-02/anywhere/r1" }),
    ).rejects.toThrow(/supportedRegions/);
  });

  it("refuses to return a result when officialResults is false", async () => {
    await expect(
      withCapabilities({ officialResults: false }).getResult({
        raceRef: RACE_1,
      }),
    ).rejects.toThrow(/officialResults/);
  });

  it("refuses a dead heat when deadHeatFlags is false", async () => {
    await expect(
      withCapabilities({ deadHeatFlags: false }).getResult({ raceRef: RACE_1 }),
    ).rejects.toThrow(/deadHeatFlags/);
  });

  it("refuses non-runners when nonRunnerFeed is false", async () => {
    await expect(
      withCapabilities({ nonRunnerFeed: false }).getResult({ raceRef: RACE_1 }),
    ).rejects.toThrow(/nonRunnerFeed/);
  });

  it("does not offer an odds subscription it cannot serve", () => {
    const asPort: RacingDataProvider = provider;
    expect(asPort.capabilities.liveOdds).toBe(false);
    expect(asPort.subscribeOdds).toBeUndefined();
    expect(canSubscribeOdds(asPort)).toBe(false);
  });

  it("permits auto-settlement only when results are fully described", () => {
    expect(canAutoSettle(provider)).toBe(true);
    expect(canAutoSettle(withCapabilities({ deadHeatFlags: false }))).toBe(false);
    expect(canAutoSettle(withCapabilities({ nonRunnerFeed: false }))).toBe(false);
    expect(canAutoSettle(withCapabilities({ officialResults: false }))).toBe(false);
  });
});
