# Strength App - Data Flow Architecture

## Overview

The Strength app displays two synchronized financial charts (Strength and Price) with real-time data updates. Data flows from API → Raw Storage → Aggregation → Chart Display.

## Terminology

### Simplified Ticker Management

- **`chartTickers`**: Single list of tickers for both data fetching and display. Both strength and price charts use the same tickers.

## Data Structure

### Database Row (StrengthRowGet)

```typescript
{
  timenow: Date      // CRITICAL: 1-minute intervals, no seconds
  ticker: string     // Market ticker symbol
  price: number      // Current price
  volume: number     // Trading volume
  "1": number        // 1-minute interval strength
  "4": number        // 4-minute interval strength
  "12": number       // 12-minute interval strength
  "60": number       // 60-minute (1hr) interval strength
  "240": number      // 240-minute (4hr) interval strength
}
```

### Timestamp Requirements

- **1-Minute Intervals**: Data points are spaced exactly 1 minute apart
- **No Seconds/Milliseconds**: Seconds and milliseconds must be 0
- **Consistent X-Axis**: The `timenow` field is used directly as chart x-axis

## Core Architecture Principles

1. **Cache at the Raw Data Level**: Always cache individual ticker data, not aggregated results
2. **Filter During Aggregation**: Apply ticker selection during aggregation, not fetching
3. **Preserve Timestamps**: Use all market ticker timestamps for consistency across selections
4. **Incremental Updates**: Real-time data appends to existing data without refetching

## Data Flow Layers

### 1. Data Fetching Layer (`useRealtimeStrengthData` hook)

**Purpose**: Manages raw data fetching and real-time updates for selected tickers

**Key Behaviors**:

- Fetches data for `chartTickers`
- Initial load: Fetches up to `MAX_DATA_HOURS` of historical data
- Real-time updates: Every 60 seconds, fetches only new data points
- Merges new data with existing data, handling duplicates
- Forward-fills missing strength values in real-time updates

**Data Structure**:

```typescript
rawData: (StrengthRowGet[] | null)[]  // Array indexed by chartTickers
```

### 2. Data Aggregation Layer (`SyncedCharts` component)

**Purpose**: Aggregates raw data for chart display

**Process**:

```typescript
// Use all raw data for both charts
const strengthData = aggregateStrengthData(rawData, interval, rawData)
const priceData = aggregatePriceData(rawData, rawData)
```

### 3. Data Aggregation Layer (`aggregateStrengthData`, `aggregatePriceData`)

**Purpose**: Combines multiple ticker data into single chart series

**Key Features**:

- Uses timestamps from ALL market data (not just selected tickers)
- Applies forward-fill interpolation for missing values
- Averages values across selected tickers
- Normalizes price data for equal contribution

**Critical**: Always passes full `rawData` as second parameter for consistent timestamps:

```typescript
const strengthData = aggregateStrengthData(
  strengthRawData, // Filtered data to aggregate
  controlInterval, // Intervals to average
  rawData // ALL market data for timestamps
)
```

### 4. Chart Display Layer (`Chart` component)

**Purpose**: Renders data with efficient updates

**Update Strategies**:

- **Initial Load**: Uses `setData()` to set all data
- **Real-time Update**: Uses `update()` for last point only
- **Ticker Change**: Uses `setData()` for complete refresh

**Change Detection**:

```typescript
// Detects if only last point changed (real-time) vs multiple changes (ticker switch)
const onlyLastChanged = currentData.slice(0, -1).every((item, index) => {
  const prevItem = prevData[index]
  return (
    prevItem &&
    item.time === prevItem.time &&
    Math.abs(item.value - prevItem.value) < 0.0001
  )
})
```

## Real-time Update Flow

### Important: 1-Minute Interval Behavior

- Database saves data every minute to 1-minute interval timestamps
- Database pre-creates empty rows with just timestamps (no data)
- The same timestamp (e.g., 14:02) might be updated multiple times as data arrives
- Must handle both new data points AND updates to existing points

1. **Fetch** (every 60 seconds):

   - `fetchRealtimeUpdate()` fetches the LAST TWO 1-minute intervals
   - Current interval: Might be empty (pre-created) or partially filled
   - Previous interval: Might still be receiving updates
   - Example: At 14:03:30, fetches both 14:02 (previous) and 14:03 (current)
   - This ensures we capture:
     - Updates to the previous interval (14:02)
     - New data for the current interval (14:03)
   - Empty pre-created rows are filtered out during aggregation

