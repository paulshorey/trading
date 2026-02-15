/**
 * Strength Interval Constants
 * Adapted from lib/common/sql/strength/constants.ts
 *
 * Central source of truth for all interval definitions.
 * When adding or modifying intervals, also update lib/common/sql/strength/constants.ts.
 */

/** Legacy intervals (even numbers) - kept for backwards compatibility. */
export const OLD_INTERVALS = ["2", "4", "12", "30", "60", "240"] as const;

/** New intervals (prime-ish numbers) - current active intervals. */
export const NEW_INTERVALS = ["1", "3", "5", "7", "13", "29", "59", "109", "181", "D", "W"] as const;

/** All intervals combined - used for database operations. */
export const ALL_INTERVALS = [...OLD_INTERVALS, ...NEW_INTERVALS] as const;

/** Type for any valid interval column name */
export type StrengthInterval = (typeof ALL_INTERVALS)[number];

/** Record type with all interval columns as nullable numbers. */
export type IntervalValues = {
  [K in StrengthInterval]: number | null;
};

/** Number of previous rows to check when forward-filling missing values. */
export const FORWARD_FILL_DEPTH = 5;

/**
 * Calculate the average of all interval values.
 * Only includes non-null values in the calculation.
 */
export function calculateAverage(intervalValues: Record<string, number | null>): number | null {
  let sum = 0;
  let count = 0;

  for (const interval of ALL_INTERVALS) {
    const rawValue = intervalValues[interval];
    const value = rawValue !== null && rawValue !== undefined ? Number(rawValue) : null;

    if (value !== null && !isNaN(value) && isFinite(value)) {
      sum += value;
      count++;
    }
  }

  if (count === 0) {
    return null;
  }

  return Math.round((sum / count) * 100) / 100;
}
