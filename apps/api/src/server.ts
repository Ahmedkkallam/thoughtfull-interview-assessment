import pg from "pg";
import { buildApp } from "./app.ts";
import { systemClock } from "./clock.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString: databaseUrl });
// A dropped idle connection (database restart) emits "error"; unhandled, it would crash the process.
pool.on("error", (err) => console.error("idle database connection error", err));
const app = buildApp({ pool, clock: systemClock });

const port = Number(process.env.API_PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`API listening on http://localhost:${port}`);
