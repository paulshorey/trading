This project is a monorepo of multiple NextJS apps. It uses Vercel's TurboRepo to build, test, and deploy.

### Folder structure:

Before running any terminal npm or pnpm command, make sure to be in the correct folder, depending on the app or utility library that we're working with.

**Apps:**
- ./apps/log - logging and observability for all data types
- ./apps/trade - day trading and investment positions management
- ./apps/strength - financial charts and data analysis
- ./apps/strength/charts - code to setup and render the financial strength charts and interact with UI
- ./apps/auth - authentication testing app using Next Auth and Prisma
- ./apps/facts - (additional app in monorepo)

**Shared Libraries:**
- ./lib/common - shared utilities imported by all apps:
  - ./lib/common/sql - database functions for log, order, and strength tables
  - ./lib/common/twillio - Twilio integration for SMS alerts
  - ./lib/common/fe - client-side React components, hooks, and utility functions
  - ./lib/common/cc - cloud console logging
  - ./lib/common/lib/db/neon.ts - Neon/PostgreSQL database connection
  - ./lib/common/lib/nextjs - Next.js utility functions

- ./lib/config - build configuration and tooling (eslint, typescript, tailwind, postcss)

### PNPM instead of NPM:

If you need to run `npm i` or `npm install`, run `pnpm install` instead.

### Import paths:

Most `./apps/*` apps use project-relative import paths to reference their own root project directory like this: `@/path/to/file`.

Shared utilities are imported from `@lib/common` like this: `import { cc } from '@lib/common/cc'` or `import { getDb } from '@lib/common/lib/db/neon'`.

Internal imports within `@lib/common` use relative paths like `../../` because they're all part of the same package.

Be careful optimizing imports. There are multiple folders in the project with the same name such as `@/lib` vs `@/dydx/lib` vs `@lib/common/lib` vs `@lib/common/fe/lib`. All existing import paths are correct exactly as they are. Do not optimize import paths unless you have moved things around.

Note "fe" means "front end", and "be" means "back end". Several apps have this naming convention to separate client-side from server-side files.

### Questions:

If I present you with a contradictory or confusing request, if you do not understand what I mean, please ask me to clarify.
