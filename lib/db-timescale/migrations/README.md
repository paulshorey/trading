# Timescale Migrations

This directory is the canonical schema history for `TIMESCALE_URL`.

## Naming

- `YYYYMMDDHHMM__description.sql`

## Rules

- Never edit applied migrations.
- Add forward-only migrations.
- Keep schema ownership here even if apps use raw SQL.
