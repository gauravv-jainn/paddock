import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The metamorphic suite only — docs/08 D20 layer 2.
 *
 * A separate config because the default one deliberately EXCLUDES this
 * directory, and running it through that config finds nothing and exits 0.
 * A tripwire that passes because it ran nothing is worse than no tripwire.
 *
 * `passWithNoTests` is false here on purpose: if these files ever stop being
 * collected, that is a failure, not a pass.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/metamorphic/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    passWithNoTests: false,
  },
});
