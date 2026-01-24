---
description: Instructions for working with the trade application
applyTo:
  - "apps/trade/**/*"
---

# Trade App Instructions

## Overview

Trade is a day trading and investment positions management application.

## Key Technologies

- **Framework**: Next.js (React)
- **Language**: TypeScript
- **Database**: Neon (PostgreSQL)
- **Styling**: Tailwind CSS

## File Structure

- `apps/trade/app/` - Next.js App Router pages and layouts
- `apps/trade/components/` - React components for trading UI
- `apps/trade/lib/` - Trading-specific utilities and helpers
- `apps/trade/dydx/` - dYdX exchange integration

## Import Conventions

- **Local imports**: Use `@/` prefix (e.g., `import { Position } from '@/components/Position'`)
- **Shared database**: Use `@lib/common/lib/db/neon` for database access
- **Shared SQL functions**: Use `@lib/common/sql`
- **Never** optimize import paths unless you've moved a file

## Development Commands

Navigate to the app directory first:

```bash
cd apps/trade
pnpm run dev      # Start development server
pnpm run build    # Build and run type checking
pnpm run test     # Run tests
```

Or from root:

```bash
pnpm --filter trade dev
pnpm --filter trade build
pnpm --filter trade test
```

## Database Operations

- Use shared database utilities from `@lib/common/lib/db/neon`
- Check `@lib/common/sql` for existing query functions
- Handle sensitive trading data securely
- Never commit API keys or credentials

## Trading-Specific Considerations

1. **Financial Precision**: Use appropriate decimal handling for currency
2. **Real-time Data**: Consider websocket connections and state management
3. **Security**: Validate all trading operations and user permissions
4. **Audit Logging**: Log significant trading actions using `@lib/common/cc`

## Best Practices

1. Always run `pnpm run build` to verify TypeScript and lint errors
2. Check AGENTS.md in `apps/trade/` for app-specific context
3. Test trading logic thoroughly before deployment
4. Use environment variables for API keys and sensitive configuration
