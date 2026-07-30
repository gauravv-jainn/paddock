// @vitest-environment jsdom
import axe from "axe-core";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

/**
 * WCAG 2.2 AA — axe-core over the real page components.
 *
 * The pages are async server components, which are plain async functions
 * returning JSX. They are called directly with their data dependencies mocked,
 * so what axe scans is the markup the pages actually emit — not markup written
 * for the test, which would prove nothing.
 *
 * A 24-runner field is used deliberately: the biggest table in the product,
 * and where a header-association or scope mistake actually costs a screen
 * reader user something.
 */

const RUNNER_COUNT = 24;

const runners = Array.from({ length: RUNNER_COUNT }, (_, i) => ({
  runnerId: `runner-${i + 1}`,
  clothNumber: i + 1,
  stallDraw: i + 1,
  horseName: `Invented Horse ${i + 1}`,
  horseBreedingSuffix: i % 3 === 0 ? "IRE" : null,
  jockeyName: `Invented Jockey ${i + 1}`,
  trainerName: `Invented Trainer ${i + 1}`,
  weightLb: 120 + i,
  officialRating: 80 + i,
  status: i === 5 ? "non_runner" : i === 7 ? "withdrawn" : "declared",
  startingPrice: `${(i + 2).toFixed(3)}`,
  withdrawnAtOdds: i === 7 ? "4.000" : null,
  finishPosition: i < 4 ? i + 1 : null,
  deadHeatCount: i === 2 ? 2 : 1,
  disqualified: i === 3,
}));

const racecard = {
  raceId: "race-1",
  name: "The Invented Handicap Stakes",
  offTime: new Date("2024-05-04T14:30:00.000Z"),
  status: "result",
  raceClass: "Class 3",
  raceType: "flat",
  distanceYards: 1760,
  ageBand: "4yo+",
  isHandicap: true,
  declaredRunners: RUNNER_COUNT,
  actualRunners: RUNNER_COUNT - 2,
  rule4Pence: 10,
  resultVersion: 1,
  trackName: "Invented Park",
  countryCode: "GB",
  going: "good",
  meetingDate: "2024-05-04",
  runners,
};

const meetings = [
  {
    meetingId: "meeting-1",
    date: "2024-05-04",
    trackName: "Invented Park",
    countryCode: "GB",
    going: "good",
    status: "completed",
    races: [
      {
        raceId: "race-1",
        name: "The Invented Handicap Stakes",
        offTime: new Date("2024-05-04T14:30:00.000Z"),
        isHandicap: true,
        declaredRunners: RUNNER_COUNT,
        actualRunners: RUNNER_COUNT - 2,
        status: "result",
      },
    ],
  },
];

const user = { id: "user-1", email: "someone@example.test" };

const calculation = {
  version: 1,
  betType: "EACH_WAY",
  oddsTaken: 9,
  totalStakeMinor: "2000",
  race: { status: "RESULT", actualRunners: 22, isHandicap: true },
  runner: {
    status: "DECLARED",
    finishPosition: 3,
    deadHeatCount: 2,
    disqualified: false,
  },
  rulesApplied: [
    "place terms: 22 actual runners, handicap -> 4 places at 1/5 (docs/05 §4)",
    "dead heat: 2 tied for 1 remaining place -> stake reduced by 1/2",
    "Rule 4: 10p in the pound, applied to winnings on BOTH parts (docs/08 D16)",
    "rounded once, half-up, ties in the user's favour",
  ],
  placeTermsReducedByFieldSize: {
    declaredWouldHavePaid: 5,
    actualPays: 4,
    note: "two horses were withdrawn, taking the field below the 5-place band",
  },
  rule4: {
    applied: true,
    totalPence: 10,
    cappedAt90: false,
    source: "band-table",
    bands: [
      {
        price: "4/1",
        deduction: 10,
        sourceCount: 6,
        computedCount: 2,
        evidenceConfidence: "computed-confirmed",
      },
      {
        price: "11/10",
        deduction: 45,
        sourceCount: 5,
        computedCount: 0,
        evidenceConfidence: "consensus-only",
        disputed: "one source publishes 100/30 for this row",
      },
    ],
    weakestConfidence: "consensus-only",
  },
  parts: [
    {
      part: "WIN",
      stakeMinor: "1000",
      // A LOSING part that still carries the race's dead-heat count — exactly
      // the shape settle() emits, and the case the rendering got wrong.
      deadHeatTied: 2,
      deadHeatPositionsAvailable: 0,
      effectiveStake: { num: "1000", den: "1" },
      grossWinnings: { num: "0", den: "1" },
      rule4Pence: 10,
      netWinnings: { num: "0", den: "1" },
      partReturn: { num: "0", den: "1" },
      partReturnMinor: "0",
      outcome: "lost",
    },
    {
      part: "PLACE",
      stakeMinor: "1000",
      placesPaid: 4,
      placeFractionDen: 5,
      placeTermsSource: "standard",
      deadHeatTied: 2,
      deadHeatPositionsAvailable: 1,
      effectiveStake: { num: "1000", den: "2" },
      grossWinnings: { num: "5625", den: "2" },
      rule4Pence: 10,
      netWinnings: { num: "10125", den: "4" },
      partReturn: { num: "12125", den: "4" },
      partReturnMinor: "3031",
      outcome: "won",
    },
  ],
  rounding: {
    exactNumerator: "12125",
    exactDenominator: "4",
    mode: "half-up, ties in the user's favour",
    roundedMinor: "3031",
  },
  returnMinor: "3031",
};

