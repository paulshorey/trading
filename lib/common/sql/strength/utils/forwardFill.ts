/**
 * Forward-Fill Utilities
 *
 * Functions for forward-filling missing interval values in strength data.
 * Forward-filling ensures that all interval columns have values by copying
 * from previous rows when current values are null.
 */

import { ALL_INTERVALS, FORWARD_FILL_DEPTH, StrengthInterval, IntervalValues } from "../constants";

/**
 * Row structure for forward-fill operations.
 * Uses the centralized IntervalValues type for consistency.
 */
export interface StrengthRow extends IntervalValues {
  id?: number;
  ticker: string;
  timenow: Date;
  average?: number | null;
  [key: string]: unknown;
}

/**
 * Forward-fill a single interval value by looking back through previous rows.
 *
 * @param rows - Array of rows sorted by timenow DESC (newest first)
 * @param interval - The interval column to forward-fill
 * @param rowIndex - The index of the row to fill (0 = newest)
 * @param maxDepth - Maximum number of rows to look back
 * @returns The filled value or null if no value found
 */
export function forwardFillInterval(rows: StrengthRow[], interval: StrengthInterval, rowIndex: number, maxDepth: number = FORWARD_FILL_DEPTH): number | null {
  // First check if the current row already has a value
  const currentValue = rows[rowIndex]?.[interval];
  if (currentValue !== null && currentValue !== undefined) {
    // Convert to number (PostgreSQL may return strings)
    return Number(currentValue);
  }

  // Look back through previous rows to find a value
  for (let i = rowIndex + 1; i < Math.min(rows.length, rowIndex + maxDepth + 1); i++) {
    const value = rows[i]?.[interval];
    if (value !== null && value !== undefined) {
      // Convert to number (PostgreSQL may return strings)
      return Number(value);
    }
  }

  return null;
}

/**
 * Forward-fill all interval values for a single row.
 *
 * @param rows - Array of rows sorted by timenow DESC (newest first)
 * @param rowIndex - The index of the row to fill (0 = newest)
 * @param maxDepth - Maximum number of rows to look back
 * @returns Object with filled interval values (all converted to numbers)
 */
export function forwardFillAllIntervals(
  rows: StrengthRow[],
  rowIndex: number = 0,
  maxDepth: number = FORWARD_FILL_DEPTH
): Record<StrengthInterval, number | null> {
  const filled: Record<string, number | null> = {};

  for (const interval of ALL_INTERVALS) {
    const value = forwardFillInterval(rows, interval, rowIndex, maxDepth);
    // Ensure value is a proper number or null
    filled[interval] = value !== null && !isNaN(value) ? value : null;
  }

  return filled as Record<StrengthInterval, number | null>;
}

/**
 * Identify which intervals need to be forward-filled (are currently null).
 *
 * @param row - The row to check
 * @returns Array of interval names that are null
 */
export function getMissingIntervals(row: StrengthRow): StrengthInterval[] {
  const missing: StrengthInterval[] = [];

  for (const interval of ALL_INTERVALS) {
    if (row[interval] === null || row[interval] === undefined) {
      missing.push(interval);
    }
  }

  return missing;
}

/**
 * Check if a row needs forward-filling (has any null interval values).
 *
 * @param row - The row to check
 * @returns true if any interval is null
 */
export function needsForwardFill(row: StrengthRow): boolean {
  return getMissingIntervals(row).length > 0;
}
