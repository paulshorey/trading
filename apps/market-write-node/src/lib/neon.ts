import { Pool } from "pg";

/**
 * Neon PostgreSQL connection pool.
 * Used for tradingview_v1 table operations (separate from the TimescaleDB pool).
 */

let neonPool: Pool | null = null;

export function getNeonDb(): Pool {
  if (!neonPool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL environment variable not set");
    }
    neonPool = new Pool({
      connectionString,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return neonPool;
}
