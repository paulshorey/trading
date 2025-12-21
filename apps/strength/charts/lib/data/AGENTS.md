# Data Fetching

API client and React hook for fetching real-time strength data.

## Files

**FetchStrengthData.ts** - API service class:
- `fetchTickerData()` / `fetchMultipleTickersData()` - Fetch from API
- `mergeData()` - Merge new data with existing, update same timestamps
- `prepareDate()` - Ensure 1-minute intervals (no seconds)

**useRealtimeStrengthData.ts** - Real-time data React hook:
- Fetches initial historical data (configurable hours back)
- Polls every 10 seconds for latest interval values
- Merges and forward-fills missing values
- Updates existing chart timestamps with new values

**Important**: Database rows are at 1-minute intervals, but are UPDATED every
few seconds with new interval data. We poll every 10 seconds to get the latest.

## Real-time Strategy (10-second polling)

Database rows exist at 1-minute intervals (10:01:00, 10:02:00, etc.) but each
row is updated every few seconds as new interval values become available.

On each 10-second poll:
1. Fetch last 3 minutes of data (current + previous + buffer)
2. Forward-fill any null interval values from previous rows
3. Merge into existing data (same timestamps get UPDATED, not duplicated)
4. Chart updates to show latest interval values

This allows the chart to show real-time updates as intervals complete.

