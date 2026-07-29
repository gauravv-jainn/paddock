import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Loader for tests/golden/published.json.
 *
 * `tests/golden/README.md` permits writing the loader and the harness. It does
 * not permit inventing a race or an expected return, and this file does
 * neither: it reads, validates shape, and converts money strings to bigint.
 * Every `expectedReturnMinor` came from a published third-party example.
 *
 * The one thing it decides is D15: a vector marked `expectedDisputed` is kept
 * and reported, but never handed to the pass/fail gate.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

export type BetType = "WIN" | "PLACE" | "EACH_WAY";
export type ExpectedStatus = "WON" | "LOST" | "PARTIAL" | "VOID";

/** Integer pair. The sole input to the Rule 4 band lookup — docs/08 D14. */
export interface Fraction {
  num: number;
  den: number;
}

export interface PublishedVector {
  id: string;
  source: string;
  sourceFile: string;
  sourceQuote: string;
  note?: string;
  race: {
    rule4Pence?: number;
    /** docs/08 D14. Absent when the source states no withdrawn price. */
    withdrawnAtFraction?: Fraction | Fraction[];
    /** Display only. Never an input to the lookup. */
    withdrawnAtOdds?: number | number[];
    actualRunners?: number;
    isHandicap?: boolean;
    status: string;
  };
  statedTerms?: { placesPaid: number; placeFraction: string };
  bet: {
    type: BetType;
    stakeMinor?: string;
    unitStakeMinor?: string;
    totalStakeMinor?: string;
    oddsStated: string;
    oddsTaken: number;
  };
  outcome: { finishPosition: number; deadHeatCount: number };
  expectedReturnMinor: string;
  expectedStatus: ExpectedStatus;
  /** docs/08 D15 — the SOURCE's figure is doubted, not ours. */
  expectedDisputed?: boolean;
  expectedDisputedReason?: string;
}

/** Money reaches callers as bigint. It never passes through a number. */
export interface LoadedVector extends PublishedVector {
  expectedReturn: bigint;
  stake: bigint;
}

export interface PublishedSuite {
  /** Vectors the engine is graded on. Disputed ones are NOT here. */
  graded: LoadedVector[];
  /** Kept and reported, excluded from pass/fail (docs/08 D15). */
  disputed: LoadedVector[];
  /** graded + disputed. */
  all: LoadedVector[];
}

class FixtureError extends Error {
  constructor(id: string, detail: string) {
    super(`published.json vector '${id}': ${detail}`);
    this.name = "FixtureError";
  }
}

/** Digit string to bigint. Rejects anything a float could have touched. */
function money(id: string, field: string, raw: unknown): bigint {
  if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) {
    throw new FixtureError(
      id,
      `${field} must be a digit string in pence, got ${JSON.stringify(raw)}`,
    );
  }
  return BigInt(raw);
}

function assertFraction(id: string, f: Fraction): void {
  if (!Number.isInteger(f.num) || !Number.isInteger(f.den)) {
    throw new FixtureError(id, "withdrawnAtFraction must be integers (docs/08 D14)");
  }
  if (f.num <= 0 || f.den <= 0) {
    throw new FixtureError(id, "withdrawnAtFraction must be positive");
  }
}

export function loadPublishedVectors(
  file = path.join(HERE, "published.json"),
): PublishedSuite {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    vectors: PublishedVector[];
  };

  if (!Array.isArray(parsed.vectors) || parsed.vectors.length === 0) {
    throw new Error("published.json has no vectors");
  }

  const seen = new Set<string>();
  const all: LoadedVector[] = parsed.vectors.map((v) => {
    if (seen.has(v.id)) throw new FixtureError(v.id, "duplicate id");
    seen.add(v.id);

    if (!v.sourceQuote) {
      throw new FixtureError(
        v.id,
        "no sourceQuote — an expected value with no published quote behind it " +
          "cannot grade anything",
      );
    }

    // EACH_WAY stakes twice the unit (docs/04 §6); everything else stakes once.
    const stakeField = v.bet.type === "EACH_WAY" ? "totalStakeMinor" : "stakeMinor";
    const rawStake = v.bet[stakeField as keyof typeof v.bet];
    const stake = money(v.id, stakeField, rawStake);

    if (v.bet.type === "EACH_WAY") {
      const unit = money(v.id, "unitStakeMinor", v.bet.unitStakeMinor);
      if (unit * 2n !== stake) {
        throw new FixtureError(
          v.id,
          `EACH_WAY total must be twice the unit: ${unit} * 2 !== ${stake}`,
        );
      }
    }

    const fr = v.race.withdrawnAtFraction;
    if (fr) {
      for (const one of Array.isArray(fr) ? fr : [fr]) assertFraction(v.id, one);
    }

    if (v.expectedDisputed && !v.expectedDisputedReason) {
      throw new FixtureError(
        v.id,
        "expectedDisputed without expectedDisputedReason — a fixture excluded " +
          "from the gate must say why",
      );
    }

    return {
      ...v,
      stake,
      expectedReturn: money(v.id, "expectedReturnMinor", v.expectedReturnMinor),
    };
  });

  return {
    all,
    graded: all.filter((v) => !v.expectedDisputed),
    disputed: all.filter((v) => v.expectedDisputed === true),
  };
}

/**
 * Which vectors could not be settled under D14 — the source names a withdrawn
 * price only as a decimal that is not an exact ladder match, so the fractional
 * lookup input is unavailable and the engine must refuse rather than guess.
 *
 * A Rule 4 vector that carries `rule4Pence` but no withdrawn price is NOT
 * unsettleable: the deduction is given outright, so the band lookup never runs.
 */
export function unsettleableUnderD14(suite: PublishedSuite): LoadedVector[] {
  return suite.all.filter(
    (v) =>
      v.race.withdrawnAtOdds !== undefined &&
      v.race.withdrawnAtFraction === undefined,
  );
}
