# Suggestions

Cursor Gemini3 suggestions were trash.

# Charts Mini-App

This folder contains the UI and logic for the financial strength analysis charts. It functions as a self-contained "mini-app" within the broader strength application.

## 1. Overview & Entry Point

The application rendering starts at **`SyncedChartsWrapper.tsx`**.

### Initialization Flow:

1.  **`SyncedChartsWrapper.tsx`**:
    - **Responsibility**: Layout & Initialization.
    - **Action**: Calculates window dimensions (`availableWidth`, `availableHeight`).
    - **Wait Condition**: Waits for the Zustand store (`useChartControlsStore`) to "hydrate" (load state) from the URL query parameters.
    - **Render**: Once ready, it renders the global `Header` and the main `SyncedCharts` component.

## 2. Main Logic: `SyncedCharts.tsx`

This component acts as the **Controller** for the charts. It orchestrates data fetching, processing, and rendering.

### Responsibilities:

- **State Connection**: Connects to `useChartControlsStore` to read user preferences (selected tickers, time intervals, hours back).
- **Data Fetching**: Calls the custom hook `useRealtimeStrengthData` to fetch historical data and subscribe to real-time updates.
- **Data Aggregation**:
  - Watches `rawData` (from the hook) and `interval` (from store).
  - Calls `aggregateStrengthData` and `aggregatePriceData` (from `lib/`) to process raw database rows into chart-friendly `LineData[]`.
  - Updates the store with the processed `aggregatedStrengthData` and `aggregatedPriceData`.
- **Rendering**: Renders the `Chart` component (UI) and `MarketControl` (UI).

## 3. Data Flow Architecture

The data flows in a unidirectional manner:

1.  **URL / User Input** -> **Zustand Store** (`state/useChartControlsStore.ts`)
    - The URL is the source of truth for configuration (tickers, interval).
2.  **Store** -> **Data Hook** (`lib/useRealtimeStrengthData.ts`)
    - The hook reads selected tickers and fetches raw data from the API/DB.
3.  **Data Hook** -> **Aggregation Logic** (`SyncedCharts.tsx` -> `lib/aggregate*.ts`)
    - Raw data is transformed into averaged/normalized lines.
4.  **Aggregation** -> **Store**
    - Processed chart data is saved back to the store.
5.  **Store** -> **Chart UI** (`components/Chart.tsx`)
    - The UI component simply renders the data currently in the store.

## 4. Folder Structure

### `state/`

- **`useChartControlsStore.ts`**: The brain of the app. Uses **Zustand**.
  - Manages configuration (`chartTickers`, `interval`, `hoursBack`).
  - Manages processed data (`aggregatedStrengthData`).
  - **URL Sync**: Uses `persist` middleware with a custom `createURLStorage` (in `lib/urlSync.ts`) to keep state in sync with the browser URL.

### `lib/`

- **`useRealtimeStrengthData.ts`**:
  - Fetches initial historical data.
  - Sets up a 1-minute polling interval for new data.
  - Implements **Forward-Fill Logic** to handle missing data points in real-time.
- **`aggregateStrengthData.ts` / `aggregatePriceData.ts`**: Pure functions that take raw database rows and calculate the averages/indexes needed for the chart lines.
- **`FetchStrengthData.ts`**: Service layer interacting with the API/DB.

### `components/`

- **`Chart.tsx`**: A wrapper around the **Lightweight Charts** library. It handles the actual drawing of lines and axes.
- **`Header.tsx`**: Top navigation and info bar.

### `controls/`

- **`MarketControl.tsx`**: Dropdown for selecting market sectors/tickers.
- **`IntervalControl.tsx`**, `TimeControl.tsx`: Buttons to change time range and aggregation settings.

## 5. Key Concepts

- **Hydration**: The app ensures URL params are loaded _before_ fetching data to prevent a "flash" of default data.
- **Forward-Fill**: Since financial data can have gaps (especially with 2-minute intervals), the app "fills forward" previous values to prevent gaps in the lines.
- **Dual-Axis**: The chart renders two datasets on the same X-axis (Time):
  - Left Y-Axis: Strength (0-100 scale).
  - Right Y-Axis: Price (market value).
