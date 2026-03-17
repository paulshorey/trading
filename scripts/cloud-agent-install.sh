#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
export HUSKY="${HUSKY:-0}"
export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"
STORE_DIR="${PNPM_STORE_DIR:-$ROOT_DIR/.pnpm-store}"

mkdir -p "$PNPM_HOME" "$STORE_DIR" "$ROOT_DIR/.turbo"

case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac

corepack enable
corepack prepare pnpm@10.28.1 --activate

# Preinstall the Android SDK used by notes-android so cloud builds reuse cached tooling.
bash "$ROOT_DIR/scripts/install-android-sdk.sh"

# Install PostgreSQL 17 client tools (psql, pg_dump) for db:migrate and db:verify
need_pg17=false
if ! command -v psql >/dev/null 2>&1 || ! command -v pg_dump >/dev/null 2>&1; then
  need_pg17=true
elif ! pg_dump --version | grep -qE '\b17[.[]'; then
  need_pg17=true
fi
if [[ "$need_pg17" == "true" ]]; then
  echo "Installing PostgreSQL 17 client tools..."
  sudo apt-get update -qq
  sudo apt-get install -y postgresql-common ca-certificates
  sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y
  sudo apt-get install -y postgresql-client-17
  echo "PostgreSQL client tools installed: $(pg_dump --version)"
fi

pnpm fetch --store-dir "$STORE_DIR"
pnpm install --frozen-lockfile --prefer-offline --store-dir "$STORE_DIR"
