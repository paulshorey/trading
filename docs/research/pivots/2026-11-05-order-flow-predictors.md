# Order flow, absorption, and context: metrics that could predict short-term reversals and continuations

Researched November 5, 2026 (web search plus Databento's cost API for this account). Nothing
here is implemented or measured on GC or SI; every "may contribute" below is a hypothesis to
test. The [early-confirmation update](2026-11-05-early-confirmation-update.md) defined how to
_score_ pivot predictions against a random-walk baseline. This paper asks the other
question: which inputs could carry information the price path does not already contain.
It changes no recorded decision. Four proposals need Paul's decision
([section 8](#8-decisions)).

## Summary

> Revised November 6, 2026: second and sub-second horizons are in scope, and MBP-1 is
> recommended as the archive schema. See [second scale and MBP-1](2026-11-06-second-scale-and-mbp1.md).

1. **The price path cannot separate a real low from a pause.** Up to the low, both
   look the same. An edge has to come from information the path does not hold: who is
   trading aggressively, how the book responds, what related markets do, and what is
   scheduled.
2. **Measure the market's response to flow, not just the flow.** Cumulative volume delta
   (CVD) trends with price almost by construction, because large orders are split into many
   small ones that keep printing on the same side
   ([Lillo and Farmer, 2004](https://arxiv.org/abs/cond-mat/0311053)). The informative case
   is a mismatch: heavy aggressive selling that no longer moves price (absorption), or
   light flow that moves price far (no one on the other side).
3. **Measure flow where it matters.** Reversals are more frequent at round numbers and at
   levels where resting orders cluster, and moves accelerate once those levels break
   ([Osler, 2003](https://onlinelibrary.wiley.com/doi/full/10.1111/1540-6261.00588);
   [Kavajecz and Odders-White, 2004](https://academic.oup.com/rfs/article-abstract/17/4/1043/1570736)).
   Flow measured while price tests a level should say more than flow averaged over every
   row.
4. **TBBO already supports most of this.** The base rows store aggressor volume, sweeps,
   size relative to displayed depth, and book imbalance at trades. What is missing are the
   derived response, location, and cross-market metrics.
5. **One upgrade is nearly free and time-limited.** MBP-1 (every change to the best bid and
   ask, not only the book at trades) is quoted at $0.30 for a year of GC and $0.16 for SI on
   this account. It fixes TBBO's main blind spot: cancellations and refills between trades.
   The included history is a rolling 12 months, so the oldest days of our TBBO year are
   already leaving it.
6. **Expect small effects.** Published order-flow signals are weak and short-lived: about
   two price changes ahead for stocks ([Kolm et al., 2023](https://onlinelibrary.wiley.com/doi/10.1111/mafi.12413)),
   and an information coefficient of 0.004 on 10-second bars in a 2026 replication
   ([S E, 2026](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7053198)). Our simulated
   fills are uncertain by 1–2 ticks in GC and SI ([engine](../../project/engine.md#data-limits-tbbo-only)).
   Flow metrics are therefore model inputs at decision points (a pivot candidate, a level
   test) that predict moves of an ATR or more over minutes. They are not standalone
   tick-scalping signals.

## 1. Where information can come from

| Layer                    | Examples                                                   | New information beyond price?     | Data                                |
| ------------------------ | ---------------------------------------------------------- | --------------------------------- | ----------------------------------- |
| 1. Price path            | RSI, ATR, EMA, MACD, slope, swings, structure              | No: reworkings of the same prices | Any                                 |
| 2. Trade flow            | Aggressor side, size, timing, CVD, volume                  | Yes                               | TBBO (exact)                        |
| 3. Book at trades        | Displayed size, spread, imbalance before each trade        | Yes, partly                       | TBBO                                |
| 4. Book between trades   | Cancels, refills, quote pulling, true order-flow imbalance | Yes                               | MBP-1; MBO for single orders        |
| 5. Other markets         | SI, PL, ES/NQ/YM/RTY, Euro FX (6E), 10-year notes (ZN)     | Yes                               | TBBO of those products              |
| 6. Positioning, schedule | Options open interest, settlement, economic releases       | Yes, slow                         | Statistics schema; outside calendar |

On the indicators you named:

- **ATR** is the yardstick. Every distance and size below is divided by it, which makes
  features comparable across volatility regimes and products. It predicts how far, not which
  way.
- **RSI** is a bounded recent return: layer 1. It is already stored, and RSI structure and
  divergence are planned ([contract](../../project/pivot-structure-design.md)). Treat it as one
  input, not a source of new information.
- **CVD and volume** are layer 2: genuinely new information. Their value is mostly in
  comparisons: CVD against price (divergence, absorption), volume against the move it
  produced, and volume now against volume at the same phase earlier.

## 2. The core idea: effort against result

Think of pushing a stalled car. If you push hard and it doesn't move, something is
blocking it. If it rolls away at a touch, nothing is holding it back. In a market the push
is aggressive volume (market orders), and the result is how far price moves.

Over short intervals, price change is close to linear in order-flow imbalance, with a slope
inversely proportional to the depth available
([Cont, Kukanov and Stoikov, 2014](https://academic.oup.com/jfec/article-abstract/12/1/47/816163)).
A falling slope therefore means more liquidity is meeting the flow than the book showed,
from hidden orders, refills, or new passive buyers. In E-mini data, "sometimes selling
pressure causes only minor drops in price while, at other times, prices react vigorously"
([Andersen and Bondarenko, 2013](https://pure.au.dk/ws/files/68359010/rp13_43.pdf)). That
variation is what we want to measure.

Two refinements matter:

- **Expected against surprise flow.** Order signs are strongly persistent, and the
  persistence is offset by liquidity and trade size, which keeps returns close to random
  ([Lillo and Farmer, 2004](https://arxiv.org/abs/cond-mat/0311053)). A long run of selling
  is therefore normal while a large seller is working an order. The surprise (flow minus what its own
  recent history predicts) carries the news. Persistent imbalances predict continuing
  pressure, and the relation reverses once current flow is controlled for
  ([Chordia and Subrahmanyam, 2004](https://www.sciencedirect.com/science/article/pii/S0304405X03001752)).
- **Hidden liquidity is measurable.** CME iceberg orders can be detected from discrepancies
  between displayed size and traded size, and their total size predicted
  ([Zotikov and Antonov, 2021](https://arxiv.org/abs/1909.09495)). An estimate of hidden
  liquidity at the best level improves short-horizon direction models
  ([Physica A, 2020](https://www.sciencedirect.com/science/article/pii/S0378437119315407)).
  Both informed and liquidity traders use icebergs
  ([Lajbcygier et al., 2025](https://onlinelibrary.wiley.com/doi/full/10.1111/jfir.12414)), so
  a detected iceberg is a sign of interest at a price, not of direction by itself.

## 3. Context: where flow is measured

Stop-loss and take-profit orders cluster at round numbers. Take-profit orders dominate at
the exact number, and prices reverse there more often than at arbitrary numbers. Stop-loss
orders sit just beyond, and prices trend rapidly once they trigger
([Osler, 2003](https://onlinelibrary.wiley.com/doi/full/10.1111/1540-6261.00588);
[stop cascades](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr150.pdf)).
Support and resistance levels coincide with peaks in limit-order depth
([Kavajecz and Odders-White, 2004](https://academic.oup.com/rfs/article-abstract/17/4/1043/1570736)).

The same flow means different things in different places. Heavy selling with little
progress at a prior low, a session low, or a round number is a defended level. The same
selling in the middle of a range means little. A sweep beyond the level followed by a
reclaim is the stop-run the contract already plans
([failed breaks](../../project/pivot-structure-design.md)). So the metrics below are meant to be
read at **events**: a pivot candidate reaching a progress stage, or price coming within a
fraction of an ATR of a known level.

## 4. Data we have and could add

Costs below were quoted by Databento's `get_cost` API on November 5, 2026, for this account
and the period November 1, 2025 to November 1, 2026. Schemas in the plan's included history
are quoted at or near $0. Sizes are billable (uncompressed) sizes.

| Schema (GLBX.MDP3) | What it adds                                                                                                                                         | Year of GC / SI                                | Notes                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| TBBO (have)        | Every trade with the best bid and ask just before it                                                                                                 | ≈ 2.5 GB / 0.7 GB                              | Book is stale in quiet seconds (80% of SI's)                                                       |
| MBP-1              | Every change at the best bid and ask: true order-flow imbalance, cancels compared with fills, refills, quote pulling, a current book at every second | 58.7 GB, $0.30 / 44.2 GB, $0.16                | Rolling 12-month included window: November 2025 days are already billed. ES is about 15 GB a month |
| MBO                | Every order: native icebergs, order lifetimes, queue position (needed to simulate limit orders)                                                      | 113 GB, $174.60 / 85 GB, $132.90               | Includes all depth; MBP-10 can be rebuilt from it                                                  |
| MBP-10             | Ten price levels                                                                                                                                     | GC ≈ 59 GB and $27.51 for September 2026 alone | MBO is cheaper per year and more complete                                                          |
| Statistics         | Open interest, settlement, session high and low, indicative open, price limits                                                                       | ≈ 0.25 GB each, $0                             | Open interest is daily: regime context only                                                        |
| Gold options (OG)  | Option trades; statistics per strike (open interest, settlement implied volatility, delta)                                                           | Trades 0.1 GB, $0.01; statistics 51 GB, $0     | OG MBP-1 is 1.2 TB per month: not practical                                                        |
| 6E, ZN (TBBO)      | Dollar and rates proxies for gold                                                                                                                    | ≈ 0.06 and 0.21 GB a month                     | Same rules as our products                                                                         |

Not from Databento: an economic-release calendar (CPI and payrolls at 8:30 ET, FOMC
decisions, others). The two daily LBMA gold price auctions (10:30 and 15:00 London) are fixed
times and need no download.

**MBP-1 against MBO.** Reconstructing CME book activity from an unconflated aggregated
depth feed plus trades recovers iceberg refills with 99.97% recall and consumption with
about 99% precision. With one-second conflation, recall of additions and withdrawals falls
to 16–19%
([Narayan, 2026](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7551778); one
session of NQ, single author). MBP-1 is unconflated but covers the best level only, which is
where absorption at an extreme happens. So MBP-1 should be enough for refills and pulling at
the touch. MBO is needed for single-order icebergs and queue position. BBO-1s is too coarse.

The [November 1 decision](../../project/engine.md#data-limits-tbbo-only) is TBBO only, under
identical rules for every product. Adding MBP-1 for all seven products keeps the rules
identical, and live MBP-1 is available on the same feed. It is still a change to a recorded
decision, so it is Paul's call.

## 5. Inventory

**Gaps and closures (applies to every metric below):**

- **Row windows** (N rows, same-phase baselines, rolling fits) follow the row rules: they
  continue across scheduled closures, including an early close and reopen, because closures
  add no rows. Only a coverage gap (missing data) invalidates them: a window containing a
  missing row is NULL until N covered rows follow the gap.
- **Book and trade-sequence state** (queue episodes, level and refill timers, per-price
  levels, trade runs, decaying intensities, inter-trade timers, N-trade windows) also resets
  at each session open, since the book and trade sequence are not observed across a closure
  and the reopening auction.
- **Session-scoped metrics** (session VWAP, session high and low, level tests) reset at
  session opens by definition.

Missing data is never treated as zero activity. **Zero denominators:** any ratio, mean, correlation, or z-score whose denominator is
zero (no qualifying trades, no volume, no variation, no baseline) is NULL with a state
flag saying why, never NaN, infinity, or an invented zero.

Conventions: "Have" means the ingredient is already stored in `bar_1s`/`bar_1m` or a tier-1
stage (names as in `metrics.py` and `indicators.py`). "Planned" means it is in the
[pivot/structure contract](../../project/pivot-structure-design.md) or the
[early-confirmation update](2026-11-05-early-confirmation-update.md). "New" means not yet designed.
Every metric is a ratio, a log ratio, a distance in ATR or basis points, a count, or a time,
and follows the row-window rules: rolling windows over rows `o − 59 … o`, same-phase
comparisons at `o − 60`, `o − 120`, …. "Leg" is the current swing since the last confirmed
opposite pivot. A z-score uses the trailing mean and deviation of the same quantity at the
same phase, fitted causally.

### A. Aggression: who is pushing

| #   | Metric                                                                                             | How to calculate                                                                                                                                                                                                                                                                                                                                                                                                                         | How it may contribute                                                                                                                                                                            | Data | Status                                                                                    |
| --- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ----------------------------------------------------------------------------------------- |
| A1  | Delta ratio                                                                                        | (buy − sell aggressor volume) ÷ (buy + sell), per window; unknown-side volume is excluded                                                                                                                                                                                                                                                                                                                                                | Direction and strength of pressure; the base input for most metrics below                                                                                                                        | TBBO | Have (`delta_ratio`)                                                                      |
| A2  | CVD divergence at pivots                                                                           | Change in CVD between two same-kind pivots ÷ sided volume between them                                                                                                                                                                                                                                                                                                                                                                   | A lower low on rising CVD means sellers ran out or were absorbed                                                                                                                                 | TBBO | Planned (`low_cvd_change_ratio`)                                                          |
| A3  | Surprise flow                                                                                      | Delta at row o minus its one-step forecast from an autoregression of order p fitted causally on the 3,600 scheduled-open rows ending at o − 1 (refitted each row, then applied frozen to row o; no training-block parameters), ÷ that fit's residual deviation. A row window: it continues across scheduled closures, resets at coverage gaps, and is NULL until 3,600 covered rows follow a gap, or when the residual deviation is zero | Separates routine order splitting from new pressure; surprise flow should predict better than raw CVD                                                                                            | TBBO | New                                                                                       |
| A4  | Sweep ratio                                                                                        | Volume printed beyond the pre-trade best price ÷ volume                                                                                                                                                                                                                                                                                                                                                                                  | Urgency: a trader willing to pay through the book. Sweeps late in a leg can mark capitulation                                                                                                    | TBBO | Have (`sweep_ratio`, `sweep_delta_ratio`)                                                 |
| A5  | Consumption intensity (`take_mean`, a new name: `take_ratio` already means the buy share of takes) | Mean of trade size ÷ displayed size on the side hit, over trades with a known side and positive opposing depth; NULL with a "no qualifying trade" state when there are none                                                                                                                                                                                                                                                              | Above 1 means levels are consumed; a falling take ratio at an extreme means more size is appearing than is taken                                                                                 | TBBO | New (needs a count of contributing trades; `buy_take_sum` and `sell_take_sum` are stored) |
| A6  | Large-trade delta                                                                                  | Signed volume of trades at or above the trailing 99th-percentile size ÷ volume; NULL with a "no volume" state when the window has no trades                                                                                                                                                                                                                                                                                              | Large aggressive prints against the leg near its extreme can mark an informed reversal                                                                                                           | TBBO | New (`max_size_ratio`, `size_hhi` exist)                                                  |
| A7  | Trade intensity                                                                                    | log((trades per row + 1) ÷ (same-phase trailing mean + 1)), finite on rows without trades, and its change over the last 5–10 rows                                                                                                                                                                                                                                                                                                        | A selling climax is a burst that peaks then fades while price stalls                                                                                                                             | TBBO | Partly (`rel_trades`)                                                                     |
| A8  | Self-excitation                                                                                    | Hawkes branching ratio of trade arrivals, fitted on a rolling window                                                                                                                                                                                                                                                                                                                                                                     | High values mean activity feeding on itself (stops, liquidations): moves that overshoot and then snap back ([Filimonov and Sornette, 2012](https://link.aps.org/doi/10.1103/PhysRevE.85.056108)) | TBBO | New (expensive; later)                                                                    |
| A9  | Same-side run length                                                                               | Length of the current run of same-side trades ÷ its trailing median; the run resets at coverage gaps and session opens                                                                                                                                                                                                                                                                                                                   | Long runs are order splitting (continuation); a run breaking at an extreme is a change of hands                                                                                                  | TBBO | Partly (`side_switch_ratio`)                                                              |

### B. Absorption and response: what the push achieved

| #   | Metric                   | How to calculate                                                                                                                                                                                                                                                                                                                                                                                                                          | How it may contribute                                                                                                             | Data  | Status                                                                                                                                 |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Impact per unit flow     | Slope of log-price change (bps) on net aggressor volume (÷ trailing median volume) over the last N rows; NULL with an "inactive" state when fewer than N/2 rows have nonzero net flow or the flow has zero variance. `impact_decay` = `(recent − earlier) / (abs(recent) + abs(earlier) + eps)` over the recent and earlier slopes, bounded −1 to 1 and defined when either slope is zero or negative NULL unless all N rows are covered. | **Core absorption signal.** Impact collapsing in the leg's direction while flow stays heavy means a large passive buyer or seller | TBBO  | New                                                                                                                                    |
| B2  | Effort without result    | z(delta in the leg's direction) − z(return in the leg's direction, in ATR), over the last N rows; NULL with a "flat" state when either trailing deviation is zero NULL unless all N rows are covered.                                                                                                                                                                                                                                     | A simple, robust version of B1: high effort, little progress                                                                      | TBBO  | New                                                                                                                                    |
| B3  | Hidden volume at a price | While the best bid (ask) stays at one price without interruption, volume sold into it ÷ the largest displayed size seen there; resets at gaps, closures, and session ends. TBBO cannot show that a queue persisted between trades, so B3 is computed only from MBP-1 (A5 and B4 are the TBBO-side evidence)                                                                                                                               | Above 1 means size was replenished (iceberg, refills, or new buyers): someone defends that price                                  | MBP-1 | New                                                                                                                                    |
| B4  | Defended extreme         | Volume traded at exactly the leg's extreme price ÷ leg volume; rows spent there                                                                                                                                                                                                                                                                                                                                                           | A low where much volume traded but price would not go lower differs from a quick wick through thin air                            | TBBO  | New                                                                                                                                    |
| B5  | Refill speed             | After the best bid is hit, seconds until its displayed size recovers to its pre-trade level at the same price; censored on any best-price change, coverage gap, or session boundary (as S6)                                                                                                                                                                                                                                               | Fast refills mean a persistent passive buyer; refills slowing means the defender is leaving                                       | MBP-1 | New                                                                                                                                    |
| B6  | Native iceberg detection | Traded size above an order's resting size, and refill modifications ([Zotikov and Antonov](https://arxiv.org/abs/1909.09495))                                                                                                                                                                                                                                                                                                             | Exact hidden size and side at a level                                                                                             | MBO   | New (later)                                                                                                                            |
| B7  | Flow–price correlation   | Correlation of per-row delta and per-row return within the window; NULL with a "flat" state when either has zero variance                                                                                                                                                                                                                                                                                                                 | Low correlation during a leg means flow is not moving price                                                                       | TBBO  | New (`flow_price_corr` correlates same-phase period changes with their delta ratios; `cvd_close_corr` correlates close and CVD levels) |

### C. Book: where liquidity sits

| #   | Metric                     | How to calculate                                                                                                                                                                                                                                                           | How it may contribute                                                                                                                                                                            | Data  | Status                  |
| --- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- | ----------------------- |
| C1  | Queue imbalance            | bid size ÷ (bid + ask size) before each trade, with the book's age                                                                                                                                                                                                         | Predicts the next mid-price move, strongly for large-tick contracts ([Gould and Bonart, 2015](https://arxiv.org/abs/1512.03492)). For us mainly entry timing                                     | TBBO  | Have (`book_imbalance`) |
| C2  | Microprice tilt            | Spread × (bid − ask) ÷ (bid + ask) ÷ 2, equivalently spread × (C1 − 0.5): zero for a balanced book; in bps                                                                                                                                                                 | Better fair value than the midpoint; timing and fill quality                                                                                                                                     | TBBO  | Have (`tilt_bps`)       |
| C3  | Order-flow imbalance (OFI) | Sum over quote updates of e = bid term − ask term ([Cont et al., 2014](https://academic.oup.com/jfec/article-abstract/12/1/47/816163)): bid term = new bid size if the bid price rose, size change if unchanged, −old bid size if it fell; ask term mirrored. ÷ mean depth | The established short-horizon price driver; also the denominator for a cleaner B1                                                                                                                | MBP-1 | New                     |
| C4  | Liquidity pulling          | Decrease in displayed size on one side through cancellations, not trades, over the last N seconds, ÷ mean depth; NULL unless all N rows are covered                                                                                                                        | Liquidity leaving ahead of a move or a release; spreads widen and depth falls before scheduled announcements in ES ([2026](https://www.sciencedirect.com/science/article/pii/S0165176526004520)) | MBP-1 | New                     |
| C5  | Spread state               | `rel_spread`: log(mean spread in the window ÷ the same-phase EMA(20) of earlier periods)                                                                                                                                                                                   | Wide spreads mean uncertainty and poor fills; a gate rather than a direction signal                                                                                                              | TBBO  | Have (`rel_spread`)     |

### D. Exhaustion and path

| #   | Metric                  | How to calculate                                                                                                                                                  | How it may contribute                                                                            | Data | Status                              |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---- | ----------------------------------- |
| D1  | Leg speed ratio         | log(pullback speed ÷ impulse speed), speeds in ATR per row                                                                                                        | Slowing pullbacks in a trend are healthy; an accelerating countermove is a reversal              | TBBO | Planned (`speed_ratio_log`)         |
| D2  | Volume per unit move    | log((leg volume ÷ leg size in ATR) ÷ the same for the previous same-direction leg)                                                                                | Rising effort per ATR of progress is exhaustion (B2 at the leg scale)                            | TBBO | New (`pullback_volume_log` planned) |
| D3  | Climax position         | Rows from the leg's largest one-second volume to its extreme; that volume ÷ the trailing same-phase mean, NULL with a "no baseline" state while that mean is zero | A climax at or just before the extreme followed by fading volume is the classic capitulation low | TBBO | New                                 |
| D4  | Leg-extension hazard    | Run past confirmation in θ, mapped through the overshoot survival curve fitted on training blocks                                                                 | The chance the current leg ends soon, compared with random                                       | TBBO | Planned (PR F0)                     |
| D5  | Regime: trend or revert | Variance ratio, return autocorrelation                                                                                                                            | Says whether flow signals should be read as continuation or as fade                              | TBBO | Have (`vr_5`, `ret_autocorr`)       |
| D6  | Path efficiency         | Net move ÷ sum of absolute moves in the window                                                                                                                    | Efficient paths are one-sided pressure; choppy paths are two-sided trade                         | TBBO | Have (`path_efficiency`)            |

### E. Location: where the test happens

| #   | Metric                   | How to calculate                                                                                                                                                                    | How it may contribute                                                                                                                               | Data     | Status                                                   |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------- |
| E1  | Distance to known levels | Distance from price to prior confirmed pivots, session high and low, prior session high, low, and close, in ATR                                                                     | Puts every flow metric in context: absorption at a level is a defended level                                                                        | TBBO     | Partly (`prior_high_atr`, `day_high_dist`, `donchian_*`) |
| E2  | VWAP distance            | (price − session VWAP) ÷ ATR                                                                                                                                                        | Institutional benchmark; reversion toward it or acceptance away from it                                                                             | TBBO     | Have (`session_vwap_atr`)                                |
| E3  | Volume-at-price peaks    | Session volume profile by tick: distance to the nearest price with volume above the session's 80th percentile, in ATR; volume at the current price ÷ the session's median per price | High-volume prices mark accepted value and resting interest ([theory](https://personalpages.manchester.ac.uk/staff/goran.peskir/levels.pdf))        | TBBO     | New                                                      |
| E4  | Round-number distance    | Signed distance to the nearest round level of the product's grid (for GC, multiples of $10 and $50), in ATR; side (just above or below)                                             | Take-profits at the number (reversal), stops just beyond (acceleration) ([Osler](https://onlinelibrary.wiley.com/doi/full/10.1111/1540-6261.00588)) | TBBO     | New (needs a rule exception, [section 8](#8-decisions))  |
| E5  | Level test count         | Number of separate approaches within k ATR of the level this session without a break, stored as context; the feature is min(count, 5) ÷ 5, bounded 0 to 1                           | Repeated tests use up the resting orders; the fourth test breaks more often than the first (hypothesis)                                             | TBBO     | New                                                      |
| E6  | Clock phase              | Seconds since session open and to close; minute of hour; minutes to the next LBMA auction or settlement                                                                             | Flow and reversals cluster at scheduled times; quarter-hour effects appear in crypto futures ([2026](https://arxiv.org/html/2607.09426v1))          | Calendar | Partly (`session_elapsed_s`)                             |

### F. Other markets

| #   | Metric                  | How to calculate                                                                                                                                                                                                                                                                                              | How it may contribute                                                                                                                                                                                                                                                                                 | Data           | Status                            |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | --------------------------------- |
| F1  | Non-confirmation        | When GC makes a new N-row extreme, the paired product's (SI, PL) distance from its own N-row extreme, in its ATR; mirrored for SI. For ES and NQ (a pair), whether the partner is also at a new extreme (a flag). A count over all four index products needs a multi-product stage, which is not designed yet | A low that the related market refuses to confirm is more likely to hold. Independent information, not a reworking of GC's own prices                                                                                                                                                                  | TBBO of pairs  | New (needs a cross-product stage) |
| F2  | Lead–lag residual       | GC return over the last k rows minus β × SI return, β rolling over the same trailing window (no fitted parameter), in ATR; as `beta_resid_atr` in the [pair design](../../project/pair-design.md)                                                                                                             | One market often moves a little ahead of the other; lagger forecasts reach about 60% accuracy for the next midpoint change in equities, but not after the spread ([Huth and Abergel, 2014](https://www.sciencedirect.com/science/article/pii/S0927539814000048)). Useful only as minute-scale context | TBBO of pairs  | New                               |
| F3  | Cross-market flow       | Partner's (buy − sell) ÷ (buy + sell) over the target's current swing leg (from its last confirmed pivot), needing the target's pivots: P3 after PR D. The rolling-window version is `partner_delta_ratio` in `pair_1m`, a separate, earlier proxy                                                            | Selling exhausted in GC while still heavy in SI, or the reverse                                                                                                                                                                                                                                       | TBBO of pairs  | New                               |
| F4  | Dollar and rates shocks | 6E and ZN returns over the last 1–5 minutes, in their ATR                                                                                                                                                                                                                                                     | Gold reacts to the dollar and yields; a shock there before GC moves is advance notice. US futures lead global gold price discovery ([Edinburgh](https://www.pure.ed.ac.uk/ws/files/82358957/GoldILS_JFutMkt_Forthcoming.pdf))                                                                         | TBBO of 6E, ZN | New (new data)                    |

### G. Positioning and schedule

| #   | Metric                      | How to calculate                                                                                                                                                                  | How it may contribute                                                                                                                                                                                                      | Data                 | Status                                                |
| --- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------- |
| G1  | Release proximity           | Minutes to and since the next scheduled release, with a release-type code                                                                                                         | Price impact per unit of flow rises around releases in ES ([arXiv:2508.06788](https://arxiv.org/html/2508.06788)); flow signals should be read differently, or entries blocked                                             | Outside calendar     | New                                                   |
| G2  | Late-session momentum       | Session return so far in ATR, with a flag for the session's last 30 minutes                                                                                                       | The last 30 minutes' return is predicted by the rest of the day in over 60 futures, linked to option and leveraged-product hedging ([Baltussen et al., 2021](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3760365)) | TBBO                 | New                                                   |
| G3  | Option open interest nearby | Open interest of OG (SO) strikes within ±1 ATR of price ÷ total open interest, from the latest statistics records published (`ts_recv`) at or before the decision, with their age | Large open interest near price can pin or accelerate price through dealer hedging. Dealers' side is unknown, so this is a weak proxy                                                                                       | Statistics (options) | New (later)                                           |
| G4  | Open interest change        | Change between the two latest published open-interest records ÷ open interest, joined as of publication (`ts_recv`), with its age                                                 | Separates new positioning from short covering; daily, so regime context only                                                                                                                                               | Statistics           | New                                                   |
| G5  | Roll-period flag            | Sessions since the last roll and to expiry, and the next month's volume share over completed sessions (the realized roll date is not known in advance)                            | Roll trading distorts flow; flow metrics may need to be ignored near rolls                                                                                                                                                 | Have (rolls)         | New (inputs stored; the features need a causal stage) |

Not recommended: **VPIN**. Its predictive content is mostly a mechanical link to trading
intensity, and it peaked after the 2010 flash crash, not before
([Andersen and Bondarenko, 2014](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1881731.)).
A1, A7, and C3 cover what it tries to measure.

## 6. How to make these useful

- **Read them at events.** Compute them every row, but train and evaluate at decision
  points: a pivot candidate at progress 0.25 and 0.5, and a level test (E1, E4, E3 within
  0.25 ATR). The question at a decision point is narrow ("does this low hold?"). Averaging
  over every row dilutes the signal.
- **Score against the random-walk baseline.** At a given progress, a low holds with a known
  probability if price is random
  ([early-confirmation update, section 2](2026-11-05-early-confirmation-update.md#2-two-random-walk-baselines-every-model-must-beat)).
  A metric is useful only if it moves that probability, measured as Brier skill over the
  baseline.
- **Add families one at a time.** Price only, then + aggression (A), + absorption (B), +
  location (E), + other markets (F), + book between trades (C3, C4, B5) once MBP-1 exists.
  Report the gain of each family with block-bootstrap intervals over sessions. This answers
  "what gave the edge" directly.
- **Report by regime and session segment.** Microstructure effects depend on state
  ([Andersen and Bondarenko](https://pure.au.dk/ws/files/68359010/rp13_43.pdf);
  [S E, 2026](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7053198)). An effect present
  only in the US morning is still useful if known.
- **Keep timing honest.** Cross-market values join only as of their availability. A level
  must be known before the test begins (a prior pivot is usable only after its confirmation).
  Event-level MBP-1 must be aligned to `ts_recv` like TBBO.
- **Respect costs.** A metric that predicts the next tick is useless with 1–2 ticks of fill
  uncertainty. Targets stay at ATR-sized brackets over minutes.

## 7. Proposed first study

A small event study that runs before PR F, without new storage or data:

1. **Candidates.** GC and SI, November 2025 to August 2026 (the September–October holdout
   untouched). Fixed-threshold directional-change pivots at 1 ATR on second rows, with
   candidates sampled at progress 0.25 and 0.5.
2. **Metrics.** B1, B2, B4, A3, D3, and F1, computed from TBBO in a research
   script with the row-window rules (B3 joins once MBP-1 is a source). E4 joins only if its exception (section 8, item 3) is
   approved.
3. **Test.** For each metric, split candidates into quintiles and compare the confirmation
   rate with the random-walk baseline in each quintile, then fit one logistic model with the
   baseline as an offset. Fit quintile edges and the model on November–March, purge one
   session, and score only April–August (Brier skill and quintile rates). Fixed parameters: N = 60 rows for B1, B2, and B7 (B1's earlier slope over the
   leg's rows before those, at least 30), p = 5 for A3, 20 earlier same-phase periods for
   D3's baseline, and the 60-row `1m@1s` window extremes for F1. No other values are
   tried. NULL policy: in the quintile test, NULL rows form their own bin, reported
   with their count and rate; in the logistic model, each metric enters with a missing
   indicator and NULL values set to the training block's median. Bin edges and medians
   come from the training block only. Pre-register the metrics, these parameters, the NULL policy, these periods, and the success rule: positive Brier skill over the baseline whose
   session-block 95% interval excludes zero, in both products.
4. **Report.** Which families moved the probability, by how much, and in which sessions.
   Metrics that pass become tier-1 or tier-3 stage features with migrations, if they are
   computed causally from past rows alone. A metric with parameters fitted on a training
   block becomes versioned, split-specific model preprocessing instead, never a shared
   stored column. Metrics that fail are recorded and dropped.

This takes days, and it decides which part of the inventory earns pipeline work.

## 8. Decisions

Paul decided on November 6, 2026:

1. **MBP-1: yes.** Paul downloads MBP-1 for the current products. Keep each Databento batch
   job as delivered, one per product with parent symbology as for TBBO, in its own folder
   such as `data/databento/mbp-1/GC--2025-11--2026-10/`. The catalog reads only TBBO and
   definition jobs (`catalog.SCHEMAS`), so MBP-1 folders do not affect `research` until a PR
   adds MBP-1 as a source. The included history window rolls, so its oldest days cost a
   little more each week. The download is approved; reading MBP-1 is not yet. The binding
   rule in `AGENTS.md` and the [engine](../../project/engine.md#data-limits-tbbo-only) stays
   "TBBO only" until the PR that adds MBP-1 as a source changes it with Paul's approval
   ([second scale and MBP-1](2026-11-06-second-scale-and-mbp1.md)).
2. **Paired products: yes**, starting with GC + SI and ES + NQ. The design is
   [pair-design.md](../../project/pair-design.md).
3. **Round numbers:** open. The scale-invariance test multiplies every price by a factor,
   and the nearest round level moves when prices are multiplied, so E4 cannot pass it as
   written. The proposal is an explicit exception for features defined on a product's price
   grid, tested instead by shifting prices by whole grid steps.
4. **Economic-release calendar:** deferred, neither accepted nor rejected. If added, it is
   one more input (G1): scheduled release times, recorded as known before each release.

Later, if the first study finds absorption useful: MBO for GC and SI ($307 a year) for B6
and limit-order simulation, and gold-options statistics for G3.

## Sources

Market microstructure: [Cont, Kukanov and Stoikov 2014](https://academic.oup.com/jfec/article-abstract/12/1/47/816163);
[Gould and Bonart 2015](https://arxiv.org/abs/1512.03492);
[Kolm, Turiel and Westray 2023](https://onlinelibrary.wiley.com/doi/10.1111/mafi.12413);
[Lillo and Farmer 2004](https://arxiv.org/abs/cond-mat/0311053);
[Chordia and Subrahmanyam 2004](https://www.sciencedirect.com/science/article/pii/S0304405X03001752);
[Andersen and Bondarenko on VPIN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1881731.) and
[trade classification](https://pure.au.dk/ws/files/68359010/rp13_43.pdf);
[Filimonov and Sornette 2012](https://link.aps.org/doi/10.1103/PhysRevE.85.056108);
[order-flow filtration, 2025](https://arxiv.org/abs/2507.22712v2);
[S E 2026, OFI replication](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7053198) (single author, preprint).

Hidden liquidity: [Zotikov and Antonov 2021](https://arxiv.org/abs/1909.09495);
[level-I hidden liquidity, Physica A 2020](https://www.sciencedirect.com/science/article/pii/S0378437119315407);
[Lajbcygier et al. 2025](https://onlinelibrary.wiley.com/doi/full/10.1111/jfir.12414);
[Narayan 2026](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=7551778) (single author, preprint, one session).

Levels and schedule: [Osler 2003](https://onlinelibrary.wiley.com/doi/full/10.1111/1540-6261.00588);
[Osler 2002, stop cascades](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr150.pdf);
[Kavajecz and Odders-White 2004](https://academic.oup.com/rfs/article-abstract/17/4/1043/1570736);
[De Angelis and Peskir 2016](https://personalpages.manchester.ac.uk/staff/goran.peskir/levels.pdf) (theory);
[Baltussen, Da, Lammers and Martens 2021](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3760365);
[liquidity withdrawal before announcements, 2026](https://www.sciencedirect.com/science/article/pii/S0165176526004520);
[returns and order flow around macro news in ES](https://arxiv.org/html/2508.06788);
[quarter-hour effect in crypto futures](https://arxiv.org/html/2607.09426v1).

Cross-market: [Huth and Abergel 2014](https://www.sciencedirect.com/science/article/pii/S0927539814000048);
[gold price discovery, London and New York](https://www.pure.ed.ac.uk/ws/files/82358957/GoldILS_JFutMkt_Forthcoming.pdf).

Data: [Databento GLBX.MDP3 catalog](https://databento.com/catalog/cme/GLBX.MDP3) (schemas,
plans and history windows); [statistics schema](https://databento.com/docs/schemas-and-data-formats/statistics);
[dataset specification](https://databento.com/docs/venues-and-datasets/glbx-mdp3). Costs and
sizes: Databento `metadata.get_cost` and `get_billable_size` for this account on November 5, 2026.

Most journal papers above were read as abstracts or excerpts, not full text; the claims used
here are the ones stated in those abstracts or excerpts.
