/**
 * Demo seed — S15.
 *
 * ALL DATA HERE IS INVENTED. Tracks, horses, jockeys, trainers, prices and
 * finishing orders are placeholders, named so they cannot be mistaken for
 * racing data — the same convention as
 * `src/modules/providers/archive/__fixtures__/` and `docs/08` D12.
 *
 * Nothing in this file is evidence of anything about settlement. The grader
 * for settlement is `tests/golden/`, assembled by hand from real historical
 * results. Never copy a value out of here into a golden vector.
 *
 * The user is created through the NORMAL `register()` path, so the opening
 * balance arrives as a real double-entry ledger transaction rather than as a
 * seeded number. A seeded balance would make the demo's first equity-curve
 * point a fiction.
 *
 * Usage:  pnpm demo   (or: tsx scripts/seed-demo.ts)
 */
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { closeDb, getDb, type Database } from "@/db/client";
import { placeBet, type BetType } from "@/modules/betting";
import { identityService } from "@/modules/identity";
import { settleRace } from "@/modules/settlement";
import { OPENING_BALANCE_MINOR, walletService } from "@/modules/wallet";
import { formatPence } from "@/lib/money";

const DEMO_EMAIL = "demo@paperhorse.test";
const DEMO_PASSWORD = "paper horse demo bankroll";

/** A real sha256 digest of the seeded snapshot, computed per race below. */
const { sha256OfPayload, persistPayload } = await import("@/modules/providers");

interface RunnerSpec {
  horse: string;
  jockey: string;
  trainer: string;
  price: number;
  /** Null = unplaced. */
  finish?: number | null;
  deadHeatCount?: number;
  status?: "declared" | "non_runner" | "withdrawn";
  disqualified?: boolean;
}

interface RaceSpec {
  key: string;
  track: string;
  name: string;
  isHandicap: boolean;
  /** Runners that actually started. Selects the place-terms row. */
  actualRunners: number;
  status: "open" | "result";
  offsetHours: number;
  runners: RunnerSpec[];
  /** What this race exists to demonstrate. Printed at the end. */
  demonstrates: string;
}

/** Filler runners, so a field reaches the size a place-terms row needs. */
function filler(count: number, from: number): RunnerSpec[] {
  return Array.from({ length: count }, (_, i) => ({
    horse: `Placeholder Horse ${from + i}`,
    jockey: `Placeholder Jockey ${from + i}`,
    trainer: `Placeholder Yard ${from + i}`,
    price: 8 + i,
    finish: null,
  }));
}

