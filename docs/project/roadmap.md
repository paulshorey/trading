# Platform roadmap

## 1. Historical data

Download futures and crypto price, volume, and timestamp data from QuantConnect
LEAN. Choose tickers, date ranges, and resolutions; record sources and instrument
metadata; validate ordering, duplicates, gaps, and coverage. Keep futures contracts
and any roll rules explicit.

## 2. Metrics, strategies, and ML

Build reusable Python metrics and feature pipelines. Develop configurable rule-based
strategies and ML models trained on custom metrics. Use chronological training,
validation, and holdout periods, and version inputs, parameters, and model artifacts.

## 3. Backtesting and developer tools

Expand the runner and UI to configure experiments, compare results, and troubleshoot
features, signals, orders, costs, and equity. Improve execution assumptions for each
market and add apps or services as the research workflow requires.

## 4. Continuous trading and control

Apply the same strategy logic to historical warmup plus incoming live data. Develop
paper trading first, then broker execution, recovery, and position reconciliation.
Provide configuration, monitoring, pause/resume, risk limits, and manual overrides
with a record of automated and human decisions.

The current local foundation includes sample-data ingestion, baseline strategies,
replay accounting, and a charting UI. Broader data, ML training, and bot execution
are the next development stages.
