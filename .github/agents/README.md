# GitHub Copilot Custom Agents

This directory contains custom agent definitions for GitHub Copilot's agentic workflow system.

## Overview

These agents implement a coordinated multi-phase development workflow designed for this TurboRepo monorepo. The orchestrator agent coordinates specialized sub-agents, each with isolated context windows, to handle complex development tasks.

## Available Agents

### @orchestrator
**Role:** Master coordinator  
**When to use:** Any non-trivial task touching multiple files  
**Phases:** Coordinates all other agents sequentially

### @codebase-explorer
**Role:** Code exploration and analysis  
**Phase:** 1  
**Purpose:** Find affected files, understand current implementation, identify knowledge gaps

### @web-researcher
**Role:** Research and discovery  
**Phase:** 2 (Optional)  
**Purpose:** Research libraries, APIs, best practices when knowledge gaps exist

### @implementer
**Role:** Code implementation  
**Phase:** 3  
**Purpose:** Write the actual code changes, run builds and tests

### @refactorer
**Role:** Code quality improvement  
**Phase:** 4  
**Purpose:** Review and refactor implementation for better maintainability

### @test-writer
**Role:** Test creation  
**Phase:** 5 (Optional)  
**Purpose:** Write unit tests for new functionality

### @reviewer-documenter
**Role:** Final review and documentation  
**Phase:** 6  
**Purpose:** Verify requirements met, check quality, ensure documentation

## How It Works

### Synchronous Sequential Workflow

The orchestrator runs each phase in order:
1. Each sub-agent blocks until complete
2. Orchestrator evaluates output before proceeding
3. Orchestrator may ask user for clarification at any checkpoint
4. No parallel execution - strict phase ordering
5. Orchestrator decides which phases to run based on task

### Context Isolation

- Sub-agents have isolated context windows
- They cannot see previous phases' outputs
- Orchestrator must explicitly pass relevant information
- This keeps each agent focused on its specific task

### Optional Phases

Not every task requires all phases:
- **Web Research (Phase 2):** Skip if no knowledge gaps
- **Test Writing (Phase 5):** Skip if no new testable functionality

## Usage Examples

### Simple Task (Skip Orchestrator)
```
Fix typo in apps/trade/README.md
```
Direct implementation without orchestrator.

### Complex Task (Use Orchestrator)
```
@orchestrator Add a new charting feature to price-ui that displays
volume-weighted moving averages using HighCharts
```

The orchestrator will:
1. Explore the price-ui codebase
2. Research HighCharts volume-weighted MA APIs
3. Implement the feature
4. Refactor for quality
5. Write tests
6. Review and document

## Benefits

### For Monorepo Complexity
- Agents understand monorepo structure
- Each agent knows about TurboRepo commands
- Proper context about import paths and project structure

### For Code Quality
- Separate refactoring phase ensures clean code
- Dedicated test writing phase ensures coverage
- Final review catches issues before completion

### For Context Management
- Isolated contexts prevent information overload
- Each agent focuses on its specialty
- Main context stays clean and manageable

### For Complex Tasks
- Research phase finds best solutions
- Exploration phase maps the codebase
- Multi-phase approach handles uncertainty

## Agent Configuration

Each agent is defined with:
- **YAML Frontmatter:** Name, description, tools, metadata
- **Persona Definition:** Clear role and responsibilities
- **Process Guidelines:** Step-by-step workflow
- **Return Format:** Structured output expectations
- **Boundaries:** What NOT to do

## Best Practices

1. **Use orchestrator for multi-file changes** - It coordinates better than manual chaining
2. **Be specific in requests** - Clear requirements lead to better results
3. **Trust the workflow** - Each phase builds on previous phases
4. **Review checkpoints** - Orchestrator will pause for clarification when needed
5. **Provide feedback** - Help agents learn what works for your codebase

## Comparison to Claude Code

This setup is inspired by the `.claude` folder structure used for Claude Code but adapted for GitHub Copilot's architecture:

| Aspect | Claude Code | GitHub Copilot |
|--------|-------------|----------------|
| Location | `.claude/` | `.github/agents/` |
| Format | Markdown + frontmatter | `.agent.md` with YAML |
| Model selection | Specified per agent | Managed by Copilot |
| Orchestration | User-defined | Built into @orchestrator |
| Tools | Explicit tool definitions | Tools in YAML frontmatter |

Both systems share the same philosophy: **specialized agents with isolated contexts coordinated by an orchestrator**.

## References

- [GitHub Copilot Custom Agents Docs](https://docs.github.com/en/copilot/how-tos/use-copilot-agents)
- [Agentic Workflow Best Practices](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/)
- [Custom Instructions Guide](https://docs.github.com/en/copilot/tutorials/customization-library/custom-instructions)