const settlement = {
  id: "settlement-1",
  betId: "bet-1",
  raceId: "race-1",
  resultVersion: 1,
  outcome: "PARTIAL",
  returnMinor: 3031n,
  calculation,
  payloadHash: "a".repeat(64),
  isReversal: false,
  createdAt: new Date("2024-05-04T15:00:00.000Z"),
};

const bet = {
  betId: "bet-1",
  userId: "user-1",
  walletId: "wallet-1",
  betType: "EACH_WAY" as const,
  unitStakeMinor: 1000n,
  totalStakeMinor: 2000n,
  status: "partial",
  settledVersion: 1,
  returnMinor: 3031n,
  legId: "leg-1",
  runnerId: "runner-3",
  oddsTaken: 9,
};

const runnerLabel = {
  runnerId: "runner-3",
  horseName: "Invented Horse 3",
  clothNumber: 3,
  raceId: "race-1",
  raceName: "The Invented Handicap Stakes",
  offTime: new Date("2024-05-04T14:30:00.000Z"),
  trackName: "Invented Park",
  meetingDate: "2024-05-04",
  finishPosition: 3,
  startingPrice: "9.000",
};

vi.mock("@/lib/session", () => ({
  getCurrentUser: () => Promise.resolve(user),
  requireUser: () => Promise.resolve(user),
}));

vi.mock("@/lib/demo", () => ({ isDemoData: () => Promise.resolve(true) }));

vi.mock("@/modules/catalog", () => ({
  getRacecard: () => Promise.resolve(racecard),
  listMeetings: () => Promise.resolve(meetings),
  getRunnerLabels: () => Promise.resolve(new Map([["runner-3", runnerLabel]])),
}));

vi.mock("@/modules/betting", () => ({
  getBetForUser: () => Promise.resolve(bet),
  listBetsWithLegsForUser: () => Promise.resolve([bet]),
}));

vi.mock("@/modules/settlement", () => ({
  getSettlementHistory: () => Promise.resolve([settlement]),
  getCurrentSettlements: () => Promise.resolve(new Map([["bet-1", settlement]])),
}));

vi.mock("@/modules/analytics", () => ({
  MIN_SAMPLE_FOR_RATIO: 30,
  getPerformanceSummary: () =>
    Promise.resolve({
      settledBets: 4,
      openBets: 1,
      stakedMinor: 8000n,
      returnedMinor: 5220n,
      profitMinor: -2780n,
      roi: { value: -0.3475, sampleSize: 4, meaningful: false },
      strikeRate: { value: 0.25, sampleSize: 4, meaningful: false },
      averageOddsTaken: 6.25,
      wins: 1,
      places: 0,
      losses: 3,
      voids: 0,
      needsReview: 1,
      balanceMinor: 9_997_220n,
    }),
  getEquityCurve: () =>
    Promise.resolve([
      {
        at: new Date("2024-05-04T12:00:00.000Z"),
        balanceMinor: 10_000_000n,
        deltaMinor: 10_000_000n,
        entryType: "OPENING_BALANCE",
        betId: null,
      },
      {
        at: new Date("2024-05-04T14:00:00.000Z"),
        balanceMinor: 9_998_000n,
        deltaMinor: -2000n,
        entryType: "STAKE",
        betId: "bet-1",
      },
      {
        at: new Date("2024-05-04T15:00:00.000Z"),
        balanceMinor: 9_999_220n,
        deltaMinor: 1220n,
        entryType: "RETURN",
        betId: "bet-1",
      },
    ]),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  redirect: () => {
    throw new Error("redirect");
  },
}));

