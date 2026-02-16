export type StrengthWhere = {
  ticker?: string;
  server_name?: string;
  app_name?: string;
  node_env?: string;
  timenow_gt?: string;
  timenow_lt?: string;
  limit?: number;
};

export type StrengthDataAdd = {
  ticker: string | null;
  interval: string | null;
  strength: number | null;
  price?: number | null;
  volume?: number | null;
};

export type StrengthInterval = "2" | "4" | "12" | "30" | "60" | "240" | "1" | "3" | "5" | "7" | "13" | "29" | "59" | "109" | "181" | "D" | "W";
export type StrengthRow = Record<string, unknown>;

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
} & Record<StrengthInterval, number | null>;
