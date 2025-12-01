# Forward-Fill Logic Documentation

## Overview

The strength app implements forward-fill logic at multiple layers to handle missing data points and ensure chart continuity. This is critical because:

1. **Database gaps**: Some intervals may have missing strength values (1m, 4m, 12m, 60m, 240m)
2. **Real-time updates**: New data points may arrive with partial values
3. **Multiple tickers**: Different tickers may have data at different timestamps

## Implementation Layers

### 1. Real-time Data Forward-Fill (`useRealtimeStrengthData.ts`)

**Purpose**: Fill missing strength values in real-time updates before merging with historical data

**Process**:
```typescript
// Fetches 3 rows sorted by timenow (newest first):
// [0] - Latest row (unreliable placeholder, ignored)
// [1] - Current real-time update (may have nulls)
// [2] - Historical data (usually complete)

const forwardFillStrengthData = (currentRow, historicalRow) => {
  // Forward-fill each strength interval if null
  ['1', '4', '12', '60', '240'].forEach(interval => {
    if (currentRow[interval] === null && historicalRow[interval] !== null) {
      currentRow[interval] = historicalRow[interval]
    }
  })
  // Also forward-fill price if needed
  if (currentRow.price === 0 || currentRow.price === null) {
    currentRow.price = historicalRow.price || 0
  }
}
```

**Key Points**:
- Only uses index 1 (current) and index 2 (historical)
- Ignores index 0 as it's a pre-created placeholder
- Fills nulls in current row with values from historical row

### 2. Historical Data Forward-Fill (`aggregateDataUtils.ts`)

**Purpose**: Fill gaps in historical data when aggregating multiple tickers

**Process**:
```typescript
function forwardFillData(data, sortedTimestamps) {
  // First pass: collect valid values
  const validDataByTimestamp = new Map()

  // Second pass: fill all timestamps
  let previousValue = null
  for (timestamp of sortedTimestamps) {
    if (validDataByTimestamp.has(timestamp)) {
      // Use existing value
      previousValue = validDataByTimestamp.get(timestamp)
    } else if (previousValue !== null) {
      // Forward-fill from previous
      filledData.set(timestamp, previousValue)
    } else {
      // Look ahead if no previous value
      // (backward-fill for initial gaps)
    }
  }
}
```

**Key Points**:
- Fills forward primarily (uses last known value)
- Backward-fills only when no previous value exists
- Ensures all timestamps have values for smooth charts

### 3. Strength Data Aggregation (`aggregateStrengthData.ts`)

**Purpose**: Combine multiple tickers' strength data with interpolation

**Process**:
1. Extract global timestamps from ALL market data
2. For each ticker:
   - Calculate average of selected intervals (1m, 4m, etc.)
   - Skip empty pre-created rows (all values null)
   - Apply forward-fill to ensure continuity
3. Average all tickers' values at each timestamp

**Key Features**:
- Filters out empty database placeholder rows
- Uses consistent timestamps across all tickers
- Averages after interpolation for smooth results

### 4. Price Data Aggregation (`aggregatePriceData.ts`)

**Purpose**: Normalize and combine price data from multiple tickers

**Process**:
1. Extract global timestamps from ALL market data
2. For each ticker:
   - Filter valid price values (not null, not 0)
   - Apply forward-fill interpolation
   - Track last valid price for normalization
3. Normalize each ticker relative to its last price
4. Average normalized values for equal contribution

**Key Features**:
- Normalization ensures tickers contribute equally regardless of price level
- Forward-fill maintains price continuity
- Scales result back to meaningful price range

## Critical Timestamp Requirements

All timestamps MUST:
- Have seconds and milliseconds set to 0
- Use the `timenow` field directly from database
- Be spaced exactly 1 minute apart

## Common Issues and Solutions

### Issue: Strength chart spikes at latest point

**Cause**: Missing interval values in real-time update
**Solution**: Forward-fill from historical data (implemented in `useRealtimeStrengthData`)

### Issue: Gaps in historical charts

**Cause**: Missing data for certain timestamps
**Solution**: Forward-fill interpolation in aggregation functions

### Issue: Different tickers show different timestamps

**Cause**: Using filtered data for timestamp extraction
**Solution**: Always extract timestamps from ALL market data

## Data Flow Summary

```
Database Row
    ↓
Real-time Forward-Fill (useRealtimeStrengthData)
    ↓
Raw Data Storage (in memory)
    ↓
Filter by Selected Tickers
    ↓
Historical Forward-Fill (aggregateDataUtils)
    ↓
Aggregation & Normalization
    ↓
Chart Display
```

## Testing Checklist

- [ ] Real-time updates don't cause spikes when intervals are missing
- [ ] Historical data shows smooth lines without gaps
- [ ] Switching tickers maintains continuity
- [ ] "All" and "Multi" interval selections average correctly
- [ ] Price normalization works across different price scales

## Future Improvements

1. **Smarter interpolation**: Use weighted averages based on time distance
2. **Configurable strategies**: Allow linear vs step interpolation
3. **Missing data alerts**: Notify when excessive forward-filling occurs
4. **Caching layer**: Store interpolated results to reduce recalculation