# Strength App - Data Flow Architecture

## Overview

The Strength app displays two synchronized financial charts (Strength and Price) with real-time data updates. Data flows from API → Raw Storage → Aggregation → Chart Display.

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

2. **Merge** (at raw data level):
   - `StrengthDataService.mergeData()` combines with existing data
   - Updates `lastDataTimestampRef` with newest timestamp
   - Triggers `setRawData()` which updates the state

3. **Re-aggregate** (triggered by state change):
   - `useEffect` in `SyncedCharts` detects `lastUpdateTime` change
   - Re-runs aggregation functions with updated raw data
   - Produces new aggregated arrays with updated values

4. **Update Chart** (efficient rendering):
   - `Chart` component detects only last value changed
   - Uses `update()` method for efficient incremental update
   - Preserves zoom, pan, and cursor position

## Ticker Selection Change Flow

1. **User Changes Selection**:
   - Updates `controlTickers` or `priceTickers` in store
   - Does NOT trigger new data fetch

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