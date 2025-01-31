export type OrderRow = {
  client_id: number;
  type: "MARKET" | "LIMIT" | "STOP_MARKET";
  ticker: string;
  side: "LONG" | "SHORT";
  size: number;
  price: number;
  server_name?: string;
  app_name?: string;
  node_env?: string;
  time?: EpochTimeStamp;
};
