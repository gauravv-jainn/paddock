import { formatFraction } from "./rules/fraction";
import { lookupPlaceTerms } from "./rules/placeTerms";
import { lookupRule4Band, type EvidenceConfidence } from "./rules/rule4";
import type {
  BetStatus,
  Calculation,
  PartCalculation,
  Rational,
  ReviewReason,
  Rule4Calculation,
  SettlementBet,
  SettlementOutcome,
  SettlementRace,
  SettlementRunner,
} from "./types";

/**
 * settle() — the product.
 *
 * PURE. No I/O, no database, no clock, no randomness, no environment. Given
 * the same three values it returns the same answer forever, which is what
 * makes replay from a persisted payload meaningful.
 *
 * ORDER OF OPERATIONS is `.claude/rules/money.md`, and it is load-bearing:
 *
 *   1. non-runner            -> VOID, full refund, stop
 *   2. disqualified          -> LOST, stop
 *   3. place terms from actual_runners + is_handicap, never a cached value
 *   4. outcome vs places paid
 *   5. dead-heat divisor
 *   6. Rule 4, on WINNINGS ONLY, and AFTER the divisor
 *   7. round ONCE, at the very end
 *
 * Every intermediate is an exact bigint rational so step 7 is the only
 * rounding that happens anywhere. Rounding after the place fraction — the
 * obvious shortcut — compounds error across the two each-way parts.
 *
 * REFUSALS ARE RETURN VALUES. docs/08 D14 and D17 produce a NEEDS_REVIEW
 * outcome, never an exception: a pure function that throws for a business
 * outcome is I/O-shaped and cannot be replayed. Throwing is reserved for
 * programmer error.
 */

/** Odds are decimal and are multipliers only; scale them to integers once. */
const ODDS_SCALE = 1_000_000n;
const PENCE_PER_POUND = 100n;

const rational = (num: bigint, den: bigint): Rational => ({ num, den });
const ZERO: Rational = { num: 0n, den: 1n };

function addRationals(a: Rational, b: Rational): Rational {
  return { num: a.num * b.den + b.num * a.den, den: a.den * b.den };
}

/** Half-up, ties in the user's favour. Returns are non-negative. */
function roundHalfUp(r: Rational): bigint {
  if (r.den <= 0n) {
    throw new Error(`non-positive denominator ${r.den}`);
  }
  const q = r.num / r.den;
  const rem = r.num % r.den;
  return rem * 2n >= r.den ? q + 1n : q;
}

function assertProgrammerInputs(bet: SettlementBet): void {
  if (bet.unitStakeMinor <= 0n || bet.totalStakeMinor <= 0n) {
    throw new RangeError(`stake must be positive, got ${bet.totalStakeMinor}`);
  }
  if (!Number.isFinite(bet.oddsTaken) || bet.oddsTaken <= 1) {
    throw new RangeError(`oddsTaken must exceed 1, got ${bet.oddsTaken}`);
  }
  if (bet.type === "EACH_WAY" && bet.totalStakeMinor !== bet.unitStakeMinor * 2n) {
    throw new RangeError("EACH_WAY total stake must be twice the unit stake");
  }
  if (bet.type !== "EACH_WAY" && bet.totalStakeMinor !== bet.unitStakeMinor) {
    throw new RangeError("WIN/PLACE total stake must equal the unit stake");
  }
}

/**
 * Step 6's multiplier, resolved from the race — docs/08 D14 and D17.
 *
 * An announced deduction is authoritative. Otherwise every WITHDRAWN runner
 * must carry a fractional price; one that does not makes the race
 * unsettleable, and that is reported rather than guessed.
 */
