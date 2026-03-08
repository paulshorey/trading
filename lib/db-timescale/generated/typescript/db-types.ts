// AUTO-GENERATED FILE. DO NOT EDIT.
// Run: pnpm --filter @lib/db-timescale db:types:generate

export interface Candles1m1sRow {
  time: Date;
  ticker: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ask_volume: number;
  bid_volume: number;
  cvd_open: number | null;
  cvd_high: number | null;
  cvd_low: number | null;
  cvd_close: number | null;
  vd: number | null;
  trades: number | null;
  max_trade_size: number | null;
  big_trades: number | null;
  big_volume: number | null;
  symbol: string | null;
  vd_ratio: number | null;
  book_imbalance: number | null;
  price_pct: number | null;
  divergence: number | null;
  sum_bid_depth: number | null;
  sum_ask_depth: number | null;
  sum_price_volume: number | null;
  unknown_volume: number | null;
  vwap: number | null;
}

export interface Candles1h1mRow {
  time: Date;
  ticker: string;
  symbol: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ask_volume: number;
  bid_volume: number;
  cvd_open: number | null;
  cvd_high: number | null;
  cvd_low: number | null;
  cvd_close: number | null;
  vd: number | null;
  vd_ratio: number | null;
  book_imbalance: number | null;
  price_pct: number | null;
  divergence: number | null;
  trades: number | null;
  max_trade_size: number | null;
  big_trades: number | null;
  big_volume: number | null;
  sum_bid_depth: number | null;
  sum_ask_depth: number | null;
  sum_price_volume: number | null;
  unknown_volume: number | null;
}

export interface Candles1sRow {
  time: Date;
  ticker: string;
  symbol: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  cvd_open: number | null;
  cvd_high: number | null;
  cvd_low: number | null;
  cvd_close: number | null;
  vd: number | null;
  vd_ratio: number | null;
  book_imbalance: number | null;
  price_pct: number | null;
  trades: number | null;
  max_trade_size: number | null;
  big_trades: number | null;
  big_volume: number | null;
  divergence: number | null;
  ask_volume: number | null;
  bid_volume: number | null;
  sum_bid_depth: number | null;
  sum_ask_depth: number | null;
  sum_price_volume: number | null;
  unknown_volume: number | null;
  vwap: number | null;
}
