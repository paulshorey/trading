# To do

Priority order: most important first. Check items off, and move lasting decisions
into the [handoff](handoff.md) or the relevant design doc. Details of the current
task live in [handoff: next steps](handoff.md#next-steps).

## Now: make the core work and test it

- [x] **Merge PR #62.** Merged into `main`.
- [ ] **Download contract definitions.** Free, but submitting the job needs the
      account owner. Settings are in [data](data.md#what-we-have).
- [x] **Implement one-second rows and metrics.** Per-second TBBO metrics, the stored
      `1m@1s` candle with 87 features, migration `0002_second_rows`, and
      `research ingest plan|run|status` ([ingestion](ingestion.md)).
- [x] **One continuous series per product.** `market.continuous_bar_1s` and
      `market.continuous_candle_1m_1s` take each session from its front contract;
      rolls only move forward, in backtests too.
- [x] **Run the GC and SI ingest.** Completed November 3: 11 min 2 s, 8 workers,
      46,503,000 rows per table, 57.65 GB. Both products have 257/257 front sessions;
      degraded reports and the GCZ6 roll checked ([results](handoff.md#first-ingest-gc-and-si)).
- [ ] **Stages (PR A).** Tiered stages with per-stage tables, versions, and checkpoints;
      registries; empty windows carry the last trade price; drawdown/drawup and high/low order; lead derived from
      indicator warm-ups (40 to start), with `warm` flags and a lead+10 check
      ([warm-up](feature-pipeline.md#warm-up-is-derived-never-typed)); rebuild GC and SI ([pipeline](feature-pipeline.md), [plan](plan-1h-and-pivots.md)).
- [ ] **Store `1h@1m` rows (PR B).** `market.bar_1m` and `market.candle_1h_1m`
      ([plan](plan-1h-and-pivots.md#5-1h1m-amendments-to-the-proposed-plan)).
- [ ] **Volatility tier (PR C).** Including bullish, bearish, and adverse-excursion ATR
      ([plan](plan-1h-and-pivots.md#7-volatility-tier-atr-family)).
- [ ] **Swing structure, signals, labels (PRs D–F)**
      ([contract](pivot-structure-design.md), [plan](plan-1h-and-pivots.md#3-pivot-and-structure-design)).
- [ ] **Test backtests on real data at full scale.** Run a full year of GC and SI.
      Check run time and memory, rolls and warmup at every contract change, and the
      per-session quality reports. Run `research verify` on a week of GC and SI:
      whole-session versus second-by-second parity has been proven only on the MGC
      sample day. Load a large run in the UI.
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
- [ ] **Roll warmup.** Backtests replay `warmup_sessions` on a new contract, while stored
      rows warm it for 5 sessions before the roll. Let backtests read the continuous series
      so both see the same features.
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

- [ ] **CI actions.** Update the GitHub Actions that warn about the Node 20 deprecation
      (checkout, setup-node, setup-uv, pnpm), and watch the `ubuntu-latest` move to
      Ubuntu 26.
- [ ] **Legacy Tailscale profile.** `tailscale.dev.json`, `scripts/tailscale-dev.mjs`,
      and the `dev:tailscale` scripts predate `~/git/local-dev`, which now manages
      the services (API on 4401). Remove them, or align them with local-dev.
- [ ] **Old SQL proposal.** Delete `lib/db-research/schema.sql`,
      `partitions.example.sql`, and `queries/` once migrations cover what they offer.
- [ ] **Stale PRs.** Close #56, #58, and #59; they target the archived implementation.
