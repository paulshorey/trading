# Auth App

This app tests authentication providers and manages user authentication using Next Auth and Prisma.

## Folder Structure

- `./app` - Next.js app directory with routes and pages
- `./prisma` - Prisma schema for user and auth management
  - `./prisma/schema.prisma` - User accounts and session management
- `./lib/db` - Auth-specific database utilities
  - `./lib/db/auth.ts` - Next Auth configuration with Prisma adapter
  - `./lib/db/prisma.ts` - Prisma client instance
- `./scripts` - Build and setup scripts
- `./middleware.ts` - Next.js middleware for auth

## Database Safety

Neon database project "data" has two branches:

- **DEVELOPMENT** (id: br-dark-hill-adhys7uf) - Test here first
- **PRODUCTION** (id: br-aged-rice-adc9rcrp) - Requires confirmation

**When using Neon MCP tools:**

1. ALWAYS specify `"branchId": "br-dark-hill-adhys7uf"` (development) in params
2. NEVER modify production without user confirmation
3. After dev changes, ask: "Applied to development. Apply to production?"
4. Always label results clearly: "Development Database" or "Production Database"

## Dependencies

This app depends on:
- `@lib/common` - Shared utilities (imported from workspace)
- Prisma - Database ORM for user management
- Next Auth - Authentication framework
