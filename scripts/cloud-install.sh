#!/bin/sh
# Cloud agent setup: JavaScript and Python dependencies from the lockfiles.
set -e
pnpm install --frozen-lockfile
if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/0.13.6/install.sh | sh
  PATH="$HOME/.local/bin:$PATH"
fi
uv sync --frozen
