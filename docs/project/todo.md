# To do

Priority order: most important first. Check items off, and move lasting decisions
into the [handoff](handoff.md) or the relevant design doc. Details of the current
task live in [handoff: next steps](handoff.md#next-steps).

## Now: make the core work and test it

- [x] **Merge PR #62.** Merged into `main`.
- [ ] **Download contract definitions.** Free, but submitting the job needs the
      account owner. Settings are in [data](data.md#what-we-have).
- [x] **Implement one-second rows and metrics.** Per-second trade metrics, the stored
      `1m@1s` candle with 87 features, the second-row migration (now part of `0001_baseline`), and
      `research ingest plan|run|status` ([ingestion](ingestion.md)).
- [x] **One continuous series per product.** `market.continuous_bar_1s` and
      `market.continuous_candle_1m_1s` take each session from its front contract;
      rolls only move forward, in backtests too.
- [x] **Run the GC and SI ingest.** Completed November 3: 11 min 2 s, 8 workers,
      46,503,000 rows per table, 57.65 GB. Both products have 257/257 front sessions;
      degraded reports and the GCZ6 roll checked. Superseded by the stage rebuild below.
- [x] **Stages (PR A).** Tiered stages with per-stage tables, versions, and checkpoints;
      registries; empty windows carry the last trade price; drawdown/drawup and high/low order; lead derived from
      indicator warm-ups (40 to start), with `warm` flags and a two-start warm-up test
      ([warm-up](feature-pipeline.md#warm-up-is-derived-never-typed)); GC and SI rebuilt November 4 ([results](handoff.md#rebuild-with-stages-gc-and-si), [pipeline](feature-pipeline.md), [plan](plan-1h-and-pivots.md)).
- [x] **Rebuild `trading` on the baseline schema.** Completed November 4 with Paul's
      authorization: reset the four project schemas, migrate, register 2,182 files, rebuild
      GC/SI, and verify ([results](handoff.md#baseline-rebuild-gc-and-si)).
- [x] **Store `1h@1m` rows (PR B1, #74).** `market.bar_1m` and `market.candle_1h_1m`
      (migration `0002`), resolution-aware row replacement, and the engine on the stage graph.
      Applied to `trading` and built for GC/SI on November 4 in 2 min 29 s; full-year checks
      passed ([results](handoff.md#pr-b1-results-minute-stages)). Merged.
- [x] **Hourly-only metrics (PR B2, #75).** Stage `stats_1h_1m` (migration `0003`): realized
      volatility from one-second returns, minute-return statistics, drawdown/drawup in ATR,
      high/low position, session VWAP, prior-session levels, price-flow correlation. Applied to
      `trading` and built for GC/SI on November 4 in 1 min 55 s; full-year checks passed
      ([results](handoff.md#pr-b2-results-hourly-statistics)). Merged.
- [x] **Minute volatility (PR C1, #76).** Stage `vol_1m` (migration `0004`) and the shared
      module `volatility.py`: ATR(5)/ATR(50) and their log ratios, bullish/bearish and
      adverse-excursion ATR, extremes as levels, time-of-day normal, daily ATR and its percentile,
      true range, Parkinson and Garman–Klass, spread ÷ ATR; ATR in price and dollars as context.
      Applied to `trading` and built for GC/SI on November 4 in 1 min 55 s; full-year checks passed
      ([results](handoff.md#pr-c1-results-minute-volatility)). Merged.
- [x] **Second-resolution volatility (PR C2, #77).** Stage `vol_1s` (migration `0005`) on
      `volatility.py` unchanged: the 26 `vol_1m` features for the `1m@1s` window plus realized
      volatility from its one-second returns; joined into the engine's `1m@1s.` features. Live
      cost about 0.08 ms per second (`research verify` 321.7 s for the MGC day). Applied to
      `trading` and built for GC/SI on November 4 in 5 min 47 s; full-year checks passed
      ([results](handoff.md#pr-c2-results-second-volatility)). Merged.
- [x] **Move from TBBO to MBP-1.** November 15: MBP-1 is the only market data (GC, SI, PL,
      ES, YM, RTY verified; NQ not downloaded); book events reach the engine and fills use the
      book each order meets ([what changed](handoff.md#the-move-to-mbp-1-november-15-2026)).
- [x] **Rebuild GC and SI from MBP-1.** Done November 16 with Paul's authorization: schemas
      reset, 858 contract-sessions rebuilt in 25 minutes, every contract `current`, trade
      rows equal to the TBBO-built ones
      ([results](handoff.md#rebuilt-from-mbp-1-november-16-2026)).
- [x] **Swings of the price path (PR D).** Six scales (0.5, 1, 2 ATR on `1m@1s` and `1h@1m`) as
      stages of their own: `market.pivot_1s`, `pivot_1m`, and `pivot_event` (migration `0006`);
      the detector replays the trades and is verified against an independent replay
      ([what was built](plan-1h-and-pivots.md#36-implemented-in-pr-d-price-swings),
      [results](handoff.md#pr-d-results-swings)).
- [ ] **Free disk space, or decide what not to store.** `pivot_1s` takes 64 GB for GC and SI,
      and 63 GB is free: NQ, `pivot_rsi_1s`, `book_1s`, or an in-place rebuild of a second
      table no longer fit ([open questions](handoff.md#open-questions)).
- [ ] **Decide the ATR normalizer for thin markets.** `*_atr` values grow without bound when
      the ATR has decayed to almost nothing (rare on front sessions, common in lead sessions):
      clip at training, or floor the normalizer ([finding](handoff.md#pr-d-results-swings)).
- [ ] **RSI swings (`pivot_rsi_1s`, `pivot_rsi_1m`).** The same detector on the RSI series
      ([contract](pivot-structure-design.md#swing-sources-price-and-rsi)): measure the
      row-to-row RSI noise, choose thresholds above it, and store them when disk allows.
- [x] **Outcome labels and the benchmark (PR F).** Twelve label variants stored for GC and SI
      (`market.pivot_label_1s`, `pivot_label_1m`, migration `0007`), parameters frozen first
      ([spec](pivot-label-spec.md)); `research benchmark detectors` and `models`
      ([results](handoff.md#pr-f-results-labels-and-benchmark)).
- [ ] **Structure signals and other new inputs (PR E), next.** The stored features rank early
      reversal candidates no better than the position of price alone; add inputs and rerun
      `research benchmark models` on the same labels before storing a model stage
      ([recommendation](handoff.md#next-steps), [contract](pivot-structure-design.md)).
- [ ] **Benchmark follow-ups, when a result needs them:** the horizon-aware random-walk
      baseline, a tuned CUSUM (the frozen one finds 3–7%), and pooled or longer history for
      the slow scales, which have too few candidates to fit.
- [ ] **Final holdout.** September 1, 2026 on is unread; evaluate one chosen model on it once.
- [x] **Test backtests on real data at full scale.** November 5: a GC year in 161 s with
      2.6 GB, `research verify` on a GC and an SI week (identical), a 43 MB run in the UI, and
      backtests equal to the stored rows at rolls. Fixed what it found: backtests now warm
      each contract for the stored lead, and `verify` holds one session in memory
      ([checks](handoff.md#full-scale-checks-after-pr-c2)). The per-session quality reports
      belong to the session quality policy below.
- [ ] **Session quality policy.** Backtests currently include degraded sessions with
      only a report. Decide and implement a default: skip, or mark and exclude from
      ML rows. Examples are 2025-11-28 (CME outage; NQ, YM, and RTY records flag a
      possibly wrong book) and the six other `degraded` dates. Stored rows record each
      file's condition in `market.ingest_slice.source_files` and flagged trades per second
      (`bad_book_trades`).
- [ ] **Store runs, trades, and ML rows in PostgreSQL.** Replace `data/runs/*.json`
      with tables (spec, provenance, summary, trades) and persist the would-be-trade
      rows that runs now only summarize. Point the UI's run history at the database.
      Then make the trade inspector rebuild candles from the run's own inputs, or warn when
      the code or data fingerprint differs from the run's provenance; today it rebuilds
      with the current code (deferred from the PR #62 review, since the fingerprint changes
      with almost every edit during prototyping).
- [ ] **Make the data audit a command.** The November 1 and November 15 checks (full
      decode, record types, receive order, event-time inversions, implied tick sizes, trades
      outside the calendar, crossed books, Databento flags, front contract by day) were
      one-off scripts. Add them to `research catalog` (for example `--audit`) for future
      downloads such as NQ.

## Next: research workflow

- [ ] **Research comparison.** Phase-by-phase runs, bias on and off, and rolling against
      clock candles, after costs ([design §11](../sliding-windows/design.md#11-validation)).
- [ ] **Strategy candidates.** Replace the `bias_pullback` baseline with researched
      strategies built on the stored metrics.
- [ ] **ML training.** One model on would-be-trade rows pooled from every contract's
      front sessions, each row within one contract
      ([training across contracts](handoff.md#training-across-contracts-decided-november-2-2026)).
      Purged walk-forward splits (gradient-boosted trees with a logistic baseline);
      backtest out-of-sample predictions on newer sessions, and evaluate a final holdout
      once.
- [ ] **UI views.** A session explorer and run comparison
      ([research UI](metric-explorer.md#next)).

## Later: refinements after the core is tested

- [x] **Fill realism.** Superseded by MBP-1: market orders, time and session exits, and
      stop fills are priced at the book the order meets, and every trade records the spread
      at the decision and its entry slippage in ticks.
- [ ] **Fill robustness.** A setting (for example `fill_penalty_ticks`) to rerun with fills
      one tick worse and a longer order latency; report both results and flag those that
      flip. Fill a resting target also when the opposite best quote trades through it, once
      a queue rule is chosen. Record the slippage of market exits as entries do.
- [ ] **Book stage `book_1s`.** Tier 0 from every book event: queue imbalance, order-flow
      imbalance, time-weighted spread, depletion and refill
      ([metrics](../research/pivots/2026-11-06-second-scale-and-mbp1.md)). Switch ingestion's
      day cache to keep book events for it.
- [x] **Roll warmup.** Backtests warm each contract for the stored lead by default and compute
      exactly the stored rows from every roll on
      ([checks](handoff.md#full-scale-checks-after-pr-c2)). Reading stored rows would only be
      faster ([next steps](handoff.md#next-steps)).
- [ ] **More products.** Add PL, YM, RTY, and ES once GC and SI are rebuilt and disk allows;
      they are on disk with specs. NQ still has to be downloaded.
- [ ] **Slower bias.** Optionally a `1d@1h` window.

## Live trading: after research shows an edge

- [ ] **Paper sessions.** A Databento live MBP-1 source feeding one-second chunks to the
      engine with simulated fills. Record each day and replay it as a backtest to
      confirm identical decisions.
- [ ] **Checkpoints.** Save and restore indicator, window, order, and position state, so
      a live session can restart without replaying history.
- [ ] **Broker execution.** Broker adapter, reconciliation, risk limits, pause and
      resume, manual overrides, and a decision log. Run a small live test to compare
      real fills with the simulated ones.

## Housekeeping

- [x] **Delete the unused `features.FeaturePipeline`.** Done with the MBP-1 change, which
      rebuilds every stage anyway.
- [ ] **At the next `source.py` rebuild**, give `HistoricalSource` the roll warm-up count
      apart from its warm-up list, and skip warm-up sessions outside the downloaded data, so a
      download that starts partway through a session cannot make a backtest differ from storage
      ([edge case](handoff.md#full-scale-checks-after-pr-c2)). `source.py` is in every stage's
      identity.

- [ ] **CI actions.** Update the GitHub Actions that warn about the Node 20 deprecation
      (checkout, setup-node, setup-uv, pnpm), and watch the `ubuntu-latest` move to
      Ubuntu 26.
- [x] **Legacy Tailscale profile.** `tailscale.dev.json`, `scripts/tailscale-dev.mjs`,
      and the `dev:tailscale` scripts predate `~/git/local-dev`, which now manages
      the services (API on 4401). Removed November 4 with `scripts/research.py`.
- [x] **Old SQL proposal.** Delete `lib/db-research/schema.sql`,
      `partitions.example.sql`, and `queries/` once migrations cover what they offer.
- [x] **Stale PRs.** #56, #58, and #59 target the archived implementation; closed November 1.
