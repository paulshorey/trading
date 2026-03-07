#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

expected_env_files=(
  "apps/log/.env"
  "apps/market-view-next/.env"
  "apps/market-write-node/.env"
  "apps/tradingview-node/.env"
)

missing_env=0
for env_file in "${expected_env_files[@]}"; do
  if [[ ! -f "$env_file" ]]; then
    missing_env=1
    break
  fi
done

if [[ $missing_env -eq 1 ]]; then
  if [[ -n "${INFISICAL_TOKEN:-}" && -n "${INFISICAL_PROJECT_ID:-}" ]]; then
    echo "Hydrating app .env files from Infisical..."
    pnpm run init
  else
    echo "Skipping Infisical bootstrap because required secrets are not configured."
  fi
fi

echo "Workspace ready."
echo "Recommended commands:"
echo "  pnpm dev:market-write-node"
echo "  pnpm build:market-write-node"
