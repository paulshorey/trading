# Handoff

As of November 3, 2026. Start here, then read [AGENTS.md](../../AGENTS.md). Tasks are
tracked in [todo.md](todo.md); this page explains the architecture, the decisions behind
it, and where the work stands.

## Goal

A platform to research short-horizon futures strategies and machine-learning models on
history, then run them live on the same code. A rolling `1h@1m` candle (the last 60
one-minute rows, every minute) sets a direction bias that only rules out a direction;
rolling `1m@1s` features (the last 60 one-second rows, every second) time entries; a
bracket sized in ATRs exits within minutes. Prototype with GC (gold) and SI (silver), then
add products. Models train on at least a year of history.

## Architecture

```text
data/databento/tbbo/*.dbn.zst      Permanent tick archive: Databento TBBO, one file per day
        │                          and product, gitignored (data/README.md)
        │  catalog.py (files, checksums), source.py (one contract's trades per session)
        ▼
lib/strategy-core                  The same code for history and live sessions
  bars.py, metrics.py              Trades → one row per scheduled second, exact statistics
  windows.py, window_metrics.py    Rolling candles: rows o − 59 … o
  kernels.py, indicators.py        Per-phase indicators: candles o, o − 60, o − 120, …
  features.py                      Normalized features (Unit), engine.py strategies and fills
  rows.py, state.py                Rows to store, with exact checkpoints
        │                                      │
        ▼                                      ▼
Engine: backtests and rehearsals      research ingest → PostgreSQL `trading`
(research backtest, verify)           market.bar_1s, market.candle_1m_1s   (per contract)
                                      market.continuous_*                  (per product)
                                                  │
                                                  ▼
                                      ML training (next): one model on pooled examples
```

`apps/backtest-runner` holds the data adapters, calendars, ingestion, CLI (`research`), and
the local API; `apps/research-web` is the UI (run setup, results, trade inspector).

## Core rules

These are fundamental; changing any of them changes every stored value.