/**
 * Wraps a page's markup in the real document shell.
 *
 * axe checks things that only exist at document level — landmark uniqueness,
 * heading order across the header and main, colour contrast against the real
 * background — so scanning a fragment would miss exactly the rules the shell
 * is responsible for.
 */
async function scan(pageMarkup: string): Promise<axe.AxeResults> {
  const css = await import("node:fs").then((fs) =>
    fs.readFileSync("src/app/globals.css", "utf8"),
  );

  document.documentElement.lang = "en-GB";
  document.head.innerHTML = `<title>PaperHorse</title><style>${css}</style>`;
  document.body.innerHTML = `
    <a class="skip-link" href="#main">Skip to main content</a>
    <p class="demo-banner" role="status">DEMO DATA — invented horses.</p>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="site-header__brand" href="/">PaperHorse</a>
        <nav class="site-nav" aria-label="Main">
          <a href="/">Meetings</a>
          <a href="/bets">My bets</a>
          <a href="/analytics">Analytics</a>
          <a href="/login">Sign in</a>
        </nav>
      </div>
    </header>
    ${pageMarkup}
  `;

  return axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
  });
}

/** React's escaping, so an assertion compares like with like. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function describeViolations(results: axe.AxeResults): string {
  return results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n` +
        v.nodes.map((n) => `    ${n.html.slice(0, 160)}`).join("\n"),
    )
    .join("\n\n");
}

describe("WCAG 2.2 AA — axe-core over the real pages", () => {
  beforeAll(() => {
    expect(typeof axe.run).toBe("function");
  });

  /**
   * WHAT THIS SUITE CANNOT CHECK, stated rather than left implicit.
   *
   * jsdom has no layout engine, so axe cannot resolve what is painted over
   * what and reports `color-contrast` as INCOMPLETE — not as a pass. Treating
   * an incomplete result as a green tick is exactly the sort of check that
   * checks nothing, so contrast is verified separately and arithmetically in
   * `contrast.test.ts`, which computes the WCAG relative-luminance ratio for
   * every pair the stylesheet actually paints.
   *
   * This test pins the limitation: if a future axe or jsdom leaves something
   * ELSE unevaluated, it fails and says so rather than quietly shrinking the
   * coverage of everything above.
   */
  it("leaves only colour-contrast unevaluated, and nothing else", async () => {
    const { default: Page } = await import("@/app/races/[raceId]/page");
    const element = await Page({ params: Promise.resolve({ raceId: "race-1" }) });
    const results = await scan(renderToStaticMarkup(element));

    expect(results.incomplete.map((i) => i.id).sort()).toEqual(["color-contrast"]);
    // And a real number of rules did run, so "no violations" means something.
    expect(results.passes.length).toBeGreaterThan(10);
  });

  it(`racecard with a ${RUNNER_COUNT}-runner field is clean`, async () => {
    const { default: Page } = await import("@/app/races/[raceId]/page");
    const element = await Page({ params: Promise.resolve({ raceId: "race-1" }) });
    const results = await scan(renderToStaticMarkup(element));

    expect(describeViolations(results)).toBe("");
    // Non-vacuous: axe actually ran over a populated document.
    expect(results.passes.length).toBeGreaterThan(0);
    expect(document.querySelectorAll("tbody tr")).toHaveLength(RUNNER_COUNT);
  });

  it("meeting list is clean", async () => {
    const { default: Page } = await import("@/app/page");
    const results = await scan(renderToStaticMarkup(await Page()));

    expect(describeViolations(results)).toBe("");
    expect(results.passes.length).toBeGreaterThan(0);
  });

  it("bet history is clean", async () => {
    const { default: Page } = await import("@/app/bets/page");
    const results = await scan(renderToStaticMarkup(await Page()));

    expect(describeViolations(results)).toBe("");
    expect(results.passes.length).toBeGreaterThan(0);
  });

  it("settlement detail is clean", async () => {
    const { default: Page } = await import("@/app/bets/[betId]/page");
    const element = await Page({ params: Promise.resolve({ betId: "bet-1" }) });
    const results = await scan(renderToStaticMarkup(element));

    expect(describeViolations(results)).toBe("");
    expect(results.passes.length).toBeGreaterThan(0);
  });

  it("analytics is clean", async () => {
    const { default: Page } = await import("@/app/analytics/page");
    const results = await scan(renderToStaticMarkup(await Page()));

    expect(describeViolations(results)).toBe("");
    expect(results.passes.length).toBeGreaterThan(0);
  });
});

