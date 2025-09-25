This project is a monorepo of multiple NextJS apps. It uses Vercel's TurboRepo to build, test, and deploy.

### Folder structure:

Before running any terminal command including pnpm, make sure to be in the correct folder, depending on the app or utility library that we're working with.

- ./apps/data - logging and observability for all data types
- ./apps/trade - day trading and investment positions management. Also an API endpoint for saving strength data from an indicator for future analysis.
- ./apps/common - common files imported by other apps, mostly helping with user and database management, but also containing useful utilities, functions, components, and server actions to accomplish various tasks and integrate with 3rd party services

- ./apps/common/sql - functions, types, and interfaces for interacting with databases
- ./apps/common/sql/\* - add, get, and manage types of each database table in Neon DB
- ./apps/common/twillio - integration with Twillio to send logs and alerts via SMS message
- ./apps/common/fe - client-side React components, hooks, and utility functions
- ./apps/common/cc - saves console logs to the cloud after printing them in the terminal
- ./apps/common/prisma/schema.prisma - auth and user accounts are managed in Prisma DB

### PNPM instead of NPM:

If you need to run `npm i` or `npm install`, run `pnpm install` instead.

### Import paths:

./apps/data and ./apps/trade apps use project-relative import paths to reference their own root project directory, like `@/path/to/file`

./apps/common is used as common library of utilities, so it must always use relative import paths like `../../`, because this will work when imported by any other app

DO NOT optimize any existing import paths, unless the files have been moved and need to be updated. There are multiple folders in the project with the same name such as `@/lib` vs `@/dydx/lib` vs `@apps/common/lib` vs `@apps/common/fe/lib`. All existing import paths are correct exactly as they are.

Note: "fe" means "front end", and "be" means "back end". Several apps have this naming convention to separate client-side from server-side files.

### Database safety rules:

Neon database project "data" has two branches:

- **DEVELOPMENT** (id: br-dark-hill-adhys7uf) - Test here first
- **PRODUCTION** (id: br-aged-rice-adc9rcrp) - Requires confirmation
  Note: Neon API requires IDs, not names.

**When using Neon MCP tools:**

1. ALWAYS specify `"branchId": "br-dark-hill-adhys7uf"` (development) in params - omitting defaults to production.
2. NEVER modify production without user confirming to apply to production!
3. After dev changes, ask: "Applied to development. Apply to production?"
4. Always label results clearly: "Development Database" or "Production Database"

### Questions:

If I present you with a contradictory or confusing question, comment, or evidence, and you do not understand what I mean, please ask me to clarify.
