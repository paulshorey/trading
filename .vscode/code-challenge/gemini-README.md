# Suggestions

VsCode Gemini3 suggestions were ok, nothing insightful, but not terrible.

# Strength Charts Mini-App

This folder contains the frontend logic for the stock market time series chart page. It functions as a self-contained "mini-app" within the `apps/strength` project.

## Architecture Overview

The application follows a unidirectional data flow pattern, orchestrating data fetching, state management, and rendering.

### 1. Entry Point & Initialization

**File:** `SyncedChartsWrapper.tsx`

This is the root component. It handles the initialization sequence:

1.  **Dimension Calculation:** Determines the available window size for the charts.
2.  **State Hydration:** Waits for the Zustand store (`useChartControlsStore`) to hydrate state from URL query parameters.
3.  **Rendering:** Only renders the main `SyncedCharts` component once both dimensions and state are ready.

### 2. Main Controller

**File:** `SyncedCharts.tsx`

This component acts as the central hub. It connects:

- **State:** Reads configuration (tickers, intervals, time range) from the store.
- **Data Fetching:** Invokes `useRealtimeStrengthData` to fetch raw data.
- **Data Processing:** Aggregates raw data into chart-friendly formats (`aggregateStrengthData`, `aggregatePriceData`).
- **Rendering:** Passes processed data to the `Chart` components and renders the UI controls.

### 3. Data Flow

1.  **Fetch:** `useRealtimeStrengthData` (hook) calls `FetchStrengthData` (service) to get raw data from `/api/v1/strength`.
2.  **Poll:** The hook sets up an interval to poll for new data every minute.
3.  **Aggregate:** When new data arrives or controls change (e.g., interval), `SyncedCharts` runs aggregation logic to calculate averages and normalize prices.
4.  **Store/Render:** Aggregated data is stored in the Zustand store and passed down to `Chart` components for visualization.

### 4. State Management

**Folder:** `state/`

- **Store:** `useChartControlsStore.ts` uses Zustand to manage global state (selected tickers, time range, aggregated data).
- **Persistence:** `lib/urlSync.ts` handles syncing specific state slices with the URL query parameters, allowing shareable chart configurations.

## Folder Structure

- **`components/`**: Pure UI components (Presentational).
  - `Chart.tsx`: Wraps the Lightweight Charts library.
  - `Header.tsx`, `UpdatedTime.tsx`: Display components.
- **`controls/`**: Interactive components that modify the global state.
  - `MarketControl.tsx`, `TimeControl.tsx`: Dropdowns and buttons for user input.
- **`lib/`**: Business logic and utilities.
  - **Data Fetching:** `FetchStrengthData.ts`, `useRealtimeStrengthData.ts`.
  - **Aggregation:** `aggregateStrengthData.ts`, `aggregatePriceData.ts`.
  - **Utils:** `chartUtils.ts`, `chartConfig.ts`.
- **`state/`**: State management logic.
  - `useChartControlsStore.ts`: Main store definition.
  - `lib/urlSync.ts`: URL synchronization logic.

## Key Dependencies

- **Lightweight Charts:** Used for rendering the financial time series charts.
- **Zustand:** Used for state management.
