import { getTimescaleDb } from "@lib/db-timescale/lib/db/timescale";

export const pool = getTimescaleDb();

// Log which database URL is being used (without password)
const dbUrl = process.env.TIMESCALE_URL || "";
const safeDbUrl = dbUrl.replace(/:[^:@]+@/, ":***@");
console.log(`Database URL: ${safeDbUrl}`);
