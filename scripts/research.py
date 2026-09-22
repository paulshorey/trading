"""Repo launcher: no third-party Python packages required for the baseline."""
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root / "lib/strategy-core/src"), str(root / "apps/backtest-runner/src")]
if __name__ == "__main__":
    from backtest_runner.cli import main
    main()
