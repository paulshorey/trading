# This project is a monorepo of trading and financial data apps. It uses TurboRepo to build, test, and deploy.

## Folder structure

### Apps `./apps/`

- `view-next` - TypeScript app to display financial charts and data analysis visualizations
- `write-node` - TypeScript server that connects to data providers, ingests price and volume data per trade, calculates indicators, aggregates candles and higher timeframes for backtestsing
- `tradingview-node` - Node.js/Express API for TradingView webhook ingest and strength reads
- `log-next` - logging and observability dashboard

### Shared Libraries `./lib/`

- `common` shared utilities
- `config` shared tooling
- `db-trading` database contracts for TRADING_DB
- `db-timescale` database contracts for TIMESCALE_DB

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
- Use `@lib/db-trading/...` and `@lib/db-timescale/...` for DB contracts/helpers.

In `lib/*` packages:

- Use relative imports.
- Do not rewrite import paths unless files were moved.

## Operational rules for agent work

- Always use `pnpm` (never `npm`)
- Use `pnpm --filter <app> <command>` or `cd apps/<app> && pnpm run <command>`
- Never add `pnpm install` / `pnpm i` inside package-level `build`, `dev`, `test`, or `start` scripts. Install dependencies from the workspace root only.
- For focused work on one app or package, install from the root with a filter that includes that target plus its workspace dependencies, for example:
  - `pnpm run deps:install -- view-next...`
  - `pnpm run deps:install -- @lib/config...`
- Use a full root install (`pnpm run deps:install`) when running repo-wide commands such as `pnpm build`, when touching multiple apps, or when changing shared workspace dependencies.
- If request is ambiguous or contradictory, ask for clarification

## Remote DB:

The current environment is only development. It's experimental. So, feel free to make changes to the remote deployed database. Migrations, breaking changes, destructive changes are ALL OK! This is not production.

- `db:migrate` writes to the target database.
- `db:verify` verifies that it was migrated correctly.
- Run both after making changes to the database schema, table structure, indexes, new tables, etc.
- Before running against a deployed DB, confirm the environment variable is present, the host is reachable from the cloud agent, and there are no unexpected pending migrations.

Run `cloud:install` to install PostgreSQL 17 client tools (psql, pg_dump) if not already installed.

## Finish task:

- Run `pnpm build`, fix issues, then run `pnpm build` again until there are no more issues to fix.

## AGENTS maintenance

- Read local `AGENTS.md` in the folder you edit, when present.
- Keep AGENTS.md files aligned with actual architecture.
- Remove outdated or incorrect instructions.
- Documentation should be concise and minimal.
