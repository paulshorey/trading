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

pnpm fetch --store-dir "$STORE_DIR"
pnpm install --frozen-lockfile --prefer-offline --store-dir "$STORE_DIR"
