/**
 * Data Layer Exports
 *
 * Centralized exports for all data fetching and processing functionality.
 */

// API
export { StrengthDataApi, FetchStrengthData } from './api'
export type { FetchStrengthDataParams, FetchStrengthDataResult } from './api'

// Hooks
export { useStrengthData, useRealtimeStrengthData } from './useStrengthData'
export type { UseStrengthDataOptions, UseStrengthDataResult } from './useStrengthData'

export { useAggregatedData } from './useAggregatedData'
export type { UseAggregatedDataOptions, UseAggregatedDataResult } from './useAggregatedData'

// Aggregation utilities
export {
  aggregateStrengthData,
  aggregatePriceData,
  forwardFillData,
  extractGlobalTimestamps,
  generateFutureTimestamps,
} from './aggregation'


