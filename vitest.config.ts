import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  // Vitest already depends on vite, so loadEnv adds nothing to the dependency
  // tree. The empty prefix is the point: Vite only exposes VITE_* by default,
  // and these are server-side tests that need DATABASE_URL and friends.
  const fromFiles = loadEnv(mode, process.cwd(), "");

  // A variable set in the shell wins over one in .env.local, so
  // `TEST_DATABASE_URL=... pnpm test` still overrides the file.
  const env = Object.fromEntries(
    Object.entries(fromFiles).filter(([key]) => process.env[key] === undefined),
  );

  return {
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    test: {
      env,
      // `pnpm test:settlement` targets src/modules/settlement, which does not
      // exist yet. Without this it exits non-zero and the commit guard reads
      // that as a red settlement suite.
      passWithNoTests: true,
      include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
      // tests/metamorphic imports @/modules/settlement, which does not exist
      // yet. Excluded so the default gate stays honest; run it deliberately
      // with `pnpm test:metamorphic`. See tests/metamorphic/README.md.
      exclude: ["**/node_modules/**", "tests/metamorphic/**"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
      },
    },
  };
});
