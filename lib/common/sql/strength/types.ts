export type StrengthRowGet = {
  id: number;
  ticker: string;
  timenow: Date; // DateTime as ISO string
  price: number;
  volume: number;
  server_name: string;
  app_name: string;
  node_env: string;
  // even
  "2": number | null;
  "4": number | null;
  "12": number | null;
  "30": number | null;
  "60": number | null;
  "240": number | null;
  // prime
  "30S": number | null;
  "1": number | null;
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
