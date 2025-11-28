/**
 * URL Synchronization Utilities for Zustand Store
 *
 * Provides two-way synchronization between Zustand store state and URL query parameters:
 *
 * 1. **URL → Store**: On page load, query parameters initialize store state
 * 2. **Store → URL**: Store changes update URL via history.replaceState()
 * 3. **Bookmarkable State**: URLs can be shared with specific chart configurations
 *
 * Usage:
 * - createURLStorage() creates a custom StateStorage adapter for Zustand persist middleware
 * - Only specified keys (URL_SYNC_KEYS) are synced with the URL
 * - Arrays and objects are JSON stringified/parsed automatically
 *
 * Example URL: /charts?hoursBack=24&interval=["12","30"]&tickers=["ETHUSD","BTCUSD"]
 */

import { StateStorage } from 'zustand/middleware'

/**
 * Parse URL query parameter value
 * Handles JSON arrays/objects and primitive types
 */
const parseQueryValue = (value: string | null): any => {
  if (!value) return null

  // Try to parse as JSON first (for arrays and objects)
  try {
    return JSON.parse(value)
  } catch {
    // If not JSON, handle primitives
    if (value === 'true') return true
    if (value === 'false') return false
    if (!isNaN(Number(value))) return Number(value)
    return value
  }
}

/**
 * Stringify value for URL query parameter
 */
const stringifyQueryValue = (value: any): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value)
  return JSON.stringify(value)
}

/**
 * Get all query parameters as an object
 */
export const getQueryParams = (): Record<string, any> => {
  if (typeof window === 'undefined') return {}

  const searchParams = new URLSearchParams(window.location.search)
  const params: Record<string, any> = {}

  searchParams.forEach((value, key) => {
    params[key] = parseQueryValue(value)
  })

  return params
}

/**
 * Update URL with new query parameters
 * Preserves existing params not in the update
 */
export const updateQueryParams = (updates: Record<string, any>) => {
  if (typeof window === 'undefined') return

  const searchParams = new URLSearchParams(window.location.search)

  Object.entries(updates).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      searchParams.delete(key)
    } else {
      searchParams.set(key, stringifyQueryValue(value))
    }
  })

  const newUrl = `${window.location.pathname}${
    searchParams.toString() ? '?' + searchParams.toString() : ''
  }`
  window.history.replaceState(null, '', newUrl)
}

/**
 * Create a URL storage adapter for Zustand persist middleware
 * Only syncs specified keys with URL query parameters
 */
export const createURLStorage = (syncKeys: string[]): StateStorage => {
  // Track if we're currently writing to prevent read-after-write issues
  let isWriting = false

  return {
    getItem: (name) => {
      if (typeof window === 'undefined') return null
      if (isWriting) return null

      const params = getQueryParams()
      const state: any = {}
      let hasData = false

      syncKeys.forEach((key) => {
        if (params[key] !== undefined) {
          state[key] = params[key]
          hasData = true
        }
      })

      if (!hasData) return null

      // Zustand expects format with state property
      return JSON.stringify({ state, version: 0 })
    },

    setItem: (name, value) => {
      if (typeof window === 'undefined') return

      isWriting = true

      try {
        const { state } = JSON.parse(value)
        const updates: Record<string, any> = {}

        syncKeys.forEach((key) => {
          if (state[key] !== undefined) {
            updates[key] = state[key]
          }
        })

        updateQueryParams(updates)
      } catch (e) {
        console.error('Failed to sync state to URL:', e)
      } finally {
        setTimeout(() => {
          isWriting = false
        }, 10)
      }
    },

    removeItem: (name) => {
      if (typeof window === 'undefined') return

      const searchParams = new URLSearchParams(window.location.search)
      syncKeys.forEach((key) => searchParams.delete(key))

      const newUrl = `${window.location.pathname}${
        searchParams.toString() ? '?' + searchParams.toString() : ''
      }`
      window.history.replaceState(null, '', newUrl)
    },
  }
}


