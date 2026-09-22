# Strategy core

Shared Python data types, metrics, strategies, and replay calculations. Keep logic
incremental so historical replay and future live feeds can use the same decisions.
Data access, broker execution, and visualization belong in separate adapters.

- `models.py`: bar and instrument data types.
- `strategies.py`: strategy interface and SMA/RSI baselines.
- `engine.py`: replay accounting, execution assumptions, and risk checks.
- `order_flow.py`: metrics requiring actual trade/quote inputs, unavailable from OHLCV alone.

Extend this library with custom metrics and strategy logic as historical datasets
become available. ML feature and inference code should follow the same time-aware
input contract. See the [platform roadmap](../../docs/project/roadmap.md).
