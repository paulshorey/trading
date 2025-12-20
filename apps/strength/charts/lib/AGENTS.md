# Charts Library Files

## Data Fetching & Processing

- `FetchStrengthData.ts` - API client for fetching strength data from backend
- `useRealtimeStrengthData.ts` - React hook: polls for new data every minute
- `forwardFillData.ts` - Adds data points at required timestamps (time range boundaries only)

## Data Aggregation

### aggregateStrengthData.ts

Strength data aggregation for left y-axis:

- `aggregateStrengthData()` - Average selected intervals across all tickers
- `aggregateStrengthByInterval()` - Separate line for each interval

### aggregatePriceData.ts

Price data aggregation for right y-axis:

- `aggregatePriceData()` - Normalized average of all tickers
- `aggregatePriceByTicker()` - Separate normalized line for each ticker

**Key**: Both functions share a normalization context (`processTickersForNormalization`)
to ensure individual lines converge to the same point and are visually consistent.

### aggregateDataUtils.ts

Shared utilities:

- `extractGlobalTimestamps()` - Get all unique timestamps from data
- `forwardFillData()` - Fill missing values by forward-filling
- `extendDataIntoFuture()` - Extend data 12 hours into future
- `aggregateStrengthDataWithInterpolation()` - Interpolation for strength data

## Chart Configuration

- `chartConfig.ts` - Chart options, dual y-axes configuration
- `chartUtils.ts` - Time range calculations, data formatting
- `urlSync.ts` - Sync chart state with URL query parameters

## Custom Primitives

- `TimeRangeHighlight.ts` - Shaded background regions for market hours
- `VerticalLinePrimitive.ts` - Vertical line markers for events
- `timeMarkers.ts` - Configuration for time ranges and markers

See `TIME_RANGE_HIGHLIGHTING.md` for details on the highlighting implementation.
