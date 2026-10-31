"""Launch the research CLI from the uv environment for tools that call python3 directly
(local-dev starts the API this way). Prefer `uv run research ...`; run `pnpm deps:install`
(`uv sync --frozen`) first."""

import os
import sys
from pathlib import Path

entry = Path(__file__).resolve().parents[1] / ".venv/bin/research"
if not entry.is_file():
    sys.exit("Python environment missing: run `pnpm deps:install` (uv sync --frozen) first.")
os.execv(entry, [str(entry), *sys.argv[1:]])
