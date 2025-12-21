# Web Workers

This folder contains Web Worker implementations for offloading heavy computations from the main thread.

## Files

- **aggregation.worker.ts**: Self-contained Web Worker that performs all data aggregation
  - Strength data aggregation (average of intervals across tickers)
  - Price data aggregation (normalized average of all tickers)
  - Individual interval strength data
  - Individual ticker price data
  - Echoes back `dataVersion` for race condition handling
  - Note: All aggregation logic is duplicated (inlined) from `/lib/aggregation/` to avoid import issues in workers

- **useAggregationWorker.ts**: React hook that manages the worker lifecycle
  - Creates/terminates worker on mount/unmount
  - Serializes data before sending to worker (Dates → ISO strings)
  - **dataVersion tracking**: Tied to data source (tickers) for race condition prevention
  - **Stale result filtering**: Results with old dataVersion are ignored
  - `setValidDataVersion()`: Set minimum acceptable version (older results ignored)

- **types.ts**: Shared types for worker communication
  - `WorkerStrengthRow`: Serializable version of `StrengthRowGet`
  - `AggregationWorkerRequest/Response`: Message types with `dataVersion`

## Why Web Workers?

Aggregation involves processing thousands of data points with complex calculations (forward-fill, normalization, averaging). Running this on the main thread causes UI freezes during real-time updates.

Workers run in a separate thread, keeping the UI responsive.

## Race Condition Prevention

The `dataVersion` system prevents showing stale data when tickers change:

1. `dataVersion` is tied to the data source (increments when tickers change)
2. Each worker request includes the `dataVersion`
3. Worker echoes back `dataVersion` in results
4. Results with old `dataVersion` are ignored at multiple levels:
   - Worker hook checks `dataVersion >= validDataVersionRef`
   - SyncedCharts double-checks against `chartDataVersionRef`

This ensures old ticker data is NEVER shown after switching tickers.

## Usage

```tsx
const { aggregate, isProcessing, setValidDataVersion } = useAggregationWorker({
  onResult: (result, processingTimeMs, dataVersion) => { /* update chart */ },
  onError: (error) => { /* handle error */ },
})

// When data source changes, set the valid version
useEffect(() => {
  setValidDataVersion(dataVersion)
  clearChartData()
}, [dataVersion])

// Trigger aggregation with dataVersion
aggregate(rawData, intervals, tickers, dataVersion)
```

