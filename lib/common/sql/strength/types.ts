export type StrengthRowGet = {
  id: number;
  ticker: string;
  timenow: Date; // DateTime as ISO string
  price: number;
  volume: number;
  server_name: string;
  app_name: string;
  node_env: string;
  time: number; // Added for UI consistency with other modules
  "1": number | null;
  "4": number | null;
  "12": number | null;
  "60": number | null;
  "240": number | null;
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
  time?: Date | null;
};
