export type StrengthRowGet = {
  id: number;
  ticker: string;
  time: Date; // DateTime as ISO string
  timenow: Date; // DateTime as ISO string
  price: number;
  volume: number;
  "30S": number | null;
  "1": number | null;
  "2": number | null;
  "3": number | null;
  "4": number | null;
  "5": number | null;
  "6": number | null;
  "7": number | null;
  "9": number | null;
  "12": number | null;
  "24": number | null;
  "48": number | null;
  "60": number | null;
  "72": number | null;
  "90": number | null;
  server_name: string;
  app_name: string;
  node_env: string;
  created_at: Date; // DateTime as ISO string
};
export type StrengthRowAdd = {
  ticker: string;
  time: Date; // DateTime as ISO string
  timenow: Date; // DateTime as ISO string
  price?: number;
  volume?: number;
  "30S"?: number | null;
  "1"?: number | null;
  "2"?: number | null;
  "3"?: number | null;
  "4"?: number | null;
  "5"?: number | null;
  "6"?: number | null;
  "7"?: number | null;
  "9"?: number | null;
  "12"?: number | null;
  "24"?: number | null;
  "48"?: number | null;
  "60"?: number | null;
  "72"?: number | null;
  "90"?: number | null;
  server_name?: string;
  app_name?: string;
  node_env?: string;
  created_at?: Date; // DateTime as ISO string
};

export type StrengthDataAdd = {
  ticker: string | null;
  interval: string | null;
  time: Date | null;
  timenow: Date | null;
  price: number | null;
  volume: number | null;
  strength: number | null;
};
