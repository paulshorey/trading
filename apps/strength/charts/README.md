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
    │   • InlineControls      │     │  • Uses useAggregatedChartData hook │
    │   • ControlsDropdown    │     │  • Renders Chart component          │
    │   • DrawerNews/Calendar │     │  • Manages ticker selection UI      │
    └─────────────────────────┘     └─────────────────────────────────────┘
                                                    │
                                    ┌───────────────┼───────────────┐
                                    │               │               │
                                    ▼               ▼               ▼
                    ┌───────────────────┐  ┌─────────────┐  ┌─────────────────┐
                    │   Chart.tsx       │  │MarketControl│  │ UpdatedTime.tsx │
                    │(Rendering Layer)  │  │   (Ticker)  │  │ (Status Badge)  │
                    │ • Creates chart   │  └─────────────┘  └─────────────────┘
                    │ • Dual y-axes     │
                    │ • Scaling fix     │
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
│  useAggregatedChartData Hook       │
│  (lib/hooks/useAggregatedChartData)│
│  • Orchestrates data pipeline      │
│  • Updates Zustand store           │
└─────────────────────────────────────┘
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
│  StrengthApi Service               │
│  (lib/strengthApi.ts)              │
│  • Calls /api/v1/strength          │
│  • Fetches multiple tickers        │
│  • Merges incremental updates      │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Data Aggregation                  │
│  • aggregateStrengthData()         │
│  • aggregatePriceData()            │
│  • Forward-fill (interpolation.ts) │
│  • Normalize across tickers        │
└─────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Chart.tsx Rendering               │
│  • Dual y-axes (left: strength,    │
│    right: price)                   │
│  • Uses chartScalingFix for 2x     │
│  • Applies time range              │
└─────────────────────────────────────┘
```

---

## Folder Structure

```
charts/
├── SyncedChartsWrapper.tsx    # Entry point - hydration gate
├── SyncedCharts.tsx           # Main orchestration component
├── constants.ts               # Centralized magic numbers & config
├── classes.module.scss        # Shared SCSS styles
│
├── components/                # UI Components
│   ├── index.ts               # Barrel exports
│   ├── Chart.tsx              # Chart rendering (lightweight-charts)
│   ├── ChartStates.tsx        # Loading/Error/NoData states
│   ├── ChartTitle.tsx         # Chart title overlay
│   ├── Header.tsx             # Top navigation bar
│   ├── UpdatedTime.tsx        # Real-time update indicator
│   ├── controls/              # User input controls
│   │   ├── ControlsDropdown.tsx   # Settings popover
│   │   ├── InlineControls.tsx     # Header controls wrapper
│   │   ├── IntervalControl.tsx    # Strength interval selector
│   │   ├── MarketControl.tsx      # Ticker/market selector
│   │   └── TimeControl.tsx        # Time range selector
│   └── drawers/               # Sliding drawer panels
│       ├── index.ts           # Barrel exports
│       ├── Drawer.tsx         # Shared drawer shell component
│       ├── Drawer.module.scss # Drawer styles
│       ├── DrawerCalendar.tsx # Economic calendar content
│       └── DrawerNews.tsx     # News feed content
│
├── lib/                       # Business Logic & Utilities
│   ├── index.ts               # Barrel exports
│   ├── strengthApi.ts         # API service class (fetch, merge)
│   ├── useRealtimeStrengthData.ts # Real-time data polling hook
│   ├── hooks/
│   │   └── useAggregatedChartData.ts # Data aggregation hook
│   ├── aggregateStrengthData.ts   # Strength data processing
│   ├── aggregatePriceData.ts      # Price data processing
│   ├── interpolation.ts           # Forward-fill & normalization
│   ├── timeRangeUtils.ts          # Time range calculations
│   ├── chartConfig.ts             # Chart options configuration
│   └── chartScalingFix.ts         # 2x scaling mouse event fix
│
└── state/                     # State Management
    ├── index.ts               # Barrel exports
    ├── useChartControlsStore.ts   # Zustand store
    ├── config/                # Configuration constants
    │   ├── index.ts           # Barrel exports
    │   ├── tickers.ts         # Market/ticker definitions
    │   ├── intervals.ts       # Strength interval options
    │   └── timeRanges.ts      # Hours back options
    └── lib/
        └── urlSync.ts         # URL ↔ Store synchronization
