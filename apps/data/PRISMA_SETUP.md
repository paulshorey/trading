# Prisma Multi-Environment Setup Guide

This setup allows you to use different database URLs for development and production environments.

## Quick Start

### 1. Create Environment Files

Create these files in `/apps/data/` (they're gitignored):

**`.env.local` (Development):**

```bash
# Development Database
DATABASE_URL="postgresql://username:password@localhost:5432/yourdb_dev"

# NextAuth
NEXTAUTH_SECRET="your-nextauth-secret-here"
NEXTAUTH_URL="http://localhost:5555"
```

**`.env.production.local` (Production):**

```bash
# Production Database
DATABASE_URL="postgresql://username:password@your-prod-server:5432/yourdb_prod"

# NextAuth
NEXTAUTH_SECRET="your-production-nextauth-secret-here"
NEXTAUTH_URL="https://your-production-domain.com"
```

### 2. Install Dependencies

```bash
cd apps/data
pnpm install
```

### 3. Generate Prisma Client

```bash
# For development
pnpm prisma:generate:dev

# For production
pnpm prisma:generate:prod
```

## Available Scripts

| Script                      | Description                                           |
| --------------------------- | ----------------------------------------------------- |
| `pnpm prisma:generate:dev`  | Generate Prisma client using development DATABASE_URL |
| `pnpm prisma:generate:prod` | Generate Prisma client using production DATABASE_URL  |
| `pnpm prisma:migrate:dev`   | Run migrations in development                         |
| `pnpm prisma:migrate:prod`  | Deploy migrations in production                       |
| `pnpm prisma:push:dev`      | Push schema changes to development DB                 |
| `pnpm prisma:push:prod`     | Push schema changes to production DB                  |
| `pnpm prisma:studio:dev`    | Open Prisma Studio for development DB                 |
| `pnpm prisma:studio:prod`   | Open Prisma Studio for production DB                  |

## How It Works

### Environment-Specific Generation

The custom script `scripts/prisma-generate.js` loads the appropriate `.env` file and sets environment variables before running `prisma generate`. This solves the problem of Prisma not picking up environment-specific env files.

### Database Schema

The schema includes:

- **NextAuth.js tables**: Account, Session, User, VerificationToken
- **Application tables**: Log, Order
- **Proper indexing and relationships**

### File Structure

```
apps/data/
├── prisma/
│   ├── schema.prisma          # Main schema file
│   └── ..prisma/              # Generated client (auto-created)
├── scripts/
│   └── prisma-generate.js     # Environment-specific generation script
├── lib/
│   └── prisma.ts              # Prisma client export
├── .env.local                 # Development environment (create this)
├── .env.production.local      # Production environment (create this)
└── .env.example              # Template for environment variables
```

## Workflow Examples

### Development Workflow

```bash
cd apps/data

# Set up development database
pnpm prisma:migrate:dev

# Generate client for development
pnpm prisma:generate:dev

# View/edit data
pnpm prisma:studio:dev
```

### Production Deployment

```bash
cd apps/data

# Deploy migrations to production
pnpm prisma:migrate:prod

# Generate client for production
pnpm prisma:generate:prod
```

### Making Schema Changes

1. Edit `prisma/schema.prisma`
2. Test in development:
   ```bash
   pnpm prisma:migrate:dev
   pnpm prisma:generate:dev
   ```
3. Deploy to production:
   ```bash
   pnpm prisma:migrate:prod
   pnpm prisma:generate:prod
   ```

## Import in Other Apps

Other apps in the monorepo can import the Prisma client:

```typescript
import { prisma } from "@apps/data/lib/prisma";

// Use prisma client
const users = await prisma.user.findMany();
```

## Troubleshooting

### "Database URL not found"

Make sure you've created the appropriate `.env.local` or `.env.production.local` file with a valid `DATABASE_URL`.

### "Prisma client not generated"

Run the appropriate generate command:

- `pnpm prisma:generate:dev` for development
- `pnpm prisma:generate:prod` for production

### Different schema per environment

If you need completely different schemas per environment, create separate schema files and modify the generation script to use different schema paths.
