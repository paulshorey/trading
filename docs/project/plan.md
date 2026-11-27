# The working plan

Written November 27, 2026, with Paul. This is the list of work in order. Each step is
written so that it can be given to an agent on its own: what it is for, what to read, what
to do, when it is done, and what it must not do. The [roadmap](roadmap.md) holds the goal,
the decisions, and how a result is judged; [status](status.md) says where the work stands
today; [results](results.md) records what each experiment found.

**Status of this page:** proposed. Steps marked *needs Paul* wait for a decision listed
under [open decisions](#open-decisions).

## The strategy in five lines

1. **Train one model on every product we have, over the one free year.** Many products
   replace many years ([decisions 13 and 42](roadmap.md#decisions)).
2. **Hold out time, not products.** The last months of the year are never trained on, and a
   few months of new data, downloaded just before live trading, are the final test.
3. **Add products by kind of market**, because products of one kind move together. Metals
   are here; equity indices are downloaded; energy and currencies follow.
4. **Then add new information**, not more views of the price path: the book between
   trades, and how the structures of price, RSI, and CVD compare.
5. **Buy five more years only if the one-year result is promising**, by a rule written
   down before the result is seen ([the gate](#the-gate-is-it-promising)).

## What the products are worth as evidence

Five-minute returns during US hours on eight days across the year (measured November 27,
2026; a small sample, enough to rank):

| | ES | NQ | YM | RTY | GC | SI | PL |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ES | 1.00 | 0.94 | 0.83 | 0.83 | 0.49 | 0.45 | 0.45 |
| NQ | | 1.00 | 0.66 | 0.76 | 0.47 | 0.42 | 0.44 |
| YM | | | 1.00 | 0.78 | 0.41 | 0.36 | 0.36 |
| RTY | | | | 1.00 | 0.42 | 0.38 | 0.39 |
| GC | | | | | 1.00 | 0.82 | 0.74 |
| SI | | | | | | 1.00 | 0.78 |

The four indices are about one and a half markets, not four, and the three metals about
one and a half. Indices and metals are less separate than expected (0.36 to 0.49). So a
third and a fourth kind of market add more evidence than another index. Trade dates stay
the unit of evidence: every interval resamples whole dates, all products together.

| Kind | Products | State |
| --- | --- | --- |
| Metals | GC, SI, PL | GC and SI stored; PL downloaded |
| Equity indices | ES, NQ, YM, RTY | Downloaded, not stored |
| Energy | CL, RB, NG | Downloading. RB follows CL closely and trades less; NG is nearly unrelated to CL |
| Currencies | 6E, 6J, and one more | Not downloaded. The franc follows the euro; the yen is the most independent; a commodity currency (6A or 6C) adds more than 6S |
| Rates | ZN | Not trained on: its price moves in whole ticks at these timeframes |
| Micros | MES, MNQ, MGC | Not trained on: the same prices as the minis. Wanted later, to price fills |

## Steps

Machine time is on this Mac (10 cores, 64 GB). "Stale" and "rebuild" are explained in
[ingestion](ingestion.md#builder-identities-and-when-a-stage-is-stale).

### Phase 0: finish what is running

**0.1 Record the dated-clock result.** The model with and without the 135 dated market
clocks on GC and SI (yardstick run 15) is running.
- *Do:* when it finishes, write its result into [results.md](results.md) and
  [clock-spec.md](clock-spec.md) as the spec there says; update [status.md](status.md).
- *Done when:* the result table, the paired difference with its interval, and what it does
  and does not show are in results.md.
- *Do not:* change the spec's measure after seeing the number.

### Phase A: make room for many products

These four steps do not depend on each other and can run in parallel, except that A3
rewrites stored rows and must not overlap another ingest.

**A1. Check the new files.** ES, NQ, YM, RTY, and PL are in `data/databento/mbp-1/`.
- *Read:* [ingestion.md](ingestion.md#the-data-on-this-machine), the `databento-mbp-1` skill.
- *Do:* `research catalog --verify` (checksums). Turn the checks made by hand on GC and SI
  into one command, `research audit PRODUCT` (full decode, record types, receive order,
  event-time inversions, implied tick size against the product table, trades outside the
  calendar, crossed books, Databento's flags, the most traded contract by day), and run it
  on all seven products.
- *Done when:* a report per product is saved under `~/tmp_trading/`, every difference from
  the product table is fixed or listed, and flagged dates are named.
- *Do not:* ingest anything. About 185 GB of files; allow an hour or two.

**A2. Decide which product trains on which timeframe.** A market whose price moves in
whole ticks makes most features collapse (the ATR sits at its spread floor).
- *Do:* from the files, for each product and each timeframe, measure the typical range of
  a window in spreads, the share of seconds with a trade, and the spread against the slow
  ATR (the cost of a trade). Propose a rule ("train a product on a timeframe where its
  typical range is at least N spreads") and the table it gives.
- *Done when:* the table and the rule are in this page and Paul has confirmed the rule.
  *Needs Paul.*

**A3. Store one-second values only where they are read**
([decision 25](roadmap.md#decisions)). The database holds 375 GB for two products; twelve
would not fit beside the files.
- *Read:* [ingestion.md](ingestion.md#fast-swing-rows-are-stored-sparsely), `pipeline.py`
  (`SPARSE`, `SPARSE_STEPS`, `stored_rows`), `dataset.py` (what it reads).
- *Do:* store `candle_1m_1s`, `stats_1m_1s`, and `vol_1s` at ten-second ends and at event
  rows, as the fast swings already are; keep `bar_1s` complete. The engine still computes
  every second. Rebuild GC and SI; return the dead space (`VACUUM FULL`, one partition at
  a time).
- *Done when:* `ingest plan` is `current`; a backtest warmed for the lead still computes
  the stored rows (the existing test); `research verify` passes; the dataset built from the
  new rows equals the one built before, value for value; the database size is recorded.
- *Do not:* change any value. This step changes what is kept, never what is computed.
  A rebuild of two products: allow three hours.

**A4. Freeze how many products are judged.** Before any index is scored.
- *Read:* [how results are judged](roadmap.md#how-results-are-judged),
  [yardstick-spec.md](yardstick-spec.md).
- *Do:* write the spec: the same dates and test months for every product; three fits on
  the same rows, *pooled* (one model, all products), *per kind* (one model a kind), and
  *leave one kind out* (fitted without a kind, scored on it); skill reported pooled, by
  kind, by product, and for buys and sells apart; intervals from resampled trade dates
  with all products' rows of a date together. Decide whether the model is told the kind
  of market ([open decision 4](#open-decisions)). Build what the yardstick needs to run
  it: a product list, the three fits, memory and time (the dataset is 1.4 GB a product;
  a run on two products takes 80 minutes, so twelve need a plan, such as fewer rows a
  product or one fit a night).
- *Done when:* the spec is merged and `research yardstick` runs the three fits on GC and
  SI alone, reproducing the latest run's pooled number.
- *Do not:* score an index before the spec is merged.

### Phase B: equity indices

**B1. Register and ingest ES, NQ, YM, RTY, and PL.** *After A1, A2, A3.*
- *Do:* confirm each product's tick size and value, calendar, commission, main hours, and
  dated market clocks (the venue rules in `strategy_core/schedules/`); `research ingest
  run`; one `research verify` day per product; the fingerprint baseline extended.
- *Done when:* every contract is `current`, each product's verify passes, and the
  continuous series of each product has no unexplained gap.
- Allow most of a day: ES has about four times GC's book activity.

**B2. The first model on two kinds of market.** *After A4 and B1.*
- *Do:* run the frozen spec on metals and indices together. Record every number.
- *Done when:* results.md holds pooled, per-kind, and leave-one-kind-out results, and the
  answer to "is one model for both kinds at least as good as one each?".

**B3. Does the minute-end result hold between minute ends?** *Any time after A3.* The
dataset has one row a minute, at its last second, where the slower timeframes have just
completed a row; the model would decide at every second.
- *Do:* add rows at the other ten-second ends (they are stored), with the minute-end rows
  as the control, and compare the model on both. Spec first.
- *Done when:* the paired comparison is in results.md.

### Phase C: energy and currencies

**C1. Choose them from numbers.** *When the files are here.*
- *Do:* run A1 and A2 on CL, RB, NG and on the currency files; extend the correlation
  table above with them.
- *Done when:* this page says which are trained on and why. *Needs Paul.*

**C2. Register, ingest, and rerun.** As B1 and B2, for the kinds chosen. Energy and
currencies have their own main hours and dated clocks (inventory reports, London and Tokyo
hours), which are registered before the run.

### Phase D: new information

Each is judged by the model with and without it, on every kind of market stored by then.

**D1. The book between trades** (`book_1s`, step 1 of the process). Today the model sees
the book only as each trade saw it. Judged at the one-minute horizon and by the quality of
entries, where the only predictability so far was found.

**D2. The codes that compare price, RSI, and CVD** (step 5;
[decision 41](roadmap.md#decisions)): what each series had confirmed when price confirmed a
higher high or a lower low, the age of each confirmation, and "still waiting" kept apart
from "confirmed and disagreeing". With the current pullback over the threshold as its own
feature. This rebuilds the swing stages.

**D3. One portfolio across products**: one position at a time and one daily limit shared
by all. Needed as soon as a model's policy trades more than one product.

### The gate: is it promising?

Written before the results exist. *Needs Paul* ([open decision 1](#open-decisions)).
Proposed: the one-year result is promising when, on the test months,

- the pooled forecast's skill at the bracket horizon is above zero with its interval, and
  at or above zero for at least two kinds of market taken alone; **or**
- a policy's net result after costs is above zero with its interval, under both base and
  stressed execution, and not from one kind, one product, or one side alone.

Then, in this order: the holdout months (September 1, 2026 onward) are evaluated once, as
a check that is recorded whatever it shows; five more years are bought; the model is
walked forward over them, which is the real test; and the months downloaded just before
live trading are the final one.

If neither holds after Phase D, the plan is reviewed with Paul before anything is bought.

### Phase E: after the gate

**E1.** Five more years, ingested and walked forward by quarter. **E2.** The swing mode
(positions held across days; [decision 40](roadmap.md#decisions)). **E3.** Paper trading on
the live feed, replayed each day as a backtest to confirm identical decisions. **E4.** The
final evaluation on the newest months, once. **E5.** A broker adapter and a small live test.

## Order and what can run together

```text
0.1 ──┐
A1 ───┼─ B1 ─┐
A2 ───┤      ├─ B2 ─ C2 ─ D1, D2 ─ the gate ─ E
A3 ───┘      │
A4 ──────────┘        B3 any time after A3;  C1 when the files arrive
```

A3 and B1 write to the database and must not run at the same time as another ingest.
Model runs (0.1, B2, B3, C2) read it and take hours; run one at a time.

## Open decisions

For Paul. Each has a recommendation.

1. **The gate.** Is the rule above the right test of "promising"? Recommended as written.
2. **What would be traded live.** Which products, and minis or micros? It sets the costs
   every result is charged and whether one portfolio (D3) comes early. Recommended: decide
   after B2 shows which kinds the model works on; charge full-size costs until then.
3. **The holdout.** September 1 to November 6, 2026 for every product, looked at once, at
   the gate. Recommended as written.
4. **Does the model know which market it is looking at?** Today it does not: every input
   is normalized and no product name is given. Recommended: keep it blind for the pooled
   fit, and add one run that is told the kind of market, as a comparison.
5. **Rates and grains.** Recommended: ZN downloaded but not trained on; grains left until
   after the gate (their sessions have a midday break and daily price limits).
6. **How long a run may take.** With twelve products a full comparison is many hours.
   Recommended: overnight runs are acceptable; one model run at a time.
7. **The order of Phase D.** Recommended: the book between trades before the comparison
   codes, because it is new information and the comparison codes are another view of
   price.
