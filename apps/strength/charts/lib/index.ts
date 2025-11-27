/**
 * Library exports for charts
 *
 * This barrel file provides clean imports for all chart utilities:
 * @example
 * import { StrengthApi, useAggregatedChartData, calculateTimeRange } from './lib'
 */

// API Service
export { StrengthApi, FetchStrengthData } from './strengthApi'
export type {
  FetchStrengthDataParams,
  FetchStrengthDataResult,
} from './strengthApi'

// Hooks
export { useRealtimeStrengthData } from './useRealtimeStrengthData'
export type {
  UseRealtimeStrengthDataOptions,
  UseRealtimeStrengthDataResult,
} from './useRealtimeStrengthData'

export { useAggregatedChartData } from './hooks/useAggregatedChartData'
export type {
  UseAggregatedChartDataOptions,
  UseAggregatedChartDataResult,
} from './hooks/useAggregatedChartData'

// Data Processing
export { aggregatePriceData } from './aggregatePriceData'
export { aggregateStrengthData } from './aggregateStrengthData'

// Interpolation Utilities
export {
  generateFutureTimestamps,
  forwardFillData,
  extractGlobalTimestamps,
  normalizeMultipleTickerData,
  aggregateStrengthDataWithInterpolation,
} from './interpolation'

// Time Range Utilities
export {
  calculateTimeRange,
  convertToChartData,
  getNearestSeriesValueAtTime,
} from './timeRangeUtils'

// Chart Configuration
export { getChartConfig, getLineSeriesConfig } from './chartConfig'

// Chart Scaling Fix
export { attachChartScalingFix } from './chartScalingFix'
