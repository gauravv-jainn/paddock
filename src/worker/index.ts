import { closeDb } from "@/db/client";
import { runSettlementPass } from "./settle-results";

/**
 * Worker entry point — the second deployable (docs/03 §2).
 *
 * Ingestion, odds polling and settlement run here, never on a request handler.
 *
 * The loop is a plain interval, not a queue. Phase 0 settles from a local
 * archive; a job queue would be infrastructure the current phase cannot
 * justify (CLAUDE.md: do not build what the task does not require). The seam
 * is `runSettlementPass` — that is what a queue would end up calling.
 */

const INTERVAL_MS = Number(process.env["WORKER_INTERVAL_MS"] ?? 10_000);

let running = false;
let stopping = false;

async function tick(): Promise<void> {
  // Passes never overlap. A slow pass must not have a second start on top of
  // it — settlement is idempotent, but doing the work twice is still waste.
  if (running || stopping) return;
  running = true;
  try {
    const report = await runSettlementPass();
    if (report.racesSettled > 0 || report.betsNeedingReview > 0) {
      console.log(
        `settlement: ${report.racesSettled} race(s), ` +
          `${report.betsSettled} settled, ${report.betsResettled} re-settled, ` +
          `${report.betsNeedingReview} needing review`,
      );
    }
  } catch (error) {
    // A failed pass is logged and retried on the next tick. Crashing the
    // worker on one bad race would stop every other race settling too.
    console.error("settlement pass failed:", error);
  } finally {
    running = false;
  }
}

function main(): void {
  console.log(`paperhorse worker: settlement pass every ${INTERVAL_MS}ms`);
  const timer = setInterval(() => void tick(), INTERVAL_MS);
  void tick();

  const shutdown = (signal: string): void => {
    console.log(`\npaperhorse worker: ${signal}, shutting down`);
    stopping = true;
    clearInterval(timer);
    void closeDb().then(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