```

---

## File Reference

### Entry Points

| File                      | Purpose                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `SyncedChartsWrapper.tsx` | **Entry point**. Waits for hydration before rendering. Calculates responsive dimensions. |
| `SyncedCharts.tsx`        | **Orchestration layer**. Uses `useAggregatedChartData` hook, renders Chart component.    |

### State Layer (`state/`)

| File                       | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `useChartControlsStore.ts` | Zustand store holding all chart state. Persists to URL. |
| `config/tickers.ts`        | Market categories and ticker options.                   |
| `config/intervals.ts`      | Strength interval configurations (2m, 4m, 12m, etc.).   |
| `config/timeRanges.ts`     | Available time range options (24h, 48h, etc.).          |
| `lib/urlSync.ts`           | Custom Zustand storage adapter for URL sync.            |

### Data Layer (`lib/`)

| File                              | Purpose                                                        |
| --------------------------------- | -------------------------------------------------------------- |
| `strengthApi.ts`                  | Service class for API calls to `/api/v1/strength`.             |
| `useRealtimeStrengthData.ts`      | Hook managing real-time data polling.                          |
| `hooks/useAggregatedChartData.ts` | Hook that orchestrates fetching + aggregation + store updates. |
| `aggregateStrengthData.ts`        | Processes raw data into strength chart series.                 |
| `aggregatePriceData.ts`           | Processes raw data into price chart series.                    |
| `interpolation.ts`                | Forward-fill, timestamp extraction, normalization utilities.   |
| `timeRangeUtils.ts`               | Time range calculation, data conversion.                       |
| `chartConfig.ts`                  | Lightweight Charts configuration.                              |
| `chartScalingFix.ts`              | Mouse event coordinate correction for 2x scaling.              |

### UI Components (`components/`)

| File                         | Purpose                                |
| ---------------------------- | -------------------------------------- |
| `Chart.tsx`                  | Core chart rendering with dual y-axis. |
| `ChartStates.tsx`            | Loading, Error, NoData placeholders.   |
| `ChartTitle.tsx`             | Chart heading overlay.                 |
| `Header.tsx`                 | Top navigation bar.                    |
| `UpdatedTime.tsx`            | Last update time badge.                |
| `drawers/Drawer.tsx`         | Shared sliding drawer shell.           |
| `drawers/DrawerCalendar.tsx` | Economic calendar widget.              |
| `drawers/DrawerNews.tsx`     | News feed widget.                      |

### Controls (`components/controls/`)

| File                   | Purpose                     |
| ---------------------- | --------------------------- |
| `MarketControl.tsx`    | Ticker/market dropdown.     |
| `IntervalControl.tsx`  | Strength interval dropdown. |
| `TimeControl.tsx`      | Time range dropdown.        |
| `InlineControls.tsx`   | Header controls wrapper.    |
| `ControlsDropdown.tsx` | Settings popover.           |

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
       ├─► Merges with defaults from config/
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
       └─► useAggregatedChartData hook
           └─► useRealtimeStrengthData
               ├─► loadInitialData() via StrengthApi
               └─► setupRealtimeUpdates() - poll every 60s

6. DATA PROCESSING (inside useAggregatedChartData)
   └─► useEffect watches rawData, interval changes
       ├─► aggregateStrengthData() → store
       ├─► aggregatePriceData() → store
       └─► calculateTimeRange() → store

7. CHART RENDERING
   └─► Chart component receives data from hook
       ├─► Creates Lightweight Chart instance
       ├─► Attaches chartScalingFix
       ├─► Adds strength series (left y-axis)
       ├─► Adds price series (right y-axis)
       └─► Sets visible time range

8. REAL-TIME UPDATES (ongoing)
   └─► Every 60 seconds:
       ├─► Fetch new data points via StrengthApi
       ├─► Merge with existing data
       ├─► Re-aggregate in useAggregatedChartData
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

Missing data points are filled using the most recent known value (`lib/interpolation.ts`). This ensures:

- Continuous chart lines without gaps
- Consistent timestamp alignment across tickers
- Real-time updates don't cause visual jumps

### 2x Scaling Trick

The chart renders at 2x dimensions (`window.innerWidth * SCALE_FACTOR`) and the page uses CSS `zoom: 0.5`. This provides:

- Sharper rendering on high-DPI displays
- More data points visible without performance issues
- Mouse events are corrected via `lib/chartScalingFix.ts`

---

## Constants (`constants.ts`)

All magic numbers are centralized:

| Constant                      | Value | Description                      |
| ----------------------------- | ----- | -------------------------------- |
| `CHART_WIDTH_INITIAL`         | 2400  | Initial chart width in pixels    |
| `CHART_WIDTH_FALLBACK`        | 1200  | Fallback when window unavailable |
| `HOURS_BACK_INITIAL`          | 240   | Max historical data hours        |
| `REALTIME_UPDATE_INTERVAL_MS` | 60000 | Polling interval (1 min)         |
| `DRAWER_WIDTH`                | 360   | Drawer panel width               |
| `SCALE_FACTOR`                | 2     | Retina scaling factor            |

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
