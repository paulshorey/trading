#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

expected_env_files=(
  "apps-trading/log-next/.env"
  "apps-trading/view-next/.env"
  "apps-trading/write-node/.env"
  "apps-trading/tradingview-node/.env"
  "apps-marketing/eighthbrain-next/.env"
  "apps-marketing/notes-next/.env"
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
    echo "App .env files are missing, but Infisical bootstrap secrets are not configured."
    echo "Set INFISICAL_TOKEN and INFISICAL_PROJECT_ID in Cursor Cloud Agent secrets, then rerun pnpm run init."
  fi
fi

echo "Workspace ready."
echo "Recommended commands:"
echo "  pnpm run deps:install -- <package>..."
echo "  pnpm dev:write-node"
echo "  pnpm build:write-node"
