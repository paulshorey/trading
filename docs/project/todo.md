# To do

Most important first. The order of the research work is the roadmap's
[build order](roadmap.md#build-order); how to do the current task is in the
[handoff](handoff.md#next-steps). Check items off, and record what was built and found in
the [build log](build-log.md).

## Now: the build order

- [x] **Set up the new machine** and rebuild the database there: done November 23
      ([what was found](build-log.md#the-new-machine-november-23-2026)).
- [x] **Replay the middle timeframe's candidates** (item 6): done November 23
      ([results](../archive/replay.md#results-for-the-middle-timeframe-november-23-2026)).
- [x] **Remove the withdrawn design** (November 23): the label stages and tables, the
      benchmark, the candidate replay; the roadmap cut to the current plan
      ([record](build-log.md#the-withdrawn-design-removed-november-23-2026)).
- [x] **The engine makes position decisions** (item 7), **the 3 ATR scale and the structure
      code** (item 8), and **the first decision model** (item 9): done November 24
      ([results](yardstick-spec.md#results-november-24-2026)).
- [ ] **Make the forecast no worse than `flat`**: fewer rows a session or leaf sizes counted
      in sessions, and shrinkage fitted on training data; spec first.
- [ ] **Base changes, in one rebuild** (item 10): a rolling net-flow series without session
      resets; the ATR normalizer floored at the spread
      ([finding](build-log.md#pr-d-results-swings)); the `source.py` change under
      [housekeeping](#housekeeping).
- [ ] **Swings and structure of RSI and of net flow**, and their agreement with price
      (item 11): measure each series' row-to-row noise and freeze its threshold first
      ([contract](pivot-structure-design.md#swing-sources-price-and-rsi)).
- [ ] **Six years of GC and SI** (item 12).
- [ ] **`book_1s`** and **the scheduled-news table** (item 13).
- [ ] **ES** (item 14), with one-second values stored where they are read.
- [ ] **More inputs and the named variants** (item 15).
- [ ] **The final evaluation on the holdout** (item 16). September 1, 2026 onward is
      reserved for one frozen evaluation. Record prior engineering exposure when reporting.

## Also open

- [ ] **The sliding-clock control.** The same policy on completed minute boundaries and on
      every eligible second, in one portfolio, to measure what the faster clock earns
      ([rule](roadmap.md#how-a-policy-is-evaluated)). Run it with the first policy that is not flat.
- [ ] **Session quality policy.** Backtests include degraded sessions with only a report.
      Decide and implement a default: skip, or mark and exclude from ML rows. Examples are
      2025-11-28 (CME outage; NQ, YM, and RTY records flag a possibly wrong book) and the
      six other `degraded` dates. Stored rows record each file's condition in
      `market.ingest_slice.source_files` and flagged trades per second (`bad_book_trades`).
- [ ] **Store runs, trades, and ML rows in PostgreSQL.** Replace `data/runs/*.json` with
      tables (spec, provenance, summary, trades) and persist the would-be-trade rows that
      runs now only summarize. Point the UI's run history at the database. Then make the
      trade inspector rebuild candles from the run's own inputs, or warn when the code or
      data fingerprint differs from the run's provenance; today it rebuilds with the
      current code.
- [ ] **Download contract definitions.** Free, but submitting the job needs the account
      owner. Settings are in [data](data.md#what-we-have).
- [ ] **Make the data audit a command.** The November 1 and November 15 checks (full
      decode, record types, receive order, event-time inversions, implied tick sizes, trades
      outside the calendar, crossed books, Databento flags, front contract by day) were
      one-off scripts. Add them to `research catalog` (for example `--audit`) for future
      downloads such as NQ.
- [ ] **Benchmark follow-ups, when a result needs them:** the horizon-aware random-walk
      baseline and a tuned CUSUM (the frozen one finds 3–7%).
- [ ] **Fill robustness.** Fill a resting target also when the opposite best quote trades
      through it, once a queue rule is chosen. Record the slippage of market exits as
      entries do. (The replay already reruns with longer latency and one more adverse tick.)
- [ ] **UI views.** A session explorer and run comparison
      ([research UI](metric-explorer.md#next)).
- [ ] **Slower bias.** Optionally a slower window of 60 hourly
      rows (`60h@1h`; a one-day window would need a row count other than 60), once timeframes
      are a parameter.

## Live trading: after research shows an edge

- [ ] **Paper sessions.** A Databento live MBP-1 source feeding one-second chunks to the
      engine with simulated fills. Record each day and replay it as a backtest to confirm
      identical decisions.
- [ ] **Checkpoints.** Save and restore indicator, window, order, and position state, so a
      live session can restart without replaying history.
- [ ] **Broker execution.** Broker adapter, reconciliation, risk limits, pause and resume,
      manual overrides, and a decision log. Run a small live test to compare real fills
      with the simulated ones.

## Housekeeping

- [ ] **At the next `source.py` rebuild**, give `HistoricalSource` the roll warm-up count
      apart from its warm-up list, and skip warm-up sessions outside the downloaded data, so
      a download that starts partway through a session cannot make a backtest differ from
      storage ([edge case](build-log.md#full-scale-checks-after-pr-c2)). `source.py` is in
      every stage's identity, so do it with the rebuild of the timeframe parameter.
- [ ] **CI actions.** Update the GitHub Actions that warn about the Node 20 deprecation
      (checkout, setup-node, setup-uv, pnpm), and watch the `ubuntu-latest` move to
      Ubuntu 26.

## Done

Details of each are in the [build log](build-log.md).

- [x] Engine, windows, features, UI, and database layer (PR #62).
- [x] One-second rows, metrics, and the continuous series per product (#63).
- [x] Stages with their own versions, checkpoints, and derived warm-ups (PR A, #70).
- [x] `1h@1m` rows and hourly statistics (PR B1 #74, B2 #75).
- [x] Minute and second volatility (PR C1 #76, C2 #77).
- [x] Backtests on real data at full scale; backtests warm for the stored lead (#80).
- [x] MBP-1 replaces TBBO; fills at the book each order meets (#81); GC and SI rebuilt from
      MBP-1 (November 16).
- [x] Swings of the price path at six scales (PR D, #82).
- [x] Outcome labels and the benchmark (PR F, #83); context inputs tested, no gain (#84);
      the displacement baseline (#85).
- [x] Design review against the goal (November 19, #88) and a second review (November 20).
- [x] Sparse storage of the fast swing rows: `pivot_1s` from 64 GB to 4.5 GB (#89).
- [x] After-cost replay (#90) and agreement with the slower timeframe by rule (#91): no
      rule beats staying flat.
- [x] Timeframe as a parameter (build-order item 3): one stage class per kind for
      merged-step timeframes; stored rows unchanged.
- [x] The middle timeframe `10m@10s` (build-order item 4): stored for GC and SI with its
      swing scales and labels, and joined into the engine.
- [x] One set of stages for every timeframe (build-order item 5): `1m@1s` is built by the
      classes of the other two; stored values unchanged.
