/**
 * Strength Utilities
 *
 * Exports all utility functions for strength data processing.
 * Constants and types are re-exported from the parent constants file.
 */

// Re-export constants and types from the centralized constants file
export {
  OLD_INTERVALS,
  NEW_INTERVALS,
  ALL_INTERVALS,
  FORWARD_FILL_DEPTH,
  isValidInterval,
  extractIntervalValues,
  type OldInterval,
  type NewInterval,
  type StrengthInterval,
  type IntervalValues,
  type PartialIntervalValues,
} from "../constants";

// Backwards compatibility alias (deprecated - use ALL_INTERVALS instead)
export { ALL_INTERVALS as STRENGTH_INTERVALS } from "../constants";

// Export forward-fill utilities
export {
  forwardFillInterval,
  forwardFillAllIntervals,
  getMissingIntervals,
  needsForwardFill,
  type StrengthRow,
} from "./forwardFill";

// Export average calculation utilities
export { calculateAverage, mergeAndCalculateAverage } from "./average";
