#!/bin/zsh
# Fingerprint every derived row of a research database: per table and contract, the row count
# and an order-free hash of every column but builder_id. Two databases built from the same
# files by the same code print the same lines, so a rebuild (on this machine or another) can be
# compared with `diff`. Contracts are named by symbol, since their ids differ between databases.
#
#   scripts/db-fingerprint.sh [database] > fingerprint.txt      (default database: trading)
set -euo pipefail
db=${1:-trading}
tables=$(psql -d "$db" -Atc "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'market' and (c.relkind = 'p' or c.relname = 'pivot_event') order by 1")
for t in ${(f)tables}; do
  cols=$(psql -d "$db" -Atc "select string_agg(quote_ident(column_name), ',' order by column_name)
    from information_schema.columns where table_schema = 'market' and table_name = '$t'
    and column_name not in ('builder_id', 'contract_id', 'variant_id')")
  has_variant=$(psql -d "$db" -Atc "select count(*) from information_schema.columns
    where table_schema = 'market' and table_name = '$t' and column_name = 'variant_id'")
  if [[ $has_variant == 1 ]]; then
    psql -d "$db" -Atc "select '$t', c.raw_symbol, v.name, count(*),
      sum(hashtextextended(row($cols)::text, 0)::numeric)
      from market.$t x join market.contract c on c.id = x.contract_id
      join market.variant v on v.id = x.variant_id group by 2, 3 order by 2, 3"
  else
    psql -d "$db" -Atc "select '$t', c.raw_symbol, '', count(*),
      sum(hashtextextended(row($cols)::text, 0)::numeric)
      from market.$t x join market.contract c on c.id = x.contract_id group by 2 order by 2"
  fi
done
