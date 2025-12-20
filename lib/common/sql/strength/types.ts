export type StrengthRowGet = {
  id: number;
  ticker: string;
  timenow: Date; // DateTime as ISO string
  price: number;
  volume: number;
  server_name: string;
  app_name: string;
  node_env: string;
  "30S": number | null;
  "3": number | null;
  "5": number | null;
  "7": number | null;
  "13": number | null;
  "19": number | null;
  "39": number | null;
  "59": number | null;
  "71": number | null;
  "101": number | null;
  average: number | null; // Average of all interval columns
  created_at: Date; // DateTime as ISO string
};

export type StrengthRowAdd = {
  ticker: string;
  timenow: Date; // DateTime as ISO string
  price: number | null;
  volume: number | null;
  server_name?: string;
  app_name?: string;
  node_env?: string;
  created_at?: Date; // DateTime as ISO string
} & Record<string, number | null>;

export type StrengthDataAdd = {
  ticker: string | null;
  interval: string | null;
  strength: number | null;
  price?: number | null;
  volume?: number | null;
};
