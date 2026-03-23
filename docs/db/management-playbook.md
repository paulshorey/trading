# Database Management Playbook

This is the operational guide for database-first schema management in this
monorepo.

For day-to-day command selection across local development, cloud agents,
production deploys, and PR review, see
[`workflow-guide.md`](./workflow-guide.md).

## Packages and source of truth

- `@lib/db-trading` owns `TRADING_DB_URL`
- `@lib/db-timescale` owns `TIMESCALE_DB_URL`
- Source of truth is:
  - `migrations/*.sql` (history)
  - `schema/current.sql` (current snapshot)
  - `queries/**/*.sql` (query contracts)

Generated files under `generated/*` are derived artifacts, not the source of
truth.

## Core rule

Never change database structure manually.

Always:

1. add or edit a migration
2. run the migration script
3. regenerate schema/types
4. update app code that depends on the changed contract

## Environment setup

Before running package scripts, export the correct DB URL:

- Postgres: `TRADING_DB_URL`
- Timescale: `TIMESCALE_DB_URL`

The app `.env` files already contain these values.

From the monorepo root you can run `pnpm db:migrate`, `pnpm db:verify`, or `pnpm db:migrate-and-verify` (Turborepo runs the task in each package that defines it—currently both DB packages). Target one package with e.g. `pnpm exec turbo run db:migrate --filter=@lib/db-trading`.

`db:migrate` uses only the Node `pg` client and does not require `pg_dump` or `psql`.
`db:schema:snapshot`, `db:verify`, and `db:migrate-and-verify` also require local PostgreSQL client tools.
Match the client major version to the target DB server and CI. The current DB
contract workflow runs PostgreSQL 17 service containers with PostgreSQL 17
client tools, and the local snapshot scripts now fail fast if `pg_dump` and the
server major versions do not match.

## First-time setup for fresh empty databases

For a brand-new empty database, use the normal migration flow:

```bash
pnpm --filter @lib/db-trading db:migrate
pnpm --filter @lib/db-timescale db:migrate
```

Timescale note:

- the Timescale migration runner executes `CREATE EXTENSION IF NOT EXISTS timescaledb`
- the DB role still needs permission to create extensions

## First-time setup for existing databases

Both DB packages include a baseline migration generated from the live DB:

- `lib/db-trading/migrations/202602180130__baseline.sql`
- `lib/db-timescale/migrations/202602180131__baseline.sql`

For a database that already has the baseline schema, mark only the baseline as
applied:

```bash
pnpm --filter @lib/db-trading db:migrate:baseline
pnpm --filter @lib/db-timescale db:migrate:baseline
```

After baselining, run the normal migration flow so later migrations still apply:

```bash
pnpm --filter @lib/db-trading db:migrate
pnpm --filter @lib/db-timescale db:migrate
```

## Verification workflow

Each DB package now has a contract verification command:

```bash
pnpm --filter @lib/db-trading db:migrate-and-verify
pnpm --filter @lib/db-timescale db:migrate-and-verify
```

Contract check without migrations: `db:verify` (`verify.mjs`). Full pipeline: `db:migrate-and-verify` (pnpm runs `migrate.mjs` then `verify.mjs`).

`db:verify`:

1. regenerates `schema/current.sql`
2. regenerates generated TS/JSON artifacts
3. checks those files are reproducible with `git diff --exit-code`
4. runs DB-level assertions for expected tables/indexes/constraints

`db:migrate-and-verify` is implemented as `node scripts/migrate.mjs && node scripts/verify.mjs`.

The same `db:migrate-and-verify` command runs in CI against fresh Postgres and Timescale
containers.

For guarded live-production parity checks from GitHub Actions, use the manual
workflow at
[`db-production-parity.yml`](../../.github/workflows/db-production-parity.yml),
which runs `db:verify` with protected environment secrets.

Against a deployed remote database, `db:migrate-and-verify` applies pending migrations
before regenerating local contract artifacts; use `db:verify` alone to diff the live
DB against the repo without migrating.

Remote `db:migrate` / `db:migrate-and-verify` runs are allowed only with an explicit user
request. Before running them from a cloud agent:

1. confirm the corresponding `*_DB_URL` environment variable is present
2. confirm the host is reachable from the current environment
3. compare local migration files with `schema_migrations_cursor` and understand
   any pending migrations before proceeding

## Creating a new migration

```bash
pnpm --filter @lib/db-trading db:migration:new -- add_order_status
pnpm --filter @lib/db-timescale db:migration:new -- add_candles_4h_1m
```

Important:

- do not add `BEGIN` / `COMMIT` inside migration files
- the migration runner wraps each file in a transaction
- if you need an operation that cannot run inside a transaction (for example
  `CREATE INDEX CONCURRENTLY`), add `-- cursor:no-transaction` at the top of
  the migration file
