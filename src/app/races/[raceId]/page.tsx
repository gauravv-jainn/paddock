import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { getRacecard } from "@/modules/catalog";
import { BetSlip } from "./BetSlip";

export const dynamic = "force-dynamic";

function formatOffTime(offTime: Date): string {
  return offTime.toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London",
  });
}

export default async function RacecardPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const [race, user] = await Promise.all([getRacecard(raceId), getCurrentUser()]);
  if (!race) notFound();

  return (
    <main id="main">
      <p>
        <a href="/">← Meetings</a>
      </p>

      <h1>{race.name}</h1>
      <p className="muted">
        {race.trackName} ({race.countryCode}) · {formatOffTime(race.offTime)} ·{" "}
        {race.isHandicap ? "Handicap" : "Non-handicap"} · Status: {race.status}
      </p>

      <div className="panel">
        <h2>Race details</h2>
        <dl className="derivation">
          <dt>Declared runners</dt>
          <dd>{race.declaredRunners ?? "not recorded"}</dd>
          <dt>Actual runners</dt>
          <dd>
            {race.actualRunners ?? "not recorded"}
            {race.actualRunners === null ? (
              <span className="muted">
                {" "}
                — each-way place terms cannot be determined without this
              </span>
            ) : null}
          </dd>
          <dt>Rule 4 deduction</dt>
          <dd>
            {race.rule4Pence === 0
              ? "none announced"
              : `${race.rule4Pence}p in the pound`}
          </dd>
          <dt>Going</dt>
          <dd>{race.going ?? "not recorded"}</dd>
          <dt>Distance</dt>
          <dd>
            {race.distanceYards === null
              ? "not recorded"
              : `${race.distanceYards} yards`}
          </dd>
          <dt>Class / type / age</dt>
          <dd>
            {race.raceClass ?? "—"} · {race.raceType ?? "—"} · {race.ageBand ?? "—"}
          </dd>
          <dt>Result version</dt>
          <dd>
            {race.resultVersion}
            {race.resultVersion > 0 ? " (amended by the stewards)" : ""}
          </dd>
        </dl>
      </div>

      <h2 id="runners-heading">Runners</h2>
      <div className="table-scroll">
        <table aria-labelledby="runners-heading">
          <caption>
            {race.runners.length} runner{race.runners.length === 1 ? "" : "s"} declared.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="right">
                No.
              </th>
              <th scope="col" className="right">
                Draw
              </th>
              <th scope="col">Horse</th>
              <th scope="col">Jockey</th>
              <th scope="col">Trainer</th>
              <th scope="col" className="right">
                Weight
              </th>
              <th scope="col" className="right">
                OR
              </th>
              <th scope="col" className="right">
                SP
              </th>
              <th scope="col">Status</th>
              <th scope="col">Finish</th>
            </tr>
          </thead>
          <tbody>
            {race.runners.map((runner) => (
              <tr key={runner.runnerId}>
                <td className="right">{runner.clothNumber}</td>
                <td className="right">{runner.stallDraw ?? "—"}</td>
                <th scope="row">
                  {runner.horseName}
                  {runner.horseBreedingSuffix ? ` (${runner.horseBreedingSuffix})` : ""}
                </th>
                <td>{runner.jockeyName ?? "—"}</td>
                <td>{runner.trainerName ?? "—"}</td>
                <td className="right">
                  {runner.weightLb === null ? "—" : `${runner.weightLb} lb`}
                </td>
                <td className="right">{runner.officialRating ?? "—"}</td>
                <td className="right">{runner.startingPrice ?? "—"}</td>
                <td>
                  {runner.status}
                  {runner.withdrawnAtOdds
                    ? ` (withdrawn at ${runner.withdrawnAtOdds})`
                    : ""}
                </td>
                <td>
                  {runner.finishPosition ?? "—"}
                  {runner.deadHeatCount > 1
                    ? ` — dead heat of ${runner.deadHeatCount}`
                    : ""}
                  {runner.disqualified ? " — disqualified" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <BetSlip
        raceId={race.raceId}
        raceIsOpen={race.status === "open"}
        signedIn={user !== null}
        runners={race.runners.map((r) => ({
          runnerId: r.runnerId,
          clothNumber: r.clothNumber,
          horseName: r.horseName,
          startingPrice: r.startingPrice,
          status: r.status,
        }))}
      />
    </main>
  );
}
