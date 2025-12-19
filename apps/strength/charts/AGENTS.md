# Charts Mini-App

Financial charting system built on TradingView's `lightweight-charts` library (v5.0.8).

## Purpose

Renders synchronized strength and price charts with real-time data updates, custom primitives (time range highlighting, vertical markers), and aggregation controls.

## Folder Structure

```
charts/
├── SyncedChartsWrapper.tsx   # Entry point - waits for dimensions + hydration
├── SyncedCharts.tsx          # Orchestrates data flow to child charts
├── constants.ts              # Chart configuration constants
├── classes.module.scss       # Shared chart styles
│
├── components/
│   ├── Chart.tsx             # Core chart rendering + primitive attachment
│   ├── ChartTitle.tsx        # Title with ticker/aggregation info
│   ├── ChartStates.tsx       # Loading/error states
│   ├── Header.tsx            # Top controls bar
│   ├── UpdatedTime.tsx       # Last update timestamp
│   └── controls/             # Aggregation, date, ticker selectors
│
├── lib/
│   ├── FetchStrengthData.ts         # API client for strength data
│   ├── useRealtimeStrengthData.ts   # Real-time data polling hook
│   ├── aggregateStrengthData.ts     # Aggregate multiple tickers
│   ├── aggregatePriceData.ts        # Price data aggregation
│   ├── aggregateDataUtils.ts        # Shared aggregation utilities
│   ├── chartConfig.ts               # Chart styling config
│   ├── chartUtils.ts                # Misc chart helpers
│   ├── forwardFillData.ts           # Add required timestamps for time ranges
│   ├── timeMarkers.ts               # Time range + marker config
│   ├── TimeRangeHighlight.ts        # Custom primitive: shaded regions
│   └── VerticalLinePrimitive.ts     # Custom primitive: vertical lines
│
└── state/
    ├── useChartControlsStore.ts     # Zustand store for UI controls
    └── lib/                         # Store utilities
```

## Data Flow

```
URL Query Params
      ↓
useChartControlsStore (Zustand)
      ↓
SyncedChartsWrapper (dimensions + hydration)
      ↓
SyncedCharts (fetches raw data via useRealtimeStrengthData)
      ↓
Aggregation (aggregateStrengthData, aggregatePriceData)
      ↓
Chart.tsx (add required timestamps → setData → attach primitives)
      ↓
lightweight-charts (renders canvas)
```

## Key Concepts

### Required Timestamps for Time Ranges

Time range boundaries are added to the data as forward-filled points, ensuring `timeToCoordinate()` works correctly for highlighting. Natural gaps (weekends, holidays) are preserved - the chart compresses them, showing time ranges as narrow bars during non-trading periods. See `TIME_RANGE_HIGHLIGHTING.md`.

### Custom Primitives

- **TimeRangeHighlight**: Shaded backgrounds for market hours
- **VerticalLinePrimitive**: Vertical lines for events (page load, etc.)

Both implement `ISeriesPrimitive<Time>` with PaneView + Renderer pattern.

### Scroll Sync

Charts are synchronized via `subscribeCrosshairMove` and `subscribeVisibleLogicalRangeChange` callbacks on the timeScale, sharing visible range between strength and price charts.

### Aggregation

Multiple tickers can be combined using different strategies (average, weighted, min/max). Controlled via Zustand store and URL params.

### Chart Lines

The chart displays multiple lines that can be toggled:

**Always visible:**

- **Price** (green, right scale) - normalized average of all selected tickers
- **Strength** (orange, thick, left scale) - aggregated average of all selected intervals across all tickers

**Optional (controlled by toggles):**

- **Individual interval lines** (`showIntervalLines`) - separate line for each selected interval (2m, 4m, 12m, 30m, 1h, 4h), uses left scale
- **Individual ticker price lines** (`showTickerLines`) - separate line for each selected ticker, uses right scale

### Aggregation Functions

- `aggregateStrengthData()` - averages selected intervals across all tickers
- `aggregateStrengthByInterval()` - generates data for each interval separately
- `aggregatePriceData()` - normalizes and averages all ticker prices
- `aggregatePriceByTicker()` - generates normalized price data for each ticker separately

Individual ticker prices are normalized relative to each ticker's last price, then scaled to match the aggregated price range so they can be visually compared on the same scale.

## Related Documentation

- `TIME_RANGE_HIGHLIGHTING.md` - Time range shading implementation
- `state/AGENTS.md` - Zustand store details
- `lib/AGENTS.md` - Library utilities
