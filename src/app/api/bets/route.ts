import { NextResponse } from "next/server";
import { z } from "zod";
import { fail, parseBody, unauthenticatedToResponse } from "@/lib/http";
import { requireUser } from "@/lib/session";
import { listBetsForUser, placeBet, type PlaceBetRefusal } from "@/modules/betting";

/**
 * Bet placement — docs/03 §4 steps 1–3. Step 4 is the service's transaction.
 *
 * The stake crosses the wire as an **integer number of pence**, never pounds
 * and never a decimal. `1050` is £10.50. A JSON float cannot represent every
 * pence value exactly, and `.claude/rules/money.md` bars a float anywhere in
 * the money path — including its entry point.
 */
const bodySchema = z.object({
  idempotencyKey: z.uuid(),
  betType: z.enum(["WIN", "PLACE", "EACH_WAY"]),
  /** Pence, per part. EACH_WAY debits twice this. Max £10,000 a part. */
  unitStakeMinor: z.number().int().positive().max(1_000_000),
  raceId: z.uuid(),
  runnerId: z.uuid(),
  oddsTaken: z.number().gt(1).finite(),
  /** Decimal points of movement against the bettor that are acceptable. */
  oddsTolerance: z.number().min(0).finite().default(0),
});

/**
 * Every refusal is a 409: the request was well-formed and the user is who they
 * say they are, but the state of the world does not permit it. The `code`
 * distinguishes them. 402 was considered for INSUFFICIENT_BALANCE and rejected
 * — there is no payment to require, and no real money exists in this system.
 */
const REFUSAL_STATUS: Record<PlaceBetRefusal, number> = {
  RACE_NOT_OPEN: 409,
  RUNNER_NOT_DECLARED: 409,
  ODDS_MOVED: 409,
  INSUFFICIENT_BALANCE: 409,
  NO_PRICE: 409,
};

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();

    const parsed = await parseBody(request, bodySchema);
    if (!parsed.ok) return parsed.response;

    const outcome = await placeBet({
      userId: user.id,
      idempotencyKey: parsed.data.idempotencyKey,
      betType: parsed.data.betType,
      unitStakeMinor: BigInt(parsed.data.unitStakeMinor),
      raceId: parsed.data.raceId,
      runnerId: parsed.data.runnerId,
      oddsTaken: parsed.data.oddsTaken,
      oddsTolerance: parsed.data.oddsTolerance,
    });

    if (outcome.kind === "REFUSED") {
      return fail(
        REFUSAL_STATUS[outcome.reason],
        outcome.reason,
        "bet not placed",
        outcome.detail,
      );
    }

    // docs/03 §4: a duplicate returns the original bet at 200, not 201, and
    // does not re-debit. The status is how a client tells the two apart.
    return NextResponse.json(
      { bet: serialiseBet(outcome.bet), duplicate: outcome.duplicate },
      { status: outcome.duplicate ? 200 : 201 },
    );
  } catch (error) {
    const unauthenticated = unauthenticatedToResponse(error);
    if (unauthenticated) return unauthenticated;
    throw error;
  }
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const rows = await listBetsForUser(user.id);
    return NextResponse.json({ bets: rows.map(serialiseBet) });
  } catch (error) {
    const unauthenticated = unauthenticatedToResponse(error);
    if (unauthenticated) return unauthenticated;
    throw error;
  }
}

/** bigint is not JSON-serialisable. Pence go out as strings, never as floats. */
function serialiseBet(bet: {
  id: string;
  betType: string;
  status: string;
  unitStakeMinor: bigint;
  totalStakeMinor: bigint;
  returnMinor: bigint;
  placedAt: Date;
  settledAt: Date | null;
}) {
  return {
    id: bet.id,
    betType: bet.betType,
    status: bet.status,
    unitStakeMinor: bet.unitStakeMinor.toString(),
    totalStakeMinor: bet.totalStakeMinor.toString(),
    returnMinor: bet.returnMinor.toString(),
    placedAt: bet.placedAt.toISOString(),
    settledAt: bet.settledAt?.toISOString() ?? null,
  };
}
