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

1. **Initial Load**: Fetches up to 240 hours of historical data
2. **Real-time Updates**: Every minute, fetches only new data points
3. **Data Merging**: Intelligently merges new data with existing data, handling duplicates
4. **Chart Updates**: Incrementally updates chart series with new points

### Key Components

#### `strengthDataService.ts`

- Centralized service for all API calls
- Handles date preparation (even minutes, no seconds)
- Provides data merging utilities

#### `useRealtimeStrengthData.ts`

- Custom React hook managing real-time data
- Handles initial load and periodic updates
- Manages update intervals and cleanup

#### `SyncedCharts.tsx`

- Uses the real-time hook for data management
- Aggregates data for display
- Manages chart synchronization

#### `Chart.tsx`

- Enhanced to handle incremental updates
- Intelligently determines when to use `setData()` vs `update()`
- Preserves chart state during updates

## Configuration

### Update Interval

Default: 60 seconds (1 minute)

To modify, change the `updateIntervalMs` parameter in `SyncedCharts.tsx`:

```typescript
const { rawData, isLoading, error, lastUpdateTime, isRealtime } =
  useRealtimeStrengthData({
    tickers: controlTickers,
    enabled: controlTickers.length > 0,
    maxDataHours: 240,
    updateIntervalMs: 60000, // Change this value (milliseconds)
  })
```

### Data History

Default: 240 hours (10 days)

To modify, change the `maxDataHours` parameter.

## API Requirements

The API endpoint `/api/v1/strength` must support:

- `ticker`: Ticker symbol to fetch
- `timenow_gt`: Start date/time (exclusive)
- `timenow_lt`: End date/time (exclusive) - optional

## Performance Considerations

1. **Incremental Updates**: Only new data points are fetched and processed
2. **Efficient Merging**: Uses Map-based deduplication for O(n) performance
3. **Smart Chart Updates**: Only updates changed data points
4. **Resource Cleanup**: Properly cleans up intervals on unmount

## Troubleshooting

### Data Not Updating

- Check browser console for API errors
- Verify API endpoint is responding
- Ensure ticker symbols are valid

### Chart Performance Issues

- Consider reducing update frequency if needed
- Check if data aggregation is taking too long
- Monitor browser memory usage

### Visual Glitches

- Ensure chart width/height are properly set
- Check for CSS conflicts
- Verify time range calculations

## Future Enhancements

Potential improvements:

- WebSocket support for instant updates
- Configurable update intervals per user
- Data caching and offline support
- Alert notifications for significant changes
