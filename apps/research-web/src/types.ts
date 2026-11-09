export interface CatalogDate {
  date: string;
  condition: string;
  present: boolean;
  contracts: string[];
}
export interface CatalogProduct {
  root: string;
  name: string;
  tick_size: number;
  tick_value: number;
  calendar: string;
  dates: CatalogDate[];
}
export interface Bracket {
  target_atr: number;
  stop_atr: number;
  max_hold_s: number;
}
export interface StrategyParams {
  bias_ret_atr: number;
  bias_rsi: number;
  trigger_rsi: number;
  trigger_delta: number;
  max_bias_age_s: number;
  use_bias: boolean;
  allow_short: boolean;
  bracket: Bracket;
}
export interface ExecutionParams {
  contracts: number;
  commission_per_contract: number;
  feed_latency_ms: number;
  close_delay_ms: number;
  order_latency_ms: number;
  limit_fill: "through" | "touch";
  depth_penalty_ticks: number;
  cooldown_s: number;
  flat_before_close_s: number;
}
export interface FeatureParams {
  rsi_period: number;
  atr_period: number;
  volume_period: number;
}
export interface RunSpec {
  product: string;
  start: string;
  end: string;
  contract: string | null;
  warmup_sessions: number | null; // null: the stored lead
  strategy: "bias_pullback";
  strategy_params: StrategyParams;
  execution: ExecutionParams;
  features: FeatureParams;
}
export interface Summary {
  trades: number;
  signal_rows: number;
  cancelled_orders: number;
  long: number;
  short: number;
  win_rate: number | null;
  net_usd: number;
  commission_usd: number;
  avg_ticks: number | null;
  avg_r: number | null;
  profit_factor: number | null;
  max_drawdown_usd: number;
  avg_hold_s: number | null;
  entry_delay_ms_p50: number | null;
  entry_delay_ms_p90: number | null;
  exit_reasons: Record<string, number>;
}
export interface Trade {
  contract: string;
  direction: number;
  contracts: number;
  signal_end_ns: string;
  decision_ns: string;
  entry_ns: string;
  exit_ns: string;
  entry_px: number;
  exit_px: number;
  target_px: number;
  stop_px: number;
  exit_reason: string;
  pnl_ticks: number;
  pnl_usd: number;
  commission_usd: number;
  r_multiple: number | null;
  mfe_ticks: number;
  mae_ticks: number;
  hold_s: number;
  entry_delay_ms: number;
  flags: string[];
  features: Record<string, number | null>;
}
export interface FeatureSpec {
  name: string;
  unit: string;
  description: string;
  stage?: string | null; // the stage that produced it; absent in older runs
}
export interface Candidates {
  rows: number;
  unfilled?: number;
  censored?: number;
  win_rate?: number;
  avg_usd?: number;
  avg_r?: number | null;
  entry_delay_ms_p50?: number;
  exit_reasons?: Record<string, number>;
}
export type Quality = Record<string, number | null>;
export interface RunSummary {
  id: string;
  created_at: string;
  spec: RunSpec;
  summary: Summary;
}
export interface Run extends RunSummary {
  trades: Trade[];
  equity: { exit_ns: string; value: number }[];
  candidates: Candidates;
  performance: {
    seconds_processed: number;
    elapsed_s: number;
    market_seconds_per_s: number | null;
  };
  quality: Record<string, Quality>;
  contracts: string[];
  feature_specs: FeatureSpec[];
  assumptions: string[];
  provenance: {
    strategy: { name: string; params: RunSpec["strategy_params"] };
    execution: ExecutionParams;
    features: FeatureParams;
    code_sha256: string;
    calendar: string;
    data_files: Record<string, { sha256: string; condition: string }>;
    packages: Record<string, string>;
  };
}
export interface TradeWindow {
  trade: Trade;
  bars: {
    time: number;
    open?: number;
    high?: number;
    low?: number;
    close?: number;
  }[];
}
