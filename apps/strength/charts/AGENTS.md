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

### Individual Interval Lines

The chart displays multiple lines:

- **Price** (blue) - normalized average of selected tickers
- **Strength** (orange, thick) - aggregated average of all selected intervals across all tickers
- **Individual intervals** (thin colored lines) - separate line for each selected interval (2m, 4m, 12m, 30m, 1h, 4h)

Individual interval colors:

- 2m: Purple (#9333ea)
- 4m: Cyan (#06b6d4)
- 12m: Green (#22c55e)
- 30m: Yellow (#eab308)
- 60m: Red (#ef4444)
- 240m: Pink (#ec4899)

The `aggregateStrengthByInterval()` function in `lib/aggregateStrengthData.ts` generates data for each interval separately, averaging across all selected tickers.

## Related Documentation

- `TIME_RANGE_HIGHLIGHTING.md` - Time range shading implementation
- `state/AGENTS.md` - Zustand store details
- `lib/AGENTS.md` - Library utilities
