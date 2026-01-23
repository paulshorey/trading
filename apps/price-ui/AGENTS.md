# Price UI app (apps/price-ui/)

Financial charting app displaying price and relative strength (RSI), with real-time updates.

## Overview

- **Left y-axis:** Strength (-100 to 100)
- **Right y-axis:** Price
- **X-axis:** Time (shared)

## Folders

Current working directory is `apps/price-ui`
Inside:

- lib/utils/ - Utility functions with unit tests
- api/ - NextJS API routes
- components/ - React components (wrappers in root, feature-specific in sub-folders)
- docs/ - Documentation for HighCharts and other libraries

## Highcharts

@apps/price-ui/docs/highcharts/overview.md

### Technical Indicators

The chart supports technical indicators via Highcharts' built-in indicators module. Currently implemented:

- **SMA (20-period)**: Simple Moving Average calculated from closing prices

**How indicators work with lazy-loaded data:**

When the user zooms/pans, we fetch extra historical data beyond the visible range to ensure proper indicator calculation. The `estimateDataInterval()` utility function determines the data granularity, then we fetch 20 extra periods before the visible start time. The xAxis `min`/`max` constrains what's displayed while the full data allows correct indicator values at the start of the visible range.
