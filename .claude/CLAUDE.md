# Claude Code

## Agentic Workflow

For any non-trivial task or request that will likely edit more than just the current file, use the orchestrator agent, which coordinates a synchronous multi-agent workflow:

## Available Agents

All agents are defined in `.claude/agents/`:

1. orchestrator.md - Opus 4.5, coordinates all phases sequentially
2. codebase-explorer.md - Sonnet, reads and understands the codebase
3. web-researcher.md - Sonnet, performs deep web research
4. implementer.md - Sonnet, implements the feature/fix
5. refactorer.md - Sonnet, improves code quality
6. test-writer.md - Sonnet, writes unit tests
7. reviewer-documenter.md - Sonnet, reviews and documents

### When to Use This Workflow

**Use orchestrator agent for:**

- Complex changes touching multiple files
- Tasks requiring research or exploration
- Anything non-trivial

**Skip orchestrator for:**

- Simple changes to the current file
- Trivial changes with obvious solutions

## Workflow Behavior

Orchestrator agent should understand the task, requirements, deliverables, each part of the process, and communicate to the user if anything is unclear.

The orchestrator runs each phase **synchronously and sequentially**:

1. Each subagent blocks until complete
2. Orchestrator evaluates output before proceeding
3. Orchestrator may ask user for clarification at any checkpoint
4. No parallel execution - strict phase ordering

**Context passing**: Subagents have isolated context. They cannot see each other's outputs. The orchestrator must explicitly pass relevant information from previous phases to each subagent.

## Project-Specific Notes

This is a TurboRepo monorepo. File structure and configuration is described in root `/AGENTS.md`.
Each app and library inside this monorepo has its own `AGENTS.md` file, such as `/apps/strength/AGENTS.md`.

Always use `pnpm` instead of `npm`.

Before running CLI commands use either of these techniques to target the correct app:

1. `cd` into the correct package directory: `cd /apps/trade` then `pnpm run test`
2. or specify which app to run the command on: `pnpm --filter trade build`