- write forward-only SQL
- never edit an already-applied migration

## Safe migration pattern for populated tables

When existing rows already exist, use additive/backfill migrations:

1. add the new column as nullable or with a safe default
2. backfill existing rows with `UPDATE`
3. add strict constraints (`NOT NULL`, `CHECK`, FK, etc.) after data is clean

Example:

```sql
ALTER TABLE public.order_v1 ADD COLUMN status text;

UPDATE public.order_v1
SET status = 'open'
WHERE status IS NULL;

ALTER TABLE public.order_v1
  ALTER COLUMN status SET NOT NULL;
```

## Safe type-change pattern for populated tables

Type changes are supported, but the migration must explicitly define how old
values convert to the new type with `USING`.

Example:

```sql
ALTER TABLE public.example
  ALTER COLUMN some_col TYPE integer
  USING NULLIF(trim(some_col::text), '')::integer;
```

If a direct cast is not safe, prefer:

1. add a new column of the target type
2. backfill it with `UPDATE`
3. update app code to read/write the new column
4. drop the old column in a later migration

## Add or edit a column

Example: add column `status` to `order_v1`.

1. Create migration:
   ```bash
   pnpm --filter @lib/db-trading db:migration:new -- add_order_status
   ```
2. Edit the new migration file:

   ```sql
   ALTER TABLE public.order_v1 ADD COLUMN status text;

   UPDATE public.order_v1
   SET status = 'open'
   WHERE status IS NULL;

   ALTER TABLE public.order_v1
     ALTER COLUMN status SET NOT NULL;
   ```

3. Apply migration:
   ```bash
   pnpm --filter @lib/db-trading db:migrate
   ```
4. Verify and refresh contracts:
   ```bash
   pnpm --filter @lib/db-trading db:migrate-and-verify
   ```
5. Update query contracts in `lib/db-trading/queries/*` if needed.
6. Update adapters (`lib/db-trading/sql/*`) to read/write the new column.

## Add a new table

1. Create migration:
   ```bash
   pnpm --filter @lib/db-trading db:migration:new -- create_positions_v1
   ```
2. Write forward-only SQL:

   ```sql
   CREATE TABLE public.positions_v1 (
     id bigserial PRIMARY KEY,
     ticker text NOT NULL,
     size numeric NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   );

   CREATE INDEX IF NOT EXISTS positions_v1_ticker_created_at_idx
     ON public.positions_v1 (ticker, created_at DESC);
   ```

3. Apply migration, verify, then add query contracts and adapters.

## TypeScript enforcement strategy

Generated files:

- `lib/db-trading/generated/typescript/db-types.ts`
- `lib/db-timescale/generated/typescript/db-types.ts`

How to enforce:

1. Regenerate after every migration (`db:types:generate` or `db:migrate-and-verify`).
2. Import generated row types in adapter code where practical.
3. Run `pnpm build` in CI; any adapter code out of sync with updated generated
   types should fail type-check.
4. Require a diff in:
   - `migrations/*.sql`
   - `schema/current.sql`
   - `generated/typescript/db-types.ts`
   - `generated/contracts/db-schema.json`
     for schema-related PRs.

## Recommended PR checklist for schema changes

- [ ] New migration added (no edits to already-applied migrations)
- [ ] Migration applied successfully in target environment
- [ ] `db:migrate-and-verify` passes for the affected DB package
- [ ] `schema/current.sql` updated
- [ ] `generated/typescript/db-types.ts` updated
- [ ] `generated/contracts/db-schema.json` updated
- [ ] Relevant `queries/*.sql` updated
- [ ] Relevant `sql/*` adapters updated
- [ ] `pnpm build` passes

## Script reference

Postgres package:

- `pnpm --filter @lib/db-trading db:migration:new -- <name>`
- `pnpm --filter @lib/db-trading db:migrate`
- `pnpm --filter @lib/db-trading db:migrate-and-verify`
- `pnpm --filter @lib/db-trading db:migrate:baseline`
- `pnpm --filter @lib/db-trading db:schema:snapshot`
- `pnpm --filter @lib/db-trading db:types:generate`

Timescale package:

- `pnpm --filter @lib/db-timescale db:migration:new -- <name>`
- `pnpm --filter @lib/db-timescale db:migrate`
- `pnpm --filter @lib/db-timescale db:migrate-and-verify`
- `pnpm --filter @lib/db-timescale db:migrate:baseline`
- `pnpm --filter @lib/db-timescale db:schema:snapshot`
- `pnpm --filter @lib/db-timescale db:types:generate`
