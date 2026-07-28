import { defineConfig } from "drizzle-kit";

const url = process.env["DATABASE_URL"];
if (!url) {
  throw new Error("DATABASE_URL is not set. drizzle-kit cannot run without it.");
}

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
