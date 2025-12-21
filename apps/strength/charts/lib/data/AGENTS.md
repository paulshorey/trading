# Data Fetching

API client and React hook for fetching real-time strength data.

## Files

**FetchStrengthData.ts** - API service class:
- `fetchTickerData()` / `fetchMultipleTickersData()` - Fetch from API
- `mergeData()` - Merge new data with existing, handle duplicates
- `prepareDate()` - Ensure 1-minute intervals (no seconds)

**useRealtimeStrengthData.ts** - Real-time data React hook:
- Fetches initial historical data (configurable hours back)
- Polls every minute for updates
- Merges and forward-fills missing values
- Handles "unreliable latest row" by using second-to-last

**Important**: All timestamps are 1-minute intervals with no seconds.

## Real-time Strategy

Fetches last TWO intervals on each update:
1. Current interval may be empty (pre-created placeholder)
2. Previous interval may still be receiving updates
3. Forward-fills missing values from historical data

Ensures reliable updates without incomplete data.

