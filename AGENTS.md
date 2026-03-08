# This project is a monorepo of multiple apps. It uses TurboRepo to build, test, and deploy.

## Folder structure

### Apps:

- `market-view-next` - ./apps/market-view-next - TypeScript app to display financial charts and data analysis visualizations
- `market-write-node` - ./apps/market-write-node - TypeScript server that connects to data providers, ingests price and volume data per trade, calculates indicators, aggregates candles and higher timeframes for backtestsing
- `tradingview-node` - ./apps/tradingview-node - Node.js/Express API for TradingView webhook ingest and strength reads
- `log` - ./apps/log - logging and observability dashboard

### Shared Libraries:

- `lib/common` is shared utility code and is not DB schema source of truth.
- `lib/config` contains shared tooling config.
- `lib/db-postgres` owns `POSTGRES_URL` database contracts.
- `lib/db-timescale` owns `TIMESCALE_URL` database contracts.

## DB package contract model

For each DB package:

- `migrations/` = canonical migration history
- `schema/current.sql` = generated schema snapshot
- `queries/` = language-agnostic SQL contracts
- `generated/` = generated artifacts for language clients
- runtime adapters live in `sql/*` and/or `lib/db/*`

## Import and boundary rules

In apps:

- Use `@/` for same-app imports.
- Use `@lib/common/...` for shared non-DB utilities.
- Use `@lib/db-postgres/...` and `@lib/db-timescale/...` for DB contracts/helpers.

In `lib/*` packages:

- Use relative imports for sibling files.
- Do not rewrite import paths unless files were moved.

## Operational rules for agent work

- Always use `pnpm` (never `npm`).
- Prefer `pnpm --filter <name> ...` for scoped commands.
- If request is ambiguous or contradictory, ask for clarification.
- When uncertain, do web research per `.cursor/rules/deep-search.mdc`.

If DB contracts change:

- Update migration(s), regenerate snapshot/types/contracts, and ensure adapters stay in sync. See scripts in `lib/db-postgres/package.json` and `lib/db-timescale/package.json`.

## Setup workspace:

Install any dependencies you need (like tsc).

- `pnpm install`
- `pnpm run init` if envs are missing (first-session setup)
- Cloud agents use snapshot-managed environment settings (update script runs `pnpm install` automatically on boot).
- Prefer `pnpm dev:market-write-node` for focused service work instead of the root `pnpm dev` fanout.

## Finish task:

- Run `pnpm build`, fix issues, then run `pnpm build` again until there are no more issues to fix.

## AGENTS maintenance

- Read local `AGENTS.md` in the folder you edit, when present.
- Keep AGENTS files aligned with actual architecture.
- Remove outdated or redundant instructions.

## Cursor Cloud specific instructions

### Services overview

| Service | Port | Dev command | Notes |
|---|---|---|---|
| `market-view-next` | 3333 | `pnpm --filter market-view-next dev` | Next.js frontend; needs `TIMESCALE_URL` |
| `tradingview-node` | 3000 | `pnpm --filter tradingview-node dev` | Express API; needs `POSTGRES_URL` |
| `market-write-node` | 8080 | `pnpm --filter market-write-node dev` | Data pipeline; needs `TIMESCALE_URL` + Databento keys |
| `log` | 3333 | `pnpm --filter log dev` | Log dashboard; needs `POSTGRES_URL` |
| `eighthbrain` | 3340 | `pnpm --filter eighthbrain dev` | Marketing site; no DB required |

### Environment variables

- `.env` files per app are hydrated from Infisical via `pnpm run init` (requires `INFISICAL_TOKEN` + `INFISICAL_PROJECT_ID` secrets).
- If Infisical secrets are unavailable, create stub `.env` files manually — see the "Environment Variables by App" section of each app's AGENTS.md or source code for required keys.
- Databases (`POSTGRES_URL`, `TIMESCALE_URL`) are external/hosted; there is no Docker Compose for local DB.

### Build and test

- `pnpm build` runs Turbo across all packages. All apps type-check and build without a live DB connection.
- `pnpm --filter tradingview-node test` runs the only automated test suite (node:test + supertest, mocked DB). All other apps have no automated tests.
- `pnpm lint` uses `next lint` for Next.js apps and `eslint` for Node apps. Note: the ESLint flat-config (`eslint.config.js`) files have known compatibility issues with `next lint` in Next.js 14 — builds skip linting and succeed.

### Native build scripts

The root `package.json` includes `pnpm.onlyBuiltDependencies` to allow build scripts for `esbuild`, `@tailwindcss/oxide`, `@parcel/watcher`, and `unrs-resolver`. Without this, `tsx` (used by `market-write-node` and `tradingview-node`) will not work.
