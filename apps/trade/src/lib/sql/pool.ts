import { Pool } from 'pg';

export const pool = new Pool({
  host: process.env.LOG_PG_HOST,
  port: Number(process.env.LOG_PG_PORT || 5432),
  user: process.env.LOG_PG_USER,
  password: process.env.LOG_PG_PASSWORD,
  database: process.env.LOG_PG_DATABASE,
  ssl: {
    rejectUnauthorized: false,
  },
});
