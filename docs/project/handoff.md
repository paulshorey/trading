# Handoff: engine, data, and storage

As of November 1, 2026. Read this first, then [AGENTS.md](../../AGENTS.md) and the
[engine design](engine.md).

## Goal

Short-horizon futures strategies, researched on history and run live on the same
code. A rolling `1h@1m` candle (the last hour, every minute) sets a direction bias
that only rules out a direction; rolling `1m@1s` features (the last minute, every
second) time entries; a bracket sized in ATRs exits within minutes. Start with GC
(gold) and NQ (Nasdaq-100), then add products. ML models learn from one row per
would-be trade: the inputs at the decision and the outcome after it.

## Where things stand

| Area     | State                                                                                                                                    |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Code     | Engine, windows, features, TBBO fills, ML rows, research UI, database layer: PR #62 (draft, branch `claude/uv-unified-engine`), CI green |
| Data     | Only the one-day Micro Gold sample is on disk. One year of TBBO for GC, NQ, and other products is downloading                            |
| Database | Local PostgreSQL 18 database `trading` (Homebrew service), migration `0001_foundation` applied, sample file registered                   |
| Services | Under `~/git/local-dev`, Trading web runs on 4400 and the API on 4401; plain `pnpm dev` uses 4400 and 8001                               |
| Strategy | `bias_pullback` is an infrastructure baseline that loses on the sample day; it is not a candidate                                        |

## Decisions and why

| Decision                                                                                                                          | Why                                                                                                                                               | Details                                                             |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Rolling candles in trading time; indicators run per phase on candles one period apart                                             | Complete candles at every step; phase 0 equals standard candles. RSI over consecutive rolling candles correlated only 0.12 with the correct value | [Sliding windows](../sliding-windows/README.md)                     |
| Features use only normalized units, enforced by `features.Unit` and a scale-invariance test                                       | Gold and Nasdaq prices change by multiples over years; models must not learn price levels                                                         | [AGENTS.md](../../AGENTS.md#normalized-features-required)           |
| One engine for backtests and live sessions: whole sessions for speed, one second per call live; `research verify` proves equality | Paper-test unfinished strategies on the code that ships; the equality check also catches look-ahead                                               | [Engine](engine.md)                                                 |
| Explicit timing and conservative TBBO fills (pre-trade book, trade-through targets, stops never better than the trigger)          | Realistic minute-scale costs; every setting is recorded with the run                                                                              | [Timing model](engine.md#timing-model)                              |
| DBN files are the tick archive; PostgreSQL holds everything derived, including one row per scheduled-open second                  | SQL research and fast backtests on stored rows; one consistent stack, no Parquet layer                                                            | [Data](data.md#storage), [storage](../../lib/db-research/README.md) |
| Stored rows are computed by `strategy-core`, the code live sessions run                                                           | Stored history and live features must be identical                                                                                                | [Storage guidance](../../lib/db-research/README.md)                 |
| uv (Python 3.13), numba for per-phase loops, psycopg 3, numbered SQL migrations                                                   | Reproducible environments, fast batch runs, simple schema history                                                                                 | [README](../../README.md)                                           |
| `research-web` is the only UI; its center is the trade inspector                                                                  | Checking backtest logic matters most now                                                                                                          | [Research UI](metric-explorer.md)                                   |

## Run it

```sh
pnpm deps:install && pnpm dev            # UI http://127.0.0.1:4400
uv run research catalog                  # products on disk; lists products without a spec
uv run research backtest apps/backtest-runner/examples/mgc-sample.json
uv run research verify apps/backtest-runner/examples/mgc-sample.json
uv run research db status | migrate | register
pnpm lint && pnpm test && pnpm build
```

## Next task: store one-second rows and metrics

1. **Data.** Put each Databento job folder, unchanged, under
   `data/databento/GLBX.MDP3/<job_id>/`. `research catalog` lists parent symbols
   without a spec; add each to `PRODUCTS` in `lib/strategy-core/src/strategy_core/market.py`
   (tick size, tick value, and its `pandas_market_calendars` name). Then run
   `research db register`.
2. **Validate.** Backtest a week per product and read the per-session quality report
   and fill-delay percentiles. If GC or NQ entries wait more than a few hundred
   milliseconds, consider Databento `mbp-1` for execution.
3. **Per-second fields.** Add the research metrics to `BaseBars` in `bars.py`, in both
   `aggregate` (trades to seconds) and `combine` (seconds to minutes). Keep the tests
   that require roll-ups to equal direct aggregation in any chunking.
4. **Schema.** Add `0002_*.sql`: contracts (from `definition` records), the roll
   schedule, builder versions, and a monthly-partitioned one-second table keyed on
   `(contract_id, end_ns)`. Follow the [storage guidance](../../lib/db-research/README.md).
5. **Ingest command.** For each product and session: `HistoricalSource.session_trades`,
   then `bars.aggregate`, then binary `COPY`. Make each (contract, session) slice
   idempotent (delete, then copy) and record the builder version (code hash,
   `close_delay`, `feed_latency`, files). Store front and next contracts only.
   Parallelize by product or day; the measured `COPY` rate is about 400,000 rows per
   second.
6. **Optional.** Let backtests read stored rows when the builder version and settings
   match the run, with fills still from DBN trades.

Things to know:

- TBBO has only top-of-book data, at trades. "Depth" means the displayed size and
  order count at the best bid and ask (`bid_sz_00`, `ask_sz_00`, `bid_ct_00`,
  `ask_ct_00`). `Trades` does not yet carry the order counts; add them if needed.
  Full depth requires MBP-10.
- CVD needs an explicit origin, such as the session open. Store per-second net delta
  and the running extremes; derive cumulative values from the origin. Unknown-side
  volume (mostly spread legs) stays out of CVD and is reported separately.
- A contract-year is about 21 million scheduled seconds, roughly 8 GB at 44 columns
  before indexes.

## Open questions

1. Which products besides GC and NQ were downloaded, and should they get specs now?
2. Store `no_trades` seconds as rows (simpler queries) or derive them from the
   calendar (about 40% fewer rows for thin products)?
3. Store rolling `1m@1s` and `1h@1m` features, or compute them on read from stored
   one-second rows?
4. Buy `definition` records for contract metadata (expiration, multiplier)?

## Known limits

- TBBO fills in quiet markets use the next trade's book; MGC fills waited a median
  0.6–0.8 s. Measure GC and NQ.
- There is no queue model for limit orders, and no live data or broker adapter yet.
- PRs #56, #58, and #59 target the archived implementation and can be closed.

## Environment

- uv uses its default cache, `~/.cache/uv`.
- `DATABENTO_API_KEY` is exported by `~/.secrets.sh`, which `~/.zshenv` loads. A free
  metadata call confirmed access to `GLBX.MDP3` (2010-06-06 onward). The code does not
  use the key yet; the live feed will.
- PostgreSQL: `brew services start|stop postgresql@18`; data in
  `/opt/homebrew/var/postgresql@18`. Override the connection with
  `TRADING_DATABASE_URL`.
- Agents may stop and restart local-dev services when a task needs it; see
  `~/git/AGENTS.md`. Ports come from `~/git/local-dev/config.json`.
