# Charts Library Files

## Data Fetching & Processing

- `FetchStrengthData.ts` - API client for fetching strength data from backend
- `useRealtimeStrengthData.ts` - React hook: polls for new data every minute
- `forwardFillData.ts` - Adds data points at required timestamps (time range boundaries only)

## Data Aggregation

- `aggregateStrengthData.ts` - Combine multiple tickers for strength series (left y-axis)
- `aggregatePriceData.ts` - Combine multiple tickers for price series (right y-axis)
- `aggregateDataUtils.ts` - Shared aggregation utilities

## Chart Configuration

- `chartConfig.ts` - Chart options, dual y-axes configuration
- `chartUtils.ts` - Time range calculations, data formatting
- `urlSync.ts` - Sync chart state with URL query parameters

## Custom Primitives

- `TimeRangeHighlight.ts` - Shaded background regions for market hours
- `VerticalLinePrimitive.ts` - Vertical line markers for events
- `timeMarkers.ts` - Configuration for time ranges and markers

See `TIME_RANGE_HIGHLIGHTING.md` for details on the highlighting implementation.
