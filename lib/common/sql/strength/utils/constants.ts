/**
 * Strength Interval Constants
 *
 * Defines the interval columns used for strength calculations.
 * These columns store strength values at different time intervals.
 */

/**
 * All interval columns in the strength_v1 table.
 * Used for forward-filling and average calculations.
 */
export const STRENGTH_INTERVALS = ["30S", "3", "5", "7", "13", "19", "39", "59", "71", "101"] as const;

/**
 * Type for valid interval column names
 */
export type StrengthInterval = (typeof STRENGTH_INTERVALS)[number];

/**
 * Number of previous rows to check when forward-filling missing values.
 * Going back 3 rows ensures we have enough historical data without
 * excessive database queries.
 */
export const FORWARD_FILL_DEPTH = 3;
