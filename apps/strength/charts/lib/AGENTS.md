# Files

charts/lib/aggregatePriceData.ts - filter and format line data from multiple tickers for the price series (right y-axis)
charts/lib/aggregateStrengthData.ts - filter and format line data from multiple tickers for the strength series (left y-axis)
charts/lib/aggregateDataUtils.ts - utilities for aggregatePriceData and aggregateStrengthData
charts/lib/chartConfig.ts - set up the chart options, dual y-axes (left and right), and inputs
charts/lib/chartUtils.ts - utilities for x-axis, converting, and formatting chart data
charts/lib/strengthDataService.ts - fetch strength/price data
charts/lib/urlSync.ts - sync chart state with URL query parameters
charts/lib/useRealtimeStrengthData.ts - polls for new data every minute
