# Strength app codebase

This project is the "strength" app. It renders 2 charts side by side, to compare price and strength.

Chart 1: strength. Similar to the RSI number, but from -100 to 100 instead of 0 to 100.
Chart 2: price. The user controls which data to show in each chart.

## Filesystem:

- ./charts/SyncedChartsWrapper.tsx waits until the window and document are ready. Then it loads the components and passes to them the available screen height.

- ./charts/SyncedCharts.tsx is a full-screen app that renders 2 financial data charts to compare side by side. The x-axis (time) is synced, so scrolling or interacting with the time in one does the same in the other.

- ./charts/components - general UI
- ./charts/controls - dropdowns and selectors
- ./charts/lib - utilities to configure the charts or filter data
- ./charts/state - Zustand store, synced with the URL query params

- ./sql/strength - get and add strength data in the database
- ./sql/strength/types.ts - refer to this to know what object properties and database row columns the app logic uses

## Data flow

### Selection Hierarchy

1. **Market tickers** - User selects the market type (Crypto, Equities, Metals, Treasuries) from a selector. Each option value is an array of tickers. This determines which data to fetch.
2. **Strength tickers** - From those selected market tickers, user selects which tickers to display in the Strength chart. This filters the cached data.
3. **Price tickers** - Also from those selected market tickers, user selects which tickers to display in the Price chart. This filters the cached data.

### Behavior

- When user changes selected **Market tickers**, the Strength and Price selectors reset to their default "Average" (average of all available tickers), and new data is fetched for ALL market tickers
- When user selects new **Strength tickers**, it filters existing cached data and updates only the Strength chart. Price chart remains unchanged.
- When user selects new **Price tickers**, it filters existing cached data and updates only the Price chart. Strength chart remains unchanged.

### Technical Implementation

- **Data fetching**: `useRealtimeStrengthData` hook always fetches data for `marketTickers` (not `controlTickers`)
- **Data filtering**: In `SyncedCharts.tsx`, raw data is filtered based on ticker selections before aggregation
- **Chart updates**: Each chart receives filtered aggregated data and updates independently
- **No refetching** occurs when changing Strength or Price selections - only filtering of cached data

### Performance

- All market ticker data is cached after initial fetch
- Switching between tickers is instant (no loading state)
- Charts update smoothly without remounting or flickering

## Important Notes

- See `DATA_FLOW_ARCHITECTURE.md` for detailed explanation of the recent data flow optimization
- SQL types and database functions are in `./sql/strength/` folder
- All timestamps MUST be at even minutes (0, 2, 4...) with no seconds
- The `timenow` field from database is used directly as chart x-axis timestamp

## Keeping notes and documenting changes

- You are an AI agent, CLAUDE. You will read this file (CLAUDE.md) every time to remember important details about the codebase. Please update this file as needed, to help yourself remember how everything works. For example, you added DATA_FLOW_ARCHITECTURE.md file and mentioned it here. Great. In the future feel free to add other documentation files and edit existing ones. Mention the files here in CLAUDE.md to help yourself navigate the codebase next time.
