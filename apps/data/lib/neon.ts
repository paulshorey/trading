import { Pool } from "pg";

let pool: Pool;

export const getDb = () => {
  if (!pool) {
    const connectionString = process.env.NEON_DATABASE_URL;
    if (!connectionString) {
      throw new Error("NEON_DATABASE_URL environment variable not set");
    }

    pool = new Pool({
      connectionString,
    });
  }
  return pool;
};
