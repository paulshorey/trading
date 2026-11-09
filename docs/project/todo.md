# To do

Priority order: most important first. Check items off, and move lasting decisions
into the [handoff](handoff.md) or the relevant design doc. Details of the current
task live in [handoff: next steps](handoff.md#next-steps).

## Now: make the core work and test it

- [x] **Merge PR #62.** Merged into `main`.
- [ ] **Download contract definitions.** Free, but submitting the job needs the
      account owner. Settings are in [data](data.md#what-we-have).
- [x] **Implement one-second rows and metrics.** Per-second TBBO metrics, the stored
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
- [ ] **Swing structure, signals, labels (PRs D–F), next**
      ([contract](pivot-structure-design.md), [plan](plan-1h-and-pivots.md#3-pivot-and-structure-design)).
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
- [ ] **Make the data audit a command.** The November 1 checks (record types, receive
      order, event-time inversions, implied tick sizes, trades outside the calendar,
      Databento flags, front contract by day) were a one-off script. Add them to
      `research catalog` (for example `--audit`) for future downloads.

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

- [ ] **TBBO fill safeguards.** TBBO shows the book only at trades, so simulated fills
      are uncertain by about 1–2 ticks in GC and SI
      ([measurements](engine.md#data-limits-tbbo-only)). Use the same rules for every
      product:
  - **Pessimistic fills.** Price market orders (entries, time and session exits, stop
    fills) at the worse of the last known book and the next observed book. Estimate
    the last known book from the previous trade: if that trade took all the displayed
    size on its side, move that side one tick.
  - **Activity gate.** One setting in seconds (for example `max_book_age_s`): allow
    entries only if the latest trade is that recent at the decision. Count gated
    signals in the run summary.
  - **Per-entry uncertainty.** Record the book's age at the decision and how far the
    bid or ask moved across the gap, in ticks, for every trade; summarize per run.
    Rename or clarify `entry_delay_ms`: it is how old the simulated price is, not a
    real delay.
  - **Robustness rerun.** A setting (for example `fill_penalty_ticks`) to rerun with
    fills one tick worse; report both results and flag those that flip.
  - **Done when** every rule has unit tests and whole-session versus second-by-second
    parity still holds.
- [x] **Roll warmup.** Backtests warm each contract for the stored lead by default and compute
      exactly the stored rows from every roll on
      ([checks](handoff.md#full-scale-checks-after-pr-c2)). Reading stored rows would only be
      faster ([next steps](handoff.md#next-steps)).
- [ ] **More products.** Add PL, YM, RTY, ES, and NQ once GC and SI ingestion is proven;
      all are on disk with specs.
- [ ] **Slower bias.** Optionally a `1d@1h` window.

## Live trading: after research shows an edge

- [ ] **Paper sessions.** A Databento live TBBO source feeding one-second chunks to the
      engine with simulated fills. Record each day and replay it as a backtest to
      confirm identical decisions.
- [ ] **Checkpoints.** Save and restore indicator, window, order, and position state, so
      a live session can restart without replaying history.
- [ ] **Broker execution.** Broker adapter, reconciliation, risk limits, pause and
      resume, manual overrides, and a decision log. Run a small live test to compare
      real fills with the TBBO fill model.

## Housekeeping

- [ ] **At the next `candle_1m_1s` rebuild**, delete the unused `features.FeaturePipeline`
      ([B1 decisions](handoff.md#pr-b-1h1m-rows)); `features.py` is in that stage's identity,
      so the edit waits for a rebuild that happens anyway. (`pipeline.FastAtr` is gone: the
      engine reads `vol_1s.atr_price`.)
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
