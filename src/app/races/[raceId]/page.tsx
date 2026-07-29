import { notFound } from "next/navigation";
import { getRacecard } from "@/modules/catalog";

export const dynamic = "force-dynamic";

export default async function RacecardPage({
  params,
}: {
  params: Promise<{ raceId: string }>;
}) {
  const { raceId } = await params;
  const race = await getRacecard(raceId);
  if (!race) notFound();

  return (
    <main>
      <p>
        <a href="/">← Meetings</a>
      </p>

      <h1>{race.name}</h1>
      <p>
        {race.trackName} ({race.countryCode}) · {race.meetingDate} ·{" "}
        {race.offTime.toISOString()}
      </p>

      <dl>
        <dt>Status</dt>
        <dd>{race.status}</dd>
        <dt>Handicap</dt>
        <dd>{race.isHandicap ? "yes" : "no"}</dd>
        <dt>Declared runners</dt>
        <dd>{race.declaredRunners ?? "not recorded"}</dd>
        <dt>Actual runners</dt>
        <dd>{race.actualRunners ?? "not recorded"}</dd>
        <dt>Rule 4 deduction</dt>
        <dd>{race.rule4Pence}p in the £</dd>
        <dt>Class</dt>
        <dd>{race.raceClass ?? "not recorded"}</dd>
        <dt>Type</dt>
        <dd>{race.raceType ?? "not recorded"}</dd>
        <dt>Distance</dt>
        <dd>
          {race.distanceYards === null ? "not recorded" : `${race.distanceYards} yards`}
        </dd>
        <dt>Age band</dt>
        <dd>{race.ageBand ?? "not recorded"}</dd>
        <dt>Going</dt>
        <dd>{race.going ?? "not recorded"}</dd>
        <dt>Result version</dt>
        <dd>{race.resultVersion}</dd>
      </dl>

      <h2>Runners</h2>
      <table>
        <thead>
          <tr>
            <th>No.</th>
            <th>Draw</th>
            <th>Horse</th>
            <th>Jockey</th>
            <th>Trainer</th>
            <th>Weight (lb)</th>
            <th>OR</th>
            <th>SP</th>
            <th>Status</th>
            <th>Finish</th>
          </tr>
        </thead>
        <tbody>
          {race.runners.map((runner) => (
            <tr key={runner.runnerId}>
              <td>{runner.clothNumber}</td>
              <td>{runner.stallDraw ?? "—"}</td>
              <td>
                {runner.horseName}
                {runner.horseBreedingSuffix
                  ? ` (${runner.horseBreedingSuffix})`
                  : ""}
              </td>
              <td>{runner.jockeyName ?? "—"}</td>
              <td>{runner.trainerName ?? "—"}</td>
              <td>{runner.weightLb ?? "—"}</td>
              <td>{runner.officialRating ?? "—"}</td>
              <td>{runner.startingPrice ?? "—"}</td>
              <td>
                {runner.status}
                {runner.withdrawnAtOdds
                  ? ` (withdrawn at ${runner.withdrawnAtOdds})`
                  : ""}
              </td>
              <td>
                {runner.finishPosition ?? "—"}
                {runner.deadHeatCount > 1
                  ? ` (dead heat, ${runner.deadHeatCount})`
                  : ""}
                {runner.disqualified ? " DSQ" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
