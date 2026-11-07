import pg from "pg";
import { buildApp } from "./app.ts";
import { systemClock } from "./clock.ts";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set");

const pool = new pg.Pool({ connectionString: databaseUrl });
const app = buildApp({ pool, clock: systemClock });

await app.listen({ port: Number(process.env.PORT ?? 3000), host: "0.0.0.0" });
