/**
 * Strength Data API Service
 *
 * Handles all API communication for fetching strength/price data.
 * Pure API calls with no state management.
 */

import { StrengthRowGet } from '@lib/common/sql/strength'
import { HOURS_BACK_INITIAL } from '../constants'

export interface FetchStrengthDataParams {
  ticker: string
  timenow_gt: Date
  timenow_lt?: Date
}

export interface FetchStrengthDataResult {
  rows: StrengthRowGet[] | null
  error: string | null
}

/**
 * Service for fetching strength data from the API
 */
export class StrengthDataApi {
  private static baseUrl = '/api/v1/strength'

  /**
   * Fetch strength data for a single ticker
   */
  static async fetchTickerData(
    params: FetchStrengthDataParams
  ): Promise<FetchStrengthDataResult> {
    try {
      const queryParams = new URLSearchParams()
      queryParams.append('ticker', params.ticker)
      queryParams.append('timenow_gt', params.timenow_gt.toISOString())
      if (params.timenow_lt) {
        queryParams.append('timenow_lt', params.timenow_lt.toISOString())
      }

      const response = await fetch(
        `${this.baseUrl}?${queryParams.toString()}`,
        { method: 'GET' }
      )
      const data = await response.json()

      if (data.error) {
        return { rows: null, error: data.error }
      }

      // Convert date strings back to Date objects
      let rows = data.rows
      if (rows && rows.length > 0) {
        rows = rows.map((row: any) => {
          const timenow = new Date(row.timenow)

          // Validate that timenow is at even minutes with no seconds
          const minutes = timenow.getMinutes()
          const seconds = timenow.getSeconds()
          const milliseconds = timenow.getMilliseconds()

          if (minutes % 2 !== 0 || seconds !== 0 || milliseconds !== 0) {
            console.warn('[StrengthDataApi] Invalid timestamp detected:', {
              ticker: params.ticker,
              timenow: timenow.toISOString(),
              minutes,
              seconds,
              milliseconds,
            })
          }

          return {
            ...row,
            timenow,
            created_at: new Date(row.created_at),
          }
        })

        // Ensure data is sorted in ascending order by timenow
        rows.sort(
          (a: StrengthRowGet, b: StrengthRowGet) =>
            a.timenow.getTime() - b.timenow.getTime()
        )
      }

      return { rows, error: null }
    } catch (err) {
      console.error(`Error fetching data for ${params.ticker}:`, err)
      return {
        rows: null,
        error: err instanceof Error ? err.message : 'Failed to fetch data',
      }
    }
  }

  /**
   * Fetch data for multiple tickers in parallel
   */
  static async fetchMultipleTickersData(
    tickers: string[],
    timenow_gt: Date,
    timenow_lt?: Date
  ): Promise<(StrengthRowGet[] | null)[]> {
    const promises = tickers.map((ticker) =>
      this.fetchTickerData({ ticker, timenow_gt, timenow_lt })
    )

    const results = await Promise.all(promises)
    return results.map((result) => result.rows)
  }

  /**
   * Prepare date for API query (rounded to even minute, no seconds)
   */
  static prepareDate(date: Date): Date {
    const prepared = new Date(date)
    prepared.setSeconds(0, 0)
    const minutes = prepared.getMinutes()
    if (minutes % 2 !== 0) {
      prepared.setMinutes(minutes - 1)
    }
    return prepared
  }

  /**
   * Get the date for initial data load
   */
  static getInitialDataDate(hoursBack: number = HOURS_BACK_INITIAL): Date {
    const date = new Date(Date.now() - hoursBack * 60 * 60 * 1000)
    return this.prepareDate(date)
  }

  /**
   * Merge new data with existing data, handling duplicates
   * Uses timenow as the unique key (should be even minutes, no seconds)
   */
  static mergeData(
    existingData: StrengthRowGet[],
    newData: StrengthRowGet[]
  ): StrengthRowGet[] {
    if (!newData || newData.length === 0) return existingData
    if (!existingData || existingData.length === 0) {
      return [...newData].sort(
        (a, b) => a.timenow.getTime() - b.timenow.getTime()
      )
    }

    // Create a map of existing data by timestamp
    const dataMap = new Map<number, StrengthRowGet>()

    existingData.forEach((item) => {
      dataMap.set(item.timenow.getTime(), item)
    })

    // Add or update with new data
    newData.forEach((item) => {
      dataMap.set(item.timenow.getTime(), item)
    })

    // Convert back to sorted array
    return Array.from(dataMap.values()).sort(
      (a, b) => a.timenow.getTime() - b.timenow.getTime()
    )
  }
}

// Alias for backwards compatibility
export const FetchStrengthData = StrengthDataApi


