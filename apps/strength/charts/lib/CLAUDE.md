# Files

charts/lib/aggregatePriceData.ts - filter and format line data from multiple tickers for Price chart
charts/lib/aggregateStrengthData.ts - filter and format line data from multiple tickers for Strength chart
charts/lib/aggregateDataUtils.ts - utilities for aggregatePriceData and aggregateStrengthData
charts/lib/chartConfig.ts - set up the chart options, axis, and inputs
charts/lib/chartSync.ts - works with SyncedCharts.tsx component to synchronize the x-axis and time range
charts/lib/chartUtils.ts - utilities for x-axis, converting, and formatting chart data
charts/lib/strengthDataService.ts - fetch strength/price data
charts/lib/urlSync.ts -
charts/lib/useRealtimeStrengthData.ts - polls for new data every minute

# Real-time Data Updates

## Overview

The charts now support real-time data updates that automatically fetch and display new data every minute without requiring page refresh or chart reload.

## Key Features

### 1. Automatic Data Fetching

- Fetches new data every 60 seconds
- Only retrieves data since the last fetch (incremental updates)
- Efficiently merges new data with existing data

### 2. Smooth Chart Updates

- Uses lightweight-charts' `update()` method for incremental updates
- No flickering or full chart redraws
- Preserves user interactions (zoom, pan, cursor position)

### 3. Visual Indicators

- **Live Status Badge**: Shows real-time connection status
- **Last Update Time**: Displays when data was last refreshed
- **Go to Latest Button**: Quickly scroll to the most recent data

## Architecture

### Data Flow

1. **Initial Load**: Fetches up to MAX_DATA_HOURS hours of historical data
2. **Real-time Updates**: Every minute, fetches only new data points
3. **Data Merging**: Intelligently merges new data with existing data, handling duplicates
4. **Chart Updates**: Incrementally updates chart series with new points

### Key Components

#### `SyncedCharts.tsx`

- Uses the real-time hook for data management
- Aggregates data for display
- Manages chart synchronization

#### `lib/strengthDataService.ts`

- Centralized service for all API calls
- Handles date preparation (even minutes, no seconds)
- Provides data merging utilities

#### `lib/useRealtimeStrengthData.ts`

- Custom React hook managing real-time data
- Handles initial load and periodic updates
- Manages update intervals and cleanup

#### `components/Chart.tsx`

- Enhanced to handle incremental updates
- Intelligently determines when to use `setData()` vs `update()`
- Preserves chart state during updates

### Update Interval

Default: 60 seconds (1 minute)

To modify, change the `updateIntervalMs` parameter in `SyncedCharts.tsx`:

```typescript
const { rawData, isLoading, error, lastUpdateTime, isRealtime } =
  useRealtimeStrengthData({
    tickers: controlTickers,
    enabled: controlTickers.length > 0,
    maxDataHours: MAX_DATA_HOURS,
    updateIntervalMs: 60000, // Change this value (milliseconds)
  })
```
