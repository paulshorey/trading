from pathlib import Path
import sys
import unittest

root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root / "lib/strategy-core/src"), str(root / "apps/backtest-runner/src")]
suite = unittest.defaultTestLoader.discover(str(root / "apps/backtest-runner/tests"))
result = unittest.TextTestRunner(verbosity=2).run(suite)
sys.exit(not result.wasSuccessful())
