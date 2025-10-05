# @lib/common - Shared Utilities Library

This package contains reusable utilities used by all apps in the monorepo.

## Folder Structure

- `./cc` - Cloud console logging: saves console logs to the cloud after printing in terminal
- `./fe` - Frontend utilities:
  - `./fe/components` - Reusable React components (ErrorBoundary, Json viewer, Logs, etc.)
  - `./fe/lib` - Client-side utility functions
  - `./fe/styles` - Shared Mantine theme and styles
- `./lib` - Core utilities:
  - `./lib/db/neon.ts` - PostgreSQL/Neon database connection utility
  - `./lib/nextjs` - Next.js utilities (formatResponse, getCurrentIpAddress)
- `./sql` - Database functions for each table:
  - `./sql/log` - Log data management
  - `./sql/order` - Trading order management
  - `./sql/strength` - Financial strength data management
  - `./sql/types.ts` - Shared SQL types
- `./twillio` - Twilio integration for sending SMS alerts

## Import Paths

All apps import from `@lib/common` using specific subpaths:

```typescript
import { cc } from '@lib/common/cc'
import { getDb } from '@lib/common/lib/db/neon'
import { strengthGets } from '@lib/common/sql/strength/gets'
import { ErrorBoundary } from '@lib/common/fe/components/wrappers/ErrorBoundary'
import { theme } from '@lib/common/fe/styles/theme'
```

## Notes

- All imports within this package use relative paths (e.g., `../../lib/db/neon`)
- This is a workspace package, not published to npm
- Used by: apps/trade, apps/log, apps/strength, apps/facts, apps/auth
