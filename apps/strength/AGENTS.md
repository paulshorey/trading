# Strength app codebase

This project is the "strength" app. It renders a single chart with dual y-axes to compare price and strength on the same chart.

- Left y-axis: strength data (similar to RSI, ranges from -100 to 100)
- Right y-axis: price data
- The user controls which tickers to display for each data series.

## Filesystem:

- ./charts/SyncedChartsWrapper.tsx waits until the window and document are ready. Then it loads the components and passes to them the available screen height.

- ./charts/SyncedCharts.tsx is a full-screen app that renders a single financial chart with dual y-axes (left for strength, right for price). Both data series share the same x-axis (time).

- ./charts/components - general UI
- ./charts/controls - dropdowns and selectors
- ./charts/lib - utilities to configure the charts or filter data
- ./charts/state - Zustand store, options for select fields, synced with the URL query params

- ./sql/strength - get and add strength data in the database
- ./sql/strength/types.ts - refer to this to know what object properties and database row columns the app logic uses

## Data flow

### Selection Hierarchy

1. **Market tickers** - User selects the market type (Crypto, Equities, Metals, Treasuries) from a selector. Each option value is an array of tickers. This determines which data to fetch.
2. **Strength tickers** - From those selected market tickers, user selects which tickers to display in the Strength chart. This filters the cached data.
3. **Price tickers** - Also from those selected market tickers, user selects which tickers to display in the Price chart. This filters the cached data.

### Behavior

- When user changes selected **Market tickers**, both Strength and Price selectors reset to "Average" (all market tickers), and new data is fetched for ALL market tickers
- When user selects new **Strength tickers**, it:
  1. Updates the Strength chart with filtered cached data
  2. Also updates Price tickers to match (Strength acts as master selector)
  3. Both charts update to show the same ticker selection
- When user selects new **Price tickers**, it:
  1. Updates only the Price chart with filtered cached data
  2. Does NOT affect Strength selection (Price can be changed independently)
  3. Only the Price chart updates

### Selector Hierarchy

1. **Market** → Resets both Strength and Price to Average
2. **Strength** → Sets both Strength and Price to the same selection
3. **Price** → Changes only Price (independent selection)

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

- You are an AI agent. You will read AGENTS.md file in any relevant folder every time you think about a prompt. AGENTS.md in any folder will serve as documentation about the files in that folder, and how this folder relates to the app as a whole. Please update any existing AGENTS.md files as you make changes and understand the codebase better, to help yourself remember how everything works. Feel free to modify any existing AGENTS.md files in the codebase, and if a folder does not have a AGENTS.md file, please create one with notes that will help you next time. Please note only general concepts that are not easily explained as comment blocks in each file above each function. AGENTS.md is to help you understand the codebase, and how each folder relates to other folders, so you will know how to find the correct file or function.
- If adding a new AGENTS.md file, also add a file `CLAUDE.md` in the same folder, with contents `@AGENTS.md`. This is required so the non-standard Claude Code agent can read the AGENTS.md file also, by importing it from its own special CLAUDE.md instructions file.