function resolveRule4(
  race: SettlementRace,
):
  | { ok: true; calc: Rule4Calculation }
  | { ok: false; reason: ReviewReason; detail: string } {
  const withdrawn = race.withdrawals.filter((w) => w.runnerStatus === "withdrawn");

  if (race.announcedRule4Pence !== null) {
    const pence = race.announcedRule4Pence;
    if (!Number.isInteger(pence) || pence < 0 || pence > 90) {
      throw new RangeError(`announced Rule 4 must be 0-90 pence, got ${pence}`);
    }
    return {
      ok: true,
      calc: {
        applied: pence > 0,
        totalPence: pence,
        cappedAt90: false,
        source: pence > 0 ? "announced" : "none",
        bands: [],
        weakestConfidence: null,
      },
    };
  }

  if (withdrawn.length === 0) {
    return {
      ok: true,
      calc: {
        applied: false,
        totalPence: 0,
        cappedAt90: false,
        source: "none",
        bands: [],
        weakestConfidence: null,
      },
    };
  }

  const bands: Rule4Calculation["bands"] = [];
  let total = 0;
  for (const w of withdrawn) {
    if (w.fraction === null) {
      // D17: a withdrawn runner with neither a price nor an announced
      // deduction. A null fraction does NOT mean "no deduction".
      return {
        ok: false,
        reason: "AMBIGUOUS_WITHDRAWAL",
        detail:
          "a withdrawn runner carries no fractional price — its deduction " +
          "cannot be looked up, and assuming zero would pay out in full on a " +
          "race that owed a deduction",
      };
    }
    const found = lookupRule4Band(w.fraction);
    if (!found.ok) {
      // D14: the price is a real fraction but sits between two published
      // bands, so no row of the table covers it.
      return { ok: false, reason: "RULE4_PRICE_NOT_ON_LADDER", detail: found.reason };
    }
    const band = found.band;
    total += band.deduction;
    bands.push({
      price: formatFraction(w.fraction),
      deduction: band.deduction,
      sourceCount: band.sourceCount,
      computedCount: band.computedCount,
      evidenceConfidence: band.evidenceConfidence,
      ...(band.disputed === undefined
        ? {}
        : { disputed: band.disputed.competing.join(" / ") }),
    });
  }

  // docs/05 §5.2 rule 2: multiple withdrawals accumulate, capped at 90p.
  const capped = total > 90;
  const totalPence = capped ? 90 : total;

  const weakest: EvidenceConfidence | null = bands.some(
    (b) => b.evidenceConfidence === "consensus-only",
  )
    ? "consensus-only"
    : bands.length > 0
      ? "computed-confirmed"
      : null;

  return {
    ok: true,
    calc: {
      applied: totalPence > 0,
      totalPence,
      cappedAt90: capped,
      source: "band-table",
      bands,
      weakestConfidence: weakest,
    },
  };
}

/** docs/05 §6.1. Floored at 0 so a position beyond the paid places yields 0. */
function positionsAvailable(placesPaid: number, position: number): number {
  return Math.max(placesPaid - (position - 1), 0);
}

/**
 * The share of the stake that wins, as a fraction of `tied`.
 *
 * docs/05 §6.1 gives `divisor = horsesTied / max(positionsAvailable, 1)`, and
 * applying that literally is wrong whenever positionsAvailable EXCEEDS
 * horsesTied: one horse finishing 2nd of three paid places gives a divisor of
 * 1/2, and `stake / divisor` then DOUBLES the stake.
 *
 * §6's own first line says "the stake is proportionally reduced" — reduced,
 * never increased — and every worked example in §6.1 has
 * positionsAvailable <= horsesTied, which is the case the formula was written
 * for. Clamping restores that intent and is identical to §6.1 wherever §6.1
 * is meaningful:
 *
 *   clean win        tied 1, available 1  -> 1/1
 *   3-way for 1st    tied 3, available 1  -> 1/3   (§6.1 agrees)
 *   3 tie for 3rd/3  tied 3, available 1  -> 1/3   (§6.1 agrees)
 *   2 tie for 2nd/3  tied 2, available 2  -> 2/2   both are inside the places
 *   clean 2nd of 3   tied 1, available 2  -> 1/1   §6.1 would say 2/1
 */
function winningShare(available: number, tied: number): number {
  return Math.min(available, tied);
}

/**
 * One part of a bet, as an exact rational.
 *
 *   effectiveStake = stake x positionsAvailable / tied     (step 5)
 *   grossWinnings  = effectiveStake x (odds - 1) / fracDen (steps 4, 3)
 *   netWinnings    = grossWinnings x (100 - r4) / 100      (step 6)
 *   partReturn     = effectiveStake + netWinnings
 *
 * Combined into a single fraction so nothing is rounded here. Rule 4 touches
 * netWinnings alone — the stake comes back whole (docs/05 §5.2 rule 1).
 */
