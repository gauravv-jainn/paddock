/**
 * Converts the raceform SQLite dataset into archive day files.
 *
 *   1. list the courses so you can map them:
 *        tsx src/worker/import-raceform.ts --db ./raceform.db --list-courses
 *
 *   2. fill in courses.json  { "Ascot": { "region": "GB", "timeZone": "Europe/London" } }
 *
 *   3. import a date range:
 *        tsx src/worker/import-raceform.ts --db ./raceform.db \
 *          --courses ./courses.json --out ./archive --from 2024-06-01 --to 2024-06-30
 *
 * The course map is a required input, not a default. Region decides which
 * directory a day file lands in and the time zone decides what its off times
 * mean; both would be guesses otherwise, and an off time that is an hour out is
 * a different race.
 *
 * Uses node:sqlite, built into Node 22.5+, so the dataset costs no dependency.
 * See docs/sources/datasets.md for the licence — ingest, do not redistribute.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  buildDayFiles,
  type CourseMap,
  type RaceformRow,
} from "@/modules/providers/archive/import/raceform";

interface Args {
  db: string;
  out: string;
  courses?: string;
  from?: string;
  to?: string;
  listCourses: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    db: get("--db") ?? "",
    out: get("--out") ?? "./archive",
    ...(get("--courses") === undefined ? {} : { courses: get("--courses") as string }),
    ...(get("--from") === undefined ? {} : { from: get("--from") as string }),
    ...(get("--to") === undefined ? {} : { to: get("--to") as string }),
    listCourses: argv.includes("--list-courses"),
  };
}

function usage(detail: string): never {
  console.error(`import-raceform: ${detail}\n`);
  console.error("  --db <file>          raceform.db                (required)");
  console.error("  --list-courses       print distinct courses and exit");
  console.error("  --courses <file>     course -> {region,timeZone}");
  console.error("  --out <dir>          archive root               (default ./archive)");
  console.error("  --from / --to        YYYY-MM-DD, inclusive");
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db) usage("--db is required");

  const db = new DatabaseSync(args.db, { readOnly: true });

  if (args.listCourses) {
    const rows = db
      .prepare("SELECT DISTINCT course FROM data ORDER BY course")
      .all() as Array<{ course: string }>;
    console.error(`${rows.length} distinct courses. Map every one you intend to import:`);
    const skeleton = Object.fromEntries(
      rows.map((r) => [r.course, { region: "GB", timeZone: "Europe/London" }]),
    );
    console.log(JSON.stringify(skeleton, null, 2));
    console.error(
      "\nThe regions and zones above are a SKELETON, not an answer — every Irish " +
        "course in that list is wrong until you fix it.",
    );
    db.close();
    return;
  }

  if (!args.courses) usage("--courses is required (run --list-courses first)");

  const courses = JSON.parse(await readFile(args.courses, "utf8")) as CourseMap;

  const where: string[] = [];
  const params: string[] = [];
  if (args.from) {
    where.push("date >= ?");
    params.push(args.from);
  }
  if (args.to) {
    where.push("date <= ?");
    params.push(args.to);
  }
  const sql =
    "SELECT * FROM data" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY date, course, race_id, num";

  const rows = db.prepare(sql).all(...params) as unknown as RaceformRow[];
  db.close();

  if (rows.length === 0) {
    console.error("no rows matched — check --from/--to and the table name");
    process.exit(1);
  }

  const { dayFiles, skipped } = buildDayFiles(rows, courses);

  for (const [key, day] of dayFiles) {
    const file = path.join(args.out, `${key}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(day, null, 2)}\n`);
  }

  const races = [...dayFiles.values()].reduce(
    (n, d) => n + d.meetings.reduce((m, mt) => m + (mt["races"] as unknown[]).length, 0),
    0,
  );
  console.log(
    `rows=${rows.length} dayFiles=${dayFiles.size} races=${races} skipped=${skipped.length}`,
  );

  // Skips are the interesting output. A silent importer that drops a third of
  // the card is worse than one that fails.
  const byReason = new Map<string, number>();
  for (const s of skipped) {
    const head = s.reason.split(" — ")[0] ?? s.reason;
    byReason.set(head, (byReason.get(head) ?? 0) + 1);
  }
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    console.warn(`  SKIPPED x${n}: ${reason}`);
  }
  if (skipped.length > 0) {
    const file = path.join(args.out, "skipped.json");
    await writeFile(file, `${JSON.stringify(skipped, null, 2)}\n`);
    console.warn(`  full list: ${file}`);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
