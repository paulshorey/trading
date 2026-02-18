import { IntervalValues } from "./constants";

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

export type StrengthDataAdd = {
  ticker: string | null;
  interval: string | null;
  strength: number | null;
  price?: number | null;
  volume?: number | null;
};
