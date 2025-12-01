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

### Simplified Architecture

- **Single ticker selection** - User selects which tickers to display (`chartTickers`)
- **Both charts use same data** - Strength and Price charts display the same tickers
- **Data fetching and display** - When tickers change, new data is fetched and both charts update

### Technical Implementation

- **Data fetching**: `useRealtimeStrengthData` hook fetches data for `chartTickers`
- **Data aggregation**: Both strength and price data are aggregated from the same raw data
- **Chart updates**: Both charts update together when tickers change
- **Forward-fill logic** handles missing values at both real-time and aggregation layers

### Performance

- All market ticker data is cached after initial fetch
- Switching between tickers is instant (no loading state)
- Charts update smoothly without remounting or flickering

## Important Notes

- See `DATA_FLOW_ARCHITECTURE.md` for detailed explanation of the data flow architecture
- See `FORWARD_FILL_LOGIC.md` for comprehensive documentation of forward-fill implementation
- SQL types and database functions are in `./sql/strength/` folder
- All timestamps MUST be at 1-minute intervals with no seconds
- The `timenow` field from database is used as chart x-axis timestamp

## Keeping notes and documenting changes

- You are an AI agent. You will read AGENTS.md file in any relevant folder every time you think about a prompt. AGENTS.md files will serve as documentation about the files and code concepts in that folder, how this folder relates to the app as a whole. Add or edit AGENTS.md files as you make changes. This will help you remember which folder or file to open next time when you are starting work on a similar topic.
- When writing documentation to AGENTS.md or any other CUSTOM_INSTRUCTIONS.md files, be very concise and minimal. These md documentation files should be only a hint to help you find relevant files in the codebase. The real documentation should be kept in comment blocks above each file or function.
- If an AGENTS.md file does not exist, add it instead, then add the instructions you were trying to add.
- When adding a new AGENTS.md file, also add a file `CLAUDE.md` in the same folder, with contents `@AGENTS.md`. This is required so the non-standard Claude Code agent can read the AGENTS.md file also, by importing it from its own special CLAUDE.md instructions file.
