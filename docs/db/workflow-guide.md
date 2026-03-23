# Database Workflow Guide

This guide explains when to use `db:migrate`, `db:verify`, and
`db:migrate-and-verify` in day-to-day development, deployment, PR review, and cloud-agent
work.

## What each command does

### `db:migrate`

- applies any pending SQL migrations to the database named by `TRADING_DB_URL`
  or `TIMESCALE_DB_URL`
- uses the Node `pg` client only
- does not regenerate `schema/current.sql` or generated contract files

Use it when the goal is: "make this database catch up to the migration files."

### `db:verify`

- does not run migrations
- snapshots the live database with `pg_dump`
- regenerates `schema/current.sql` and generated contract files
- runs DB assertions
- fails on `git diff --exit-code` if the live DB and repo contract do not match

Use it when the goal is: "this database should already be correct; prove the
repo matches it."

### `db:migrate-and-verify`

- runs `db:migrate` first
- then runs the full `db:verify` flow

Use it when the goal is: "apply the schema change, then prove the repo artifacts
match the migrated database."

## Quick decision rule

- Need to apply pending migrations only: run `db:migrate`
- Need to compare the repo to an already-migrated database without changing it:
  run `db:verify`
- Need to apply migrations and then regenerate/verify repo artifacts: run
  `db:migrate-and-verify`

## Human developer on a local machine

### App code changes only

If you changed app code but did not change `lib/db-trading` or
`lib/db-timescale`:

- run `db:verify` when you want confidence that the repo still matches
  the live database
- do not run `db:migrate` unless you intentionally want to apply pending
  migrations

Examples:

```bash
pnpm --filter @lib/db-trading db:verify
pnpm --filter @lib/db-timescale db:verify
```

### Database package changes

If you edited migrations, SQL contracts, or generated DB-facing code:

1. Make the DB package change.
2. Run `db:migrate-and-verify` for the affected package.
3. Review the regenerated files.
4. Update app code that depends on the new contract.
5. Run the app/test/build commands that depend on that package.

Examples:

```bash
pnpm --filter @lib/db-trading db:migrate-and-verify
pnpm --filter @lib/db-timescale db:migrate-and-verify
```

Why this is the normal developer loop:

- it applies the migration
- it refreshes checked-in schema/type artifacts
- it proves those artifacts match the migrated database

### Production deployment with DB changes

If a migration is ready to go to production:

1. Optionally run `db:verify` first to confirm the repo matches the
   current production DB.
2. Run `db:migrate` once against production.
3. Run `db:verify` again to confirm production now matches the repo.

Examples:

```bash
pnpm --filter @lib/db-trading db:migrate
pnpm --filter @lib/db-trading db:verify
```

```bash
pnpm --filter @lib/db-timescale db:migrate
pnpm --filter @lib/db-timescale db:verify
```

This split is useful because `db:migrate` is the minimal write step, while
`db:verify` is the safest parity check after deploy.

## AI agent in a temporary cloud workspace

### App code changes only

- default to no DB writes
- run `db:verify` only when parity with a live DB is part of the task
- do not use `db:migrate-and-verify` unless the task explicitly includes applying
  migrations

### Database package changes

Recommended agent workflow:

1. Make the DB package change.
2. Run `db:migrate-and-verify` against a disposable, staging, or explicitly approved
   database.
3. If you need to compare against production after that, run
   `db:verify`.

For agents, this matters because `db:migrate-and-verify` is a write operation by default.
Temporary cloud workspaces should not silently apply production migrations just
to refresh contract files.

### Why cloud workspaces still install PostgreSQL client tools

The cloud bootstrap script at
[`scripts/cloud-agent-install.sh`](../../scripts/cloud-agent-install.sh)
installs `psql` and `pg_dump` so verify commands can run.

That install is for client binaries only.

It does not start a local PostgreSQL server.

The target database is still whichever host is named in `TRADING_DB_URL` or
`TIMESCALE_DB_URL`.

## PR review checks

The normal PR workflow in
[`db-contracts.yml`](../../.github/workflows/db-contracts.yml):

- starts fresh Postgres and Timescale service containers on `localhost`
- points `TRADING_DB_URL` and `TIMESCALE_DB_URL` at those containers
- runs `db:migrate-and-verify`

This is good for PR review because it proves:

- the migration history can build a database from scratch
- the checked-in schema snapshot and generated artifacts are reproducible
- the DB package assertions still pass

It does **not** prove that the real production database already matches the
repo. That is a separate question.

## Manual production parity check workflow

The manual workflow at
[`db-production-parity.yml`](../../.github/workflows/db-production-parity.yml)
exists for that production-parity question.

It:

- runs only on `workflow_dispatch`
- uses `db:verify`, not `db:migrate-and-verify`
- reads `TRADING_DB_URL` and `TIMESCALE_DB_URL` from a protected GitHub
  environment
- checks the live production DB shape against the repo without applying
  migrations

### GitHub setup

Create a protected GitHub environment named `production-db-parity` and add:

- `TRADING_DB_URL`
- `TIMESCALE_DB_URL`

Recommended protection:

- required reviewers
- restricted secret access to that environment only

### When to run it

Use the manual production parity workflow when:

- you want to confirm the repo matches production before a deploy
- you want to confirm production matches the repo after a deploy
- you want a human-approved check from CI infrastructure without giving normal
  PR jobs access to production DB credentials

If the repo is ahead of production, `db:verify` should fail. That is
expected. Apply the migration first, then rerun the parity check.