2. **Merge** (at raw data level):

   - `StrengthDataService.mergeData()` combines with existing data
   - Uses `timenow.getTime()` as unique key for deduplication
   - Updates existing points if timestamps match exactly
   - Adds new points if timestamps are new
   - Updates `lastDataTimestampRef` with newest timestamp
   - Triggers `setRawData()` which updates the state

3. **Re-aggregate** (triggered by state change):

   - `useEffect` in `SyncedCharts` detects `lastUpdateTime` change
   - Re-runs aggregation functions with updated raw data
   - Preserves exact timestamps from `timenow` field
   - Produces new aggregated arrays with updated values

4. **Update Chart** (efficient rendering):
   - Chart uses Unix timestamps (seconds since epoch) for x-axis
   - Conversion: `new Date(item.timenow).getTime() / 1000`
   - `Chart` component detects update type:
     - New points: Uses `update()` to append
     - Value change at same time: Uses `update()` to modify
     - Multiple changes: Uses `setData()` for full refresh
   - Preserves zoom, pan, and cursor position

## Ticker Selection Change Flow

### Simplified Selection

**Market Selector**:
   - Changes ticker selection (`chartTickers`)
   - Triggers new data fetch for selected tickers
   - Both strength and price charts update together

### Implementation Details

1. **User Changes Selection**:
   - Updates `chartTickers` in store
   - Triggers new data fetch

2. **Data Aggregation**:
   - Uses all fetched raw data
   - Creates aggregated arrays for both charts

3. **Chart Update**:
   - Both charts update with new data
   - Maintains chart instance (no remounting)

## Critical Implementation Details

### Timestamp Consistency

**Problem**: Different tickers may have different timestamps
**Solution**: Always extract timestamps from ALL market data

```typescript
// In aggregation functions:
const dataForTimestamps = allMarketData || allRawData
const sortedTimestamps = extractGlobalTimestamps(dataForTimestamps)
```

### Data Interpolation

**Problem**: Tickers may have missing data at certain timestamps
**Solution**: Forward-fill interpolation

```typescript
// Forward-fill: use most recent valid value for missing timestamps
const filledData = forwardFillData(tickerValues, sortedTimestamps)
```

### Efficient Updates

**Problem**: Full chart redraws are expensive
**Solution**: Detect update type and use appropriate method

```typescript
if (onlyLastChanged) {
  seriesRef.current.update(lastCurrent) // Efficient
} else {
  seriesRef.current.setData(currentData) // Full refresh
}
```

## Common Issues and Solutions

### Issue: Historical data not updating when switching tickers

**Cause**: Chart thinks it's a real-time update when timestamps match
**Solution**: Properly detect when multiple values have changed

### Issue: Real-time updates stop working

**Cause**: Chart component remounting disrupts update cycle
**Solution**: Use stable chart keys, rely on data change detection

### Issue: Different data shown for Average vs Individual

**Cause**: Using different timestamp sets for aggregation
**Solution**: Always use full market data timestamps

### Issue: Chart data becomes corrupted after real-time updates

**Cause**: Timestamps not properly aligned to 1-minute intervals
**Solution**:

- Ensure all timestamps have 0 seconds
- Use `timenow` directly without modification
- Validate timestamps when fetching data
- Log warnings for misaligned timestamps

### Issue: Duplicate or missing data points

**Cause**: Incorrect timestamp conversion or merging logic
**Solution**:

- Use `timenow.getTime()` as unique key for merging
- Convert to chart format: `timenow.getTime() / 1000`
- Never modify the original timestamp

## Testing Checklist

1. ✅ Switch between different ticker selections → New data fetched
2. ✅ Both charts update together with same tickers
3. ✅ Real-time updates continue after ticker changes
4. ✅ Zoom/pan state preserved during real-time updates
5. ✅ URL parameters reflect simplified structure

## Future Improvements

1. **Optimize Aggregation**: Cache aggregation results per ticker combination
2. **Differential Updates**: Only re-aggregate affected portions
3. **WebSocket Support**: Replace polling with push updates
4. **Data Persistence**: Cache raw data in IndexedDB for offline support
