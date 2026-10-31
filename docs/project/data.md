# Historical data

Status: the DBN file catalog, contract selection, session calendars, one-second and
one-minute base bars, and per-session quality checks are implemented in memory
(`apps/backtest-runner`). PostgreSQL storage is planned. The bars feed the window
engine described in the [sliding-window design](../sliding-windows/design.md).

## What to download

Buy Databento **TBBO** for **GC** (COMEX gold) and **NQ** (E-mini Nasdaq-100): every
trade, with its aggressor side and the best bid and ask immediately before it. Start
with a few months of both to validate the pipeline and fill delays, then extend to
the full history. Add products later with the same settings.

| Schema     | Contents                                     | CVD | Spread-aware fills | Bytes per record |
| ---------- | -------------------------------------------- | --- | ------------------ | ---------------- |
| `ohlcv-1s` | One bar per second with trades               | No  | No                 | 56               |
| `trades`   | Every trade with aggressor side              | Yes | No                 | 48               |
| `tbbo`     | Every trade plus the bid and ask just before | Yes | Yes                | 80               |

One-second bars have no aggressor side, so they cannot produce CVD. TBBO lets the
backtest charge the actual spread at each simulated order, which matters most for
minute-scale trading. Its bid and ask are a pre-trade snapshot at each trade, not a
continuous quote history; see the fill-delay limit in the [engine](engine.md#known-limits).

Download settings for the portal:

| Job       | Settings                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------ |
| Trades    | Dataset `GLBX.MDP3`, schema `tbbo`, symbols `GC.FUT` and `NQ.FUT` (parent), encoding DBN, compression zstd, split by day |
| Contracts | Same symbols and dates, schema `definition` (expirations, tick size, multiplier)                                         |
| Optional  | `statistics` for settlement and open interest; `status` to cross-check the session calendar                              |

Choose DBN rather than JSON or CSV: integer prices (units of 10⁻⁹), nanosecond
timestamps, and a header with the query and the instrument ID of each contract on
each date. It decodes about 10 times faster than JSON and converts losslessly.

Split by day. Each file covers one UTC date, matching `condition.json`. A CME session
runs from 17:00 to 16:00 CT, so it spans two files; the source reads both and never
assumes a file is a session. The parent symbol includes every contract and calendar
spread, so we choose our own roll rule. Keep each job folder exactly as delivered,
including `manifest.json`, `metadata.json`, and `condition.json`, under
`data/databento/GLBX.MDP3/<job_id>/` (gitignored; back it up).

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

**Decision: Databento's DBN files are the permanent tick archive, and PostgreSQL holds
the relational data derived from them.** There is no intermediate Parquet or DuckDB
layer, and no per-second series is stored.

| Storage for ticks                  | One sample day | 6 years, upper bound |
| ---------------------------------- | -------------- | -------------------- |
| DBN uncompressed (Databento bills) | 17.5 MB        | ≈ 27 GB              |
| DBN with zstd                      | 4.6 MB         | ≈ 7 GB               |
| Lean PostgreSQL table, measured    | 39 MB          | ≈ 60 GB              |

(MGC figures; GC and NQ trade more.) Rebuilding one-second base bars from a day's DBN
file takes tens of milliseconds, faster than reading them back from a database, and
live sessions build the same bars from the live feed. One-second bars for one contract
over 6 years would be about 128 million rows, so they stay in memory.

PostgreSQL stores what is relational or sparse: the dataset and file catalog with
checksums, contracts, coverage and closures, the roll schedule, quality reports, run
definitions and results, trades, ML rows (one per signal), models, predictions, and
live decisions. The [proposed schema](../../lib/db-research/README.md) needs the
revisions listed there before it is applied.

## Ingestion pipeline

Each stage reads the output of the one before and can be rerun. Stages 1–5 run in
memory today, per backtest; persisting their outputs is the PostgreSQL milestone.

1. **Register.** Verify each file against `manifest.json` (size and SHA-256). Dates
   whose `condition.json` entry is not `available` or `degraded` have no coverage.
2. **Contracts.** Resolve each raw symbol to its instrument ID per date from the file's
   symbol mappings; IDs are unique only within a day. Spreads are excluded. Loading
   `definition` records (expiration, tick size, multiplier) is planned.
3. **Calendar.** Scheduled-open sessions come from `pandas_market_calendars`
   (`CMEGlobex_GC` for gold, `CME Globex Equity` for NQ), including early closes.
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
2. **Optional schemas.** Whether to buy `statistics` and `status`, and `mbp-1` if GC
   and NQ fill delays are too long with TBBO alone.

References: [TBBO fields](https://databento.com/docs/schemas-and-data-formats/tbbo),
[batch download options](https://databento.com/docs/portal/batch-download), and
[DBN encoding](https://databento.com/docs/standards-and-conventions/databento-binary-encoding).
