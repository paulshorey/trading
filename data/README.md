# Research data

Local data, not in git (except this file). Back it up: the DBN files are the permanent
archive that every stored row is rebuilt from.

| Path                                                                    | Contents                                                                                     |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `databento/tbbo/<ROOT>--2025-11--2026-10/`                              | One Databento batch job per product (GC, SI, PL, ES, NQ, YM, RTY), exactly as delivered      |
| `databento/tbbo/<job>/glbx-mdp3-YYYYMMDD.tbbo.dbn.zst`                  | One UTC day of TBBO trades with the pre-trade book, all contracts and spreads of the product |
| `databento/tbbo/<job>/manifest.json`, `metadata.json`, `condition.json` | File checksums, the job's query (dataset, schema, date range), per-day data quality          |
| `databento/definition/` (not downloaded yet)                            | Contract definitions (expirations, tick sizes)                                               |
| `sample/`                                                               | A one-day Micro Gold sample used by tests and examples                                       |
| `runs/`                                                                 | Saved backtest runs (JSON)                                                                   |

DBN is Databento's binary encoding, compressed with zstd: 7.3 GB for one year of the seven
products. Code finds jobs by searching `databento/` for `manifest.json` at any depth
(`apps/backtest-runner/src/backtest_runner/catalog.py`), so add new downloads as new job
folders beside the existing ones and keep them unchanged. Then:

```sh
uv run research catalog --verify   # sizes and SHA-256 against each manifest
uv run research db register        # record files in market.source_file
uv run research ingest plan GC SI  # extend stored rows with the new sessions
```

See [historical data](../docs/project/data.md) for what the files contain and how they were
verified, and [ingestion](../docs/project/ingestion.md) for the rows built from them.
