import { NextResponse } from "next/server";
import { unauthenticatedToResponse } from "@/lib/http";
import { requireUser } from "@/lib/session";
import {
  getEquityCurve,
  getPerformanceSummary,
  MIN_SAMPLE_FOR_RATIO,
} from "@/modules/analytics";

/**
 * GET /api/analytics — docs/02 P0-08.
 *
 * Pence go out as strings; ratios go out with their sample size attached, so a
 * client cannot render an ROI without also having been handed the count that
 * produced it.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireUser();
    const [summary, curve] = await Promise.all([
      getPerformanceSummary(user.id),
      getEquityCurve(user.id),
    ]);

    return NextResponse.json({
      minSampleForRatio: MIN_SAMPLE_FOR_RATIO,
      summary: {
        settledBets: summary.settledBets,
        openBets: summary.openBets,
        stakedMinor: summary.stakedMinor.toString(),
        returnedMinor: summary.returnedMinor.toString(),
        profitMinor: summary.profitMinor.toString(),
        balanceMinor: summary.balanceMinor.toString(),
        roi: summary.roi,
        strikeRate: summary.strikeRate,
        averageOddsTaken: summary.averageOddsTaken,
        wins: summary.wins,
        places: summary.places,
        losses: summary.losses,
        voids: summary.voids,
        needsReview: summary.needsReview,
      },
      equityCurve: curve.map((point) => ({
        at: point.at.toISOString(),
        balanceMinor: point.balanceMinor.toString(),
        deltaMinor: point.deltaMinor.toString(),
        entryType: point.entryType,
        betId: point.betId,
      })),
    });
  } catch (error) {
    const unauthenticated = unauthenticatedToResponse(error);
    if (unauthenticated) return unauthenticated;
    throw error;
  }
}