const RACES: RaceSpec[] = [
  {
    key: "clean-win",
    track: "Invented Downs",
    name: "The Structural Placeholder Stakes",
    isHandicap: false,
    actualRunners: 16,
    status: "result",
    offsetHours: -6,
    demonstrates: "a clean WIN — no dead heat, no Rule 4, no place terms",
    runners: [
      {
        horse: "Notional Gallop",
        jockey: "Placeholder Jockey A",
        trainer: "Placeholder Yard A",
        price: 4,
        finish: 1,
      },
      {
        horse: "Second Placeholder",
        jockey: "Placeholder Jockey B",
        trainer: "Placeholder Yard B",
        price: 6,
        finish: 2,
      },
      {
        horse: "Third Placeholder",
        jockey: "Placeholder Jockey C",
        trainer: "Placeholder Yard C",
        price: 9,
        finish: 3,
      },
      ...filler(13, 1),
    ],
  },
  {
    key: "place-16-handicap",
    track: "Invented Downs",
    name: "The Sixteen Runner Placeholder Handicap",
    isHandicap: true,
    actualRunners: 16,
    status: "result",
    offsetHours: -5,
    demonstrates:
      "a PLACE bet in a 16-runner HANDICAP — 4 places paid at 1/4, the row " +
      "above the 15-runner boundary",
    runners: [
      {
        horse: "Invented Frontrunner",
        jockey: "Placeholder Jockey D",
        trainer: "Placeholder Yard D",
        price: 3.5,
        finish: 1,
      },
      {
        horse: "Fabricated Stayer",
        jockey: "Placeholder Jockey E",
        trainer: "Placeholder Yard E",
        price: 7,
        finish: 2,
      },
      {
        horse: "Hypothetical Grey",
        jockey: "Placeholder Jockey F",
        trainer: "Placeholder Yard F",
        price: 11,
        finish: 3,
      },
      {
        horse: "Fourth Placeholder",
        jockey: "Placeholder Jockey G",
        trainer: "Placeholder Yard G",
        price: 13,
        finish: 4,
      },
      ...filler(12, 20),
    ],
  },
  {
    key: "each-way-15-handicap",
    track: "Notional Park",
    name: "The Fifteen Runner Placeholder Handicap",
    isHandicap: true,
    actualRunners: 15,
    status: "result",
    offsetHours: -4,
    demonstrates:
      "an EACH-WAY bet in a 15-runner HANDICAP — 3 places at 1/4, the row " +
      "BELOW the boundary. One runner fewer than the race above, one place fewer.",
    runners: [
      {
        horse: "Imaginary Sprinter",
        jockey: "Placeholder Jockey H",
        trainer: "Placeholder Yard H",
        price: 5,
        finish: 1,
      },
      {
        horse: "Contrived Chaser",
        jockey: "Placeholder Jockey I",
        trainer: "Placeholder Yard I",
        price: 8,
        finish: 2,
      },
      {
        horse: "Theoretical Filly",
        jockey: "Placeholder Jockey J",
        trainer: "Placeholder Yard J",
        price: 12,
        finish: 3,
      },
      {
        horse: "Fourth Notional",
        jockey: "Placeholder Jockey K",
        trainer: "Placeholder Yard K",
        price: 15,
        finish: 4,
      },
      ...filler(11, 40),
    ],
  },
  {
    key: "each-way-nonhandicap",
    track: "Notional Park",
    name: "The Placeholder Maiden",
    isHandicap: false,
    actualRunners: 15,
    status: "result",
    offsetHours: -3,
    demonstrates:
      "an EACH-WAY bet in a NON-HANDICAP of the same field size — 3 places " +
      "at 1/5, not 1/4. Handicap status changes the fraction, not just the places.",
    runners: [
      {
        horse: "Conjectural Colt",
        jockey: "Placeholder Jockey L",
        trainer: "Placeholder Yard L",
        price: 6,
        finish: 1,
      },
      {
        horse: "Speculative Mare",
        jockey: "Placeholder Jockey M",
        trainer: "Placeholder Yard M",
        price: 9,
        finish: 2,
      },
      {
        horse: "Postulated Gelding",
        jockey: "Placeholder Jockey N",
        trainer: "Placeholder Yard N",
        price: 14,
        finish: 3,
      },
      ...filler(12, 60),
    ],
  },
  {
    key: "dead-heat",
    track: "Fictional Heath",
    name: "The Dead Heat Placeholder Handicap",
    isHandicap: true,
    actualRunners: 16,
    status: "result",
    offsetHours: -2,
    demonstrates:
      "a DEAD HEAT for the final paid place — two horses tie for 4th of 4 " +
      "places, so the stake on that part is halved",
    runners: [
      {
        horse: "Unreal Favourite",
        jockey: "Placeholder Jockey O",
        trainer: "Placeholder Yard O",
        price: 2.5,
        finish: 1,
      },
      {
        horse: "Invented Runner Up",
        jockey: "Placeholder Jockey P",
        trainer: "Placeholder Yard P",
        price: 5,
        finish: 2,
      },
      {
        horse: "Placeholder Third",
        jockey: "Placeholder Jockey Q",
        trainer: "Placeholder Yard Q",
        price: 8,
        finish: 3,
      },
      // The dead heat: both fourth, both marked as a tie of two.
      {
        horse: "Tied Placeholder One",
        jockey: "Placeholder Jockey R",
        trainer: "Placeholder Yard R",
        price: 10,
        finish: 4,
        deadHeatCount: 2,
      },
      {
        horse: "Tied Placeholder Two",
        jockey: "Placeholder Jockey S",
        trainer: "Placeholder Yard S",
        price: 12,
        finish: 4,
        deadHeatCount: 2,
      },
      ...filler(11, 80),
    ],
  },
  {
    key: "open-race",
    track: "Fictional Heath",
    name: "The Open Placeholder Handicap",
    isHandicap: true,
    actualRunners: 16,
    status: "open",
    offsetHours: 3,
    demonstrates: "an OPEN race, so you can place a bet yourself",
    runners: [
      {
        horse: "Yet To Run",
        jockey: "Placeholder Jockey T",
        trainer: "Placeholder Yard T",
        price: 3,
      },
      {
        horse: "Also Yet To Run",
        jockey: "Placeholder Jockey U",
        trainer: "Placeholder Yard U",
        price: 5.5,
      },
      {
        horse: "Still In The Paddock",
        jockey: "Placeholder Jockey V",
        trainer: "Placeholder Yard V",
        price: 9,
      },
      ...filler(13, 100),
    ],
  },
];

