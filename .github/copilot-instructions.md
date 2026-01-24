# GitHub Copilot Custom Instructions

This is a **TurboRepo monorepo** containing multiple NextJS applications and shared libraries for financial data visualization and trading management.

## Project Structure

### Applications (`apps/`)

- **strength** - Financial charts and data analysis (lightweight-charts)
- **price-ui** - Financial charts with HighCharts and improved data sources
- **log** - Logging and observability platform
- **trade** - Day trading and investment positions management
- **facts** - Additional application

### Shared Libraries (`lib/`)

- **common** - Core shared utilities:
  - `sql/` - Database functions for logs, orders, and strength tables
  - `twillio/` - Twilio SMS alert integration
  - `fe/` - React components, hooks, and client utilities
  - `cc/` - Cloud console logging
  - `lib/db/neon.ts` - Neon/PostgreSQL database connection
  - `lib/nextjs/` - Next.js utility functions

- **config** - Build configuration and tooling (ESLint, TypeScript, Tailwind, PostCSS)

## Development Guidelines

### Package Management

**ALWAYS use `pnpm` instead of `npm`**

### Running Commands

Target specific apps in the monorepo using either method:

1. **Navigate to directory:**
   ```bash
   cd apps/trade
   pnpm run build
   pnpm run test
   ```

2. **From root with filter:**
   ```bash
   pnpm --filter trade build
   pnpm --filter trade test
   ```

### Import Paths

- **App-local imports:** Use `@/path/to/file` for files within the same app
- **Shared utilities:** Use `@lib/common` for shared library imports
  - Example: `import { cc } from '@lib/common/cc'`
  - Example: `import { getDb } from '@lib/common/lib/db/neon'`
- **Within lib/common:** Use relative paths (`../../`) since it's one package

**Important:** Multiple folders share similar names (`@/lib`, `@/dydx/lib`, `@lib/common/lib`, `@lib/common/fe/lib`). All existing import paths are correct. Do NOT optimize or change import paths unless you've moved a file.

### Build and Test

- Build and lint together: `pnpm run build` (runs TypeScript checks and linting)
- Test: `pnpm run test`
- Don't run separate lint checks - build includes them

### Code Style

- Use existing code patterns and conventions
- Check AGENTS.md files in directories for specific guidance
- Add comments only when matching existing style or explaining complex logic
- Use existing libraries when possible

## Multi-Agent Workflow

For non-trivial tasks affecting multiple files, use the **@orchestrator** agent to coordinate a multi-phase workflow:

1. **@codebase-explorer** - Understands current code and identifies files to change
2. **@web-researcher** - Researches libraries and best practices (optional)
3. **@implementer** - Implements the changes
4. **@refactorer** - Improves code quality
5. **@test-writer** - Writes unit tests (optional)
6. **@reviewer-documenter** - Final review and documentation

### When to Use Orchestrator

**Use @orchestrator for:**
- Complex changes touching multiple files
- Tasks requiring research or exploration
- Features with unclear implementation path
- Anything non-trivial

**Skip orchestrator for:**
- Simple single-file changes
- Trivial changes with obvious solutions
- Quick fixes to current file

## Documentation

### AGENTS.md Files

Each app and library has its own `AGENTS.md` file with specific context:
- Read AGENTS.md before making changes in any folder
- Update AGENTS.md after completing work if:
  - Significant architectural decisions were made
  - Non-obvious patterns were established
  - Complex concepts need explanation
- Remove outdated or incorrect information
- Keep documentation concise

### What to Document

- Complex business logic
- Non-obvious implementation patterns
- Integration approaches
- Architectural decisions

### What NOT to Document

- Self-explanatory code
- Standard patterns
- Temporary implementations

## Best Practices

- **Clarify unclear requests** - Ask questions if requirements are ambiguous
- **Search for solutions** - Look up library documentation and best practices
- **Use ecosystem tools** - Prefer official tooling and scaffolding
- **Minimal changes** - Make surgical, focused changes
- **Verify changes** - Always test that changes work as expected
- **Security first** - Never commit secrets; handle user input safely

## Tech Stack

- **Framework:** Next.js (React)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Database:** Neon (PostgreSQL)
- **Charts:** HighCharts, lightweight-charts
- **Monorepo:** TurboRepo
- **Package Manager:** pnpm
