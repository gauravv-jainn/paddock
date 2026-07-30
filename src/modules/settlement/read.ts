import { desc, eq, inArray } from "drizzle-orm";
import { getDb, type Executor } from "@/db/client";
import { settlements, type Settlement } from "./schema";

/**
 * Settlement reads for the UI — docs/04 §7.
 *
 * The settlement detail screen renders `calculation` DIRECTLY and recomputes
 * nothing. That is the point of storing it: "when a user asks 'why did I get
 * £14.38?', the answer is rendered from stored data, not recomputed and not
 * guessed."
 */

/** Every settlement row for a bet, newest first, reversals included. */
export async function getSettlementHistory(
  betId: string,
  tx?: Executor,
): Promise<Settlement[]> {
  return (tx ?? getDb())
    .select()
    .from(settlements)
    .where(eq(settlements.betId, betId))
    .orderBy(desc(settlements.createdAt));
}

/**
 * The settlement in force for each bet — the newest non-reversal row.
 *
 * Reversals are excluded because a reversed settlement is history, not the
 * current answer. The detail screen still shows them; a list does not.
 */
export async function getCurrentSettlements(
  betIds: string[],
  tx?: Executor,
): Promise<Map<string, Settlement>> {
  if (betIds.length === 0) return new Map();

  const rows = await (tx ?? getDb())
    .select()
    .from(settlements)
    .where(inArray(settlements.betId, betIds))
    .orderBy(settlements.resultVersion);

  const byBet = new Map<string, Settlement>();
  for (const row of rows) {
    if (row.isReversal) continue;
    // Ordered ascending by version, so the last write wins and the map ends up
    // holding the highest-versioned settlement for each bet.
    byBet.set(row.betId, row);
  }
  return byBet;
}
