/**
 * Worker entry point — the second deployable (docs/03 §2).
 *
 * Ingestion, odds polling and settlement run here, never on a request handler.
 * S1 delivers the process shell only; jobs are registered by later sessions.
 */
function main(): void {
  console.log("paperhorse worker: started (no jobs registered yet)");
}

main();
