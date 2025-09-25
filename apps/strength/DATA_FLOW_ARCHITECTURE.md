# Strength App - Data Flow Architecture

## Overview

The Strength app displays two synchronized financial charts (Strength and Price) with real-time data updates. Data flows from API → Raw Storage → Aggregation → Chart Display.

## Data Structure

### Database Row (StrengthRowGet)
```typescript
{
  timenow: Date      // CRITICAL: Even minutes only (0, 2, 4...), no seconds
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
- **Even Minutes Only**: All timestamps MUST be at even minutes (0, 2, 4, 6...)
- **No Seconds/Milliseconds**: Seconds and milliseconds must be 0
- **2-Minute Intervals**: Data points are spaced exactly 2 minutes apart
- **Consistent X-Axis**: The `timenow` field is used directly as chart x-axis

## Core Architecture Principles

1. **Cache at the Raw Data Level**: Always cache individual ticker data, not aggregated results
2. **Filter During Aggregation**: Apply ticker selection during aggregation, not fetching
3. **Preserve Timestamps**: Use all market ticker timestamps for consistency across selections
4. **Incremental Updates**: Real-time data appends to existing data without refetching

## Data Flow Layers

### 1. Data Fetching Layer (`useRealtimeStrengthData` hook)

**Purpose**: Manages raw data fetching and real-time updates for all market tickers

**Key Behaviors**:
- Fetches data for ALL `marketTickers` (not just selected tickers)
- Initial load: Fetches up to `MAX_DATA_HOURS` of historical data
- Real-time updates: Every 60 seconds, fetches only new data points
- Merges new data with existing data, handling duplicates

**Data Structure**:
```typescript
rawData: (StrengthRowGet[] | null)[]  // Array indexed by marketTickers
```

### 2. Data Selection Layer (`SyncedCharts` component)

**Purpose**: Filters raw data based on user selections

**Process**:
```typescript
// Map selected tickers to their indices in marketTickers
const strengthIndices = controlTickers.map(ticker =>
  marketTickers.indexOf(ticker)
).filter(i => i >= 0)

// Extract only the data for selected tickers
const strengthRawData = strengthIndices.map(i => rawData[i] || null)
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
  strengthRawData,      // Filtered data to aggregate
  controlInterval,      // Intervals to average
  rawData              // ALL market data for timestamps
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
  return prevItem &&
    item.time === prevItem.time &&
    Math.abs(item.value - prevItem.value) < 0.0001
})
```

## Real-time Update Flow

1. **Fetch** (every 60 seconds):
   - `fetchRealtimeUpdate()` gets new data since `lastDataTimestampRef`
   - Only fetches data newer than the last known timestamp
   - New data points should be at even minutes (e.g., 14:02, 14:04, 14:06)

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

### Selector Hierarchy

1. **Market Selector** (Top Level):
   - Changes available ticker options
   - Resets both Strength and Price to "Average" (all tickers)
   - Triggers new data fetch for all market tickers

2. **Strength Selector** (Master):
   - Updates `controlTickers` in store
   - ALSO updates `priceTickers` to match
   - Both charts update to show same selection
   - Does NOT trigger new data fetch (uses cached data)

3. **Price Selector** (Independent):
   - Updates only `priceTickers` in store
   - Does NOT affect `controlTickers`
   - Only Price chart updates
   - Does NOT trigger new data fetch (uses cached data)

### Implementation Details

1. **User Changes Selection**:
   - Updates appropriate tickers in store
   - Does NOT trigger new data fetch (except Market)

2. **Filter Raw Data**:
   - Maps selected tickers to indices in `marketTickers`
   - Extracts subset of `rawData` for aggregation

3. **Re-aggregate**:
   - Uses ALL market timestamps for consistency
   - Aggregates only the filtered ticker data
   - Creates new aggregated arrays

4. **Full Chart Update**:
   - `Chart` detects multiple values changed
   - Uses `setData()` for complete refresh
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
  seriesRef.current.update(lastCurrent)  // Efficient
} else {
  seriesRef.current.setData(currentData)  // Full refresh
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
**Cause**: Timestamps not properly aligned to 2-minute intervals
**Solution**:
- Ensure all timestamps are at even minutes with 0 seconds
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

1. ✅ Switch from Average to individual ticker → Historical data updates
2. ✅ Switch between individual tickers → Charts update smoothly
3. ✅ Real-time updates continue after ticker changes
4. ✅ Zoom/pan state preserved during real-time updates
5. ✅ No unnecessary data fetching when changing selections

## Future Improvements

1. **Optimize Aggregation**: Cache aggregation results per ticker combination
2. **Differential Updates**: Only re-aggregate affected portions
3. **WebSocket Support**: Replace polling with push updates
4. **Data Persistence**: Cache raw data in IndexedDB for offline support