function settlePart(
  stake: bigint,
  oddsScaled: bigint,
  fracDen: bigint,
  tied: number,
  available: number,
  rule4Pence: number,
): Rational {
  const P = BigInt(winningShare(available, tied));
  const T = BigInt(tied);
  const R = BigInt(100 - rule4Pence);
  const oddsMinusOne = oddsScaled - ODDS_SCALE;

  // partReturn = S*P * (SCALE*100*D + (odds-1)*R) / (T * SCALE * 100 * D)
  const den = T * ODDS_SCALE * PENCE_PER_POUND * fracDen;
  const num = stake * P * (ODDS_SCALE * PENCE_PER_POUND * fracDen + oddsMinusOne * R);
  return rational(num, den);
}

function emptyCalculation(
  bet: SettlementBet,
  race: SettlementRace,
  runner: SettlementRunner,
  rule4: Rule4Calculation,
): Calculation {
  return {
    version: 1,
    betType: bet.type,
    oddsTaken: bet.oddsTaken,
    totalStakeMinor: bet.totalStakeMinor.toString(),
    race: {
      status: race.status,
      actualRunners: race.actualRunners,
      isHandicap: race.isHandicap,
    },
    runner: {
      status: runner.status,
      finishPosition: runner.finishPosition,
      deadHeatCount: runner.deadHeatCount,
      disqualified: runner.disqualified,
    },
    rulesApplied: [],
    rule4,
    parts: [],
    rounding: {
      exactNumerator: "0",
      exactDenominator: "1",
      mode: "half-up, ties in the user's favour",
      roundedMinor: "0",
    },
    returnMinor: "0",
  };
}

const NO_RULE4: Rule4Calculation = {
  applied: false,
  totalPence: 0,
  cappedAt90: false,
  source: "none",
  bands: [],
  weakestConfidence: null,
};

function finish(
  calc: Calculation,
  status: BetStatus,
  exact: Rational,
  rounded: bigint,
): SettlementOutcome {
  calc.rounding = {
    exactNumerator: exact.num.toString(),
    exactDenominator: exact.den.toString(),
    mode: "half-up, ties in the user's favour",
    roundedMinor: rounded.toString(),
  };
  calc.returnMinor = rounded.toString();
  return { kind: "SETTLED", status, returnMinor: rounded, calculation: calc };
}

