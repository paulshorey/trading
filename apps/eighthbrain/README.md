# Eighth Brain .ai

Marketing site for Eighth Brain — an AI-powered knowledge base focused on science, engineering, commerce, and finance.

**Live:** [eighthbrain.ai](https://eighthbrain.ai)

## Overview

Proof-of-concept landing page with:
- 3D force-directed knowledge graph visualization (react-force-graph-3d)
- Newsletter/waitlist signup modal (coming soon)
- Navigation links that open the signup modal (no backend yet)
- Responsive marketing layout inspired by Perplexity, Anthropic, Notion

## Development

```bash
pnpm --filter eighthbrain dev   # Port 3340
pnpm --filter eighthbrain build
pnpm --filter eighthbrain start
```

## Tech Stack

- Next.js 14 (App Router)
- Tailwind CSS
- react-force-graph-3d (Three.js)
- TypeScript
