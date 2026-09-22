"""Regenerate the committed integration report from verified local sample data."""
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(root / "lib/strategy-core/src"), str(root / "apps/backtest-runner/src")]
from backtest_runner.data import analyze
from backtest_runner.service import execute

summary = {"purpose": "Integration validation only; no evidence of strategy profitability", "quality": [], "runs": []}
for dataset, example in [("btc-usd-sample", "btc"), ("es-dec2013-sample", "es")]:
    summary["quality"].append(analyze(dataset))
    for strategy in ["sma_cross", "rsi_reversion"]:
        config = json.loads((root / f"apps/backtest-runner/examples/{example}.json").read_text())
        config["strategy"] = strategy
        result = execute(dataset, config)
        summary["runs"].append({"dataset": dataset, "run_id": result["id"], "config": result["config"],
                                "metrics": result["metrics"], "code_sha256": result["provenance"]["code_sha256"]})
output = root / "docs/project/sample-analysis.json"
output.write_text(json.dumps(summary, indent=2) + "\n")
print(output)
