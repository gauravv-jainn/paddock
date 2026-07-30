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
    // tsconfig sets jsx: "preserve" because Next does its own transform. Vitest
    // does not, so the accessibility tests — which render the real page
    // components — need the automatic runtime naming here.
    esbuild: { jsx: "automatic" },
    test: {
      env,
      // `pnpm test:settlement` targets src/modules/settlement, which did not
      // exist when this was added. Without it the run exits non-zero and the
      // commit guard reads that as a red settlement suite.
      passWithNoTests: true,
      // Three suites (wallet, catalog ingest, betting) share ONE test database
      // and each TRUNCATEs in beforeAll. Run in parallel they corrupt each
      // other's fixtures — the betting suite hit a duplicate house wallet
      // because another file's truncate-and-reseed interleaved with its own.
      //
      // Every one of them passes in isolation, which is precisely how this
      // class of defect stays hidden until it fails on someone else's machine.
      // Serialising files costs about a second on the whole suite.
      fileParallelism: false,
      include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
      exclude: ["**/node_modules/**"],
      coverage: {
        provider: "v8",
        reporter: ["text", "html"],
      },
    },
  };
});
