/**
 * Demo-data detection — S15.
 *
 * The banner is on whenever the app is NOT pointed at a real archive. The test
 * is `ARCHIVE_ROOT`: if it is set, the catalogue was ingested from the local
 * archive and the horses are real; if it is unset, the only way there is data
 * on screen is `scripts/seed-demo.ts`, whose horses are invented.
 *
 * Deliberately fails towards showing the banner. A demo without the warning is
 * a product that appears to be quoting real racing when it is not — the exact
 * failure CLAUDE.md's "no fabricated data" rule exists to prevent. A real
 * install that shows the banner is merely untidy.
 */
export function isDemoData(): boolean {
  const archiveRoot = process.env["ARCHIVE_ROOT"];
  return archiveRoot === undefined || archiveRoot.trim() === "";
}