1. **Rows and index counters, never clock time.** Every scheduled-open second and minute is
   one row, with or without trades or data; closures have no rows. Each row has an index
   counter, `slot_ordinal`, from a fixed calendar origin. For row `o`: the rolling candle
   is rows `o − 59 … o`, the phase is `o % 60`, indicators read the same-phase candles at
   `o − 60, o − 120, …`, and minute `m` holds seconds `60m − 59 … 60m`. After an 18:15
   early close and a 23:00 reopen, the 23:01 hourly candle covers 17:16–18:15 plus
   23:00–23:01, and its previous same-phase candle is exactly 60 rows earlier
   ([rows and index counters](../sliding-windows/README.md#rows-and-index-counters)).
2. **Indicators per phase.** Periods count candles of one phase, so on `1m@1s` RSI(14) is a
   14-minute RSI updated every second, and on `1h@1m` a 14-hour RSI updated every minute.
   Never feed consecutive rolling candles (they share 59 of 60 rows) to an indicator.
3. **Normalized features.** Features and model inputs are price-free: basis points, ATR
   multiples, ratios, 0–100 indexes, log ratios, or seconds, each comparing a contract with
   its own history (`features.Unit`, enforced by a scale-invariance test). Raw prices are
   only for order prices, fills, P&L, and charts.
4. **One engine.** Backtests, rehearsals, and (later) live sessions run the same code; whole
   sessions and second-by-second processing give identical results (`research verify`).
   Trades go to the second of their exchange event time; each second closes 100 ms after
   it ends, and a trade arriving later joins the second open when it arrived
   ([timing model](engine.md#timing-model)).
5. **Per-contract computation; rolls switch, never stitch.** Delivery months trade at
   different prices, so every candle, indicator, and outcome is computed within one
   contract. The front contract has the most volume in the previous complete session,
   switches at a session open, and only moves to a later month (`source.next_front`, the
   same in backtests and storage, `market.roll`). Each contract is computed from 5 sessions
   before it becomes front, so its indicators are warm at the switch; the warm-up must
   cover the slowest indicator (EMA(50) of hourly candles needs about 2.2 sessions; EMA(200)
   of hourly candles would need 9 or more). The views `market.continuous_bar_1s` and
   `market.continuous_candle_1m_1s` read each product as one series by taking every session
   from its front contract; only raw prices jump at a roll, flagged by `rolled`.

### Training across contracts (decided November 2, 2026)

- **One model, trained on examples pooled from every contract** (and later every product),
  not one model per contract. An example is one decision moment: the features then, and
  the outcome after it (a simulated trade or a return in basis points).
- **Each example lies entirely within one contract**: features from that contract's own
  history, outcome measured on the same contract. Outcomes last minutes and positions are
  closed before each session ends, while rolls happen at a session open, so no example
  spans a roll.
- **Examples come from front-contract sessions**; warm-up sessions only build indicator
  history. Examples need not form one continuous timeline.
- **Test by time.** Neighboring examples are nearly identical, so split chronologically,
  leave a gap (purge and embargo) between training and test periods, fit any rescaling on
  training data only, and evaluate a final holdout of the newest data once.
- **No price level or contract identity as an input.** A `sessions_since_roll` input is an
  option for lifecycle effects.
- **Live**: the model runs on the current front contract; the next one is computed in
  parallel during its warm-up and taken over at the roll.

## Where things stand

| Area     | State                                                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code     | Engine, windows, features, fills, ML rows, UI, and database layer (PR #62), and one-second ingestion with the continuous series (PR #63), all merged into `main` |
| Data     | One year of TBBO (2025-11-01 to 2026-10-31) for GC, SI, PL, ES, NQ, YM, RTY in `data/databento/tbbo/` (7.3 GB), verified and registered                          |
| Database | PostgreSQL 18 database `trading`: migrations `0001`–`0003` applied; GC and SI stored, 46,503,000 rows in each second table (57.65 GB including indexes)          |
| Ingest   | Run #1 completed November 3: 11 min 2 s, 8 workers; both products have 257/257 front sessions, no missing rows ([verification](#first-ingest-gc-and-si))         |
| Strategy | `bias_pullback` is an infrastructure baseline that loses money, not a candidate                                                                                  |
| UI       | Trading web on 4400 and API on 4401 under `~/git/local-dev`; plain `pnpm dev` uses 4400 and 8001                                                                 |

Stored rows ([ingestion](ingestion.md)): `market.bar_1s` holds each second's exact
statistics (OHLCV by aggressor side, CVD, sweeps, sizes, price path, and the book at trades:
spread, displayed size and orders, imbalance, effective spread); `market.candle_1m_1s`
holds the rolling `1m@1s` candle and 87 normalized features. The first full GC and SI
ingest took 11 min 2 s with 8 workers and uses 57.65 GB including indexes
([measurements](ingestion.md#measured)). The metrics follow the [TBBO engineering handoff](tbbo-engineering-handoff.md);
about 40 of its entries are not stored yet ([list](ingestion.md#metrics)) and can be added
by rebuilding from the DBN files ([how](ingestion.md#adding-a-metric-or-feature)).

## First ingest (GC and SI)

Completed November 3, 2026, on `main` commit `738fd6a`, in local PostgreSQL 18 database
`trading` at `127.0.0.1:5432`. Run #1 exited 0 with `"status": "done"`; wall time was
661.594 s (11 min 2 s), using 8 workers. No code fixes or new migrations were needed.

- **Coverage:** 6 contracts and 282 contract-sessions per product, including warm-up;
  46,503,000 rows in **each** table (93,006,000 total). GC and SI each publish all 257
  front sessions, November 3, 2025 through October 30, 2026, with no missing rows.
- **Sizes including indexes:** `bar_1s` 14.91 GB; `candle_1m_1s` 42.74 GB; total 57.65 GB
  (decimal GB). Free disk after the run: 254 GiB.
- **Resume check:** `research ingest plan GC SI` reports every contract `current`,
  `todo_sessions = 0`, `todo_rows = 0`, and no unresolved sessions.
- **Quality:** inspected all 15 contract-session reports referencing degraded files,
  including 2025-11-28, 2026-03-16, and 2026-04-10. They retain degraded source conditions;
  none reports rejected trades, bad receive-time/book flags, or missing rows. Missing
  rows measure file coverage; zero does not clear the outage or certify a session for ML.
  The [session quality policy](todo.md#now-make-the-core-work-and-test-it) remains open.
- **Roll:** July 30 switches GCQ6 to GCZ6 with `rolled = true`, consecutive ordinals, and
  populated RSI, ATR, and EMA(21) at the open. Last observed GCQ6 close was 4065.5;
  first GCZ6 close was 4123.9. Candles use GCZ6's own history. Three later complete
  candles have NULL RSI because their prior same-phase candles were empty; this follows
  the documented indicator re-seeding policy.

Local run evidence: `~/ingest-gc-si.log` (one line per session),
`~/ingest-gc-si.summary.json`, and `~/ingest-gc-si.process.json` (runtime and exit status).
To check current coverage or extend after new downloads:

```sh
uv run research db status
uv run research ingest status
uv run research ingest plan GC SI
caffeinate -i uv run research ingest run GC SI 2> ~/ingest-gc-si-next.log
```

Inspect a session's report and source conditions with:

```sql
SELECT c.raw_symbol, s.trade_date, s.missing, s.report, s.source_files
FROM market.ingest_slice s JOIN market.contract c ON c.id = s.contract_id
WHERE s.trade_date IN ('2025-11-28', '2026-03-16', '2026-04-10');
```

**If it fails** (non-zero exit, `"status": "partial"` or `"failed"`, or a `FAILED` line in
the log), stop and read the log and `research ingest status` (recent runs keep the error).
Stored sessions stay intact and readable: each session is written in one transaction, so
fixing the cause and rerunning `ingest run GC SI` resumes where it stopped.

| Symptom                                    | Cause and remedy                                                                  |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `Database migrations not applied`          | `uv run research db migrate`                                                      |
| `... is being built by another ingest run` | Another run holds that contract; wait for it or stop it                           |
| `No space left on device` or a COPY error  | Free disk space, then rerun                                                       |
| `Checksum mismatch` for a file             | Re-download that file's job; `research catalog --verify` lists the failures       |
| `... cover different parts of this day`    | Two jobs split a UTC day; download that day in one job                            |
| Plan shows `stale` or `needs_rebuild`      | Code or earlier files changed since rows were built; rerun with `--rebuild`       |
| `unresolved_sessions` is not empty         | Those sessions have no volume in their download; check their files and conditions |
| Anything else, or values that look wrong   | Stop; report the log excerpt, contract, and session; do not delete rows by hand   |

All stored rows can be rebuilt from the DBN files (`--rebuild`), so a failure never needs
manual database repair.

## Decisions

The core rules above, plus:

| Decision                                                                                             | Why                                                                                                                             | Details                                                             |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Prototype with GC and SI                                                                             | Liquid, and far smaller than NQ or ES (GC 32M and SI 13M trades a year against NQ's 103M)                                       | [Data](data.md#what-we-have)                                        |
| TBBO only, the same rules for every product                                                          | Budget and consistency. Trades are exact; the book is seen only at trades, so fills carry 1–2 ticks of uncertainty in GC and SI | [Data limits](engine.md#data-limits-tbbo-only)                      |
| DBN files are the permanent archive; PostgreSQL holds everything derived                             | Every stored value can be rebuilt or extended; SQL for research; no Parquet layer                                               | [Data](data.md#storage), [storage](../../lib/db-research/README.md) |
| Store each second's base row and its `1m@1s` candle with features; NULL when undefined, never zero   | Research and ML read compiled rows; base rows stay mergeable into any window; missing, quiet, and invalid stay distinct         | [Ingestion](ingestion.md)                                           |
| Store features as `double precision`, not `real` (decided November 2, 2026)                          | Stored features equal in-memory and live values exactly; disk space is not a concern                                            | [Measured](ingestion.md#measured)                                   |
| Event-time assignment and per-phase indicators confirmed against the TBBO handoff (November 2, 2026) | Stored rows equal what backtests and live sessions compute; the two clocks disagree on about 1 trade in 2,000                   | [Differences](ingestion.md#differences-from-the-handoff)            |
| A builder hash covers the code, settings, packages, and columns that make stored values              | Rows never mix code versions; changed code shows as `stale` until `--rebuild`                                                   | [Ingestion](ingestion.md#run-it)                                    |
| Conservative TBBO fills (pre-trade book, trade-through targets, stops never better than the trigger) | Realistic second-scale costs; every setting is recorded with the run                                                            | [Timing model](engine.md#timing-model)                              |
| Databento `definition` records for contract metadata                                                 | Free for this data; expirations, tick sizes, and multipliers                                                                    | [Data](data.md#what-we-have)                                        |
| uv with Python 3.13, numba, psycopg 3, numbered SQL migrations; `research-web` is the only UI        | Reproducible environments, fast batch runs, simple schema history; checking backtest logic matters most now                     | [README](../../README.md), [UI](metric-explorer.md)                 |

## Run it

```sh
pnpm deps:install && pnpm dev            # UI http://127.0.0.1:4400
uv run research catalog --verify         # DBN files against their checksums
uv run research db migrate               # schema migrations
uv run research ingest plan GC SI        # what would be stored; then: run GC SI, status
uv run research backtest apps/backtest-runner/examples/gc.json
uv run research verify apps/backtest-runner/examples/mgc-sample.json
pnpm lint && pnpm test && pnpm build
```

After downloading TBBO files, add the job folder under `data/databento/tbbo/` unchanged,
then `catalog --verify` and `ingest run`: contracts are extended from their checkpoints and
changed files are rebuilt ([new downloads](ingestion.md#run-it)).

## Next steps

1. **`1h@1m` rows**: `market.bar_1m` rolled up from `bar_1s` and `market.candle_1h_1m`
   with the same features on the bias window; give minute tables a longer warm-up if
   slow hourly indicators are added. Before implementation, review this plan: add a
   numbered migration and minute-row builder; merge each minute's 60 second rows by
   `slot_ordinal` and metric merge kind, within one contract; feed the existing `BIAS`
   window and per-phase features; checkpoint and resume with whole-session/streaming
   parity. Scope builder hashes so adding minute storage does not invalidate unchanged
   second-row values. Validate early closes, empty/missing rows, rolls, normalized
   features, and interruption/resume before applying the migration to `trading`.
2. **Training data**: store the would-be trades (ML rows) from front-contract sessions in
   PostgreSQL, then a training pipeline that follows
   [training across contracts](#training-across-contracts-decided-november-2-2026).
3. **Backtests read stored rows** when the builder matches, so their roll warm-up equals
   storage (backtests now replay one warm-up session).
4. **Contract definitions**: download the free `definition` job into
   `data/databento/definition/` (needs the account owner) and load expirations.

## Open questions

1. When to add PL, YM, RTY, ES, and NQ (about 27 GB per contract-year each)?
2. Which unstored handoff metrics to add first, and which training outcome to use
   (simulated bracket trade or fixed-horizon return)?

## Things to know

- Review findings on the ingest planner have reached rare edge cases. The bar for changes:
  fix what can silently corrupt stored values or the series; refuse loudly for unusual
  setups (as for split-day downloads); decline hypotheticals with a test that shows why.
  Prefer rebuilding a contract (cheap: minutes) over more incremental-repair logic.

- TBBO shows the book only at trades. In quiet SI seconds (80% of them) the book is as old
  as the last trade; features carry that age (`trade_age_s`; `book_age_s` and `depth_age_s`
  for the last trade with a usable book and displayed sizes). At random moments in
  September 2026 the next SI trade came a median 5.9 s later (GC 1.7 s). Fill safeguards
  are specified in [todo.md](todo.md#later-refinements-after-the-core-is-tested).
- CVD needs an origin: rows store per-second net delta and its extremes, and
  `session_cvd` from the session open (NULL after missing data). Unknown-side volume
  (about 3% in metals, spread legs) stays out of it.
- Data quality: 2025-11-28 (CME outage) and six other dates are `degraded`; on that day
  most NQ, YM, and RTY records flag a possibly wrong book. Stored rows record each file's
  condition and flagged trades per second.
- There is no queue model for limit orders, and no live data or broker adapter yet.

## Environment

- PostgreSQL: `brew services start|stop postgresql@18`; data in
  `/opt/homebrew/var/postgresql@18`; override the connection with `TRADING_DATABASE_URL`.
- uv uses its default cache, `~/.cache/uv`.
- `DATABENTO_API_KEY` is exported by `~/.secrets.sh`, which `~/.zshenv` loads; the code
  does not use it yet (the live feed will).
- Agents may stop and restart local-dev services when a task needs it (`~/git/AGENTS.md`;
  ports in `~/git/local-dev/config.json`).
- Never print full process command lines on this Mac: some processes carry secrets in
  their arguments.
