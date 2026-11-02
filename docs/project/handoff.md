# Handoff: engine, data, and storage

As of November 1, 2026. Read this first, then [AGENTS.md](../../AGENTS.md) and the
[engine design](engine.md). Prioritized tasks are tracked in [todo.md](todo.md).

## Goal

Short-horizon futures strategies, researched on history and run live on the same
code. A rolling `1h@1m` candle (the last 60 one-minute rows, every minute) sets a
direction bias that only rules out a direction; rolling `1m@1s` features (the last 60
one-second rows, every second) time entries; a bracket sized in ATRs exits within
minutes. Prototype with GC (gold) and SI (silver), then add products. ML models learn
from one row per would-be trade: the inputs at the decision and the outcome after it.

## Core concept: index counters, not clock time

This is the idea everything else rests on; read
[rows and index counters](../sliding-windows/README.md#rows-and-index-counters) before
changing candles, indicators, or tables.

- Every scheduled-open second and minute is one row, including seconds and minutes
  without trades or with missing data. Closures have no rows.
- Each row has an index counter, `slot_ordinal`, that increases by one per row from a
  fixed calendar origin (the first session on or after 2010-01-01). The same slot gets
  the same index in every contract, ingestion batch, backtest, and live session.
- For the row with index `o`: its rolling candle is rows `o − 59 … o`; its phase (the
  original `minute_index` or `second_index`) is `o % 60`; indicators read the
  same-phase candles at `o − 60, o − 120, …`; the previous step is `o − 1`. A minute
  with index `m` holds the seconds with indexes `60m − 59 … 60m`.
- Clock timestamps are kept on every row for charts and joins, but never decide
  window members, phases, or "one period ago".

Worked example: an early close at 18:15 UTC and a reopen at 23:00. The `1h@1m` candle
at 23:01 covers 17:16–18:15 plus 23:00–23:01, and its previous same-phase candle covers
16:16–17:16, exactly 60 rows earlier. A clock rule (same minute of the hour) would
instead compare it with the 18:01 candle, overlapping by 45 minutes.

Implemented in the engine (`SessionCalendar.slot_ordinals`, `windows.RollingWindow`;
tests in `lib/strategy-core/tests/test_windows_features.py`) and in the stored one-second
tables, keyed by `(contract_id, slot_ordinal, end_ns)` ([ingestion](ingestion.md)).

## Where things stand

| Area     | State                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code     | Engine, windows, features, TBBO fills, ML rows, research UI, and database layer merged (PR #62); one-second ingestion on branch `claude/tbbo-second-ingest`                            |
| Data     | One year of TBBO (2025-11-01 to 2026-10-31) for GC, SI, PL, ES, NQ, YM, RTY in `data/databento/tbbo/`: verified and registered                                                         |
| Database | Local PostgreSQL 18 database `trading` (Homebrew service); `0001_foundation` applied, `0002_second_rows` and `0003_continuous_series` pending; all 2,182 files in `market.source_file` |
| Ingest   | `research ingest plan, run, status`: one-second rows and `1m@1s` candle features, tested; not yet run on `trading` ([ingestion](ingestion.md))                                         |
| Services | Under `~/git/local-dev`, Trading web on 4400 and API on 4401; plain `pnpm dev` uses 4400 and 8001                                                                                      |
| Strategy | `bias_pullback` is an infrastructure baseline; it loses money and is not a candidate                                                                                                   |

## Decisions and why

| Decision                                                                                                                                                           | Why                                                                                                                                                   | Details                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Prototype with GC and SI                                                                                                                                           | Liquid enough to research, far smaller than NQ or ES (GC 32M and SI 13M trades a year against NQ's 103M)                                              | [Data](data.md#what-we-have)                                                                          |
| Rolling candles in trading time; indicators run per phase on candles exactly 60 rows apart, phase = trading-time index mod 60 (never the clock)                    | Complete candles at every step; early closes cannot misalign phases. RSI over consecutive rolling candles correlated only 0.12 with the correct value | [Sliding windows](../sliding-windows/design.md#3-phases)                                              |
| Features use only normalized units, enforced by `features.Unit` and a scale-invariance test                                                                        | Prices change by multiples over years; models must not learn price levels                                                                             | [AGENTS.md](../../AGENTS.md#normalized-features-required)                                             |
| One engine for backtests and live sessions: whole sessions for speed, one second per call live; `research verify` proves equality                                  | Paper-test unfinished strategies on the code that ships; the equality check also catches look-ahead                                                   | [Engine](engine.md)                                                                                   |
| Explicit timing and conservative TBBO fills (pre-trade book, trade-through targets, stops never better than the trigger)                                           | Realistic second-scale costs; every setting is recorded with the run                                                                                  | [Timing model](engine.md#timing-model)                                                                |
| DBN files are the tick archive; PostgreSQL holds everything derived                                                                                                | SQL research and fast backtests on stored rows; one consistent stack, no Parquet layer                                                                | [Data](data.md#storage), [storage](../../lib/db-research/README.md)                                   |
| Every scheduled-open second gets a row, including seconds without trades                                                                                           | Each sliding window is exactly 60 consecutive rows, with no skip logic. SI trades in only 20% of its seconds                                          | [Storage](../../lib/db-research/README.md)                                                            |
| Stored rows are computed by `strategy-core`, the code live sessions run                                                                                            | Stored history and live features must be identical                                                                                                    | [Storage](../../lib/db-research/README.md)                                                            |
| TBBO only, the same rules for every product; no more detailed data                                                                                                 | Budget and consistency. Trades are exact; the book is seen only at trades, so fills carry 1–2 ticks of uncertainty in GC and SI                       | [Data limits](engine.md#data-limits-tbbo-only)                                                        |
| Use Databento `definition` records for contract metadata                                                                                                           | Free for this data (quoted $0.00); authoritative expiration, tick size, and multiplier; distinguishes raw symbols that repeat each decade             | [Data](data.md#what-we-have)                                                                          |
| uv (Python 3.13), numba for per-phase loops, psycopg 3, numbered SQL migrations                                                                                    | Reproducible environments, fast batch runs, simple schema history                                                                                     | [README](../../README.md)                                                                             |
| `research-web` is the only UI; its center is the trade inspector                                                                                                   | Checking backtest logic matters most now                                                                                                              | [Research UI](metric-explorer.md)                                                                     |
| Store the rolling `1m@1s` candle and its 85 features per second, beside the exact per-second base row (decided November 1, 2026)                                   | Research and ML read compiled rows directly; base rows keep every statistic mergeable for other windows                                               | [Ingestion](ingestion.md)                                                                             |
| One continuous series per product (`market.continuous_*` views): each session from its front contract, never a merge of delivery months (decided November 1, 2026) | Months trade at different prices; per-contract features stay free of roll jumps, and the index counter continues across rolls                         | [Continuous series](ingestion.md#continuous-series-per-product)                                       |
| Rolls follow the most volume in the previous session, only forward to later delivery months, the same rule in backtests and stored rows                            | Causal; no rolling back on a day when the expiring month trades more                                                                                  | [Ingestion](ingestion.md#continuous-series-per-product)                                               |
| Store each front contract from 5 sessions before it becomes front; a builder hash marks stored rows stale after any change to the code that computes them          | Indicators are warm at each roll; rows never mix code versions                                                                                        | [Ingestion](ingestion.md#run-it)                                                                      |
| TBBO metrics follow the handoff's validity subsets and merge rules; values are NULL when undefined, never zero                                                     | Exact windows of any length; missing, quiet, and invalid stay distinguishable                                                                         | [TBBO handoff](tbbo-engineering-handoff.md), [differences](ingestion.md#differences-from-the-handoff) |

## Data verification (November 1, 2026)

All 2,181 files match their manifests (size and SHA-256), every record is a trade in
receive order, tick sizes implied by the prices match the product specs, and no
outright trade falls outside the exchange calendar for any product on any day. Watch
for: 2025-11-28 (CME outage, `degraded`; most NQ, YM, and RTY records flag a possibly
wrong book), six other `degraded` dates, and unknown-side volume of about 3% in metals
(spread legs). The [data page](data.md#what-we-have) has per-product numbers and roll
months.

## Run it

```sh
pnpm deps:install && pnpm dev            # UI http://127.0.0.1:4400
uv run research catalog [--verify]       # products on disk; --verify checks every file
uv run research backtest apps/backtest-runner/examples/gc.json   # also si.json, mgc-sample.json
uv run research verify apps/backtest-runner/examples/mgc-sample.json
uv run research db status | migrate | register
uv run research ingest plan GC SI | run GC SI | status   # stored one-second rows
pnpm lint && pnpm test && pnpm build
```

## Next task: run the one-second ingest, then add `1h@1m` rows

Implemented on November 1, 2026 ([ingestion](ingestion.md)): per-second TBBO metrics
(`metrics.py`), their rolling windows (`window_metrics.py`), 77 more `1m@1s` features
(`indicators.py`), the row builder with exact checkpoints (`rows.py`, `state.py`),
migration `0002_second_rows`, and `research ingest`.

1. **Run it.** `research db migrate`, then `research ingest plan GC SI` and
   `research ingest run GC SI`. Expect about 46.5 million rows and 59 GB. Check
   `research ingest status` (every front session stored in the continuous series) and the
   session reports, especially the `degraded` dates.
2. **`1h@1m` rows.** `market.bar_1m` rolled up from `bar_1s` (merge each metric field by its
   kind) and `market.candle_1h_1m` with the same features on the `BIAS` window spec.
3. **Definitions.** Download the `definition` batch job (settings in
   [data](data.md#what-we-have)) into `data/databento/definition/` and load expirations into
   `market.contract`. Submitting the job needs the account owner's approval.
4. **Optional.** Let backtests read stored rows when the builder version and settings
   match the run, with fills still from DBN trades.

Things to know:

- TBBO has only top-of-book data, at trades. "Depth" means the displayed size and
  order count at the best bid and ask (`bid_sz_00`, `ask_sz_00`, `bid_ct_00`,
  `ask_ct_00`), all carried by `Trades`. There is no depth beyond the best price.
- CVD needs an explicit origin. Stored rows keep per-second net delta and its running
  extremes, plus `session_cvd` from the session open (NULL after missing data).
  Unknown-side volume stays out of CVD and is reported separately.
- TBBO shows the book only at trades. At random moments in September 2026, the next
  SI trade came a median 5.9 s later (GC 1.7 s), and the ask had often moved 2+ ticks
  by then. Store book fields with their age, and see the recommended fill changes in
  [data limits](engine.md#data-limits-tbbo-only).
- A contract-year is about 21 million scheduled seconds: about 27 GB in the two stored
  tables (measured), so check disk space before adding products.

## Open questions

1. When to bring in PL, YM, RTY, ES, and NQ, all of which are on disk with specs. At about
   27 GB per contract-year, all seven products would need about 200 GB a year.
2. Store features as `real` to halve the candle table, giving up exact equality with
   in-memory features?

The TBBO fill safeguards are deferred until the core works and is tested; they are
specified in [todo.md](todo.md#later-refinements-after-the-core-is-tested).

## Known limits

- There is no queue model for limit orders, and no live data or broker adapter yet.

## Environment

- uv uses its default cache, `~/.cache/uv`.
- `DATABENTO_API_KEY` is exported by `~/.secrets.sh`, which `~/.zshenv` loads. Free
  metadata and cost calls work. The code does not use the key yet; the live feed will.
- PostgreSQL: `brew services start|stop postgresql@18`; data in
  `/opt/homebrew/var/postgresql@18`. Override the connection with
  `TRADING_DATABASE_URL`.
- Agents may stop and restart local-dev services when a task needs it; see
  `~/git/AGENTS.md`. Ports come from `~/git/local-dev/config.json`.
- Never print full process command lines on this Mac: some processes carry secrets in
  their arguments.
