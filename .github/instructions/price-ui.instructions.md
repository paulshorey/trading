---
description: Instructions for working with the price-ui application
applyTo:
  - "apps/price-ui/**/*"
---

# Price UI App Instructions

## Overview

Price-ui is a financial charts and data analysis application built with Next.js, HighCharts, and improved data sources.

## Key Technologies

- **Framework**: Next.js (React)
- **Charts**: HighCharts
- **Language**: TypeScript
- **Styling**: Tailwind CSS

## File Structure

- `apps/price-ui/app/` - Next.js App Router pages and layouts
- `apps/price-ui/components/` - React components specific to price-ui
- `apps/price-ui/lib/` - Utility functions and helpers

## Import Conventions

- **Local imports**: Use `@/` prefix (e.g., `import { Chart } from '@/components/Chart'`)
- **Shared utilities**: Use `@lib/common` (e.g., `import { cc } from '@lib/common/cc'`)
- **Never** optimize import paths unless you've moved a file

## Development Commands

Navigate to the app directory first:

```bash
cd apps/price-ui
pnpm run dev      # Start development server
pnpm run build    # Build and run type checking
pnpm run test     # Run tests
```

Or from root:

```bash
pnpm --filter price-ui dev
pnpm --filter price-ui build
pnpm --filter price-ui test
```

## HighCharts Integration

- Check existing chart configurations before creating new ones
- Follow the pattern established in existing chart components
- Consider performance for real-time financial data

## Best Practices

1. Always run `pnpm run build` to verify TypeScript and lint errors
2. Check AGENTS.md in `apps/price-ui/` for app-specific context
3. Use existing chart patterns and components when possible
4. Handle financial data precision carefully (avoid floating point errors)
