import { redirect } from "next/navigation";
import { formatOdds, formatPence, formatSignedPence } from "@/lib/money";
import { getCurrentUser } from "@/lib/session";
import { listBetsWithLegsForUser } from "@/modules/betting";
import { getRunnerLabels } from "@/modules/catalog";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  won: "Won",
  lost: "Lost",
  void: "Void — refunded",
  partial: "Placed",
  needs_review: "Needs review",
  cancelled: "Cancelled",
};

export default async function BetHistoryPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const bets = await listBetsWithLegsForUser(user.id);
  // Composed across two modules: betting owns the bets, the catalogue owns the
  // names. Neither queries the other's tables (.claude/rules/modules.md).
  const labels = await getRunnerLabels(bets.map((b) => b.runnerId));

  return (
    <main id="main">
      <h1>My bets</h1>

      {bets.length === 0 ? (
        <p>
          You have not placed a bet yet. Pick a race from{" "}
          <a href="/">Meetings</a>.
        </p>
      ) : (
        <div className="table-scroll">
          <table>
            <caption>
              {bets.length} bet{bets.length === 1 ? "" : "s"}, newest first.
            </caption>
            <thead>
              <tr>
                <th scope="col">Selection</th>
                <th scope="col">Race</th>
                <th scope="col">Type</th>
                <th scope="col" className="right">
                  Price
                </th>
                <th scope="col" className="right">
                  Stake
                </th>
                <th scope="col">Status</th>
                <th scope="col" className="right">
                  Returned
                </th>
                <th scope="col" className="right">
                  P&amp;L
                </th>
                <th scope="col">
                  <span className="visually-hidden">Detail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {bets.map((bet) => {
                const label = labels.get(bet.runnerId);
                const settled = bet.status !== "open" && bet.status !== "needs_review";
                const pnl = bet.returnMinor - bet.totalStakeMinor;

                return (
                  <tr key={bet.betId}>
                    <th scope="row">
                      {label ? `${label.clothNumber}. ${label.horseName}` : "—"}
                    </th>
                    <td>
                      {label ? (
                        <a href={`/races/${label.raceId}`}>
                          {label.raceName}
                          <span className="muted"> · {label.trackName}</span>
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{bet.betType === "EACH_WAY" ? "Each-way" : bet.betType}</td>
                    <td className="right">{formatOdds(bet.oddsTaken)}</td>
                    <td className="right">{formatPence(bet.totalStakeMinor)}</td>
                    <td>{STATUS_LABEL[bet.status] ?? bet.status}</td>
                    <td className="right">
                      {settled ? formatPence(bet.returnMinor) : "—"}
                    </td>
                    <td className={`right ${pnl >= 0n ? "positive" : "negative"}`}>
                      {settled ? formatSignedPence(pnl) : "—"}
                    </td>
                    <td>
                      <a href={`/bets/${bet.betId}`}>
                        Why?
                        <span className="visually-hidden">
                          {" "}
                          See the full settlement derivation for this bet
                        </span>
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
