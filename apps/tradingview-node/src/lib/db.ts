import { Pool } from "pg";

const connectionString = process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error("POSTGRES_URL environment variable not set");
}

export const pool = new Pool({
  connectionString,
  connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 2_000),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30_000),
  max: Number(process.env.PG_POOL_MAX || 10),
});

// Prevent background idle-client errors from becoming uncaught process errors.
pool.on("error", (err) => {
  console.error("Postgres pool idle client error:", err);
});
