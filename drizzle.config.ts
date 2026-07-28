import { defineConfig } from "drizzle-kit";

// `generate` does not connect; only `migrate`/`push` need real credentials.
const url = process.env["DATABASE_URL"] ?? "";

export default defineConfig({
  dialect: "postgresql",
  // Modules own their tables; each module keeps its own schema file.
  schema: "./src/modules/*/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: { url },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
