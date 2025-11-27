# Charts Mini-App

This folder contains a self-contained "mini-app" that renders the stock market time series chart page for the Strength Finance application. It displays real-time strength and price data for financial instruments using the [Lightweight Charts](https://www.tradingview.com/lightweight-charts/) library.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Data Flow](#data-flow)
- [Folder Structure](#folder-structure)
- [File Reference](#file-reference)
- [Initialization Sequence](#initialization-sequence)
- [Key Concepts](#key-concepts)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         SyncedChartsWrapper.tsx                         │
│                    (Entry Point - Hydration Gate)                       │
│         • Waits for window dimensions                                   │
│         • Waits for Zustand store hydration from URL                    │
│         • Renders Header + SyncedCharts when ready                      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┼───────────────┐
                    │                               │
                    ▼                               ▼
    ┌─────────────────────────┐     ┌─────────────────────────────────────┐
    │      Header.tsx         │     │         SyncedCharts.tsx            │
    │  (Navigation + Controls)│     │    (Data Orchestration Layer)       │
    │   • InlineControls      │     │  • Fetches data via hook            │
    │   • ControlsDropdown    │     │  • Aggregates strength/price data   │
    │   • DrawerNews/Calendar │     │  • Manages time range               │
    └─────────────────────────┘     │  • Renders Chart component          │
                                    └─────────────────────────────────────┘
                                                    │
                                    ┌───────────────┼───────────────┐
                                    │               │               │
                                    ▼               ▼               ▼
                    ┌───────────────────┐  ┌─────────────┐  ┌─────────────────┐
                    │   Chart.tsx       │  │MarketControl│  │ UpdatedTime.tsx │
                    │(Rendering Layer)  │  │   (Ticker)  │  │ (Status Badge)  │
                    │ • Creates chart   │  └─────────────┘  └─────────────────┘
                    │ • Dual y-axes     │
                    │ • Mouse events    │
                    └───────────────────┘
```

---

## Data Flow

### 1. State Management (Zustand Store)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                   useChartControlsStore (Zustand)                       │
├─────────────────────────────────────────────────────────────────────────┤
│  User-Controlled State:           │  Computed/Derived State:           │
│  • hoursBack (time range)         │  • timeRange (visible range)       │
│  • interval (strength intervals)  │  • aggregatedStrengthData          │
│  • chartTickers (selected tickers)│  • aggregatedPriceData             │
├─────────────────────────────────────────────────────────────────────────┤
│  URL Sync: hoursBack, interval, tickers ←→ URL Query Parameters        │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2. Data Fetching & Processing Pipeline

```
User selects tickers/settings
         │
         ▼
┌─────────────────────────────────────┐
│  useRealtimeStrengthData Hook      │
│  • Initial fetch: 240 hours back   │
│  • Polls every 60 seconds          │
│  • Returns: rawData[], isLoading   │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  FetchStrengthData Service         │
│  • Calls /api/v1/strength          │
│  • Fetches multiple tickers        │
│  • Merges incremental updates      │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Data Aggregation (useEffect)      │
│  • aggregateStrengthData()         │
│  • aggregatePriceData()            │
│  • Forward-fill missing values     │
│  • Normalize across tickers        │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Chart.tsx Rendering               │
│  • Dual y-axes (left: strength,    │
│    right: price)                   │
│  • Updates series data             │
│  • Applies time range              │
└─────────────────────────────────────┘
```

---

## Folder Structure

```
charts/
├── SyncedChartsWrapper.tsx    # Entry point - hydration gate
├── SyncedCharts.tsx           # Main orchestration component
├── constants.ts               # Global constants (width, hours)
├── classes.module.scss        # Shared SCSS styles
│
├── components/                # UI Components
│   ├── Chart.tsx              # Chart rendering (lightweight-charts)
│   ├── ChartStates.tsx        # Loading/Error/NoData states
│   ├── ChartTitle.tsx         # Chart title overlay
│   ├── Header.tsx             # Top navigation bar
│   ├── UpdatedTime.tsx        # Real-time update indicator
│   ├── DrawerCalendar.tsx     # Economic calendar drawer
│   ├── DrawerNews.tsx         # News feed drawer
│   ├── Drawer.module.scss     # Drawer styles
│   └── controls/              # User input controls
│       ├── ControlsDropdown.tsx   # Settings popover
│       ├── InlineControls.tsx     # Header controls wrapper
│       ├── IntervalControl.tsx    # Strength interval selector
│       ├── MarketControl.tsx      # Ticker/market selector
│       └── TimeControl.tsx        # Time range selector
│
├── lib/                       # Business Logic & Utilities
│   ├── FetchStrengthData.ts       # API service class
│   ├── useRealtimeStrengthData.ts # Real-time data hook
│   ├── aggregateStrengthData.ts   # Strength data processing
│   ├── aggregatePriceData.ts      # Price data processing
│   ├── aggregateDataUtils.ts      # Shared aggregation utilities
│   ├── chartConfig.ts             # Chart options configuration
│   └── chartUtils.ts              # Chart utility functions
│
└── state/                     # State Management
    ├── useChartControlsStore.ts   # Zustand store (main state)
    └── lib/
        └── urlSync.ts             # URL ↔ Store synchronization
```

---

## File Reference

### Entry Points

| File                      | Purpose                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `SyncedChartsWrapper.tsx` | **Entry point**. Waits for hydration before rendering. Calculates responsive dimensions. |
| `SyncedCharts.tsx`        | **Orchestration layer**. Fetches data, processes it, and passes to Chart component.      |

### State Layer (`state/`)

| File                       | Purpose                                                                                                              |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `useChartControlsStore.ts` | Zustand store holding all chart state. Defines available options (intervals, tickers, time ranges). Persists to URL. |
| `lib/urlSync.ts`           | Custom Zustand storage adapter for URL query parameter synchronization.                                              |

### Data Layer (`lib/`)

| File                         | Purpose                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `FetchStrengthData.ts`       | Service class for API calls to `/api/v1/strength`. Handles date serialization and data merging. |
| `useRealtimeStrengthData.ts` | React hook managing real-time data polling. Loads initial data, then polls every minute.        |
| `aggregateStrengthData.ts`   | Processes raw data into strength chart series. Averages selected intervals across tickers.      |
| `aggregatePriceData.ts`      | Processes raw data into price chart series. Normalizes prices so tickers contribute equally.    |
| `aggregateDataUtils.ts`      | Shared utilities: forward-fill interpolation, timestamp extraction, normalization.              |
| `chartConfig.ts`             | Lightweight Charts configuration: axes, colors, grid, crosshair, time formatting.               |
| `chartUtils.ts`              | Utility functions: time range calculation, data conversion, binary search for values.           |

### UI Components (`components/`)

| File                 | Purpose                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `Chart.tsx`          | Core chart rendering. Creates dual y-axis chart with strength (left) and price (right) series. |
| `ChartStates.tsx`    | Loading, Error, and NoData placeholder components.                                             |
| `ChartTitle.tsx`     | Overlay showing chart name/heading.                                                            |
| `Header.tsx`         | Top navigation bar with logo, controls, and drawer toggles.                                    |
| `UpdatedTime.tsx`    | Fixed badge showing last data update time.                                                     |
| `DrawerCalendar.tsx` | Sliding drawer with embedded economic calendar (iframe).                                       |
| `DrawerNews.tsx`     | Sliding drawer with embedded news feed (iframe).                                               |

### Controls (`components/controls/`)

| File                   | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `MarketControl.tsx`    | Dropdown for selecting tickers/markets. Uses Mantine Combobox. |
| `IntervalControl.tsx`  | Dropdown for selecting strength intervals (2m, 4m, 12m, etc.). |
| `TimeControl.tsx`      | Dropdown for visible time range (24h, 48h, etc.).              |
| `InlineControls.tsx`   | Wrapper combining Interval + Time controls for header.         |
| `ControlsDropdown.tsx` | Popover containing all controls for mobile/compact view.       |

---

## Initialization Sequence

```
1. PAGE LOAD
   └─► SyncedChartsWrapper mounts
       ├─► useState(null) for dimensions
       └─► useChartControlsStore subscribes to isHydrated

2. ZUSTAND HYDRATION (parallel)
   └─► persist middleware initializes
       ├─► urlSync reads URL query params
       ├─► Merges with defaults
       └─► Sets isHydrated = true

3. DIMENSION CALCULATION (parallel)
   └─► useEffect calculates window dimensions
       └─► Sets dimensions state

4. RENDER GATE
   └─► Both isHydrated && dimensions?
       ├─► NO:  Shows "Initializing charts..."
       └─► YES: Renders Header + SyncedCharts

5. DATA FETCHING
   └─► SyncedCharts mounts
       └─► useRealtimeStrengthData hook
           ├─► loadInitialData() - fetch 240h history
           └─► setupRealtimeUpdates() - poll every 60s

6. DATA PROCESSING
   └─► useEffect watches rawData, interval changes
       ├─► aggregateStrengthData() → store
       └─► aggregatePriceData() → store

7. CHART RENDERING
   └─► Chart component receives processed data
       ├─► Creates Lightweight Chart instance
       ├─► Adds strength series (left y-axis)
       ├─► Adds price series (right y-axis)
       └─► Sets visible time range

8. REAL-TIME UPDATES (ongoing)
   └─► Every 60 seconds:
       ├─► Fetch new data points
       ├─► Merge with existing data
       ├─► Re-aggregate
       └─► Update chart series
```

---

## Key Concepts

### URL Synchronization

The Zustand store uses a custom `createURLStorage` adapter that:

- **On load**: Reads `?hoursBack=24h&interval=["2","4"]&tickers=["BTCUSD"]` from URL
- **On change**: Updates URL via `history.replaceState()` (no page reload)
- **Benefit**: Bookmarkable/shareable chart configurations

### Dual Y-Axes

The chart displays two data series:

- **Left axis (orange)**: Strength values - aggregated momentum indicators
- **Right axis (blue)**: Price values - normalized average across tickers

### Data Normalization

When multiple tickers are selected:

1. Each ticker's prices are normalized relative to their last value
2. This allows tickers with different price scales (BTC ~$95k vs ETH ~$3k) to be compared
3. The average represents relative movement across all selected assets

### Forward-Fill Interpolation

Missing data points are filled using the most recent known value. This ensures:

- Continuous chart lines without gaps
- Consistent timestamp alignment across tickers
- Real-time updates don't cause visual jumps

### 2x Scaling Trick

The chart renders at 2x dimensions (`window.innerWidth * 2`) and the page uses CSS `zoom: 0.5`. This provides:

- Sharper rendering on high-DPI displays
- More data points visible without performance issues
- Mouse events are intercepted and coordinates corrected in `Chart.tsx`

---

## Dependencies

**External packages:**

- `lightweight-charts` - TradingView's charting library
- `zustand` - State management
- `@mantine/core`, `@mantine/hooks` - UI components
- `@tabler/icons-react` - Icons

**Internal imports:**

- `@lib/common/sql/strength` - Type definitions for strength data rows
- `/api/v1/strength` - Backend API endpoint (not in this folder)
