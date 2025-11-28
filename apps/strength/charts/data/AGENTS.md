# Data Layer

Data fetching, processing, and aggregation for the charts mini-app.

## Files

- `api.ts` - StrengthDataApi class for API calls to /api/v1/strength
- `useStrengthData.ts` - Hook for fetching + real-time polling (60s intervals)
- `useAggregatedData.ts` - Hook for processing raw data into chart format
- `aggregation.ts` - Pure functions for data aggregation and forward-fill
- `index.ts` - Public exports

## Data Flow

```
API → useStrengthData (fetch + poll) → rawData
     → useAggregatedData (process) → aggregatedStrengthData, aggregatedPriceData
     → Chart component (render)
```


