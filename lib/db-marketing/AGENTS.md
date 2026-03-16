# `@lib/db-marketing`

- This package is internal to this monorepo and is consumed directly from TypeScript source.
- Use extensionless relative imports in `.ts` files. Do not add `.js` suffixes unless the package starts emitting build artifacts.
- Keep database helpers here only when they are reused across apps in this repo.
# @lib/db-marketing

Database-first package for the `MARKETING_DB_URL` database.

## Source of truth

- `migrations/`: canonical schema change history
- `schema/current.sql`: generated snapshot of expected schema
- `queries/`: language-agnostic SQL query contracts

## TypeScript adapter

- `lib/db/postgres.ts`: connection accessor for app/runtime code

## Notes

- Keep SQL and migration contracts database-first; generated bindings are
  derived artifacts.
- `user_v1.phone` is stored as `text`, not a numeric type. Treat phone numbers
  as identifiers and normalize digits at query boundaries when needed.
- `user_v1` and `user_note_v1` share the `apply_row_timestamps_v1()` trigger
  function so `time_modified` refreshes automatically on insert/update while
  `time_created` stays stable after insert.
- Fresh empty DB: run `pnpm --filter @lib/db-marketing db:migrate`, then
  `db:verify`.
- Existing pre-migration DB with baseline schema already present: run
  `db:migrate:baseline` once, then `db:migrate`, then `db:verify`.
- Never manually create or alter tables outside migrations.
- Migration files are forward-only SQL; do not add `BEGIN` / `COMMIT`.
- For populated tables, migrations must explicitly backfill data and explicitly
  convert types with `USING` where needed.
- After schema changes, keep `migrations/`, `schema/current.sql`, generated
  artifacts, and query contracts in sync.
