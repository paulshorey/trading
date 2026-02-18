# @lib/common - Shared Utilities Library

This package contains reusable utilities used by all apps in the monorepo.

## Folder Structure

- `./cc` - Cloud console logging: saves console logs to the cloud after printing in terminal
- `./fe` - Frontend utilities:
  - `./fe/components` - Reusable React components (ErrorBoundary, Json viewer, Logs, etc.)
  - `./fe/lib` - Client-side utility functions
  - `./fe/styles` - Shared Mantine theme and styles
- `./lib` - Core utilities:
  - `./lib/db/postgres.ts` - PostgreSQL database connection utility
  - `./lib/nextjs` - Next.js utilities (formatResponse, getCurrentIpAddress)
- `./twillio` - Twilio integration for sending SMS alerts

## Import Paths

All apps import from `@lib/common` using specific subpaths:

```typescript
import { cc } from "@lib/common/cc";
import { getDb } from "@lib/common/lib/db/postgres";
import { ErrorBoundary } from "@lib/common/fe/components/wrappers/ErrorBoundary";
import { theme } from "@lib/common/fe/styles/theme";
```

## Notes

- All imports within this package use relative paths (e.g., `../../lib/db/postgres`)
- This is a workspace package, not published to npm
- Used by: apps/trade, apps/log, apps/strength, apps/facts, apps/price-ui
- New database-first workspace packages exist at `@lib/db-postgres` and `@lib/db-timescale`.
- SQL helpers now live in `@lib/db-postgres/sql/*`.
