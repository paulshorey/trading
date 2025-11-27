# Charts Mini-App

This folder is a self-contained mini-app that renders the financial time series chart page. It acts independently from the rest of the `strength` app - files here import from elsewhere, but nothing imports from this folder.

## Entry Point

**`SyncedChartsWrapper.tsx`** is the entry point, imported by `../app/page.tsx`.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            INITIALIZATION PHASE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. SyncedChartsWrapper.tsx                                                 │
│     ├── Waits for window dimensions                                         │
│     ├── Waits for Zustand store hydration from URL params                   │
│     └── Renders Header + SyncedCharts when ready                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW PHASE                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  2. SyncedCharts.tsx                                                        │
│     ├── Reads chartTickers, interval, hoursBack from Zustand store          │
│     ├── Calls useRealtimeStrengthData hook to fetch data                    │
│     ├── Aggregates rawData → aggregatedStrengthData, aggregatedPriceData    │
│     └── Passes data to Chart component for rendering                        │
│                                                                             │
│  3. lib/useRealtimeStrengthData.ts                                          │
│     ├── Fetches initial historical data via FetchStrengthData               │
│     ├── Sets up 60-second polling for real-time updates                     │
│     └── Handles forward-fill for missing strength values                    │
│                                                                             │
│  4. lib/FetchStrengthData.ts                                                │
│     └── API service class for /api/v1/strength endpoint                     │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA PROCESSING PHASE                              │
├─────────────────────────────────────────────────────────────────────────────┤
│  5. lib/aggregateStrengthData.ts                                            │
│     └── Averages strength values across selected intervals and tickers      │
│                                                                             │
│  6. lib/aggregatePriceData.ts                                               │
│     └── Normalizes and averages price data across tickers                   │
│                                                                             │
│  7. lib/aggregateDataUtils.ts                                               │
│     ├── extractGlobalTimestamps - collects all timestamps                   │
│     ├── forwardFillData - interpolates missing values                       │
│     ├── normalizeMultipleTickerData - equalizes price scales                │
│     └── generateFutureTimestamps - extends chart 12h into future            │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            RENDERING PHASE                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│  8. components/Chart.tsx                                                    │
│     ├── Creates lightweight-charts instance with dual y-axes                │
│     ├── Left axis: strength data (orange line)                              │
│     ├── Right axis: price data (blue line)                                  │
│     └── Handles zoom fix for CSS scale(0.5) transform                       │
│                                                                             │
│  9. lib/chartConfig.ts                                                      │
│     └── Chart options: colors, grid, crosshair, time formatting             │
└─────────────────────────────────────────────────────────────────────────────┘

```

## Folder Structure

```
charts/
├── SyncedChartsWrapper.tsx    # Entry point - hydration & dimension handling
├── SyncedCharts.tsx           # Main orchestrator - data fetching & aggregation
├── constants.ts               # CHART_WIDTH_INITIAL, HOURS_BACK_INITIAL
├── classes.module.scss        # Shared CSS modules
│
├── components/                # UI Components
│   ├── Header.tsx             # Top navigation bar with controls
│   ├── Chart.tsx              # Lightweight-charts wrapper with dual axes
│   ├── ChartTitle.tsx         # Floating title overlay
│   ├── ChartStates.tsx        # Loading, Error, NoData states
│   ├── UpdatedTime.tsx        # Real-time update indicator
│   ├── DrawerCalendar.tsx     # Calendar sidebar
│   ├── DrawerNews.tsx         # News sidebar
│   └── controls/              # User input controls
│       ├── ControlsDropdown.tsx   # Settings popover (mobile)
│       ├── InlineControls.tsx     # Interval + Time inline (desktop)
│       ├── IntervalControl.tsx    # Strength interval selector
│       ├── TimeControl.tsx        # Hours back selector
│       └── MarketControl.tsx      # Ticker/market selector
│
├── lib/                       # Data Processing & Utilities
│   ├── FetchStrengthData.ts       # API service for strength data
│   ├── useRealtimeStrengthData.ts # Real-time polling hook
│   ├── aggregateStrengthData.ts   # Strength data aggregation
│   ├── aggregatePriceData.ts      # Price data aggregation
│   ├── aggregateDataUtils.ts      # Shared aggregation utilities
│   ├── chartConfig.ts             # Chart options & styling
│   └── chartUtils.ts              # Time range & data conversion
│
└── state/                     # State Management
    ├── useChartControlsStore.ts   # Zustand store + ticker/interval options
    └── lib/
        └── urlSync.ts             # URL ↔ Zustand bidirectional sync
```

## Data Flow Summary

### 1. Initialization

```
URL Params → Zustand Store (hydrates) → SyncedChartsWrapper (waits) → renders UI
```

### 2. User Changes Selection

```
User clicks ticker/interval → Zustand updates → URL updates → useEffect triggers
→ Data re-fetched or re-aggregated → Chart re-renders
```

### 3. Real-time Updates (every 60s)

```
useRealtimeStrengthData polls API → merges new data → updates rawData state
→ aggregation effects run → charts update incrementally
```

## State Management

**Zustand Store** (`state/useChartControlsStore.ts`) manages:

| State                    | Description                   | URL Synced       |
| ------------------------ | ----------------------------- | ---------------- |
| `chartTickers`           | Selected ticker symbols       | ✅ `?tickers=`   |
| `interval`               | Strength intervals to average | ✅ `?interval=`  |
| `hoursBack`              | Time range to display         | ✅ `?hoursBack=` |
| `timeRange`              | Calculated visible range      | ❌               |
| `aggregatedStrengthData` | Processed chart data          | ❌               |
| `aggregatedPriceData`    | Processed chart data          | ❌               |

URL sync is bidirectional - changing the URL updates the store, and vice versa.

## Key Concepts

### Dual Y-Axes

- **Left axis (orange)**: Strength values (-100 to +100, RSI-like indicator)
- **Right axis (blue)**: Price values (normalized across tickers)

### Forward-Fill

Missing data points are filled with the most recent valid value to ensure continuous chart lines.

### Timestamp Requirements

All timestamps must be at **even minutes** (0, 2, 4...) with **no seconds**. This is enforced throughout the codebase.

### CSS Scale Workaround

The page uses `zoom: 0.5` for higher DPI rendering. `Chart.tsx` intercepts mouse events to correct coordinates.

## File Responsibilities

| File                      | Single Responsibility                                       |
| ------------------------- | ----------------------------------------------------------- |
| `SyncedChartsWrapper`     | Hydration gate - only render when ready                     |
| `SyncedCharts`            | Orchestrates data flow between hook, aggregation, and chart |
| `useRealtimeStrengthData` | Manages data fetching lifecycle and polling                 |
| `FetchStrengthData`       | Pure API calls, no state                                    |
| `aggregateStrengthData`   | Transform raw → chart-ready strength data                   |
| `aggregatePriceData`      | Transform raw → chart-ready price data                      |
| `Chart`                   | Pure rendering - receives data, renders chart               |
| `useChartControlsStore`   | Single source of truth for all UI state                     |

## Related Files (Outside This Folder)

- `@lib/common/sql/strength/` - Database queries and types
- `../app/api/v1/strength/route.ts` - API endpoint
- `../app/page.tsx` - Imports `SyncedChartsWrapper`
