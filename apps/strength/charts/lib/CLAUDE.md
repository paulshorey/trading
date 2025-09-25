# Files

charts/lib/aggregatePriceData.ts - filter and format line data from multiple tickers for Price chart
charts/lib/aggregateStrengthData.ts - filter and format line data from multiple tickers for Strength chart
charts/lib/aggregateDataUtils.ts - utilities for aggregatePriceData and aggregateStrengthData
charts/lib/chartConfig.ts - set up the chart options, axis, and inputs
charts/lib/chartSync.ts - works with SyncedCharts.tsx component to synchronize the x-axis and time range
charts/lib/chartUtils.ts - utilities for x-axis, converting, and formatting chart data
charts/lib/strengthDataService.ts - fetch strength/price data
charts/lib/urlSync.ts -
charts/lib/useRealtimeStrengthData.ts - polls for new data every minute
