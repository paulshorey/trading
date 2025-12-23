# Data Fetching

Hooks for fetching strength data with real-time polling.

## Files

- **FetchStrengthData.ts** - API service class
- **useStrengthData.ts** - Main data fetching hook (RECOMMENDED)
- **useRealtimeStrengthData.ts** - Legacy hook

## Data Flow

```
User selects tickers → dataState = 'loading'
      ↓
Historical fetch (up to 240 hours)
      ↓
dataState = 'ready', start polling
      ↓
Every 10s: fetch recent data → merge → trigger aggregation
```

## Real-Time Polling

**Interval:** 10 seconds (`updateIntervalMs: 10000`)

**Fetch window:** Dynamic based on time since last successful fetch
- Normal: 4 minutes
- After background: up to 2 hours (fills gaps)

**Process:**
1. Calculate fetch window from `lastSuccessfulFetchRef`
2. Fetch from API
3. Forward-fill null intervals from existing historical data
4. Merge into rawData (updates existing timestamps, adds new ones)

## Background Tab Recovery

When tab is in background, JS execution is limited. On return:
1. Visibility change event triggers immediate fetch
2. Dynamic window calculates time since last fetch
3. All missing data fetched (capped at 2 hours)

## Forward-Fill

Database rows may have null interval values (not yet calculated).
Forward-fill copies the last known value to ensure chart continuity.

**Key improvement:** First row of new data is forward-filled from existing historical data, not just from within the new batch.

## State Machine

```
IDLE → LOADING → READY ←→ (polling)
  ↑        ↓
  ←― ticker change ―←
```

## Key Config

```typescript
const MIN_FETCH_MINUTES = 4    // Minimum window
const MAX_FETCH_MINUTES = 120  // Maximum window (2 hours)
updateIntervalMs: 10000        // 10 seconds polling
```
