# Workflow Comparison: Claude Code vs GitHub Copilot

## Side-by-Side Comparison

### File Structure

#### Claude Code (`.claude/`)
```
.claude/
├── CLAUDE.md                    # Main documentation
└── agents/
    ├── orchestrator.md          # Master coordinator (Opus)
    ├── codebase-explorer.md     # Code exploration (Sonnet)
    ├── web-researcher.md        # Research (Sonnet)
    ├── implementer.md           # Implementation (Sonnet)
    ├── refactorer.md            # Refactoring (Sonnet)
    ├── test-writer.md           # Testing (Sonnet)
    └── reviewer-documenter.md   # Review (Sonnet)
```

#### GitHub Copilot (`.github/`)
```
.github/
├── copilot-instructions.md      # Global context
├── COPILOT_SETUP.md            # Setup guide
└── agents/
    ├── README.md                # Workflow docs
    ├── orchestrator.agent.md    # Master coordinator
    ├── codebase-explorer.agent.md
    ├── web-researcher.agent.md
    ├── implementer.agent.md
    ├── refactorer.agent.md
    ├── test-writer.agent.md
    └── reviewer-documenter.agent.md
```

## Agent Configuration Format

### Claude Code Format
```markdown
---
name: orchestrator
description: |
  Master orchestrator for multi-agent development workflow
model: opus
---

# Orchestrator

You coordinate a multi-phase development workflow...
```

### GitHub Copilot Format
```markdown
---
name: orchestrator
description: |
  Master orchestrator for multi-agent development workflow
tools:
  - read
  - search
  - edit
  - test
  - build
metadata:
  component: orchestration
  project-area: all
---

# Orchestrator Agent

You coordinate a multi-phase development workflow...
```

## Workflow Phases

Both systems use the same 6-phase workflow:

```
┌─────────────────────────────────────────────────────────────┐
│                    @orchestrator                             │
│                                                              │
│  Coordinates all phases sequentially                         │
│  Passes context between isolated agents                      │
│  Makes decisions at checkpoints                              │
└─────────────────────────────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            │                                  │
            ▼                                  ▼
  ┌──────────────────┐              ┌──────────────────┐
  │   Phase 1        │              │   Phase 2        │
  │                  │              │   (Optional)     │
  │ Codebase         │───────────▶ │                  │
  │ Explorer         │              │ Web Researcher   │
  │                  │              │                  │
  │ • Find files     │              │ • Research libs  │
  │ • Read types     │              │ • Find examples  │
  │ • Check docs     │              │ • Best practices │
  │ • ID gaps        │              │ • TypeScript     │
  └──────────────────┘              └──────────────────┘
            │                                  │
            └────────────────┬────────────────┘
                             ▼
                   ┌──────────────────┐
                   │   Phase 3        │
                   │                  │
                   │ Implementer      │
                   │                  │
                   │ • Write code     │
                   │ • Run build      │
                   │ • Run tests      │
                   │ • Fix errors     │
                   └──────────────────┘
                             │
                             ▼
                   ┌──────────────────┐
                   │   Phase 4        │
                   │                  │
                   │ Refactorer       │
                   │                  │
                   │ • Review quality │
                   │ • Improve code   │
                   │ • Verify tests   │
                   └──────────────────┘
                             │
                             ▼
                   ┌──────────────────┐
                   │   Phase 5        │
                   │   (Optional)     │
                   │                  │
                   │ Test Writer      │
                   │                  │
                   │ • Write tests    │
                   │ • Run tests      │
                   │ • Check coverage │
                   └──────────────────┘
                             │
                             ▼
                   ┌──────────────────┐
                   │   Phase 6        │
                   │                  │
                   │ Reviewer &       │
                   │ Documenter       │
                   │                  │
                   │ • Check reqs     │
                   │ • Review code    │
                   │ • Update docs    │
                   │ • Final report   │
                   └──────────────────┘
```

## Usage Examples

### Claude Code
```
Use orchestrator agent to add a new chart type to price-ui
```
Claude Code will automatically invoke the orchestrator agent.

### GitHub Copilot
```
@orchestrator Add a new chart type to price-ui
```
Explicitly invoke the orchestrator agent with `@`.

## Key Similarities

1. **Same Philosophy**: Specialized agents with isolated contexts
2. **Same Workflow**: 6-phase sequential process
3. **Same Agents**: Orchestrator coordinates 6 specialized sub-agents
4. **Same Goals**: Handle complex tasks in monorepo efficiently
5. **Same Context Isolation**: Sub-agents don't see each other's outputs
6. **Same Optionality**: Research and testing phases are optional

## Key Differences

| Feature | Claude Code | GitHub Copilot |
|---------|-------------|----------------|
| **Invocation** | Automatic | Explicit with `@` |
| **Model Selection** | Explicit (Opus/Sonnet) | Managed by Copilot |
| **Tool Definition** | In agent instructions | YAML frontmatter |
| **File Extension** | `.md` | `.agent.md` |
| **IDE Support** | Claude Code IDE | VS Code, JetBrains, etc. |
| **Discovery** | Project setting | Auto-discovered in `.github/agents/` |

## When to Use Each

### Use Claude Code (`.claude/`) when:
- Working in Claude Code IDE
- Need explicit model control (Opus vs Sonnet)
- Prefer Claude's specific capabilities

### Use GitHub Copilot (`.github/`) when:
- Working in VS Code or JetBrains
- Want integration with GitHub ecosystem
- Prefer Copilot's code completion + agents

### Use Both when:
- Team uses different IDEs
- Want maximum flexibility
- Different developers prefer different tools

## Benefits of Having Both

1. **Developer Choice**: Use the tool you prefer
2. **Same Workflow**: Same mental model regardless of tool
3. **No Conflict**: Both can coexist in the repository
4. **Team Flexibility**: Different team members can use different tools
5. **Best of Both**: Leverage strengths of each platform

## Migration Between Systems

The agents are designed to be conceptually identical, so:
- **Claude → Copilot**: Add `@` when invoking agents
- **Copilot → Claude**: Remove `@`, Claude auto-detects
- **Context Passing**: Same information flows between phases
- **Agent Roles**: Identical responsibilities

## Summary

Both systems implement the **same agentic workflow philosophy** but are adapted for their respective platforms. The implementation you're looking at provides GitHub Copilot with the same powerful multi-agent coordination that Claude Code has, ensuring all developers can benefit from structured, phase-based development regardless of their tool choice.
