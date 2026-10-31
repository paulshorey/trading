# Backtest runner

Adapters and tools around `strategy-core`: the Databento file catalog (`catalog.py`),
exchange calendars (`calendars.py`), the historical session source with contract
selection and rolls (`source.py`), run orchestration and storage (`service.py`), the
`research` CLI, and the loopback-only API used by `research-web`.

```sh
uv run research catalog                 # products and dates on disk
uv run research backtest SPEC.json      # whole sessions, as fast as possible; saves the run
uv run research verify SPEC.json        # whole-session and second-by-second runs must match
uv run research rehearse SPEC.json --speed 60   # live path, paced; 1 = real time
uv run research serve --port 8001
```

A spec selects the product, sessions, optional contract, warmup sessions, strategy
parameters, execution settings, and indicator periods; see [examples](examples/).
`mgc-sample.json` uses shorter indicator periods because one day cannot warm up
14-hour indicators. Runs are saved as JSON under `data/runs/` with full provenance
until PostgreSQL storage lands. `scripts/research.py` starts the same CLI from the uv
environment for tools that call `python3` directly.