/** Which bets the demo user places, and on what. */
const BETS: Array<{
  raceKey: string;
  horse: string;
  betType: BetType;
  unitStakeMinor: bigint;
}> = [
  { raceKey: "clean-win", horse: "Notional Gallop", betType: "WIN", unitStakeMinor: 5000n },
  {
    raceKey: "clean-win",
    horse: "Second Placeholder",
    betType: "WIN",
    unitStakeMinor: 2500n,
  },
  {
    raceKey: "place-16-handicap",
    horse: "Fourth Placeholder",
    betType: "PLACE",
    unitStakeMinor: 4000n,
  },
  {
    raceKey: "each-way-15-handicap",
    horse: "Theoretical Filly",
    betType: "EACH_WAY",
    unitStakeMinor: 2000n,
  },
  {
    raceKey: "each-way-15-handicap",
    horse: "Fourth Notional",
    betType: "EACH_WAY",
    unitStakeMinor: 2000n,
  },
  {
    raceKey: "each-way-nonhandicap",
    horse: "Postulated Gelding",
    betType: "EACH_WAY",
    unitStakeMinor: 3000n,
  },
  {
    raceKey: "dead-heat",
    horse: "Tied Placeholder One",
    betType: "EACH_WAY",
    unitStakeMinor: 2500n,
  },
  {
    raceKey: "dead-heat",
    horse: "Unreal Favourite",
    betType: "WIN",
    unitStakeMinor: 6000n,
  },
];

async function main(): Promise<void> {
  const db = getDb();

  console.log("Clearing existing data…");
  await db.execute(
    sql`truncate table settlements, bet_legs, bets, ledger_entries, wallets,
        sessions, users, runners, races, meetings, tracks, horses, people,
        provider_payloads cascade`,
  );
  await db.execute(sql`insert into wallets (kind, currency) values ('house','GBP')`);

  console.log("Registering the demo user through the normal register() path…");
  const user = await db.transaction((tx) =>
    identityService.register({ email: DEMO_EMAIL, password: DEMO_PASSWORD }, tx),
  );

  console.log("Seeding invented races…");
  const raceIds = new Map<string, string>();
  const runnerIds = new Map<string, string>();

  for (const spec of RACES) {
    const { raceId, runners } = await seedRace(db, spec);
    raceIds.set(spec.key, raceId);
    for (const [horse, id] of runners) runnerIds.set(`${spec.key}::${horse}`, id);
  }

  console.log("Placing bets…");
  for (const bet of BETS) {
    const raceId = raceIds.get(bet.raceKey);
    const runnerId = runnerIds.get(`${bet.raceKey}::${bet.horse}`);
    if (!raceId || !runnerId) throw new Error(`unknown selection: ${bet.raceKey}/${bet.horse}`);

    // Bets are placed while the race is open, exactly as a user would, then
    // the race is put back to its final status. Inserting bet rows directly
    // would skip the balance check and the ledger debit.
    const spec = RACES.find((r) => r.key === bet.raceKey);
    if (!spec) throw new Error(`unknown race ${bet.raceKey}`);
    const price = spec.runners.find((r) => r.horse === bet.horse)?.price;
    if (price === undefined) throw new Error(`no price for ${bet.horse}`);

    await db.execute(sql`update races set status = 'open' where id = ${raceId}::uuid`);
    const outcome = await placeBet({
      userId: user.id,
      idempotencyKey: randomUUID(),
      betType: bet.betType,
      unitStakeMinor: bet.unitStakeMinor,
      raceId,
      runnerId,
      oddsTaken: price,
      // The seed takes whatever price is on the runner; it is not testing the
      // tolerance path, and a refusal here would be a seeding failure.
      oddsTolerance: 100,
    });
    if (outcome.kind !== "PLACED") {
      throw new Error(`seed bet refused: ${outcome.reason} — ${outcome.detail}`);
    }
    await db.execute(
      sql`update races set status = ${spec.status} where id = ${raceId}::uuid`,
    );
  }

  console.log("Settling the finished races…");
  for (const spec of RACES) {
    if (spec.status !== "result") continue;
    const raceId = raceIds.get(spec.key) as string;

    const snapshot = { source: "demo seed — invented data", race: spec.key };
    await persistPayload({
      providerId: "demo",
      kind: "result",
      entityRef: raceId,
      body: snapshot,
    });
    const outcome = await settleRace(raceId, sha256OfPayload(snapshot));
    if (outcome.kind === "REFUSED") {
      throw new Error(`seed settlement refused: ${outcome.reason} — ${outcome.detail}`);
    }
  }

  const walletRows = await db.execute<{ id: string }>(
    sql`select id from wallets where user_id = ${user.id}::uuid and kind = 'user'`,
  );
  const balance = await walletService.getBalance(walletRows[0]!.id, db);

  console.log(`
────────────────────────────────────────────────────────────
  DEMO DATA SEEDED — every horse, track and result is INVENTED
────────────────────────────────────────────────────────────

  Sign in with:
      email     ${DEMO_EMAIL}
      password  ${DEMO_PASSWORD}

  Opening balance   ${formatPence(OPENING_BALANCE_MINOR)}
  Balance now       ${formatPence(balance)}
  Bets placed       ${BETS.length}

  What each race demonstrates:
${RACES.map((r) => `      ${r.name}\n        ${r.demonstrates}`).join("\n")}

  The DEMO DATA banner is shown because ARCHIVE_ROOT is not set. Set it to a
  real archive and the banner disappears.
────────────────────────────────────────────────────────────
`);
}

