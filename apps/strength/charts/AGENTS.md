# Charts Mini-App

Self-contained mini-app for rendering financial time series charts.

## Entry Point

`SyncedChartsWrapper.tsx` → imported by `../app/page.tsx`

## Folder Structure

- `state/` - Zustand store, options, URL sync
- `data/` - API calls, data hooks, aggregation
- `chart/` - Lightweight-charts config and utilities
- `components/` - UI components including controls

## Quick Reference

```typescript
// State
import { useChartControlsStore, tickersByMarket } from './state'

// Data
import { useStrengthData, useAggregatedData } from './data'

// Chart config
import { getChartConfig, getLineSeriesConfig } from './chart'
```

See `README.md` for detailed documentation.


