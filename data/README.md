# Research data

Local data, not in git (except this file). Back it up: the DBN files are the permanent
archive that every stored row is rebuilt from.

| Path                                                                     | Contents                                                                                                             |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `databento/mbp-1/<ROOT>--2025-11-08--2026-11-07/`                        | One Databento batch job per product (GC and SI today), exactly as delivered                      |
| `databento/mbp-1/<job>/glbx-mdp3-YYYYMMDD.mbp-1.dbn.zst`                 | One UTC day of MBP-1: every trade and every change to the best bid and ask, all contracts and spreads of the product |
| `databento/mbp-1/<job>/manifest.json`, `metadata.json`, `condition.json` | File checksums, the job's query (dataset, schema, date range), per-day data quality                                  |
| `databento/definition/` (not downloaded yet)                             | Contract definitions (expirations, tick sizes)                                                                       |
| `runs/`                                                                  | Saved backtest runs (JSON)                                                                                           |

DBN is Databento's binary encoding, compressed with zstd: 27 GB for one year of GC and SI.
Code finds jobs by searching `databento/` for `manifest.json` at any depth
(`apps/backtest-runner/src/backtest_runner/catalog.py`) and reads only `mbp-1` jobs as
market data, so add new downloads as new job folders beside the existing ones and keep them
unchanged. One file is read per UTC day: if two jobs cover different parts of the same day,
`research` refuses to run, so download whole days, or that day again in one job. A job
downloaded again over the same days replaces an earlier copy that is pending, missing, or
absent. Then:

```sh
uv run research catalog --verify   # sizes and SHA-256 against each manifest
uv run research db register        # record files in market.source_file
uv run research ingest plan GC SI  # extend stored rows with the new sessions
```

See [historical data](../docs/project/ingestion.md#the-data-on-this-machine) for what the files contain and how they were
verified, and [ingestion](../docs/project/ingestion.md) for the rows built from them.
