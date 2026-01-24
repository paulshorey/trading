This project is a monorepo of multiple NextJS apps. It uses Vercel's TurboRepo to build, test, and deploy.

### Folder structure:

**Apps:**

- strength - ./apps/strength - financial charts and data analysis experiment built with lightweight-charts
- price-ui - ./apps/price-ui - newer financial charts and data analysis built with HighCharts and improved data sources
- price-api - ./apps/price-api - market data polling + API service for futures and crypto
- log - ./apps/log - logging and observability for all data types
- trade ./apps/trade - day trading and investment positions management
- facts - ./apps/facts - (additional app in monorepo)

**Shared Libraries:**

- common - ./lib/common - shared utilities imported by all apps:
  - ./lib/common/sql - database functions for log, order, and strength tables
  - ./lib/common/twillio - Twilio integration for SMS alerts
  - ./lib/common/fe - client-side React components, hooks, and utility functions
  - ./lib/common/cc - cloud console logging
  - ./lib/common/lib/db/neon.ts - Neon/PostgreSQL database connection
  - ./lib/common/lib/nextjs - Next.js utility functions

- ./lib/config - build configuration and tooling (eslint, typescript, tailwind, postcss)

** Before running CLI commands:**

Use either of these techniques to target the correct app in the monorepo:

1. `cd` into the correct package directory: `cd /apps/trade` then `pnpm run test`
2. or specify which app in the monorepo to run the command on: `pnpm --filter trade build`

### NPM:

Always use `pnpm` instead of `npm`.

### Import paths:

Most `./apps/*` apps use project-relative import paths to reference their own root project directory like this: `@/path/to/file`.

Shared utilities are imported from `@lib/common` like this: `import { cc } from '@lib/common/cc'` or `import { getDb } from '@lib/common/lib/db/neon'`.

Internal imports within `@lib/common` use relative paths like `../../` because they're all part of the same package.

Be careful optimizing imports. There are multiple folders in the project with the same name such as `@/lib` vs `@/dydx/lib` vs `@lib/common/lib` vs `@lib/common/fe/lib`. All existing import paths are correct exactly as they are. Do not try to optimize import paths. Update import paths only if you have moved a file.

Common shared library files `./lib/common` can be imported from `@lib/common`, like this: `import { formatResponse } from '@lib/common/lib/nextjs/formatResponse'`

### Build and lint:

Don't bother checking linting / typescript separately. Simply run `npm run build` in the app that you're working on. If working on the strength app for example then `cd apps/strength` and run `npm run build` to check lint / types together.

### Questions:

If I present you with a contradictory or confusing request, ask to clarify.

If the solution is not obvious, search the web about best practices. Search for more information about the library or framework we're using.

### AGENTS.md files memory and documentation:

When working in any folder:

1. **Read** the AGENTS.md file in that folder (if exists) before making changes.
2. **Update** the AGENTS.md file after completing work to document any significant architectural decisions or non-obvious patterns
3. Keep documentation concise - only document complex concepts that aren't obvious from reading the code
4. Remove outdated or incorrect info; consolidate redundant content

## GitHub Copilot Agentic Workflow

For complex tasks affecting multiple files or requiring research, use the **@orchestrator** agent to coordinate a multi-phase workflow:

- Global project context: `.github/copilot-instructions.md`
- Agent definitions: `.github/agents/*.agent.md`
- Each agent has specialized knowledge and isolated context
- Orchestrator coordinates: explore → research → implement → refactor → test → review

**When to use @orchestrator:**
- Complex changes touching multiple files
- Tasks requiring research or exploration
- Features with unclear implementation path

**When to skip orchestrator:**
- Simple single-file changes
- Trivial changes with obvious solutions
