# This project is a monorepo of multiple apps. It uses TurboRepo to build, test, and deploy.

## Folder structure

### Apps:

- `view-next` - ./apps/view-next - TypeScript app to display financial charts and data analysis visualizations
- `write-node` - ./apps/write-node - TypeScript server that connects to data providers, ingests price and volume data per trade, calculates indicators, aggregates candles and higher timeframes for backtestsing
- `tradingview-node` - ./apps/tradingview-node - Node.js/Express API for TradingView webhook ingest and strength reads
- `log-next` - ./apps/log-next - logging and observability dashboard

### Shared Libraries:

- `lib/common` shared utilities
- `lib/config` shared tooling
- `lib/db-trading` owns `TRADING_DB_URL` database contracts
- `lib/db-timescale` owns `TIMESCALE_DB_URL` database contracts

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

If DB schema changed:

- Instruct the user to run `pnpm --filter @lib/db-marketing db:migrate` to update the database to match the latest table structure. Do not run this yourself.

## Finish task:

- Run `pnpm build`, fix issues, then run `pnpm build` again until there are no more issues to fix.

## AGENTS maintenance

- Read local `AGENTS.md` in the folder you edit, when present.
- Keep AGENTS files aligned with actual architecture.
- Remove outdated or incorrect instructions.
- Documentation should be concise and minimal.
