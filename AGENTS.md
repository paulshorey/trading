# This project is a monorepo of multiple apps. It uses TurboRepo to build, test, and deploy.

## Folder structure

### Marketing Apps `./apps-marketing/`

- `eighthbrain-next` - NextJS marketing website for an upcoming project
- `notes-next` - NextJS web app to help users quickly organize their tasks, notes, and all kinds of information.

### Trading Apps `./apps-trading/`

- `view-next` - TypeScript app to display financial charts and data analysis visualizations
- `write-node` - TypeScript server that connects to data providers, ingests price and volume data per trade, calculates indicators, aggregates candles and higher timeframes for backtestsing
- `tradingview-node` Node.js/Express API for TradingView webhook ingest and strength reads
- `log-next` - logging and observability dashboard

### Shared Libraries `./lib/`

- `common` shared utilities
- `config` shared tooling
- `db-marketing` database contracts for MARKETING_DB
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
- If request is ambiguous or contradictory, ask for clarification

Cloud agent:

- `cloud:install` installs Android SDK tooling for `notes-android` and
  PostgreSQL 17 client tools (psql, pg_dump) so Android builds, `db:migrate`,
  and `db:verify` run in fresh sessions without manual apt setup.

Remote DB operations:

- `db:migrate` writes to the target database.
- `db:verify` is not read-only; it runs `db:migrate` first, then regenerates local contract artifacts.
- Only run remote `db:migrate` / `db:verify` when the user explicitly requests it.
- Before running against a deployed DB, confirm the environment variable is present, the host is reachable from the cloud agent, and there are no unexpected pending migrations.

## Finish task:

- Run `pnpm build`, fix issues, then run `pnpm build` again until there are no more issues to fix.

## AGENTS maintenance

- Read local `AGENTS.md` in the folder you edit, when present.
- Keep AGENTS.md files aligned with actual architecture.
- Remove outdated or incorrect instructions.
- Documentation should be concise and minimal.
