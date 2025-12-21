import { IntervalValues } from "./constants";

/**
 * Row type returned from database GET operations.
 * Interval properties are auto-generated from the constants file.
 */
export type StrengthRowGet = {
  id: number;
  ticker: string;
  timenow: Date;
  price: number;
  volume: number;
  server_name: string;
  app_name: string;
  node_env: string;
  average: number | null;
  created_at: Date;
} & IntervalValues;

/**
 * Row type for ADD operations.
 * Uses Record<string, number | null> to allow dynamic interval assignment.
 */
export type StrengthRowAdd = {
  ticker: string;
  timenow: Date;
  price: number | null;
  volume: number | null;
  server_name?: string;
  app_name?: string;
  node_env?: string;
  created_at?: Date;
} & Record<string, number | null>;

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
