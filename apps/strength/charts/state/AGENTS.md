# State Management

Zustand store for chart controls with URL query parameter synchronization.

## Files

- **useChartControlsStore.ts** - Zustand store managing chart state (tickers, intervals, time range, toggles)
- **lib/urlSync.ts** - Syncs state with URL query params for persistent bookmarkable state

## Key State

- `chartTickers` - Selected tickers to display
- `interval` - Selected intervals for strength calculation
- `hoursBack` - Time range (hours of historical data)
- `showIntervalLines` / `showTickerLines` - Toggle individual lines
- `aggregatedStrengthData` / `aggregatedPriceData` - Cached aggregated data

State changes automatically update URL, allowing users to bookmark specific chart configurations.
