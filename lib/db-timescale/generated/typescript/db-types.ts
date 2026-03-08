// AUTO-GENERATED FILE. DO NOT EDIT.
// Run: pnpm --filter @lib/db-timescale db:types:generate

export interface Bbo1sRow {
  "time": Date;
  "ticker": string;
  "open": number | null;
  "high": number | null;
  "low": number | null;
  "close": number | null;
  "volume": number | null;
  "cvd": number | null;
}

export interface Candles1mRow {
  "time": Date;
  "ticker": string;
  "open": number;
  "high": number;
  "low": number;
  "close": number;
  "volume": number;
  "symbol": string | null;
  "vd": number | null;
  "cvd_open": number | null;
  "cvd_high": number | null;
  "cvd_low": number | null;
  "cvd_close": number | null;
  "vd_ratio": number | null;
  "book_imbalance": number | null;
  "price_pct": number | null;
  "trades": number | null;
  "max_trade_size": number | null;
  "big_trades": number | null;
  "big_volume": number | null;
  "divergence": number | null;
}

export interface Candles1h1mRow {
  "time": Date;
  "ticker": string;
  "symbol": string | null;
  "open": number;
  "high": number;
  "low": number;
  "close": number;
  "volume": number;
  "ask_volume": number;
  "bid_volume": number;
  "cvd_open": number | null;
  "cvd_high": number | null;
  "cvd_low": number | null;
  "cvd_close": number | null;
  "vd": number | null;
  "vd_ratio": number | null;
  "book_imbalance": number | null;
  "price_pct": number | null;
  "divergence": number | null;
  "trades": number;
  "max_trade_size": number;
  "big_trades": number;
  "big_volume": number;
  "sum_bid_depth": number;
  "sum_ask_depth": number;
  "sum_price_volume": number;
  "unknown_volume": number;
}

export interface Candles1m1sRow {
  "time": Date;
  "ticker": string;
  "open": number;
  "high": number;
  "low": number;
  "close": number;
  "volume": number;
  "ask_volume": number;
  "bid_volume": number;
  "cvd_open": number | null;
  "cvd_high": number | null;
  "cvd_low": number | null;
  "cvd_close": number | null;
  "vd": number | null;
  "trades": number;
  "max_trade_size": number;
  "big_trades": number;
  "big_volume": number;
  "symbol": string | null;
  "vd_ratio": number | null;
  "book_imbalance": number | null;
  "price_pct": number | null;
  "divergence": number | null;
  "sum_bid_depth": number;
  "sum_ask_depth": number;
  "sum_price_volume": number;
  "unknown_volume": number;
}

export interface Candles1sRow {
  "time": Date;
  "ticker": string;
  "symbol": string | null;
  "open": number;
  "high": number;
  "low": number;
  "close": number;
  "volume": number;
  "cvd_open": number | null;
  "cvd_high": number | null;
  "cvd_low": number | null;
  "cvd_close": number | null;
  "vd": number | null;
  "vd_ratio": number | null;
  "book_imbalance": number | null;
  "price_pct": number | null;
  "trades": number | null;
  "max_trade_size": number | null;
  "big_trades": number | null;
  "big_volume": number | null;
  "divergence": number | null;
  "ask_volume": number | null;
  "bid_volume": number | null;
  "sum_bid_depth": number | null;
  "sum_ask_depth": number | null;
  "sum_price_volume": number | null;
  "unknown_volume": number | null;
  "vwap": number | null;
}

export interface TimescaleDbSchema {
  "bbo-1s": Bbo1sRow;
  "candles-1m": Candles1mRow;
  "candles_1h_1m": Candles1h1mRow;
  "candles_1m_1s": Candles1m1sRow;
  "candles_1s": Candles1sRow;
}
