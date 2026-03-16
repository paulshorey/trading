# Eighth Brain .ai

Marketing site for Eighth Brain — an AI-powered knowledge base focused on science, engineering, commerce, and finance. It's going to be very impressive! Gathering the world's knowledge. No, the universe's knowledge! All in one place, for easy access. Personal AI agents to perform deep research, multiple perspectives, inspiring ideas, make the world of possibilities come to life through innovation.

**Live:** [eighthbrain.ai](https://eighthbrain.ai)

## Overview

Proof-of-concept landing page with:

- 3D force-directed knowledge graph visualization (react-force-graph-3d)
- Newsletter/waitlist signup modal (coming soon)
- Navigation links that open the signup modal (no backend yet)
- Responsive marketing layout inspired by Perplexity, Anthropic, Notion

## Tech Stack

- Next.js 14 (App Router)
- Tailwind CSS
- react-force-graph-3d (Three.js)
- TypeScript

## Conventions

- Import shared Tailwind CSS from `@lib/config/tailwind`, not deep paths like `@lib/config/tailwind/shared-styles.css`, because Next/PostCSS resolves package CSS through the package `exports` map.
