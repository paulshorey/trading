import { execFileSync } from "node:child_process";
import process from "node:process";
import { Client } from "pg";

if (!process.env.TIMESCALE_URL) {
  throw new Error("TIMESCALE_URL is required");
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
}

run("node", ["scripts/migrate.mjs"]);
run("bash", ["scripts/snapshot-schema.sh"]);
run("node", ["scripts/generate-types.mjs"]);

const client = new Client({ connectionString: process.env.TIMESCALE_URL });
await client.connect();

const expectedTables = ["candles_1m_1s", "candles_1h_1m"];

const allUserTablesResult = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
    AND table_name <> 'schema_migrations_cursor'
  ORDER BY table_name
`);

const allUserTables = allUserTablesResult.rows.map((row) => row.table_name);
const unexpectedTables = allUserTables.filter((table) => !expectedTables.includes(table));
if (unexpectedTables.length > 0) {
  throw new Error(`Unexpected public tables found: ${unexpectedTables.join(", ")}`);
}

const tablesResult = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name = ANY($1::text[])
  ORDER BY table_name
`, [expectedTables]);

const existingTables = new Set(tablesResult.rows.map((row) => row.table_name));
for (const table of expectedTables) {
  if (!existingTables.has(table)) {
    throw new Error(`Missing expected table: ${table}`);
  }
}

const indexesResult = await client.query(`
  SELECT indexname
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname IN ('idx_candles_1m_1s_time_desc', 'idx_candles_1h_1m_time_desc')
  ORDER BY indexname
`);

const existingIndexes = new Set(indexesResult.rows.map((row) => row.indexname));
for (const indexName of ["idx_candles_1m_1s_time_desc", "idx_candles_1h_1m_time_desc"]) {
  if (!existingIndexes.has(indexName)) {
    throw new Error(`Missing expected index: ${indexName}`);
  }
}

const hypertablesResult = await client.query(`
  SELECT hypertable_name
  FROM timescaledb_information.hypertables
  WHERE hypertable_schema = 'public'
    AND hypertable_name IN ('candles_1m_1s', 'candles_1h_1m')
  ORDER BY hypertable_name
`);

const existingHypertables = new Set(hypertablesResult.rows.map((row) => row.hypertable_name));
for (const table of expectedTables) {
  if (!existingHypertables.has(table)) {
    throw new Error(`Expected hypertable configuration missing for: ${table}`);
  }
}

await client.end();

run("git", [
  "diff",
  "--exit-code",
  "--",
  "lib/db-timescale/schema/current.sql",
  "lib/db-timescale/generated/typescript/db-types.ts",
  "lib/db-timescale/generated/contracts/db-schema.json",
]);

console.log("Timescale DB contract verification passed");
