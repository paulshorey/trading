#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${POSTGRES_URL:-}" ]]; then
  echo "POSTGRES_URL is required"
  exit 1
fi

pg_dump "$POSTGRES_URL" \
  --schema-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  --exclude-table=public.schema_migrations_cursor \
  | sed \
      -e '/^\\restrict /d' \
      -e '/^\\unrestrict /d' \
      -e '/^CREATE SCHEMA public;$/d' \
      -e "/^COMMENT ON SCHEMA public IS 'standard public schema';$/d" \
  > schema/current.sql

echo "Wrote schema/current.sql"
