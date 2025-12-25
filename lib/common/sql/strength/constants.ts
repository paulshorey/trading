/**
 * Strength Interval Constants
 *
 * Central source of truth for all interval definitions.
 * All other files should import from here to ensure consistency.
 *
 * When adding or modifying intervals:
 * 1. Update the appropriate array below (OLD_INTERVALS, NEW_INTERVALS)
 * 2. Run database migration to add the new column if needed
 * 3. All types and mappings are auto-generated from these arrays
 */

// =============================================================================
// INTERVAL DEFINITIONS
// =============================================================================

/**
 * Legacy intervals (even numbers) - kept for backwards compatibility.
 * These columns exist in the database and must continue to be maintained.
 */
export const OLD_INTERVALS = ["2", "4", "12", "30", "60", "240"] as const;

/**
 * New intervals (prime-ish numbers) - current active intervals.
 * The app uses these for display and calculations.
 */
export const NEW_INTERVALS = ["30S", "1", "5", "7", "13", "19", "29", "59", "109", "181"] as const;

/**
 * All intervals combined - used by the library for database operations.
 * The library must maintain all columns regardless of which the app uses.
 */
export const ALL_INTERVALS = [...OLD_INTERVALS, ...NEW_INTERVALS] as const;

// =============================================================================
// DERIVED TYPES (auto-generated from arrays above)
// =============================================================================

/** Type for old interval column names */
export type OldInterval = (typeof OLD_INTERVALS)[number];

/** Type for new interval column names */
export type NewInterval = (typeof NEW_INTERVALS)[number];

/** Type for any valid interval column name */
export type StrengthInterval = (typeof ALL_INTERVALS)[number];

/**
 * Record type with all interval columns as nullable numbers.
 * Use this for objects that need all interval properties.
 */
export type IntervalValues = {
  [K in StrengthInterval]: number | null;
};

/**
 * Partial record type - useful for objects that may have only some intervals.
 */
export type PartialIntervalValues = Partial<IntervalValues>;

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

/**
 * Number of previous rows to check when forward-filling missing values.
 * Going back 3 rows ensures we have enough historical data without
 * excessive database queries.
 */
export const FORWARD_FILL_DEPTH = 3;

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Check if a string is a valid interval column name.
 */
export function isValidInterval(value: string): value is StrengthInterval {
  return (ALL_INTERVALS as readonly string[]).includes(value);
}

/**
 * Build interval values object from a database row.
 * Converts values to numbers (PostgreSQL may return strings).
 *
 * @param row - Database row with interval columns
 * @returns Object with interval values converted to numbers
 */
export function extractIntervalValues(row: Record<string, unknown>): IntervalValues {
  const values: Record<string, number | null> = {};

  for (const interval of ALL_INTERVALS) {
    const rawValue = row[interval];
    if (rawValue !== null && rawValue !== undefined) {
      const numValue = Number(rawValue);
      values[interval] = !isNaN(numValue) && isFinite(numValue) ? numValue : null;
    } else {
      values[interval] = null;
    }
  }

  return values as IntervalValues;
}
