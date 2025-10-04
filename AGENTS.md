This project is a monorepo of multiple NextJS apps. It uses Vercel's TurboRepo to build, test, and deploy. Apps use code from ./apps/common library.

### Folder structure:

Before running any terminal npm or pnpm command, make sure to be in the correct folder, depending on the app or utility library that we're working with.

- ./apps/log - logging and observability for all data types
- ./apps/trade - day trading and investment positions management
- ./apps/strength - financial charts and data analysis
- ./apps/strength/charts - code to setup and render the financial strength charts and interact with UI

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

Most `./apps/*` apps use project-relative import paths to reference their own root project directory like this: `@/path/to/file`.

Except `./apps/common` is used as common library of utilities, so it must always use relative import paths like `../../`, because this will work when imported by any other app.

Be careful optimizing imports. There are multiple folders in the project with the same name such as `@/lib` vs `@/dydx/lib` vs `@apps/common/lib` vs `@apps/common/fe/lib`. All existing import paths are correct exactly as they are. Do not optimize import paths unless you have moved things around.

Note "fe" means "front end", and "be" means "back end". Several apps have this naming convention to separate client-side from server-side files.

### Questions:

If I present you with a contradictory or confusing request, if you do not understand what I mean, please ask me to clarify.
