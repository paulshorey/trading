# Migration

After creating the new table from old schema, I still had to do this:

```sql
-- Add unique constraint (required for ON CONFLICT)
-- Run this only if there are no duplicate (ticker, timenow) rows
ALTER TABLE strength_v1
ADD CONSTRAINT strength_v1_ticker_timenow_unique UNIQUE (ticker, timenow);

-- 1. Create a sequence for the id column
CREATE SEQUENCE strength_v1_id_seq;

-- 2. Set the sequence's current value to avoid conflicts with existing rows
SELECT setval('strength_v1_id_seq', COALESCE((SELECT MAX(id) FROM strength_v1), 0) + 1);
-- or this one is more explicit and avoids any potential issues with the sequence name
SELECT setval(pg_get_serial_sequence('public.strength_v1', 'id'), COALESCE((SELECT MAX(id) FROM public.strength_v1), 0) + 1);

-- 3. Set id's default to use the sequence
ALTER TABLE strength_v1 ALTER COLUMN id SET DEFAULT nextval('strength_v1_id_seq');

-- 4. Optionally: attach the sequence to the column so it behaves like SERIAL
ALTER SEQUENCE strength_v1_id_seq OWNED BY strength_v1.id;

-- I manually renamed a column in the new table, must update it if restoring the schema:
ALTER TABLE strength_v1 RENAME COLUMN created_at TO updated_at;
```

## Migrating table to new database

Use connection URLs (host, port, user, password, and SSL options are parsed from the URL). Replace `OLD_DATABASE_URL`, `NEW_DATABASE_URL`, and `TABLE_NAME` with real values.

### Schema only

```bash
pg_dump "$OLD_DATABASE_URL" --schema-only -t public.TABLE_NAME \
  | psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1
```

### Schema and data (single-file dump)

Dump to a file, then restore. Allows retry and works with pooled connections (Neon, Railway).

```bash
pg_dump "$OLD_DATABASE_URL" -Fc -t public.TABLE_NAME -f migration.dump
pg_restore -d "$NEW_DATABASE_URL" -Fc -v migration.dump
```

### Data only

When the schema already exists in the target:

```bash
pg_dump "$OLD_DATABASE_URL" -a -t public.TABLE_NAME -f migration.dump
pg_restore -d "$NEW_DATABASE_URL" -a -v migration.dump
```

### Schema and data (pipe, quick one-liner)

For small or medium tables:

```bash
pg_dump "$OLD_DATABASE_URL" -t public.TABLE_NAME \
  | psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1
```

### Extra large tables

For very large tables, see [backups.md](./backups.md)—use parallel directory format (`-Fd -j`) with a direct (non-pooled) connection when available. Pooled connections often fail with parallel dump.

### Tips

#### Schema name

Usually `public`. Use `-t public.log_v1` or just `-t log_v1`.

#### `ON_ERROR_STOP=1`

Makes psql exit on first error instead of continuing.

#### Dry run

Omit the `| psql ...` part and redirect to a file to inspect the SQL first:

```bash
pg_dump "$OLD_DATABASE_URL" --schema-only -t public.TABLE_NAME > schema.sql
```

Then apply: `psql "$NEW_DATABASE_URL" -v ON_ERROR_STOP=1 -f schema.sql`

#### Multiple tables

Use `-t public.table1 -t public.table2` or `-t 'public.table*'` (pattern).

#### Sequence reset

After data migration with serial/identity columns:

```sql
SELECT setval(pg_get_serial_sequence('public.TABLE_NAME', 'id'), COALESCE((SELECT MAX(id) FROM public.TABLE_NAME), 0) + 1);
```

How would I know if the table has serial/identity columns?

You can tell in a few ways:

1. **`pg_get_serial_sequence`** — Returns the sequence name for a column, or `NULL` if it doesn’t use one (serial/identity columns use a sequence):

   ```sql
   SELECT pg_get_serial_sequence('public.log_v1', 'id');
   -- Returns: public.log_v1_id_seq (serial/identity)
   -- Returns: NULL (no sequence)
   ```

2. **`information_schema.columns`** — Check `column_default` for `nextval`:

   ```sql
   SELECT column_name, column_default
   FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'log_v1';
   -- Serial/identity columns have column_default like nextval('...'::regclass)
   ```

3. **`pg_attribute.attidentity`** — For identity columns only:

   ```sql
   SELECT a.attname, a.attidentity
   FROM pg_attribute a
   JOIN pg_class c ON a.attrelid = c.oid
   JOIN pg_namespace n ON c.relnamespace = n.oid
   WHERE c.relname = 'log_v1' AND n.nspname = 'public'
     AND a.attnum > 0 AND NOT a.attisdropped;
   -- attidentity = 'a' (ALWAYS) or 'd' (BY DEFAULT) means identity column
   ```

**Rule of thumb:** If there’s an `id` (or similar) column and you didn’t insert it manually, it’s likely serial or identity. Running `pg_get_serial_sequence('public.TABLE_NAME', 'id')` is the quickest check; a non‑null result means you should reset the sequence after migrating data.
