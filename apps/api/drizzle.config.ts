import { defineConfig } from "drizzle-kit";

// No dbCredentials: we only generate SQL files; migrations are applied by src/db/migrate.ts.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
