# @lib/db-marketing

Database-first package for the `MARKETING_DB_URL` database used by the personal
productivity CMS in this repository.

This package owns:

- migration history
- current schema snapshot
- generated TypeScript and JSON schema artifacts
- shared Postgres connection access

Current tables managed here:

- `user_v1`
- `user_note_v1`

## Environment

Set:

```bash
export MARKETING_DB_URL="postgres://..."
```

`db:schema:snapshot` and `db:verify` require local PostgreSQL client tools.
Use the same PostgreSQL major version as the target DB server and CI
(`pg_dump`/`psql` 17 for the current workflow setup). The snapshot script fails
fast if the local client major version does not match the server.

## Fresh empty database

Use this flow for a brand-new empty Postgres database:

```bash
pnpm --filter @lib/db-marketing db:migrate
pnpm --filter @lib/db-marketing db:verify
```

What this does:

- creates the baseline tables
- applies all forward migrations
- regenerates schema and type artifacts during verification
- fails if generated artifacts do not match the migrated database

## Existing database that already has the baseline schema

Use this only if the database already contains the baseline tables from an
older/manual setup and has not yet been put under migration tracking:

```bash
pnpm --filter @lib/db-marketing db:migrate:baseline
pnpm --filter @lib/db-marketing db:migrate
pnpm --filter @lib/db-marketing db:verify
```

## Commands

### Apply migrations

```bash
pnpm --filter @lib/db-marketing db:migrate
```

### Verify DB contract

```bash
pnpm --filter @lib/db-marketing db:verify
```

`db:verify` is not read-only. It runs `db:migrate` first, then regenerates
local contract artifacts and checks them with `git diff --exit-code`.

### Create a new migration

```bash
pnpm --filter @lib/db-marketing db:migration:new -- add_note_status
```

Migration files are forward-only SQL. Do not add `BEGIN` / `COMMIT`; the
runner wraps each file in a transaction.

### Regenerate snapshot and types

Use these when maintaining the package itself:

```bash
pnpm --filter @lib/db-marketing db:schema:snapshot
pnpm --filter @lib/db-marketing db:types:generate
```

Or:

```bash
pnpm --filter @lib/db-marketing db:sync
```

## Files to update when the schema changes

- `migrations/*.sql`
- `schema/current.sql`
- `generated/typescript/db-types.ts`
- `generated/contracts/db-schema.json`
