# @lib/db-timescale

Database-first package for the `TIMESCALE_URL` database.

## Source of truth

- `migrations/`: canonical schema history for Timescale/Postgres
- `schema/current.sql`: generated schema snapshot
- `queries/`: SQL contracts shared across language clients

## Runtime adapter

- `lib/db/timescale.ts`: pooled DB connection accessor used by TypeScript apps.

## Polyglot support

Contract artifacts under this package should support future generated bindings
for TypeScript, Python, C#, and R.
