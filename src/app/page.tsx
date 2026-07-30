import { listMeetings } from "@/modules/catalog";

export const dynamic = "force-dynamic";

function formatOffTime(offTime: Date): string {
  return offTime.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
}

export default async function MeetingsPage() {
  const meetings = await listMeetings();

  return (
    <main id="main">
      <h1>Meetings</h1>

      {meetings.length === 0 ? (
        <div className="notice">
          <p>
            No meetings in the catalogue. Either seed the demo data with{" "}
            <code>pnpm demo</code>, or ingest a real archive with{" "}
            <code>src/worker/ingest-archive.ts</code>.
          </p>
        </div>
      ) : null}

      {meetings.map((meeting) => (
        <section key={meeting.meetingId}>
          <h2 id={`meeting-${meeting.meetingId}`}>
            {meeting.trackName} ({meeting.countryCode}) — {meeting.date}
          </h2>
          <p className="muted">
            Going: {meeting.going ?? "not recorded"} · Status: {meeting.status}
          </p>

          <div className="table-scroll">
            <table aria-labelledby={`meeting-${meeting.meetingId}`}>
              <thead>
                <tr>
                  <th scope="col">Off</th>
                  <th scope="col">Race</th>
                  <th scope="col">Handicap</th>
                  <th scope="col" className="right">
                    Declared
                  </th>
                  <th scope="col" className="right">
                    Ran
                  </th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {meeting.races.map((race) => (
                  <tr key={race.raceId}>
                    <td>{formatOffTime(race.offTime)}</td>
                    <th scope="row">
                      <a href={`/races/${race.raceId}`}>{race.name}</a>
                    </th>
                    <td>{race.isHandicap ? "yes" : "no"}</td>
                    <td className="right">{race.declaredRunners ?? "—"}</td>
                    <td className="right">{race.actualRunners ?? "—"}</td>
                    <td>{race.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </main>
  );
}
