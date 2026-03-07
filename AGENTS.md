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
- Cloud agents should use `.cursor/environment.json`, which runs `pnpm run cloud:install` at install time and `pnpm run cloud:start` on boot.
- Prefer `pnpm dev:market-write-node` for focused service work instead of the root `pnpm dev` fanout.

## Finish task:

- Run `pnpm build`, fix issues, then run `pnpm build` again until there are no more issues to fix.

## AGENTS maintenance

- Read local `AGENTS.md` in the folder you edit, when present.
- Keep AGENTS files aligned with actual architecture.
- Remove outdated or redundant instructions.
