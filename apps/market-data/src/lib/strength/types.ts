/**
 * Strength types - adapted from lib/common/sql/strength/types.ts
 */

/**
 * Input data structure for adding strength values.
 */
export type StrengthDataAdd = {
  ticker: string | null;
  interval: string | null;
  strength: number | null;
  price?: number | null;
  volume?: number | null;
};
