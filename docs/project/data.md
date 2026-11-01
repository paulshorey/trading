# Historical data

Status: the DBN file catalog, contract selection, session calendars, one-second and
one-minute base bars, and per-session quality checks are implemented in memory
(`apps/backtest-runner`). PostgreSQL holds the file catalog; one-second rows come
next. The bars feed the window
engine described in the [sliding-window design](../sliding-windows/design.md).

## What we have

One year of Databento **TBBO** (every trade with its aggressor side and the best bid
and ask just before it), November 1, 2025 to October 31, 2026, for seven CME
products. **GC and SI are the prototype pair**; NQ and ES are much larger, so leave
them for later.

| Product | Exchange contract      | Tick, value  | Files | Trades/day, front (median) | Seconds with a trade | Unknown side |
| ------- | ---------------------- | ------------ | ----- | -------------------------- | -------------------- | ------------ |
| GC      | COMEX gold, 100 oz     | 0.10, $10    | 311   | 97,000                     | 38%                  | 3.1%         |
| SI      | COMEX silver, 5,000 oz | 0.005, $25   | 311   | 30,000                     | 20%                  | 3.1%         |
| PL      | NYMEX platinum, 50 oz  | 0.10, $5     | 311   | 12,000                     | 8%                   | 3.7%         |
| ES      | E-mini S&P 500         | 0.25, $12.50 | 312   | 451,000                    | 60%                  | ~0%          |
| NQ      | E-mini Nasdaq-100      | 0.25, $5     | 312   | 381,000                    | 63%                  | ~0%          |
| YM      | E-mini Dow ($5)        | 1, $5        | 312   | 65,000                     | 29%                  | ~0%          |
| RTY     | E-mini Russell 2000    | 0.10, $5     | 312   | 92,000                     | 33%                  | ~0%          |

Layout: one Databento job folder per product, kept exactly as delivered (manifest,
metadata, condition, and daily `glbx-mdp3-YYYYMMDD.tbbo.dbn.zst` files), under
`data/databento/tbbo/<ROOT>--2025-11--2026-10/` (gitignored, 7.3 GB; back it up).
Every job is dataset `GLBX.MDP3`, schema `tbbo`, parent symbology (`GC.FUT` and so on:
all contracts and calendar spreads), DBN with zstd, split by UTC day.

Verified on November 1, 2026 (`uv run research catalog --verify` plus a full decode):

- All 2,181 files are present with the manifest size and SHA-256; all are registered
  in `market.source_file`.
- Every record is a trade, receive times are sorted, and no event time goes backward.
- Tick sizes implied by the prices equal the product specs in `strategy_core.market`.
- No outright trade falls outside the exchange calendar in any file, including
  holidays, early closes, and the equity-only Good Friday session (2026-04-03).
- Databento marks 2025-11-28 (a long CME Globex outage), 2026-03-16, 2026-04-10, and
  four weekend dates `degraded`. On 2025-11-28 most NQ, YM, and RTY records carry the
  "book may be wrong" flag; exclude or flag that day.
- Unknown-side volume is the outright legs of spread trades; it stays out of CVD.
- Front months by volume: GC G, J, M, Q, Z (rolling late in the month before); SI H,
  K, N, U, Z; PL F, J, N, V; ES, NQ, YM, RTY quarterly, about the second Monday of the
  expiry month.

