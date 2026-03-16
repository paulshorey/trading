import { execFileSync } from "node:child_process";
import process from "node:process";
import { Client } from "pg";

if (!process.env.MARKETING_DB_URL) {
  throw new Error("MARKETING_DB_URL is required");
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
}

function getScalar(rows, column) {
  return rows[0]?.[column];
}

run("node", ["scripts/migrate.mjs"]);
run("bash", ["scripts/snapshot-schema.sh"]);
run("node", ["scripts/generate-types.mjs"]);

const client = new Client({ connectionString: process.env.MARKETING_DB_URL });
await client.connect();

const tablesResult = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_name IN ('user_v1', 'user_note_v1')
  ORDER BY table_name
`);

const existingTables = new Set(tablesResult.rows.map((row) => row.table_name));
for (const table of ["user_v1", "user_note_v1"]) {
  if (!existingTables.has(table)) {
    throw new Error(`Missing expected table: ${table}`);
  }
}

const usernameConstraintResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_v1_username_key'
`);

if (getScalar(usernameConstraintResult.rows, "count") !== 1) {
  throw new Error("Missing expected unique constraint: user_v1_username_key");
}

const userPhoneColumnResult = await client.query(`
  SELECT data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_v1'
    AND column_name = 'phone'
`);

if (getScalar(userPhoneColumnResult.rows, "data_type") !== "text") {
  throw new Error("Expected public.user_v1.phone to use the text type");
}

const noteFkResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_constraint
  WHERE conname = 'user_note_v1_user_id_fkey'
`);

if (getScalar(noteFkResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected foreign key constraint: user_note_v1_user_id_fkey"
  );
}

const vectorExtensionResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_extension
  WHERE extname = 'vector'
`);

if (getScalar(vectorExtensionResult.rows, "count") !== 1) {
  throw new Error("Missing expected extension: vector");
}

const noteEmbeddingColumnsResult = await client.query(`
  SELECT column_name
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'user_note_v1'
    AND column_name IN (
      'title_embedding',
      'content_embedding',
      'embedding_model',
      'embedding_updated_at'
    )
  ORDER BY column_name
`);

const existingEmbeddingColumns = new Set(
  noteEmbeddingColumnsResult.rows.map((row) => row.column_name)
);

for (const column of [
  "title_embedding",
  "content_embedding",
  "embedding_model",
  "embedding_updated_at",
]) {
  if (!existingEmbeddingColumns.has(column)) {
    throw new Error(`Missing expected column on user_note_v1: ${column}`);
  }
}

const noteIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_user_id_idx'
`);

if (getScalar(noteIndexResult.rows, "count") !== 1) {
  throw new Error("Missing expected index: user_note_v1_user_id_idx");
}

const noteTitleEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_title_embedding_hnsw_idx'
`);

if (getScalar(noteTitleEmbeddingIndexResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected index: user_note_v1_title_embedding_hnsw_idx"
  );
}

const noteContentEmbeddingIndexResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND indexname = 'user_note_v1_content_embedding_hnsw_idx'
`);

if (getScalar(noteContentEmbeddingIndexResult.rows, "count") !== 1) {
  throw new Error(
    "Missing expected index: user_note_v1_content_embedding_hnsw_idx"
  );
}

const rowTimestampFunctionResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'apply_row_timestamps_v1'
`);

if (getScalar(rowTimestampFunctionResult.rows, "count") !== 1) {
  throw new Error("Missing expected trigger function: apply_row_timestamps_v1");
}

const rowTimestampTriggersResult = await client.query(`
  SELECT COUNT(*)::int AS count
  FROM pg_trigger
  WHERE NOT tgisinternal
    AND tgname IN (
      'user_v1_apply_row_timestamps_v1',
      'user_note_v1_apply_row_timestamps_v1'
    )
`);

if (getScalar(rowTimestampTriggersResult.rows, "count") !== 2) {
  throw new Error("Missing expected row timestamp triggers");
}

await client.end();

run("git", [
  "diff",
  "--exit-code",
  "--",
  "lib/db-marketing/schema/current.sql",
  "lib/db-marketing/generated/typescript/db-types.ts",
  "lib/db-marketing/generated/contracts/db-schema.json",
]);

console.log("Postgres DB contract verification passed");
