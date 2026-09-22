# Historical data workflow

QuantConnect LEAN is the starting source for futures and crypto price, volume, and
timestamp history. This data will support custom metrics, ML features, backtests,
and the historical context used by future trading bots.

## Next dataset work

1. Select tickers, markets, date ranges, and resolutions for the first experiments.
2. Download the corresponding history through QuantConnect's data workflow.
3. Record sources, checksums, timestamps/timezones, and instrument metadata, including
   futures contracts, multipliers, and tick sizes.
4. Validate ordering, duplicates, OHLCV bounds, gaps, and coverage before computing features.

Keep raw observations separate from derived metrics, labels, and model outputs.
Preserve gaps and contract identities; make resampling and roll policies explicit.
Price/volume bars alone do not provide trade aggressor side or order-book depth.

## Current local workflow

```sh
pnpm data:download
python3 scripts/research.py catalog
python3 scripts/research.py analyze --dataset btc-usd-sample
python3 scripts/research.py analyze --dataset es-dec2013-sample
pnpm data:report
```

`data:download` fetches the pinned public BTC/USD and ES sample files listed in
`data/manifests/`. These are integration samples; broader historical downloads are
separate. `data:report` regenerates [sample-analysis.json](sample-analysis.json).

The current importer supports unscaled UTC minute TradeBar ZIPs:

- Crypto member: `YYYYMMDD_symbol_minute_trade.csv`.
- Futures member: `YYYYMMDD_symbol_minute_trade_YYYYMM.csv`, selecting one contract.
- CSV fields: milliseconds since midnight, open, high, low, close, volume.

For compatible downloaded history, place ZIPs in `data/lean/` and create a manifest
following the [existing examples](../../data/manifests/). Include source metadata,
file dates and checksums, instrument settings, and `sample_only: false`. Analyze
the dataset before running experiments. Extend the importer for other formats.

## Storage and references

- `data/manifests/`: versioned dataset metadata.
- `data/lean/`: downloaded ZIPs, excluded from git.
- `data/runs/`: generated experiment results, excluded from git.

Use the [QuantConnect download documentation](https://www.quantconnect.com/docs/v2/lean-cli/api-reference/lean-data-download)
for account access and download options. The
[LEAN data format reference](https://github.com/QuantConnect/Lean/blob/410650da078124da84d894d73d64cffc95b5912a/Data/readme.md)
describes the sample file layout.
