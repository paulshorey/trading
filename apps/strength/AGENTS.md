# Strength App

Financial charting app displaying strength (RSI-like) and price data with real-time updates.

## Overview

- **Left y-axis:** Strength (-100 to 100)
- **Right y-axis:** Price
- **X-axis:** Time (shared)

## Structure

```
apps/strength/
├── app/                    # Next.js app directory
├── charts/                 # Chart mini-app (see charts/AGENTS.md)
│   ├── lib/data/           # Data fetching
│   ├── lib/workers/        # Web Worker aggregation
│   └── state/              # Zustand store
└── components/             # Shared UI
```

## Key Technical Points

- **Timestamps:** 1-minute intervals, seconds/ms must be 0
- **Polling:** Every 10 seconds for real-time updates
- **Aggregation:** Runs in Web Worker (~1000-1500ms)
- **Caching:** Results cached by ticker+interval for instant switching

## Database

See `@lib/common/sql/strength/` for data types and queries.

## Charts

This strength app consists mostly of the charts logic and components in `charts` folder.

This app uses light-weight charts library. Documentation in `docs/lightweight-charts`.

@docs/lightweight-charts/AGENTS.md
