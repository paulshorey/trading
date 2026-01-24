# GitHub Copilot Agents - Quick Reference

## Overview

This monorepo uses a multi-agent orchestration pattern for complex development tasks. Each agent is specialized for a specific phase of the development workflow.

## When to Use Agents

### Use @orchestrator for:
- ✅ Complex changes affecting multiple files
- ✅ Features requiring research or exploration
- ✅ Tasks with unclear implementation paths
- ✅ Cross-app changes in the monorepo
- ✅ Non-trivial refactoring
- ✅ New feature development

### Handle directly (skip agents) for:
- ❌ Simple single-file changes
- ❌ Trivial fixes with obvious solutions
- ❌ Quick documentation updates
- ❌ Minor typo corrections

## Available Agents

| Agent | Model | Purpose | Phase | Optional |
|-------|-------|---------|-------|----------|
| @orchestrator | Sonnet 4.5 | Coordinates multi-phase workflow | - | No |
| @codebase-explorer | Sonnet 4 | Explores code structure & files | 1 | No |
| @web-researcher | Sonnet 4 | Researches libraries & best practices | 2 | Yes |
| @implementer | Sonnet 4 | Implements changes | 3 | No |
| @refactorer | Sonnet 4 | Improves code quality | 4 | No |
| @test-writer | Sonnet 4 | Writes unit tests | 5 | Yes |
| @reviewer-documenter | Sonnet 4 | Final review & docs | 6 | No |

## Workflow Phases

```
┌─────────────────┐
│  @orchestrator  │ ← Coordinates everything
└────────┬────────┘
         │
    ┌────▼─────┐
    │ Phase 1  │ @codebase-explorer
    │ Explore  │ • Find affected files
    └────┬─────┘ • Read patterns & types
         │       • Identify gaps
    ┌────▼─────┐
    │ Phase 2  │ @web-researcher (optional)
    │ Research │ • Research libraries
    └────┬─────┘ • Find best practices
         │       • Get code examples
    ┌────▼─────┐
    │ Phase 3  │ @implementer
    │Implement │ • Write code
    └────┬─────┘ • Run build & tests
         │       • Fix errors
    ┌────▼─────┐
    │ Phase 4  │ @refactorer
    │ Refactor │ • Review quality
    └────┬─────┘ • Improve code
         │       • Verify tests
    ┌────▼─────┐
    │ Phase 5  │ @test-writer (optional)
    │   Test   │ • Write unit tests
    └────┬─────┘ • Verify coverage
         │       • Ensure passing
    ┌────▼─────┐
    │ Phase 6  │ @reviewer-documenter
    │  Review  │ • Final review
    └──────────┘ • Update docs
                 • Ship decision
```

## How to Use

### 1. Start with @orchestrator

```
@orchestrator Please add a new indicator to the price-ui chart component
```

The orchestrator will:
- Understand requirements
- Ask clarifying questions if needed
- Run each phase sequentially
- Pass context between agents
- Report final results

### 2. Let Orchestrator Decide

The orchestrator automatically:
- Skips Phase 2 (research) if not needed
- Skips Phase 5 (tests) for refactoring-only tasks
- Runs all phases in order
- Validates each phase before proceeding

### 3. Monitor Progress

Each agent reports:
- What it's doing
- What it found/changed
- Any concerns or blockers
- Status: ✅ Pass / ⚠️ Warning / ❌ Fail

## Agent Capabilities

### @codebase-explorer
**Tools**: read, search, glob, grep, usages

**Provides**:
- Files to modify
- Related files to consider
- TypeScript types/interfaces
- Patterns to follow
- Knowledge gaps

**Success**: All affected files identified, patterns documented

---

### @web-researcher
**Tools**: web-search, fetch, read, search

**Provides**:
- Library recommendations
- Implementation approaches
- Code examples
- Best practices
- Gotchas to avoid

**Success**: Actionable research findings for implementation

---

### @implementer
**Tools**: read, edit, write, search, build, test, bash

**Provides**:
- Implemented changes
- Dependencies added
- Edge cases handled
- Build/test status

**Success**: Build passes, existing tests pass

---

### @refactorer
**Tools**: read, edit, search, build, test, bash, usages

**Provides**:
- Code quality assessment
- Refactoring changes
- Improved patterns
- Build/test verification

**Success**: Code improved, tests still pass

---

### @test-writer
**Tools**: read, write, edit, search, test, bash

**Provides**:
- Unit tests for new code
- Coverage report
- Test patterns used

**Success**: New tests pass, appropriate coverage

---

### @reviewer-documenter
**Tools**: read, edit, write, search, grep, usages

**Provides**:
- Requirements checklist
- Security review
- Documentation updates
- Ship/no-ship decision

**Success**: All requirements met, docs updated, ready to ship

## Path-Specific Instructions

Instructions are automatically applied based on file location:

| Path | Instruction File | Auto-Applied For |
|------|------------------|------------------|
| `apps/price-ui/**` | `price-ui.instructions.md` | HighCharts, price-ui patterns |
| `apps/trade/**` | `trade.instructions.md` | Trading logic, dYdX integration |
| `apps/strength/**` | `strength.instructions.md` | lightweight-charts patterns |
| `lib/common/**` | `common-lib.instructions.md` | Shared utilities, import rules |

## Success Criteria

Before task completion, verify:

✅ All requirements met
✅ Build passes in affected apps
✅ Existing tests pass
✅ New tests added (if needed)
✅ Code quality acceptable
✅ Documentation updated
✅ No secrets committed
✅ No broken dependencies

## Common Commands

### From App Directory
```bash
cd apps/price-ui
pnpm run dev      # Development server
pnpm run build    # Build + type check + lint
pnpm run test     # Run tests
```

### From Root Directory
```bash
pnpm --filter price-ui dev
pnpm --filter price-ui build
pnpm --filter price-ui test
```

### Multiple Apps
```bash
pnpm --filter trade build
pnpm --filter strength build
```

## Monorepo-Specific Notes

### Import Paths
- **App-local**: `@/path/to/file`
- **Shared**: `@lib/common/path/to/file`
- **Within lib/common**: Use relative paths `../../`

### Package Manager
- Always use `pnpm` not `npm`

### Cross-App Changes
- Use @orchestrator for changes affecting multiple apps
- Verify builds in all affected apps
- Check for broken cross-package dependencies

## Troubleshooting

### Agent Not Working?
- Ensure YAML frontmatter is valid
- Check agent file is in `.github/agents/`
- Verify file has `.agent.md` extension

### Build Failures?
- Run `pnpm run build` in specific app directory
- Check TypeScript errors
- Verify import paths are correct

### Import Errors?
- Don't optimize import paths
- Multiple folders have similar names (`@/lib` vs `@lib/common/lib`)
- Use existing import patterns

## 2026 Features

This configuration leverages:
- ✨ **Model Selection**: Optimized models per agent
- ✨ **Handoffs**: Smooth agent transitions
- ✨ **Path-Specific Instructions**: Auto-applied context
- ✨ **Agent Skills**: Composable capabilities
- ✨ **Mission Control**: Multi-task orchestration
- ✨ **Enhanced Context**: Better monorepo understanding

## Additional Resources

- **Global Instructions**: `.github/copilot-instructions.md`
- **Agent Definitions**: `.github/agents/*.agent.md`
- **Path Instructions**: `.github/instructions/*.instructions.md`
- **App Context**: `apps/*/AGENTS.md`
- **Library Context**: `lib/*/AGENTS.md`

---

**Last Updated**: January 2026
**Copilot Version**: 2026 with custom agents support
