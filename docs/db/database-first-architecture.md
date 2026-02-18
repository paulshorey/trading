# Database-First Monorepo Architecture

This monorepo uses database-first contracts so apps in any language can share the
same schema truth.

## Packages

- `@lib/db-postgres` for `POSTGRES_URL`
- `@lib/db-timescale` for `TIMESCALE_URL`

Each package contains:

- `migrations/` - canonical schema history
- `schema/current.sql` - generated snapshot
- `queries/` - language-agnostic SQL contracts
- `generated/` - derived language outputs (TypeScript, Python, C#, R)

## Current app usage

- `apps/log`, `apps/market-view-next`, `apps/tradingview-node` import SQL helpers
  from `@lib/db-postgres/sql/*`.
- `apps/market-write-node` uses pooled Timescale access from
  `@lib/db-timescale/lib/db/timescale`.

## Migration policy

- Use forward-only migrations with immutable timestamped filenames.
- Never edit an applied migration.
- Regenerate schema snapshots and generated language artifacts in CI.
