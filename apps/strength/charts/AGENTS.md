# Charts Mini-App

Financial charting system built on `lightweight-charts` (v5.0.8). Dual y-axis charts showing strength (left) and price (right) with real-time updates.

## Folder Structure

```
charts/
├── SyncedChartsWrapper.tsx   # Entry point - waits for dimensions
├── SyncedCharts.tsx          # Orchestrates data flow
├── components/
│   ├── Chart.tsx             # Core chart rendering (lightweight-charts)
│   └── controls/             # Ticker, interval, date selectors
├── lib/
│   ├── data/                 # Data fetching (see lib/data/AGENTS.md)
│   ├── workers/              # Web Workers (see lib/workers/AGENTS.md)
│   ├── aggregation/          # Data aggregation
│   └── primitives/           # Custom chart primitives
└── state/                    # Zustand store + URL sync
```

## Data Flow

```
useStrengthData (fetches raw data, polls every 10s)
      ↓
SyncedCharts (debounces, checks hash, triggers aggregation)
      ↓
Web Worker (aggregates all data off main thread)
      ↓
Chart.tsx (uses setData/update efficiently)
```

## Performance Optimizations

### 1. Aggregation Debouncing (2000ms)

Real-time data arrives every 10 seconds. Aggregation takes ~1000-1500ms.
Debounce prevents excessive aggregations while ensuring fresh data.

### 2. Smart Hash Comparison

Before aggregating, we compare a hash of:

- Data lengths and timestamps
- Last 5 price values (detects actual value changes)
  Skips aggregation if hash unchanged.

### 3. Result Caching

Aggregated results are cached by ticker+interval combination.
When switching back to a previously viewed ticker, cached data displays instantly.
Cache expires after 5 minutes.

### 4. Efficient Chart Updates

`Chart.tsx` uses `update()` for single-point changes and `setData()` only when necessary.
This is the `lightweight-charts` best practice for real-time data.

### 5. Background Tab Recovery

When tab is in background, polling may stop. On return:

- Visibility change triggers immediate fetch
- Dynamic window calculates missed time
- All missing data fetched in one request

### 6. Scroll-to-Pause Polling

When user scrolls/pans the chart, real-time polling pauses automatically:

- Chart detects scroll via `subscribeVisibleLogicalRangeChange`
- Polling pauses to prevent chart jumping while user explores
- After 30 seconds of no scrolling, polling resumes
- On resume, all missed data is fetched (using dynamic fetch window)
- Visual indicator shows "⏸ paused" in bottom-right corner

## Chart Lines

4 independent toggles control visibility:

- **Aggregate Strength** (orange, left axis) - average of selected intervals
- **Individual Interval Strength** (light orange, left axis) - one line per interval
- **Aggregate Price** (blue, right axis) - normalized average of tickers
- **Individual Ticker Price** (light blue, right axis) - one line per ticker

UI buttons: `S` (strength), `s` (intervals), `P` (price), `p` (tickers)

## Key Implementation Notes

- **dataVersion:** Increments on ticker change, used to ignore stale worker results
- **Never mutate arrays:** Use `[...arr].sort()` not `arr.sort()` to avoid mutating store state
- **Ticker comparison:** Uses Set-based comparison (order-independent) to detect changes
- **Forward-fill:** `buildLastKnownValuesRow()` finds last non-null value per interval separately

## Related Docs

- `lib/data/AGENTS.md` - Data fetching and polling
- `lib/workers/AGENTS.md` - Web Worker and race conditions
