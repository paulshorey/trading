# Web Workers

This folder contains Web Worker implementations for offloading heavy computations from the main thread.

## Files

- **aggregation.worker.ts**: Self-contained Web Worker that performs all data aggregation
  - Strength data aggregation (average of intervals across tickers)
  - Price data aggregation (normalized average of all tickers)
  - Individual interval strength data
  - Individual ticker price data
  - Note: All aggregation logic is duplicated (inlined) from `/lib/aggregation/` to avoid import issues in workers

- **useAggregationWorker.ts**: React hook that manages the worker lifecycle
  - Creates/terminates worker on mount/unmount
  - Serializes data before sending to worker (Dates → ISO strings)
  - Handles responses and updates Zustand store

- **types.ts**: Shared types for worker communication
  - `WorkerStrengthRow`: Serializable version of `StrengthRowGet`
  - `AggregationWorkerRequest/Response`: Message types

## Why Web Workers?

Aggregation involves processing thousands of data points with complex calculations (forward-fill, normalization, averaging). Running this on the main thread causes UI freezes during real-time updates.

Workers run in a separate thread, keeping the UI responsive.

## Usage

```tsx
const { aggregate, isProcessing } = useAggregationWorker({
  onResult: (result) => { /* update store */ },
  onError: (error) => { /* handle error */ },
})

// Trigger aggregation (sends data to worker)
aggregate(rawData, intervals, tickers)
```

