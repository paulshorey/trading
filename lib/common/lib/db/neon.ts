import { Pool } from "pg";

let pool: Pool;

export const getDb = () => {
  if (!pool) {
    const connectionString = process.env.POSTGRES_URL;
    if (!connectionString) {
      throw new Error("POSTGRES_URL environment variable not set");
    }

    pool = new Pool({
      connectionString,
    });
  }
  return pool;
};
