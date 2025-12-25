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

Common shared library files (./lib/common) can be imported from `@lib/common` such as this:

```
import { NEW_INTERVALS } from '@lib/common/sql/strength/constants'
import { formatResponse } from '@lib/common/lib/nextjs/formatResponse'
import { strengthGets } from '@lib/common/sql/strength/gets'
```

### Build and lint:

Don't bother checking linting / typescript separately. Simply run `npm run build` in the app that you're working on. If working on the strength app for example then `cd apps/strength` and run `npm run build` to check lint / types together.

### Questions:

If I present you with a contradictory or confusing request, ask to clarify.

If the solution is not obvious, search the web about best practices. Search for more information about the library or framework we're using.

### AGENTS.md files memory and documentation:

You are an AI agent. You will read AGENTS.md file in any relevant folder every time you think about a prompt. AGENTS.md files will serve as documentation about the files and relationships in that folder. Add or edit AGENTS.md files as you make changes. Document complex topics which are not immediately obvious. Documentation you write will help you remember which folder or file to open next time when you work on a similar topic.

Always try to improve AGENTS.md files as you look throughout the codebase. Remove irrelevant or incorrect info. Consolidate documentation that is redundant or verbose.

Do not write too much documentation, make it very conscise. Avoid duplicate redundant comments. Do not write documentation and comments for every little change, only for big major concepts. Do not add comments or documentation for code that is easy to read. If code makes sense at a glance, it does not need documentation.
