import { redirect } from "next/navigation";
import { formatPence, formatPercent, formatSignedPence } from "@/lib/money";
import { getCurrentUser } from "@/lib/session";
import {
  getEquityCurve,
  getPerformanceSummary,
  MIN_SAMPLE_FOR_RATIO,
  type Ratio,
} from "@/modules/analytics";

export const dynamic = "force-dynamic";

/**
 * Analytics — docs/02 P0-08.
 *
 * Every ratio is rendered with its sample size, and one below the threshold is
 * labelled as not yet a result. docs/02 §5: "a 200% ROI on four bets is noise
 * and the UI must not present it as a result."
 */
export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [summary, curve] = await Promise.all([
    getPerformanceSummary(user.id),
    getEquityCurve(user.id),
  ]);

  const profitClass = summary.profitMinor >= 0n ? "positive" : "negative";

  return (
    <main id="main">
      <h1>Analytics</h1>
      <p className="muted">
        Every figure is derived from the ledger, so it cannot disagree with your
        balance.
      </p>

      <dl className="stat-grid">
        <div className="stat">
          <dt>Balance</dt>
          <dd>{formatPence(summary.balanceMinor)}</dd>
        </div>
        <div className="stat">
          <dt>Profit and loss</dt>
          <dd className={profitClass}>{formatSignedPence(summary.profitMinor)}</dd>
        </div>
        <div className="stat">
          <dt>Return on investment</dt>
          <dd className={summary.roi.value !== null && summary.roi.value < 0 ? "negative" : ""}>
            {formatPercent(summary.roi.value)}
            <RatioQualifier ratio={summary.roi} noun="settled bets" />
          </dd>
        </div>
        <div className="stat">
          <dt>Strike rate</dt>
          <dd>
            {formatPercent(summary.strikeRate.value)}
            <RatioQualifier ratio={summary.strikeRate} noun="decided bets" />
          </dd>
        </div>
        <div className="stat">
          <dt>Average price</dt>
          <dd>
            {summary.averageOddsTaken === null
              ? "—"
              : summary.averageOddsTaken.toFixed(2)}
            <span className="qualifier">stake-weighted</span>
          </dd>
        </div>
        <div className="stat">
          <dt>Total staked</dt>
          <dd>{formatPence(summary.stakedMinor)}</dd>
        </div>
      </dl>

      <div className="panel">
        <h2>Bet counts</h2>
        <dl className="derivation">
          <dt>Won</dt>
          <dd>{summary.wins}</dd>
          <dt>Placed (each-way place part only)</dt>
          <dd>{summary.places}</dd>
          <dt>Lost</dt>
          <dd>{summary.losses}</dd>
          <dt>Void</dt>
          <dd>
            {summary.voids}{" "}
            <span className="muted">
              — refunded, and excluded from the strike rate, because a void bet
              did not happen
            </span>
          </dd>
          <dt>Open</dt>
          <dd>{summary.openBets}</dd>
          <dt>Awaiting review</dt>
          <dd>
            {summary.needsReview}
            {summary.needsReview > 0 ? (
              <span className="muted">
                {" "}
                — the engine refused to settle these rather than guess, so they
                are excluded from every figure above
              </span>
            ) : null}
          </dd>
        </dl>
      </div>

      <h2 id="equity-heading">Equity curve</h2>
      <p>
        Your balance after every movement, oldest first. This is the ledger
        replayed rather than a stored running total, so it cannot drift from
        your actual balance.
      </p>

      {curve.length === 0 ? (
        <p>No ledger movements yet.</p>
      ) : (
        <div className="table-scroll">
          <table aria-labelledby="equity-heading">
            <caption>{curve.length} ledger movements.</caption>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">What</th>
                <th scope="col" className="right">
                  Movement
                </th>
                <th scope="col" className="right">
                  Balance
                </th>
              </tr>
            </thead>
            <tbody>
              {curve.map((point, i) => (
                <tr key={`${point.at.toISOString()}-${i}`}>
                  <td>
                    <time dateTime={point.at.toISOString()}>
                      {point.at.toLocaleString("en-GB", {
                        dateStyle: "short",
                        timeStyle: "medium",
                        timeZone: "Europe/London",
                      })}
                    </time>
                  </td>
                  <td>
                    {ENTRY_LABEL[point.entryType] ?? point.entryType}
                    {point.betId ? (
                      <>
                        {" "}
                        <a href={`/bets/${point.betId}`}>bet</a>
                      </>
                    ) : null}
                  </td>
                  <td
                    className={`right ${point.deltaMinor >= 0n ? "positive" : "negative"}`}
                  >
                    {formatSignedPence(point.deltaMinor)}
                  </td>
                  <td className="right">{formatPence(point.balanceMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

const ENTRY_LABEL: Record<string, string> = {
  OPENING_BALANCE: "Opening balance",
  STAKE: "Stake",
  RETURN: "Return",
  REFUND: "Refund",
  REVERSAL: "Reversal after a stewards' amendment",
  ADJUSTMENT: "Adjustment",
  BANKROLL_RESET: "Bankroll reset",
};

function RatioQualifier({ ratio, noun }: { ratio: Ratio; noun: string }) {
  if (ratio.value === null) {
    return <span className="qualifier">no {noun} yet</span>;
  }
  if (!ratio.meaningful) {
    return (
      <span className="qualifier">
        from {ratio.sampleSize} {noun} — too few to be a result. At least{" "}
        {MIN_SAMPLE_FOR_RATIO} are needed before this figure means anything.
      </span>
    );
  }
  return (
    <span className="qualifier">
      from {ratio.sampleSize} {noun}
    </span>
  );
}
