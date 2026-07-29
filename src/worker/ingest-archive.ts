/**
 * Ingest a date range of historical UK & Ireland meetings from the local
 * archive into the catalogue.
 *
 *   ARCHIVE_ROOT=./archive DATABASE_URL=... \
 *     pnpm exec tsx src/worker/ingest-archive.ts 2024-06-01 2024-06-30
 *
 * Regions default to GB and IE. The archive file format is documented in
 * src/modules/providers/archive/README.md — the files themselves are supplied
 * by you, not generated here.
 */
import { closeDb } from "@/db/client";
import { ingestRange } from "@/modules/catalog";
import { createArchiveProvider, type RegionCode } from "@/modules/providers";

const DEFAULT_REGIONS: RegionCode[] = ["GB", "IE"];

function usage(detail: string): never {
  console.error(`ingest-archive: ${detail}`);
  console.error(
    "usage: ARCHIVE_ROOT=<dir> tsx src/worker/ingest-archive.ts <from> <to> [REGION,...]",
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [from, to, regionArg] = process.argv.slice(2);
  if (!from || !to) usage("a from and to date are required (YYYY-MM-DD)");

  const root = process.env["ARCHIVE_ROOT"];
  if (!root) usage("ARCHIVE_ROOT is not set");

  const regions = regionArg
    ? regionArg.split(",").map((r) => r.trim() as RegionCode)
    : DEFAULT_REGIONS;

  const provider = createArchiveProvider({ root });
  console.log(
    `ingesting ${from}..${to} for ${regions.join(", ")} from ${root}`,
  );

  const report = await ingestRange({ provider, from, to, regions });

  console.log(
    `days=${report.daysRead} meetings=${report.meetings} races=${report.races} ` +
      `runners=${report.runners} results=${report.results} skipped=${report.skipped.length}`,
  );

  for (const skip of report.skipped) {
    console.warn(`  SKIPPED ${skip.raceRef}: ${skip.reason}`);
  }

  if (report.meetings === 0) {
    console.warn(
      "no meetings were found. Check ARCHIVE_ROOT contains <REGION>/<YYYY-MM-DD>.json files.",
    );
  }

  await closeDb();
}

main().catch(async (error: unknown) => {
  console.error(error);
  await closeDb();
  process.exit(1);
});