export function settle(
  bet: SettlementBet,
  race: SettlementRace,
  runner: SettlementRunner,
): SettlementOutcome {
  assertProgrammerInputs(bet);

  const rule4Resolved = resolveRule4(race);
  const rule4 = rule4Resolved.ok ? rule4Resolved.calc : NO_RULE4;
  const calc = emptyCalculation(bet, race, runner, rule4);

  // ── Step 1. Non-runner, or a race that did not happen. VOID, refund whole.
  if (
    runner.status === "NON_RUNNER" ||
    runner.status === "RESERVE" ||
    race.status === "VOID" ||
    race.status === "ABANDONED" ||
    race.status === "POSTPONED"
  ) {
    calc.rulesApplied.push(
      runner.status === "NON_RUNNER" || runner.status === "RESERVE"
        ? `runner.status=${runner.status} -> VOID, full refund (money.md step 1)`
        : `race.status=${race.status} -> VOID, full refund (docs/05 §7)`,
    );
    return finish(calc, "VOID", rational(bet.totalStakeMinor, 1n), bet.totalStakeMinor);
  }

  // A Rule 4 refusal is only fatal once we are actually paying out. A void
  // above refunds regardless, so the check sits here.
  if (!rule4Resolved.ok) {
    calc.rulesApplied.push(
      "REFUSED: Rule 4 could not be resolved (docs/08 D14, D17)",
    );
    return {
      kind: "NEEDS_REVIEW",
      // The two causes are NOT the same question for whoever reviews this. D17
      // is "the feed did not say what the deduction was"; D14 is "the feed gave
      // a price the published table does not cover". Collapsing them into one
      // code, as this did, made AMBIGUOUS_WITHDRAWAL unreachable and left the
      // review queue matching prose to tell them apart.
      reason: rule4Resolved.reason,
      detail: rule4Resolved.detail,
      calculation: calc,
    };
  }

  // ── Step 2. Disqualification.
  if (runner.disqualified) {
    calc.rulesApplied.push("runner.disqualified -> LOST (money.md step 2)");
    return finish(calc, "LOST", ZERO, 0n);
  }

  const oddsScaled = BigInt(Math.round(bet.oddsTaken * Number(ODDS_SCALE)));
  const wantsWin = bet.type === "WIN" || bet.type === "EACH_WAY";
  const wantsPlace = bet.type === "PLACE" || bet.type === "EACH_WAY";

  // ── Step 3. Place terms, from actual_runners. NEVER a value cached at
  //    placement time (docs/05 §4.1).
  let placesPaid = 0;
  let fracDen = 1n;
  let termsSource: "standard" | "enhanced" = "standard";
  let termsDisputed: string | undefined;

  if (wantsPlace) {
    if (race.actualRunners === null) {
      calc.rulesApplied.push(
        "REFUSED: actual_runners is null, so no place-terms row can be selected",
      );
      return {
        kind: "NEEDS_REVIEW",
        reason: "MISSING_ACTUAL_RUNNERS",
        detail:
          "place terms are a function of the runners that actually started; " +
          "settling without it would guess how many places were paid",
        calculation: calc,
      };
    }
    const enhanced =
      race.enhancedPlaces != null && race.enhancedFractionDen != null
        ? { places: race.enhancedPlaces, fractionDen: race.enhancedFractionDen }
        : null;
    const terms = lookupPlaceTerms(race.actualRunners, race.isHandicap, enhanced);
    placesPaid = terms.places;
    fracDen = BigInt(terms.fractionDen === 0 ? 1 : terms.fractionDen);
    termsSource = terms.source;
    termsDisputed = terms.disputed?.competing;
    calc.rulesApplied.push(
      `place terms: ${race.actualRunners} runners, ` +
        `${race.isHandicap ? "handicap" : "non-handicap"} -> ` +
        `${placesPaid} place(s) at 1/${terms.fractionDen} (${terms.source})`,
    );
  }

  const parts: PartCalculation[] = [];
  let exactTotal: Rational = ZERO;
  let roundedTotal = 0n;
  const position = runner.finishPosition;
  const tied = Math.max(runner.deadHeatCount, 1);

  // ── Step 4-7 for the WIN part.
  if (wantsWin) {
    const won = position === 1;
    const available = won ? positionsAvailable(1, 1) : 0;
    const part: PartCalculation = {
      part: "WIN",
      stakeMinor: bet.unitStakeMinor,
      deadHeatTied: tied,
      deadHeatPositionsAvailable: available,
      effectiveStake: won
        ? rational(
            bet.unitStakeMinor * BigInt(winningShare(available, tied)),
            BigInt(tied),
          )
        : ZERO,
      grossWinnings: ZERO,
      rule4Pence: rule4.totalPence,
      netWinnings: ZERO,
      partReturn: ZERO,
      partReturnMinor: "0",
      outcome: won ? "won" : "lost",
    };
    if (won) {
      const gross = settlePart(
        bet.unitStakeMinor,
        oddsScaled,
        1n,
        tied,
        available,
        0,
      );
      const net = settlePart(
        bet.unitStakeMinor,
        oddsScaled,
        1n,
        tied,
        available,
        rule4.totalPence,
      );
      part.grossWinnings = addRationals(gross, {
        num: -part.effectiveStake.num,
        den: part.effectiveStake.den,
      });
      part.netWinnings = addRationals(net, {
        num: -part.effectiveStake.num,
        den: part.effectiveStake.den,
      });
      part.partReturn = net;
      calc.rulesApplied.push(
        tied > 1
          ? `WIN: 1st, ${tied}-way dead heat -> stake x ${available}/${tied} (money.md step 5)`
          : "WIN: 1st, no dead heat",
      );
    } else {
      calc.rulesApplied.push(
        `WIN: finished ${position === null ? "unplaced/DNF" : `${position}`} -> lost`,
      );
    }
    parts.push(part);
  }

  // ── Step 4-7 for the PLACE part. docs/08 D16: the same Rule 4 rate applies
  //    here, to this part's own winnings, after the place fraction.
  if (wantsPlace) {
    const placed =
      placesPaid > 0 && position !== null && position <= placesPaid;
    const available = placed ? positionsAvailable(placesPaid, position) : 0;
    const part: PartCalculation = {
      part: "PLACE",
      stakeMinor: bet.unitStakeMinor,
      placesPaid,
      placeFractionDen: Number(fracDen),
      placeTermsSource: termsSource,
      ...(termsDisputed === undefined ? {} : { placeTermsDisputed: termsDisputed }),
      deadHeatTied: tied,
      deadHeatPositionsAvailable: available,
      effectiveStake: placed
        ? rational(
            bet.unitStakeMinor * BigInt(winningShare(available, tied)),
            BigInt(tied),
          )
        : ZERO,
      grossWinnings: ZERO,
      rule4Pence: rule4.totalPence,
      netWinnings: ZERO,
      partReturn: ZERO,
      partReturnMinor: "0",
      outcome: placesPaid === 0 ? "void" : placed ? "won" : "lost",
    };

    if (placesPaid === 0) {
      // docs/05 §3.2: a field too small for place betting voids the place part.
      part.partReturn = rational(bet.unitStakeMinor, 1n);
      part.effectiveStake = part.partReturn;
      calc.rulesApplied.push(
        `PLACE: ${String(race.actualRunners)} runners pays no places -> VOID, stake refunded`,
      );
    } else if (placed) {
      const gross = settlePart(
        bet.unitStakeMinor,
        oddsScaled,
        fracDen,
        tied,
        available,
        0,
      );
      const net = settlePart(
        bet.unitStakeMinor,
        oddsScaled,
        fracDen,
        tied,
        available,
        rule4.totalPence,
      );
      part.grossWinnings = addRationals(gross, {
        num: -part.effectiveStake.num,
        den: part.effectiveStake.den,
      });
      part.netWinnings = addRationals(net, {
        num: -part.effectiveStake.num,
        den: part.effectiveStake.den,
      });
      part.partReturn = net;
      calc.rulesApplied.push(
        `PLACE: finished ${position} of ${placesPaid} paid -> won` +
          (tied > 1
            ? `, ${tied}-way dead heat with ${available} position(s) available ` +
              `-> stake x ${available}/${tied}`
            : ""),
      );
    } else {
      calc.rulesApplied.push(
        `PLACE: finished ${position === null ? "unplaced/DNF" : `${position}`} ` +
          `outside ${placesPaid} paid -> lost`,
      );
    }
    parts.push(part);
  }

  if (rule4.applied) {
    calc.rulesApplied.push(
      `Rule 4: ${rule4.totalPence}p in the £ on winnings only, after the ` +
        `dead-heat divisor (money.md step 6)` +
        (rule4.cappedAt90 ? " — capped at 90p" : "") +
        (rule4.weakestConfidence === "consensus-only"
          ? " — band is consensus-only (docs/08 D21)"
          : ""),
    );
  }

  // docs/05 §3.3: an each-way bet is TWO independent bets, and
  // "total_return = win_part.return + place_part.return". So each part rounds
  // once, at the end of its own computation, and the parts are then summed.
  // Rounding the sum instead would make the whole differ from the parts by a
  // penny, which the metamorphic property "each-way = win + place" catches.
  for (const part of parts) {
    const partRounded = roundHalfUp(part.partReturn);
    part.partReturnMinor = partRounded.toString();
    roundedTotal += partRounded;
    exactTotal = addRationals(exactTotal, part.partReturn);
  }

  calc.parts = parts;
  calc.rulesApplied.push(
    parts.length > 1
      ? "each part rounded once at the end of its own computation, then summed (money.md step 7, docs/05 §3.3)"
      : "rounded once, at the end (money.md step 7)",
  );

  const won = parts.filter((p) => p.outcome === "won");
  const voided = parts.filter((p) => p.outcome === "void");
  const status =
    won.length === parts.length
      ? "WON"
      : won.length === 0 && voided.length === parts.length
        ? "VOID"
        : won.length === 0 && voided.length === 0
          ? "LOST"
          : "PARTIAL";

  return finish(calc, status, exactTotal, roundedTotal);
}