async function seedRace(
  db: Database,
  spec: RaceSpec,
): Promise<{ raceId: string; runners: Map<string, string> }> {
  const rows = await db.execute<{ id: string }>(sql`
    WITH t AS (
      INSERT INTO tracks (name, country_code, timezone)
      VALUES (${spec.track}, 'GB', 'Europe/London')
      ON CONFLICT (name, country_code) DO UPDATE SET timezone = EXCLUDED.timezone
      RETURNING id
    ), m AS (
      INSERT INTO meetings (track_id, date, going, status)
      SELECT id, CURRENT_DATE, 'Placeholder Going', 'completed' FROM t
      ON CONFLICT (track_id, date) DO UPDATE SET going = EXCLUDED.going
      RETURNING id
    )
    INSERT INTO races (meeting_id, provider_ref, provider_id, name, off_time,
                       is_handicap, status, actual_runners, declared_runners,
                       race_type, race_class, age_band, distance_yards)
    SELECT id, ${`demo-${spec.key}`}, 'demo', ${spec.name},
           now() + (${spec.offsetHours} || ' hours')::interval,
           ${spec.isHandicap}, ${spec.status}, ${spec.actualRunners},
           ${spec.runners.length}, 'flat', '4', '4yo+', 1760
    FROM m
    RETURNING id
  `);
  const raceId = rows[0]!.id;

  const runners = new Map<string, string>();
  let cloth = 1;
  for (const runner of spec.runners) {
    const inserted = await db.execute<{ id: string }>(sql`
      WITH h AS (
        INSERT INTO horses (name) VALUES (${runner.horse})
        ON CONFLICT (name, breeding_suffix, foaled_year) DO UPDATE SET name = EXCLUDED.name
        RETURNING id
      ), j AS (
        INSERT INTO people (name, kind) VALUES (${runner.jockey}, 'jockey')
        ON CONFLICT (name, kind) DO UPDATE SET name = EXCLUDED.name RETURNING id
      ), tr AS (
        INSERT INTO people (name, kind) VALUES (${runner.trainer}, 'trainer')
        ON CONFLICT (name, kind) DO UPDATE SET name = EXCLUDED.name RETURNING id
      )
      INSERT INTO runners (race_id, horse_id, jockey_id, trainer_id, cloth_number,
                           stall_draw, status, starting_price, finish_position,
                           dead_heat_count, disqualified, weight_lb, official_rating)
      SELECT ${raceId}::uuid, h.id, j.id, tr.id, ${cloth}, ${cloth},
             ${runner.status ?? "declared"}, ${runner.price.toFixed(3)},
             ${runner.finish ?? null}, ${runner.deadHeatCount ?? 1},
             ${runner.disqualified ?? false}, ${126 + (cloth % 8)}, ${70 + (cloth % 30)}
      FROM h, j, tr
      RETURNING id
    `);
    runners.set(runner.horse, inserted[0]!.id);
    cloth += 1;
  }

  return { raceId, runners };
}

try {
  await main();
} finally {
  await closeDb();
}