**TBBO only, for every product (decided November 1, 2026).** No more detailed
Databento schema will be bought. TBBO is exact for every trade, but it shows the book
only at trades, so simulated fills in thin markets are uncertain by a tick or two;
see [data limits](engine.md#data-limits-tbbo-only) for measurements and design
consequences.

**Contract definitions (recommended, not yet downloaded):** Databento quoted $0.00 for
a year of `definition` records for all seven parents. They give each contract's
expiration, tick size, and multiplier for the contracts table, and distinguish raw
symbols that repeat each decade. Download a batch job with the same settings as the
TBBO jobs (`GLBX.MDP3`, parents above, schema `definition`, 2025-11-01 to 2026-11-01,
DBN, zstd, split by day) into `data/databento/definition/`. The catalog recognizes
`definition` jobs, and `research catalog --verify` checks them.

TBBO lets the backtest charge the actual spread at each simulated order. It carries
only top-of-book size and order count at trades; there is no depth beyond the best
price.

Choose DBN rather than JSON or CSV: integer prices (units of 10⁻⁹), nanosecond
timestamps, and a header with the query and the instrument ID of each contract on
each date. A CME session runs from 17:00 to 16:00 CT, so it spans two daily files;
the source reads both and never assumes a file is a session.

## What the sample shows

The one-day Micro Gold (MGC) sample in `data/sample/` (August 31, 2026) has 218,695
TBBO records across 21 instruments:

- **Contracts.** The front contract, MGCZ6, has 80% of trades. The expiring MGCV6
  has 11%, calendar spreads 9%, and farther months 0.5%.
- **Schedule.** MGCZ6 traded in all 1,380 open minutes and in 60% of open seconds.
  Nothing traded during the 16:00–17:00 CT halt.
- **Aggressor side.** MGCZ6 volume was 45% buyer-initiated, 45% seller-initiated,
  and 10% unknown. Every unknown-side trade coincided with a spread trade: these
  are the outright legs of spread trades.
- **Sweeps.** 14% of MGCZ6 trades printed outside the attached bid and ask. 99.8% of
  those were later fills of the same event, as an order swept several price levels.
- **Ordering.** Event timestamps never went backward in file order.

## Storage

**Decision (revised October 31, 2026): DBN files are the permanent tick archive, and
PostgreSQL holds everything derived from them, including one row per scheduled-open
second per contract.** There is no Parquet or DuckDB layer.

- **DBN files** keep every trade with its pre-trade book. Fills and any rebuild read
  them. A year of the seven products is 7.3 GB with zstd.
- **One-second rows** (OHLCV plus per-second metrics such as aggressor flow, CVD,
  spread, and top-of-book size and imbalance at trades) are computed by an ingestion
  job and stored for SQL research, ML exports, and fast backtests. **Every
  scheduled-open second gets a row, including seconds without trades** (status
  `no_trades`; decided November 1, 2026), and every row carries its index counter
  (`slot_ordinal`), so a sliding window is always exactly 60 consecutive rows with no
  skip logic and phases never depend on the clock. SI has trades in only 20% of its seconds. A
  contract-year is about 21 million scheduled seconds. A measured binary `COPY` of 44-column rows wrote
  about 400,000 rows per second at about 400 bytes per row before indexes, or about
  a minute and 8 GB per contract-year. Store the front and next contracts from the
  roll schedule, not every listed month.
- **Relational data**: the file catalog with checksums, contracts, coverage, the roll
  schedule, quality reports, runs, trades, ML rows, models, predictions, and live
  decisions.

The ingestion job must compute rows with `strategy-core` code, the same code a live
session runs on the live feed; never reimplement a metric in SQL or a separate
script. Each stored row set records its builder version (code hash, assignment
settings such as `close_delay`, and source files). See the
[storage contract](../../lib/db-research/README.md) for the table design guidance.

## Ingestion pipeline

Each stage reads the output of the one before and can be rerun. Stages 1–6 run in
memory today, per backtest. Next, an ingestion job persists their outputs and the
one-second rows; `research db register` already records downloaded files.

1. **Register.** Verify each file against `manifest.json` (size and SHA-256). Dates
   whose `condition.json` entry is not `available` or `degraded` have no coverage.
2. **Contracts.** Resolve each raw symbol to its instrument ID per date from the file's
   symbol mappings; IDs are unique only within a day. Spreads are excluded. Loading
   `definition` records (expiration, tick size, multiplier) comes next.
3. **Calendar.** Scheduled-open sessions come from `pandas_market_calendars`
   (`CMEGlobex_GC`, `CMEGlobex_SI`, `CMEGlobex_PL`, and `CME Globex Equity` for the
   equity-index products), including early closes.
4. **Rolls.** The front contract is the outright with the most volume in the previous
   session, switching at the session open, after warmup sessions on the new contract.
   An explicit contract overrides it.
5. **Base bars.** One row per scheduled-open second (and minute) with status
   `observed`, `no_trades`, or `missing`. Late trades follow the
   [timing model](engine.md#timing-model).
6. **Quality report.** Per session: trades, volume, unknown-side share, late trades,
   trades outside the schedule or coverage, missing slots, event-time inversions,
   trades outside the pre-trade book, and Databento quality flags.

### Base bar fields

Each base bar (one second or one minute) stores OHLC and when the high and low occurred; volume split
into buy, sell, and unknown aggressor side; trade count; and the price × size sum
for VWAP. It also stores `delta_high` and `delta_low`: the highest and lowest
running buy − sell volume within the minute, measured from its start. Together with
the minute's net delta, these reproduce the exact CVD open, high, low, and close of
any window, clock-aligned or rolling, without rereading ticks.

CVD adds buyer-initiated volume and subtracts seller-initiated volume from an
explicit origin, such as the session open. Unknown-side volume is excluded and
reported separately; in MGC it is mostly spread legs. Classifying it from the
pre-trade bid and ask would be a separately named metric, not part of CVD.

Spread, sweep, and displayed-size fields come later, when a metric needs them, by
rerunning the builder over the DBN files.

## Open decisions

1. **Roll rule.** Previous-session volume is the default. Open interest requires the
   `statistics` schema; a fixed number of days before expiry needs only definitions.
   References: [TBBO fields](https://databento.com/docs/schemas-and-data-formats/tbbo),
   [batch download options](https://databento.com/docs/portal/batch-download), and
   [DBN encoding](https://databento.com/docs/standards-and-conventions/databento-binary-encoding).
