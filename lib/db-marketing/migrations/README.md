# Postgres Migrations

This directory is the canonical schema history for `MARKETING_DB_URL`.

## Baseline

- `202603141200__baseline.sql` defines the initial productivity CMS schema.
- For existing databases that already contain this schema, mark it applied with:
  - `pnpm --filter @lib/db-marketing db:migrate:baseline`
- The baseline marker only records `__baseline` files, so later forward
  migrations will still apply normally.

## Naming

Use immutable ordered files:

- `YYYYMMDDHHMM__description.sql`

Example:

- `202603141230__add_note_status.sql`

## Rules

- Never edit an applied migration.
- Add a new migration for every schema change.
- Keep migrations SQL-first so all language clients can consume the same
  contract.
- Do not add `BEGIN` / `COMMIT` inside migration files; the runner wraps each
  file in a transaction.
- For populated tables, prefer additive/backfill migrations:
  1. add nullable column or safe default
  2. backfill existing rows with `UPDATE`
  3. add `NOT NULL` / constraints after data is clean
- For type changes, use explicit `USING` expressions so existing rows are
  converted automatically.
- For operations that cannot run inside a transaction (for example
  `CREATE INDEX CONCURRENTLY`), add `-- cursor:no-transaction` at the top of
  the migration file.

## Typical flow

1. Create migration:
   - `pnpm --filter @lib/db-marketing db:migration:new -- add_note_status`
2. Edit the new SQL file in this folder.
3. Apply to target DB:
   - `pnpm --filter @lib/db-marketing db:migrate`
4. Verify migrated DB contract:
   - `pnpm --filter @lib/db-marketing db:verify`
5. Refresh schema snapshot + generated types:
   - `pnpm --filter @lib/db-marketing db:schema:snapshot`
   - `pnpm --filter @lib/db-marketing db:types:generate`
