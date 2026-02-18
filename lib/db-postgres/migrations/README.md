# Postgres Migrations

This directory is the canonical schema history for `POSTGRES_URL`.

## Naming

Use immutable ordered files:

- `YYYYMMDDHHMM__description.sql`

Example:

- `202602171200__create_log_order_strength_tables.sql`

## Rules

- Never edit an applied migration.
- Add a new migration for every schema change.
- Keep migrations SQL-first so all language clients can consume the same contract.
