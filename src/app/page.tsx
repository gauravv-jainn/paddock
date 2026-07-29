import { listMeetings } from "@/modules/catalog";

export const dynamic = "force-dynamic";

function formatOffTime(offTime: Date, timeZone: string): string {
  return offTime.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
}

export default async function MeetingsPage() {
  const meetings = await listMeetings();

  return (
    <main>
      <h1>Meetings</h1>

      {meetings.length === 0 ? (
        <p>
          No meetings in the catalogue. Run the archive ingestion command — see{" "}
          <code>src/worker/ingest-archive.ts</code>.
        </p>
      ) : null}

      {meetings.map((meeting) => (
        <section key={meeting.meetingId}>
          <h2>
            {meeting.trackName} ({meeting.countryCode}) — {meeting.date}
          </h2>
          <p>
            Going: {meeting.going ?? "not recorded"} · Status: {meeting.status}
          </p>

          <table>
            <thead>
              <tr>
                <th>Off</th>
                <th>Race</th>
                <th>Handicap</th>
                <th>Declared</th>
                <th>Ran</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {meeting.races.map((race) => (
                <tr key={race.raceId}>
                  <td>{formatOffTime(race.offTime, "Europe/London")}</td>
                  <td>
                    <a href={`/races/${race.raceId}`}>{race.name}</a>
                  </td>
                  <td>{race.isHandicap ? "yes" : "no"}</td>
                  <td>{race.declaredRunners ?? "—"}</td>
                  <td>{race.actualRunners ?? "—"}</td>
                  <td>{race.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </main>
  );
}
