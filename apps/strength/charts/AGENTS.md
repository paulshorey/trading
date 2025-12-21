# Charts Mini-App

Financial charting system built on `lightweight-charts` (v5.0.8). Renders dual y-axis charts showing strength (left) and price (right) data with real-time updates, time range highlighting, and aggregation controls.

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
│   ├── data/                        # Data fetching
│   │   ├── FetchStrengthData.ts     # API client for strength data
│   │   └── useRealtimeStrengthData.ts # Real-time data polling hook
│   ├── aggregation/                 # Data aggregation
│   │   ├── aggregateDataUtils.ts    # Shared aggregation utilities
│   │   ├── aggregatePriceData.ts    # Price data aggregation
│   │   └── aggregateStrengthData.ts # Strength data aggregation
│   ├── primitives/                  # Custom chart primitives
│   │   ├── TimeRangeHighlight.ts    # Custom primitive: shaded regions
│   │   ├── VerticalLinePrimitive.ts # Custom primitive: vertical lines
│   │   ├── timeMarkers.ts           # Time range + marker config
│   │   └── forwardFillData.ts       # Add required timestamps for time ranges
│   ├── chartConfig.ts               # Chart styling config
│   └── chartUtils.ts                # Misc chart helpers
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

## Key Features

### Chart Lines

**Always visible:**

- **Strength** (orange, left axis) - average of selected intervals across all tickers
- **Price** (green, right axis) - normalized average of all selected tickers

**Optional toggles:**

- **Individual interval lines** - each interval (2m, 4m, 12m, 30m, 1h, 4h) separately
- **Individual ticker price lines** - each ticker separately, normalized to converge at right edge

### Custom Primitives

- **TimeRangeHighlight** - Shaded backgrounds for market hours (see `lib/primitives/AGENTS.md`)
- **VerticalLinePrimitive** - Vertical line markers for events

### State Management

- **Zustand store** - Centralized state for chart controls
- **URL sync** - Query params preserve state across page loads
- **Real-time updates** - Polls for new data every minute

## Related Documentation

- `lib/primitives/AGENTS.md` - Custom primitives and time range highlighting
- `lib/aggregation/AGENTS.md` - Data aggregation and price normalization
- `lib/data/AGENTS.md` - API client and real-time data fetching
- `state/AGENTS.md` - Zustand store and URL sync
