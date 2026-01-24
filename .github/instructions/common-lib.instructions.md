---
description: Instructions for working with shared common library
applyTo:
  - "lib/common/**/*"
---

# Common Library Instructions

## Overview

The `lib/common` package contains shared utilities used across all applications in the monorepo.

## Structure

- `lib/common/sql/` - Database functions for logs, orders, and strength tables
- `lib/common/twillio/` - Twilio SMS alert integration
- `lib/common/fe/` - Client-side React components, hooks, and utilities
- `lib/common/cc/` - Cloud console logging utilities
- `lib/common/lib/db/neon.ts` - Neon/PostgreSQL database connection
- `lib/common/lib/nextjs/` - Next.js utility functions

## Import Patterns

### Within lib/common (Internal)

Use **relative paths** when importing within the same package:

```typescript
// From lib/common/fe/hooks/useData.ts
import { formatResponse } from '../../lib/nextjs/formatResponse'
```

### From Apps (External)

Apps import from `@lib/common`:

```typescript
// From apps/trade/app/page.tsx
import { cc } from '@lib/common/cc'
import { getDb } from '@lib/common/lib/db/neon'
import { useChart } from '@lib/common/fe/hooks/useChart'
```

## Development Commands

Navigate to the library directory:

```bash
cd lib/common
pnpm run build    # Build the library
pnpm run test     # Run tests
pnpm run type-check  # Check types
```

## Key Modules

### Database (`lib/db/neon.ts`)

- Provides PostgreSQL connection via Neon
- Exports `getDb()` function for database access
- Used by SQL utilities and apps

### Cloud Console (`cc/`)

- Centralized logging utility
- Use for structured logging across all apps
- Supports different log levels and contexts

### SQL Utilities (`sql/`)

- Reusable database query functions
- Follow existing patterns when adding new queries
- Use parameterized queries to prevent SQL injection

### Frontend Utilities (`fe/`)

- Shared React components, hooks, and utilities
- Client-side only code
- Use Next.js dynamic imports if needed

### Next.js Utilities (`lib/nextjs/`)

- Server-side utilities for Next.js apps
- Request/response formatting
- Middleware helpers

## Best Practices

1. **Breaking Changes**: Changes here affect all apps - test thoroughly
2. **Versioning**: Consider semantic versioning for major changes
3. **Documentation**: Update AGENTS.md for complex utilities
4. **Type Safety**: Maintain strong TypeScript types
5. **Testing**: Write tests for shared utilities
6. **Dependencies**: Minimize dependencies to reduce bundle size

## Testing

When modifying common library code:

```bash
# Test the library itself
cd lib/common && pnpm run test

# Test affected apps
cd ../../apps/trade && pnpm run build
cd ../price-ui && pnpm run build
cd ../strength && pnpm run build
```

## Import Path Rules

- **NEVER** change import paths unless you've moved a file
- Multiple folders share similar names (`@/lib`, `@/dydx/lib`, `@lib/common/lib`, `@lib/common/fe/lib`)
- All existing import paths are correct as-is