describe("settlement detail renders the STORED derivation", () => {
  it("shows every intermediate without recomputing any of it", async () => {
    const { default: Page } = await import("@/app/bets/[betId]/page");
    const element = await Page({ params: Promise.resolve({ betId: "bet-1" }) });
    const html = renderToStaticMarkup(element);

    // Place terms, in full.
    expect(html).toContain("4 places paid at 1/5");
    // The dead-heat divisor, stated as a divisor and not just as a number.
    expect(html).toContain("2 horses tied");
    // Rule 4 with its evidence confidence spelled out (docs/08 D21).
    expect(html).toContain("10p in the pound");
    expect(html).toContain("not independently confirmed by calculation");
    expect(html).toContain("consensus alone");
    // The disputed band is surfaced, not hidden.
    expect(html).toContain("100/30");
    // Every exact rational, as stored.
    expect(html).toContain("1000 / 2");
    expect(html).toContain("10125 / 4");
    // The single rounding step.
    expect(html).toContain("half-up, ties in the user&#x27;s favour");
    // Reduced place terms explained in plain English, not as a code.
    expect(html).toContain("place terms are set by the runners that");
    expect(html).toContain("Non-runners shrink the field");
    // Every rule that fired, in order.
    for (const rule of calculation.rulesApplied) {
      expect(html).toContain(escapeHtml(rule));
    }
    // In order, not merely all present: the order is the docs/05 rule order and
    // showing them shuffled would misrepresent how the answer was reached.
    const positions = calculation.rulesApplied.map((r) => html.indexOf(escapeHtml(r)));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("states that nothing on the page was recalculated", async () => {
    const { default: Page } = await import("@/app/bets/[betId]/page");
    const element = await Page({ params: Promise.resolve({ betId: "bet-1" }) });
    const html = renderToStaticMarkup(element);
    expect(html).toContain("Nothing on this page is recalculated");
  });
});

describe("settlement detail defects found by running it, not by reading it", () => {
  async function html(): Promise<string> {
    const { default: Page } = await import("@/app/bets/[betId]/page");
    return renderToStaticMarkup(
      await Page({ params: Promise.resolve({ betId: "bet-1" }) }),
    );
  }

  it("does NOT explain a dead heat on a part that lost outright", async () => {
    // The fixture's WIN part lost and carries deadHeatTied: 1; the PLACE part
    // won with a 2-way tie. Rendering the divisor on a losing part read as
    // "the dead heat cost you the win part" when finishing out of the places
    // is what lost it.
    const markup = await html();
    const winSection = markup.slice(
      markup.indexOf("Win part"),
      markup.indexOf("Place part"),
    );
    expect(winSection).not.toContain("horses tied");
    // And it IS shown where it belongs, so this is not passing by rendering
    // nothing at all.
    expect(markup.slice(markup.indexOf("Place part"))).toContain("horses tied");
  });

  it("shows part approximations that ADD UP to the stated total", async () => {
    // 28.125 truncated to £28.12 made the parts visibly fail to sum to the
    // total, on the one screen whose entire job is to justify that total.
    const markup = await html();
    expect(markup).toContain("£28.13");
    expect(markup).not.toContain("£28.12");
  });

  it("describes rounding as PER PART, matching what settle() does", async () => {
    // docs/05 §3.3: an each-way bet is two bets, each rounded in its own
    // right. The page previously claimed one rounding for the whole bet,
    // contradicting the engine's own rulesApplied entry directly above it.
    const markup = await html();
    expect(markup).toContain("Rounding happens once per part");
    expect(markup).toContain("two separate bets");
    expect(markup).not.toContain("rounding happens exactly once");
  });
});
