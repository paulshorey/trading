/**
 * Types for Web Worker communication
 *
 * These types are shared between the main thread and the worker.
 * We use plain objects (no Maps, no class instances) for serialization.
 */

import { LineData, Time } from 'lightweight-charts'

/**
 * Simplified row type for worker (serializable)
 * Dates are converted to ISO strings, Maps to plain objects
 */
export interface WorkerStrengthRow {
  id: number
  ticker: string
  timenow: string // ISO date string
  price: number
  volume: number
  average: number | null
  // Dynamic interval values
  [key: string]: string | number | null
}

/**
 * Worker's internal LineData (plain number for time)
 * This is serializable and gets converted to lightweight-charts LineData on receipt
 */
export interface WorkerLineData {
  time: number
  value: number
}

/**
 * Message sent TO the worker
 */
export interface AggregationWorkerRequest {
  type: 'aggregate'
  payload: {
    rawData: (WorkerStrengthRow[] | null)[]
    intervals: string[]
    tickers: string[]
    strengthIntervals: string[] // All possible intervals for iteration
  }
}

/**
 * Message received FROM the worker
 * Uses WorkerLineData internally, converted to LineData<Time> by the hook
 */
export interface AggregationWorkerResponse {
  type: 'result'
  payload: {
    strengthData: WorkerLineData[] | null
    priceData: WorkerLineData[] | null
    intervalStrengthData: Record<string, WorkerLineData[]>
    tickerPriceData: Record<string, WorkerLineData[]>
    processingTimeMs: number
  }
}

/**
 * Error response from worker
 */
export interface AggregationWorkerError {
  type: 'error'
  error: string
}

export type WorkerMessage =
  | AggregationWorkerResponse
  | AggregationWorkerError

