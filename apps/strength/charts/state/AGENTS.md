# State Management

Zustand store and configuration for the charts mini-app.

## Files

- `store.ts` - Zustand store with state and actions
- `options.ts` - Configuration options (tickers, intervals, hoursBack)
- `urlSync.ts` - Bidirectional URL ↔ Zustand sync
- `index.ts` - Public exports

## URL Sync

State is synced with URL query parameters for bookmarkable URLs:
- `?tickers=["BTCUSD"]` - Selected tickers
- `?interval=["12","30"]` - Selected intervals
- `?hoursBack=48h` - Time range
