# Historical Chart Demo

Simple demonstration of lazy loading historical data in lightweight-charts.

## Purpose

This is a minimal implementation to isolate and test the "infinite history" feature without the complexity of the main chart (aggregation, real-time updates, multiple series, etc.).

## Features

1. **Initial Load**: Fetches 24 hours of historical data on mount
2. **Lazy Loading**: When user scrolls near the beginning (< 50 bars), fetches 2 hours more
3. **Scroll Preservation**: Saves and restores visible range when prepending data

## How Scroll Preservation Works

When new historical data is loaded:

1. **Before setData()**: Save the current `visibleLogicalRange`
2. **Calculate offset**: Find how many bars were prepended by comparing timestamps
3. **After setData()**: Restore the range with offset: `from + prependedCount`, `to + prependedCount`

```typescript
// Save range before update
savedLogicalRange = chart.timeScale().getVisibleLogicalRange()

// Calculate prepended bars
const oldFirstIndex = newData.findIndex(d => d.time >= oldFirstTime)
prependedCount = oldFirstIndex

// Update data
series.setData(newData)

// Restore range with offset
requestAnimationFrame(() => {
  chart.timeScale().setVisibleLogicalRange({
    from: savedLogicalRange.from + prependedCount,
    to: savedLogicalRange.to + prependedCount,
  })
})
```

## Key Implementation Details

- Uses `barsInLogicalRange()` to detect when user scrolls near the beginning
- Tracks previous data in a ref to compare timestamps
- Uses `requestAnimationFrame` to ensure chart processes setData before restoring range
- Uses `isLazyLoadingRef` flag to distinguish lazy loads from initial load

## Files

- **SimpleChart.tsx** - The chart component with all logic
- **page.tsx** (in `/app/historical/`) - The Next.js page that renders the chart

## Usage

Visit `/historical` to see the demo. Scroll left on the chart to trigger lazy loading.
