import { notFound, redirect } from "next/navigation";
import { formatOdds, formatPence } from "@/lib/money";
import { getCurrentUser } from "@/lib/session";
import { getBetForUser } from "@/modules/betting";
import { getRunnerLabels } from "@/modules/catalog";
import { getSettlementHistory } from "@/modules/settlement";
import type { Settlement } from "@/modules/settlement";

export const dynamic = "force-dynamic";

/**
 * Settlement detail — docs/04 §7, "the feature that ends disputes".
 *
 * EVERY number on this page is read out of `settlements.calculation`. Nothing
 * is recomputed, and nothing is derived from the bet row. If the stored
 * derivation and the payout ever disagreed, this screen would show it rather
 * than paper over it — which is the entire reason the calculation is stored.
 */

/* The shape settle() wrote, as it survives JSON. Exact rationals are strings
 * (S12): a JSON number would round any numerator past 2^53. */
interface StoredRational {
  num: string;
  den: string;
}

interface StoredPart {
  part: "WIN" | "PLACE";
  stakeMinor: string;
  placesPaid?: number;
  placeFractionDen?: number;
  placeTermsSource?: string;
  placeTermsDisputed?: string;
  deadHeatTied: number;
  deadHeatPositionsAvailable: number;
  effectiveStake: StoredRational;
  grossWinnings: StoredRational;
  rule4Pence: number;
  netWinnings: StoredRational;
  partReturn: StoredRational;
  partReturnMinor: string;
  outcome: string;
}

interface StoredCalculation {
  version: number;
  betType: string;
  oddsTaken: number;
  totalStakeMinor: string;
  race: { status: string; actualRunners: number | null; isHandicap: boolean };
  runner: {
    status: string;
    finishPosition: number | null;
    deadHeatCount: number;
    disqualified: boolean;
  };
  rulesApplied: string[];
  placeTermsReducedByFieldSize?: {
    declaredWouldHavePaid: number;
    actualPays: number;
    note: string;
  };
  rule4: {
    applied: boolean;
    totalPence: number;
    cappedAt90: boolean;
    source: string;
    bands: Array<{
      price: string;
      deduction: number;
      sourceCount: number;
      computedCount: number;
      evidenceConfidence: string;
      disputed?: string;
    }>;
    weakestConfidence: string | null;
  };
  parts: StoredPart[];
  rounding: {
    exactNumerator: string;
    exactDenominator: string;
    mode: string;
    roundedMinor: string;
  };
  returnMinor: string;
  review?: { reason: string; detail: string };
  /** Present only on a reversal row. */
  reversalOf?: string;
  reason?: string;
}

function rationalToText(r: StoredRational): string {
  return `${r.num} / ${r.den}`;
}

/**
 * An exact rational as pounds, for the reader. Never used to compute.
 *
 * Rounded half-up, not truncated. Truncating showed £28.12 for an exact
 * 28.125, so the parts on screen visibly failed to add up to the total — which
 * on the one screen whose job is to justify the total is worse than useless.
 */
function rationalAsApproxPounds(r: StoredRational): string {
  const num = BigInt(r.num);
  const den = BigInt(r.den);
  if (den === 0n) return "—";
  const pence = (2n * num + den) / (2n * den);
  return formatPence(pence);
}

function ordinal(n: number): string {
  // 11th, 12th and 13th are the exceptions that a bare `n % 10` gets wrong.
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[n % 10] ?? "th";
  return `${n}${suffix}`;
}

