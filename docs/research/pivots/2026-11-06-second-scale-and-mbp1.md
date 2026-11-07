# Second and sub-second metrics, and the choice between MBP-1 and TBBO

Researched November 6, 2026. This note revises one assumption of the
[order-flow inventory](2026-11-05-order-flow-predictors.md): that strategies target moves of
an ATR or more over minutes. Paul wants second and sub-second strategies in scope as well.
It covers what can be computed at those resolutions, what each metric needs from the data,
what is realistic for a trader who is not colocated, and which schema to build on. Nothing
here is implemented or measured.

## Answer in brief

1. **Use MBP-1.** At second and sub-second scales, TBBO's blind spot (no book between
   trades) is exactly where most of the useful metrics live: about half of the inventory
   below needs MBP-1. TBBO's book is older than one second at 64% of random moments in GC
   and 85% in SI ([engine](../../project/engine.md#data-limits-tbbo-only)). In one GC hour
   (October 15, 2026, 13:30–14:30 UTC), the front contract had 289,988 top-of-book changes
   and 10,157 trades (10,861 across all GC instruments, including other months and spreads): TBBO shows the book at about one change in 29.
2. **History costs about the same.** For 2024, quoted for this account on November 6, 2026:

   | Product | TBBO            | MBP-1             |
   | ------- | --------------- | ----------------- |
   | GC      | $55.81, 2.1 GB  | $49.03, 29.2 GB   |
   | SI      | $20.74, 0.8 GB  | $32.18, 19.2 GB   |
   | ES      | $218.95, 8.4 GB | $237.55, 141.7 GB |
   | NQ      | $208.04, 8.0 GB | $246.04, 146.8 GB |

   Inside the included 12-month window both are about $0. The real cost of MBP-1 is
   storage and processing: 14–18 times the billable bytes. The GC hour above was 8.4 MB
   compressed, against 2.4 MB of TBBO for the whole day.

3. **Switching back is trivial.** TBBO is a documented subset of MBP-1
   ([Databento](https://databento.com/docs/schemas-and-data-formats/tbbo)). On the GC hour
   above, all 10,861 MBP-1 trade records (every GC instrument, `action == 'T'`) were identical to the local TBBO file in every
   field: times, instrument, price, size, side, the pre-trade bid and ask, their sizes,
   order counts, and sequence. The current source already selects `action == 'T'`. Keeping
   only trade records from MBP-1 therefore reproduces TBBO exactly, and every existing stage
   builds unchanged. The only lock-in is a model trained on book features. It needs MBP-1
   live and in every period it is tested on, and its book features are NULL on TBBO-only
   history.
4. **Be realistic about speed.** Latency-arbitrage races on exchanges last 5–10
   microseconds ([Aquilina, Budish and O'Neill, 2022](https://academic.oup.com/qje/article/137/1/493/6368348)).
   Databento's internet feed reaches an application in about 590 µs at the 90th percentile
   ([Databento](https://databento.com/live)), and an order still has to travel to CME. Any
   edge that comes from reacting first to public news, such as ES moving before NQ, belongs
   to colocated firms. What remains for us is **statistical prediction from book and flow
   state** over horizons from about one second to a minute, and using sub-second signals to
   **time entries** for longer trades. Both need prediction, not speed.
5. **Costs set the minimum move.** A market order pays the spread (usually one tick in GC
   and ES) plus fees. A one-tick prediction that is right 60% of the time does not pay for
   that. Second-scale labels must ask whether price moves by more than the round-trip cost
   within N seconds, not just which way it moves next.

## What can be computed each second (or twice a second)

Each metric is computed over every trade or book event assigned to the row, and published at
the row's close. Row and intra-row membership (such as the last 100 ms) both use the
assignment time `max(ts_event, ts_recv + feed_latency − close_delay)`, the same as trades;
`ts_event` is kept only as context. Rows can stay one second long, with sub-second detail held as
values inside the row (for example the last 100 ms), or a 500 ms row grid can be added under
the same row rules. Every model feature is a ratio, a log ratio, a time, a flag, or a price distance ÷ the
current or typical spread, in basis points, or in ATR, never a raw price. Raw counts are
stored as context only; their features are rates relative to a trailing same-phase baseline. "Queue" means the displayed size at the best
bid or ask.

### Book state (MBP-1)

| #   | Metric                    | How to calculate                                                                                                                                                                                                                                                                                                                                                                              | How it may contribute                                                                                                                                                               |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | Queue imbalance, current  | bid queue ÷ (bid + ask queue) at the row close, and its time-weighted mean over the row                                                                                                                                                                                                                                                                                                       | The best-documented next-move predictor, strongest for large-tick contracts like GC and ES ([Gould and Bonart](https://arxiv.org/abs/1512.03492)). TBBO has it only at trades       |
| S2  | Microprice offset         | Stored per row: imbalance, spread, and the analytical offset (weighted mid − mid) ÷ spread = imbalance − 0.5. A learned Stoikov mapping is fitted as versioned preprocessing on each training block only, never inside the shared stage ([Stoikov](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2970694))                                                                              | Fair value inside the spread; a better reference than the mid for short labels and entries                                                                                          |
| S3  | Queue size, relative      | Each queue ÷ its trailing same-phase median                                                                                                                                                                                                                                                                                                                                                   | A thin book moves on small flow; a thick queue is a wall                                                                                                                            |
| S4  | Depletion rate and time   | Within an uninterrupted episode at one best price (reset on every best-price change, gap, and session open): net decrease of each queue (fills plus cancels minus adds) per second ÷ that queue's trailing same-phase median size; when it is positive, queue ÷ raw rate = seconds to depletion; otherwise the time is NULL with a state flag (stable or growing). Raw rates are context only | The next tick goes to the side whose queue empties first; the probability follows from queue sizes and rates ([Cont and de Larrard](https://epubs.siam.org/doi/10.1137/110856605))  |
| S5  | Fill against cancel       | Of the size removed at the best bid in the window, the share removed by trades rather than cancellations (and for the ask); NULL with a "no removal" state when nothing was removed                                                                                                                                                                                                           | Cancels mean liquidity is leaving before being hit; fills mean it is being consumed. TBBO cannot separate them                                                                      |
| S6  | Add rate and refill speed | Size added at the best per second ÷ that queue's trailing same-phase median size. Refill time is published only on the row where the queue regains its pre-trade size at the same price; until then the row carries the seconds elapsed and an "unrecovered" flag. Any change of the best price censors the observation (MBP-1 no longer shows that level), as do gaps and the session end    | Fast refills mean a persistent passive buyer or seller (absorption, exact)                                                                                                          |
| S7  | Order-flow imbalance      | Sum of the Cont et al. OFI terms over every quote update ([Cont, Kukanov and Stoikov](https://academic.oup.com/jfec/article-abstract/12/1/47/816163)) within the last 100 ms of the current row, the current row, and the latest five scheduled-open rows (by `slot_ordinal`), ÷ mean depth. Each horizon is NULL unless every row it spans is covered, so a gap never counts as zero flow    | Linear driver of short price changes; stationary inputs like this beat raw book snapshots for neural models ([Kolm et al.](https://onlinelibrary.wiley.com/doi/10.1111/mafi.12413)) |
| S8  | Message intensity         | Book events per second ÷ the trailing same-phase mean, NULL with a "no baseline" state while that mean is zero; cancel share cancels ÷ (cancels + trades), bounded 0 to 1 and NULL with a "no activity" flag when both are zero                                                                                                                                                               | Bursts of quoting precede volatility; a rising cancel ratio marks nervous liquidity                                                                                                 |
| S9  | Spread time               | Share of the row with the spread above its trailing same-phase median, and widenings beyond that median per row ÷ their trailing same-phase mean (raw count as context; NULL while the baseline is zero)                                                                                                                                                                                      | Wide-spread moments are expensive and unstable: a gate for entries                                                                                                                  |
| S10 | Level age                 | Seconds since the best bid (ask) price last changed, restarting at each session open and after any coverage gap from the first observed book; best-price changes per row ÷ their trailing same-phase mean (raw count as context; NULL while the baseline is zero)                                                                                                                             | Large-tick prices stick; a long-lived level that suddenly flickers is about to break                                                                                                |
| S11 | Post-move queue           | Size of the new best queue right after a price level clears, ÷ its typical size                                                                                                                                                                                                                                                                                                               | A thin new queue after a tick move means continuation is cheap ([queue-reactive model](https://arxiv.org/pdf/1312.0563v1))                                                          |
| S12 | Quote-driven moves        | Share of mid changes in the window not caused by a trade at that level; NULL with a "no move" state when the mid did not change                                                                                                                                                                                                                                                               | Prices moving by quotes alone usually reflect information from elsewhere (related markets, news)                                                                                    |

### Trade flow (TBBO is enough)

| #   | Metric                 | How to calculate                                                                                                                                                                                                                                                                                                                                                           | How it may contribute                                                                                 |
| --- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| S13 | Signed volume, nested  | Delta ratio, (buy − sell) ÷ (buy + sell), over the last 100 ms of the current row, the current row, and the latest five scheduled-open rows; each horizon is NULL unless every row it spans is covered, and NULL with a "no sided flow" state when it has no buy or sell volume                                                                                            | Acceleration of pressure: the short window running ahead of the long one                              |
| S14 | Take against queue     | Per row: the mean and the maximum of trade size ÷ the opposing queue before it, over trades with a known side and positive opposing depth; needs a new count of those trades (`buy_take_sum`, `sell_take_sum` hold only the sums); NULL when there are none                                                                                                                | A take that nearly clears the queue tends to be followed through to the next tick                     |
| S15 | Trade clustering       | Trades sharing one `ts_event` and side: cluster size ÷ the trailing median trade size (14% of GC trades shared a `ts_event` in the sample hour, not always on one side)                                                                                                                                                                                                    | Usually one aggressor matching several resting orders: impatient size from one order rather than many |
| S16 | Inter-trade time       | Over trade clusters (trades sharing one `ts_event` count once): log(scheduled-open time since the previous cluster ÷ its trailing median). NULL until the first cluster after a session open or coverage gap, so closures never count as lulls                                                                                                                             | Bursts against lulls; the state in which flow signals are read                                        |
| S17 | Buy and sell intensity | Exponentially decaying counts of buy and sell trades (a simple Hawkes intensity, stored as context), reset at session opens and coverage gaps. Features: the buy share buy ÷ (buy + sell), bounded 0 to 1, and the total ÷ its trailing same-phase mean; both NULL with an "inactive" flag until trades after the reset (or whenever the intensities or baseline are zero) | Self-exciting runs that overshoot, then snap back                                                     |
| S18 | Impact per unit flow   | Mid change in bps ÷ (net signed volume ÷ trailing median volume per trade) over the last N trades, within one covered stretch: the window resets at coverage gaps and session opens, and S18 is NULL until N trades follow the reset; NULL with a "balanced" flag when the absolute net signed volume is below 5% of the window's volume                                   | Absorption at the touch: heavy aggression with no tick progress                                       |

### Other markets (pair stages, MBP-1 or TBBO)

| #   | Metric                    | How to calculate                                                                                                                                                                                                                                          | How it may contribute                                                                                              |
| --- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| S19 | Partner move not yet seen | Each leg's mid change over the last 0.1–1 s in bps ÷ that leg's trailing deviation of such changes; S19 = partner value − target value (a partner move the target has not matched); NULL with a "flat" state when either leg's trailing deviation is zero | Microsecond reactions belong to colocated firms; measure whether any residual survives at 1 s before relying on it |
| S20 | Partner book pressure     | Partner's S1 and S7                                                                                                                                                                                                                                       | Pressure building in NQ (or SI) while ES (or GC) is quiet                                                          |

### Labels for short horizons

- The direction and time of the next mid change (a classification problem, sized by S4).
- Whether the mid moves by at least the round-trip cost plus k ticks, up or down first,
  within N seconds (N = 5, 15, 60). The cost is part of the label, so the model never
  learns moves too small to trade.
- For passive entries: whether a limit order at the best would fill before the price moves
  away. Simulating that honestly needs queue position, which needs MBO.
- Every label is unknown, and excluded from training and scoring, when a coverage gap or
  session boundary falls before its outcome is decided (the next mid change, a barrier, or
  the end of its N-second horizon). An unobserved follow-up is never a no-move or no-fill
  result; the count of excluded examples is reported.

## Effort

| Step                          | Work                                                                                                                                                                                                                                                                                       | Size   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 1. MBP-1 as the trade source  | Catalog accepts `mbp-1` jobs; per day, use MBP-1 only when its file window and condition cover the TBBO file's, otherwise keep TBBO for that day; the source keeps trade records, as it already does. A test checks that rows built from MBP-1 equal rows built from TBBO for the same day | Small  |
| 2. Book events into the chunk | `MarketChunk` carries book updates beside trades; assignment to rows by the same function and settings as trades, `max(ts_event, ts_recv + feed_latency − close_delay)`; `research verify` covers them                                                                                     | Medium |
| 3. Stage `book_1s` (tier 0)   | S1–S12 per second in numba kernels, like the existing indicators; one row per scheduled second; NULL when the book is missing                                                                                                                                                              | Medium |
| 4. Fills at the true book     | The simulator fills at the book at decision time plus a latency, instead of the next trade's book                                                                                                                                                                                          | Medium |
| 5. Live                       | Subscribe to `mbp-1` instead of `tbbo`; about 100 events per second per product in busy hours, more at peaks                                                                                                                                                                               | Small  |

Step 1 changes no stored value, and steps 2–5 add new tables beside the existing ones. Going
back to TBBO for any product or period means skipping steps 2–3 there: the book features
are NULL, and everything else is unchanged.

Storage: about 15–20 times TBBO. By the ratio of compressed to billable size seen for TBBO,
a year of all seven products should take roughly 150–200 GB compressed (an estimate, to be
measured on the first download).

## Recommendation

Adopt MBP-1 as the archive schema for all products, with TBBO derived from it, and keep the
TBBO files as they are. Order of work: step 1 (small, and it proves equality), then the
order-flow event study on trade metrics, then steps 2–4 with an event study of S1–S12 at
1–60 second horizons, using labels that include costs. The November 1 rule "TBBO only, same
rules for every product" becomes "MBP-1, same rules for every product" once step 1 merges.
