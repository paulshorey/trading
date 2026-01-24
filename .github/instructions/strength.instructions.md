---
description: Instructions for working with the strength application
applyTo:
  - "apps/strength/**/*"
---

# Strength App Instructions

## Overview

Strength is a financial charts and data analysis experiment built with lightweight-charts.

## Key Technologies

- **Framework**: Next.js (React)
- **Charts**: lightweight-charts (TradingView)
- **Language**: TypeScript
- **Styling**: Tailwind CSS

## File Structure

- `apps/strength/app/` - Next.js App Router pages and layouts
- `apps/strength/components/` - React components for charts and analysis
- `apps/strength/lib/` - Utility functions and chart helpers

## Import Conventions

- **Local imports**: Use `@/` prefix (e.g., `import { StrengthChart } from '@/components/StrengthChart'`)
- **Shared utilities**: Use `@lib/common` (e.g., `import { cc } from '@lib/common/cc'`)
- **Never** optimize import paths unless you've moved a file

## Development Commands

Navigate to the app directory first:

```bash
cd apps/strength
pnpm run dev      # Start development server
pnpm run build    # Build and run type checking
pnpm run test     # Run tests
```

Or from root:

```bash
pnpm --filter strength dev
pnpm --filter strength build
pnpm --filter strength test
```

## Lightweight Charts Integration

- **Library**: Uses TradingView's lightweight-charts library
- **Performance**: Optimized for large datasets and real-time updates
- **Patterns**: Check existing chart configurations before creating new ones
- **Customization**: Follow established theming and styling patterns

## Data Analysis Features

1. **Chart Types**: Support for candlestick, line, area, and histogram charts
2. **Indicators**: Follow existing indicator implementation patterns
3. **Data Sources**: Check how data is fetched and processed
4. **State Management**: Understand how chart state is managed

## Best Practices

1. Always run `pnpm run build` to verify TypeScript and lint errors
2. Check AGENTS.md in `apps/strength/` for app-specific context
3. Use existing chart components and patterns when possible
4. Test chart performance with realistic data volumes
5. Handle real-time data updates efficiently