export default async function SettlementDetailPage({
  params,
}: {
  params: Promise<{ betId: string }>;
}) {
  const { betId } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const bet = await getBetForUser(betId, user.id);
  if (!bet) notFound();

  const [labels, history] = await Promise.all([
    getRunnerLabels([bet.runnerId]),
    getSettlementHistory(bet.betId),
  ]);
  const label = labels.get(bet.runnerId);
  const current = history.find((s) => !s.isReversal && s.resultVersion === bet.settledVersion);

  return (
    <main id="main">
      <p>
        <a href="/bets">← My bets</a>
      </p>

      <h1>Bet detail</h1>

      <div className="panel">
        <h2>The bet</h2>
        <dl className="derivation">
          <dt>Selection</dt>
          <dd>
            {label ? (
              <>
                {label.clothNumber}. {label.horseName} —{" "}
                <a href={`/races/${label.raceId}`}>{label.raceName}</a> at{" "}
                {label.trackName}, {label.meetingDate}
              </>
            ) : (
              "runner no longer in the catalogue"
            )}
          </dd>
          <dt>Bet type</dt>
          <dd>
            {bet.betType === "EACH_WAY" ? "Each-way — two equal bets" : bet.betType}
          </dd>
          <dt>Stake</dt>
          <dd>
            {formatPence(bet.unitStakeMinor)} per part · total{" "}
            {formatPence(bet.totalStakeMinor)}
          </dd>
          <dt>Price taken</dt>
          <dd>{formatOdds(bet.oddsTaken)} (frozen at placement)</dd>
          <dt>Status</dt>
          <dd>{bet.status}</dd>
          <dt>Returned</dt>
          <dd>{formatPence(bet.returnMinor)}</dd>
        </dl>
      </div>

      {history.length === 0 ? (
        <p className="notice">
          This bet has not been settled yet. The settlement worker settles a race
          once its result is published.
        </p>
      ) : null}

      {current ? <Derivation settlement={current} /> : null}

      {history.length > 1 ? (
        <>
          <h2>Settlement history</h2>
          <p>
            The stewards amended this race. Nothing was overwritten — the earlier
            settlement was reversed with compensating ledger entries and a new
            one written, so both states remain visible.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Result version</th>
                  <th scope="col">Outcome</th>
                  <th scope="col" className="right">
                    Return
                  </th>
                  <th scope="col">Kind</th>
                </tr>
              </thead>
              <tbody>
                {history.map((row) => (
                  <tr key={row.id}>
                    <td>{row.createdAt.toISOString()}</td>
                    <td>{row.resultVersion}</td>
                    <td>{row.outcome}</td>
                    <td className="right">{formatPence(row.returnMinor)}</td>
                    <td>{row.isReversal ? "reversal" : "settlement"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </main>
  );
}

function Derivation({ settlement }: { settlement: Settlement }) {
  const calc = settlement.calculation as unknown as StoredCalculation;

  return (
    <>
      <h2>Why you received {formatPence(settlement.returnMinor)}</h2>
      <p>
        Every figure below is read from the derivation stored at settlement time.
        Nothing on this page is recalculated.
      </p>

      {calc.review ? (
        <div className="error">
          <h3>This bet needs review</h3>
          <p>
            <strong>{calc.review.reason}</strong> — {calc.review.detail}
          </p>
          <p>
            Nothing has been paid. The engine refused to settle rather than guess
            at a figure it could not derive from the data it was given.
          </p>
        </div>
      ) : null}

      <div className="panel">
        <h3>Inputs</h3>
        <dl className="derivation">
          <dt>Race status</dt>
          <dd>{calc.race.status}</dd>
          <dt>Runners that actually started</dt>
          <dd>{calc.race.actualRunners ?? "not recorded"}</dd>
          <dt>Handicap</dt>
          <dd>{calc.race.isHandicap ? "yes" : "no"}</dd>
          <dt>Your horse finished</dt>
          <dd>
            {calc.runner.finishPosition === null
              ? "unplaced"
              : ordinal(calc.runner.finishPosition)}
            {calc.runner.deadHeatCount > 1
              ? ` in a dead heat of ${calc.runner.deadHeatCount}`
              : ""}
            {calc.runner.disqualified ? " — then disqualified" : ""}
          </dd>
          <dt>Price taken</dt>
          <dd>{formatOdds(calc.oddsTaken)}</dd>
          <dt>Total stake</dt>
          <dd>{formatPence(BigInt(calc.totalStakeMinor))}</dd>
        </dl>
      </div>

      <h3>Rules applied, in order</h3>
      <ol className="rules-applied">
        {calc.rulesApplied.map((rule, i) => (
          <li key={`${i}-${rule}`}>{rule}</li>
        ))}
      </ol>

      {calc.placeTermsReducedByFieldSize ? (
        <div className="notice">
          <h3>Fewer places were paid than the declared field suggested</h3>
          <p>
            {calc.placeTermsReducedByFieldSize.declaredWouldHavePaid} places would
            have been paid on the declared field, but only{" "}
            {calc.placeTermsReducedByFieldSize.actualPays} were paid because
            place terms are set by the runners that <strong>actually started</strong>,
            not by the number declared. Non-runners shrink the field, and a
            smaller field pays fewer places.
          </p>
          <p className="muted">{calc.placeTermsReducedByFieldSize.note}</p>
        </div>
      ) : null}

      <Rule4Panel rule4={calc.rule4} />

      <h3>The arithmetic, part by part</h3>
      {calc.parts.map((part, i) => (
        <PartPanel key={`${part.part}-${i}`} part={part} />
      ))}

      <div className="panel">
        <h3>Rounding</h3>
        <p>
          Everything above is carried as an exact fraction — never as a decimal —
          so that no error accumulates through the place fraction or a dead-heat
          share. Rounding happens once per part, at the end of that part&rsquo;s
          own calculation.
          {calc.parts.length > 1 ? (
            <>
              {" "}
              An each-way bet is <strong>two separate bets</strong>, so each is
              rounded as a bet in its own right and the two are then added
              together — which is how a bookmaker settles it.
            </>
          ) : null}
        </p>
        <dl className="derivation">
          <dt>
            {calc.parts.length > 1
              ? "Sum of the parts, as an exact fraction"
              : "Exact amount before rounding"}
          </dt>
          <dd className="exact">
            {calc.rounding.exactNumerator} / {calc.rounding.exactDenominator}
          </dd>
          <dt>Rounding rule</dt>
          <dd>{calc.rounding.mode}</dd>
          <dt>Final return</dt>
          <dd>
            <strong>{formatPence(BigInt(calc.rounding.roundedMinor))}</strong>
          </dd>
        </dl>
      </div>
    </>
  );
}

function Rule4Panel({ rule4 }: { rule4: StoredCalculation["rule4"] }) {
  if (!rule4.applied) {
    return (
      <div className="panel">
        <h3>Rule 4</h3>
        <p>
          No deduction. Rule 4 applies only when a horse is withdrawn after the
          market has formed, and it is taken from winnings — never from a
          returned stake.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <h3>Rule 4 deduction — {rule4.totalPence}p in the pound</h3>
      <p>
        A horse was withdrawn late, so the remaining prices were too generous. The
        deduction comes off <strong>winnings only</strong>; your stake comes back
        whole.
        {rule4.cappedAt90 ? " The deduction is capped at 90p in the pound." : ""}
      </p>
      <p className="muted">
        Source:{" "}
        {rule4.source === "announced"
          ? "the deduction was announced with the result, and an announced figure is authoritative."
          : "looked up in the published band table from the withdrawn horse's price."}
      </p>

      {rule4.bands.length > 0 ? (
        <div className="table-scroll">
          <table>
            <caption>Bands used</caption>
            <thead>
              <tr>
                <th scope="col">Withdrawn at</th>
                <th scope="col" className="right">
                  Deduction
                </th>
                <th scope="col">Evidence</th>
              </tr>
            </thead>
            <tbody>
              {rule4.bands.map((band, i) => (
                <tr key={`${band.price}-${i}`}>
                  <th scope="row">{band.price}</th>
                  <td className="right">{band.deduction}p</td>
                  <td>
                    {band.evidenceConfidence === "consensus-only" ? (
                      <>
                        Agreed by {band.sourceCount} published sources, but{" "}
                        <strong>not independently confirmed by calculation</strong>.
                        This band rests on consensus alone.
                      </>
                    ) : (
                      <>
                        Confirmed by calculation against {band.computedCount} worked
                        example{band.computedCount === 1 ? "" : "s"}, and agreed by{" "}
                        {band.sourceCount} published sources.
                      </>
                    )}
                    {band.disputed ? (
                      <>
                        {" "}
                        <strong>Disputed:</strong> {band.disputed}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function PartPanel({ part }: { part: StoredPart }) {
  const isPlace = part.part === "PLACE";
  // Only explain the dead heat on a part that actually PAID. On a losing part
  // the divisor is arithmetically present but meaningless, and rendering it
  // read as "the dead heat cost you the win part" when what lost the win part
  // was finishing fourth.
  const deadHeat = part.deadHeatTied > 1 && part.outcome !== "lost";

  return (
    <div className="panel">
      <h3>
        {isPlace ? "Place part" : "Win part"} — {part.outcome}
      </h3>

      <dl className="derivation">
        <dt>Stake on this part</dt>
        <dd>{formatPence(BigInt(part.stakeMinor))}</dd>

        {isPlace && part.placesPaid !== undefined ? (
          <>
            <dt>Place terms</dt>
            <dd>
              {part.placesPaid} place{part.placesPaid === 1 ? "" : "s"} paid at 1/
              {part.placeFractionDen} of the win odds
              {part.placeTermsSource === "enhanced"
                ? " — enhanced terms offered on this race"
                : ""}
              .
              {part.placeTermsDisputed ? (
                <>
                  {" "}
                  <strong>Note:</strong> {part.placeTermsDisputed}
                </>
              ) : null}
            </dd>
          </>
        ) : null}

        {deadHeat ? (
          <>
            <dt>Dead heat</dt>
            <dd>
              {part.deadHeatTied} horses tied for{" "}
              {part.deadHeatPositionsAvailable} remaining place
              {part.deadHeatPositionsAvailable === 1 ? "" : "s"}, so the stake is
              reduced proportionally — you are paid on{" "}
              {part.deadHeatPositionsAvailable} of {part.deadHeatTied} of it.
            </dd>
          </>
        ) : null}

        <dt>Effective stake after any dead-heat reduction</dt>
        <dd>
          <span className="exact">{rationalToText(part.effectiveStake)}</span> pence
          — about {rationalAsApproxPounds(part.effectiveStake)}
        </dd>

        <dt>Winnings before Rule 4</dt>
        <dd>
          <span className="exact">{rationalToText(part.grossWinnings)}</span> pence
          — about {rationalAsApproxPounds(part.grossWinnings)}
        </dd>

        {part.rule4Pence > 0 ? (
          <>
            <dt>Rule 4 taken off these winnings</dt>
            <dd>{part.rule4Pence}p in the pound</dd>
            <dt>Winnings after Rule 4</dt>
            <dd>
              <span className="exact">{rationalToText(part.netWinnings)}</span> pence
              — about {rationalAsApproxPounds(part.netWinnings)}
            </dd>
          </>
        ) : null}

        <dt>This part returns</dt>
        <dd>
          <strong>{formatPence(BigInt(part.partReturnMinor))}</strong>{" "}
          <span className="muted">
            (stake back plus winnings, rounded once for this part)
          </span>
        </dd>
      </dl>
    </div>
  );
}
