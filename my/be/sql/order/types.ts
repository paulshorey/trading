export type OrderRow = {
  client_id: number;
  type: "MARKET" | "LIMIT" | "STOP_MARKET";
  ticker: string;
  side: "LONG" | "SHORT";
  size: number;
  price: number;
};
