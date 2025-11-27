/**
 * Chart Constants
 * Centralized magic numbers and configuration values
 */

// ============================================================================
// CHART DIMENSIONS
// ============================================================================

/** Initial chart width in pixels (used with 2x scaling) */
export const CHART_WIDTH_INITIAL = 2400

/** Default fallback width when window is not available */
export const CHART_WIDTH_FALLBACK = 1200

// ============================================================================
// DATA FETCHING
// ============================================================================

/** Maximum hours of historical data to fetch */
export const HOURS_BACK_INITIAL = 240

/** Real-time update polling interval in milliseconds (1 minute) */
export const REALTIME_UPDATE_INTERVAL_MS = 60000

// ============================================================================
// UI DIMENSIONS
// ============================================================================

/** Drawer width in pixels */
export const DRAWER_WIDTH = 360

/** Scale factor for 2x rendering (inverse of CSS zoom: 0.5) */
export const SCALE_FACTOR = 2
