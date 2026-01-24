# GitHub Copilot Custom Instructions

This is a **TurboRepo monorepo** containing multiple NextJS applications and shared libraries for financial data visualization and trading management.

📖 **Quick Reference**: See [AGENTS-QUICK-REFERENCE.md](.github/AGENTS-QUICK-REFERENCE.md) for agent workflow guide.

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

## Multi-Agent Workflow (2026)

For non-trivial tasks affecting multiple files, use the **@orchestrator** agent to coordinate a multi-phase workflow with specialized subagents.

### Available Agents

1. **@orchestrator** (Sonnet 4.5) - Master coordinator for multi-agent workflows
2. **@codebase-explorer** (Sonnet 4) - Explores codebase structure and identifies affected files
3. **@web-researcher** (Sonnet 4) - Researches libraries, APIs, and best practices *(optional)*
4. **@implementer** (Sonnet 4) - Implements features and fixes with build/test verification
5. **@refactorer** (Sonnet 4) - Reviews and improves code quality
6. **@test-writer** (Sonnet 4) - Writes unit tests for new functionality *(optional)*
7. **@reviewer-documenter** (Sonnet 4) - Final review and documentation

### Agent Features (2026)

- **Model Selection**: Each agent uses optimized model for its task
- **Handoffs**: Smooth agent-to-agent transitions with context passing
- **Tool Specialization**: Agents have specific tools for their phase
- **Validation**: Built-in success criteria and quality checks
- **Phase Metadata**: Tracks progress through workflow phases

### When to Use Orchestrator

**Use @orchestrator for:**
- Complex changes touching multiple files
- Tasks requiring research or exploration
- Features with unclear implementation path
- Anything non-trivial or multi-step
- Cross-app changes in the monorepo

**Skip orchestrator for:**
- Simple single-file changes
- Trivial changes with obvious solutions
- Quick fixes to current file
- Documentation-only updates

### GitHub Copilot 2026 Features

This workflow leverages:
- **Custom Agents**: Specialized agents with YAML configuration
- **Agent Skills**: Composable skills for common tasks
- **Mission Control**: Orchestrate multiple tasks across repos
- **Path-Specific Instructions**: Auto-applied based on file location
- **Enhanced Context**: Improved understanding of monorepo structure

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

### Path-Specific Instructions (2026)

The `.github/instructions/` directory contains auto-applied instructions based on file location:

- **`price-ui.instructions.md`** - Auto-applied when working in `apps/price-ui/`
- **`trade.instructions.md`** - Auto-applied when working in `apps/trade/`
- **`strength.instructions.md`** - Auto-applied when working in `apps/strength/`
- **`common-lib.instructions.md`** - Auto-applied when working in `lib/common/`

These files are automatically used by Copilot coding agent and Copilot code review based on the files you're modifying.

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
