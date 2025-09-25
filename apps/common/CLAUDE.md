### Common folder

- ./apps/common - common files imported by other apps, mostly helping with user and database management, but also containing useful utilities, functions, components, and server actions to accomplish various tasks and integrate with 3rd party services

- ./apps/common/sql - functions, types, and interfaces for interacting with databases
- ./apps/common/sql/\* - add, get, and manage types of each database table in Neon DB
- ./apps/common/twillio - integration with Twillio to send logs and alerts via SMS message
- ./apps/common/fe - client-side React components, hooks, and utility functions
- ./apps/common/cc - saves console logs to the cloud after printing them in the terminal
- ./apps/common/prisma/schema.prisma - auth and user accounts are managed in Prisma DB

### Database safety:

Neon database project "data" has two branches:

- **DEVELOPMENT** (id: br-dark-hill-adhys7uf) - Test here first
- **PRODUCTION** (id: br-aged-rice-adc9rcrp) - Requires confirmation
  Note: Neon API requires IDs, not names.

**When using Neon MCP tools:**

1. ALWAYS specify `"branchId": "br-dark-hill-adhys7uf"` (development) in params - omitting defaults to production.
2. NEVER modify production without user confirming to apply to production!
3. After dev changes, ask: "Applied to development. Apply to production?"
4. Always label results clearly: "Development Database" or "Production Database"
