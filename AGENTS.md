This project is a monorepo of multiple NextJS apps. It uses Vercel's TurboRepo to build, test, and deploy.

### Folder structure

**Apps:**

- strength - ./apps/strength - financial charts and data analysis built with lightweight-charts
- price-ui - ./apps/price-ui - newer financial charts and data analysis built with HighCharts and improved data sources
- log - ./apps/log - logging and observability for all data types
- trade ./apps/trade - day trading and investment positions management
- facts - ./apps/facts - (additional app in monorepo)

**Shared Libraries:**

- common - ./lib/common - shared utilities imported by all apps
  - ./lib/common/sql - database functions for log, order, and strength tables
  - ./lib/common/twillio - Twilio integration for SMS alerts
  - ./lib/common/fe - client-side React components, hooks, and utility functions
  - ./lib/common/cc - cloud console logging
  - ./lib/common/lib/db/neon.ts - Neon/PostgreSQL database connection
  - ./lib/common/lib/nextjs - Next.js utility functions

- ./lib/config - build configuration and tooling (eslint, typescript, tailwind, postcss)

**Targeting a specific app:**

1. `cd` into the app directory, then run the command: `cd apps/trade && pnpm test`
2. Use the `--filter` flag: `pnpm --filter trade build`

### NPM

Always use `pnpm` instead of `npm`.

### Import paths

**Within apps (`./apps/*`):**

- Use `@/path/to/file` for imports within the same app
- Use `@lib/common/...` to import from `../../lib/common/...`
- Examples: `import { cc } from '@lib/common/cc'` or `import { getDb } from '@lib/common/lib/db/neon'`

**Within `@lib` (shared library):**

- Use relative paths like `../../` (not the `@lib/common` alias)

**Warning:** Don't "fix" or "optimize" import paths. They are intentionally specific. Similar folder names exist at different levels (`@/lib`, `@/dydx/lib`, `@lib/common/lib`, `@lib/common/fe/lib`). Only update an import path if you've moved the file it references.

### Checks

Check both `lint` and `build` at the same time using `npm run build`.

### Questions

If I present you with a contradictory or confusing request, ask to clarify.

If the solution is not obvious, search the web about best practices. Search for more information about the library or framework we're using.

## Workflow

If something definitely needs improvement, don't bother asking - just change it.

## Start of work

Install dependencies

```
pnpm install
```

On first session only, fetch environment variables from Infisical

```
pnpm run init
```

## End of work

After you "think" you've finished the task, run `npm run build` to check for errors. Fix any errors. Then run `npm run build` again! to make sure nothing else is broken. Continue running `npm run build` and fixing errors until no more problems. If there are many errors, rethink the approach. Maybe the code can be written in a better way?

### Documentation

**When working in any folder:**

Read the AGENTS.md file in that folder (if exists) before making changes.

**After finishing work:**

Update the AGENTS.md file to document any significant architectural decisions or non-obvious patterns
Keep documentation concise - only document complex concepts that aren't obvious from reading the code
Remove outdated or incorrect info; consolidate redundant content
