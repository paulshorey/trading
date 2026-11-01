# To do

Priority order: most important first. Check items off, and move lasting decisions
into the [handoff](handoff.md) or the relevant design doc. Details of the current
task live in [handoff: next task](handoff.md#next-task-store-one-second-rows-and-metrics-gc-and-si-first).

## Now: make the core work and test it

- [ ] **Merge PR #62.** Wait for the Codex re-review of the latest fixes, address any
      findings, and merge into `main`.
- [ ] **Download contract definitions.** Free, but submitting the job needs the
      account owner. Settings are in [data](data.md#what-we-have).
- [ ] **Store one-second rows and metrics for GC and SI.** Per-second fields, migration
      `0002`, and the ingest command, as in the handoff's next task.
- [ ] **Test backtests on real data at full scale.** Run a full year of GC and SI.
      Check run time and memory, rolls and warmup at every contract change, and the
      per-session quality reports. Run `research verify` on a week of GC and SI:
      whole-session versus second-by-second parity has been proven only on the MGC
      sample day. Load a large run in the UI.
- [ ] **Session quality policy.** Backtests currently include degraded sessions with
      only a report. Decide and implement a default: skip, or mark and exclude from
      ML rows. Examples are 2025-11-28 (CME outage; NQ, YM, and RTY records flag a
      possibly wrong book) and the six other `degraded` dates. Record the status
      with stored rows.
- [ ] **Store runs, trades, and ML rows in PostgreSQL.** Replace `data/runs/*.json`
      with tables (spec, provenance, summary, trades) and persist the would-be-trade
      rows that runs now only summarize. Point the UI's run history at the database.
- [ ] **Make the data audit a command.** The November 1 checks (record types, receive
      order, event-time inversions, implied tick sizes, trades outside the calendar,
      Databento flags, front contract by day) were a one-off script. Add them to
      `research catalog` (for example `--audit`) for future downloads.

## Next: research workflow

- [ ] **Research comparison.** Phase-by-phase runs, bias on and off, and rolling against
      clock candles, after costs ([design §11](../sliding-windows/design.md#11-validation)).
- [ ] **Strategy candidates.** Replace the `bias_pullback` baseline with researched
      strategies built on the stored metrics.
- [ ] **ML training.** Train on the would-be-trade rows with purged walk-forward splits
      (gradient-boosted trees with a logistic baseline). Backtest out-of-sample
      predictions on newer sessions, and evaluate a final holdout once.
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
- [ ] **Roll warmup.** Compute the next contract's features in parallel before the roll
      instead of replaying warmup sessions; stored rows for front and next contracts
      make this natural.
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
