import React from "react";
import type { CatalogProduct, RunSpec } from "@/types";

export const SAMPLE_SPEC: RunSpec = {
  product: "MGC",
  start: "2026-08-31",
  end: "2026-08-31",
  contract: "MGCZ6",
  warmup_sessions: 0,
  strategy: "bias_pullback",
  strategy_params: {
    bias_ret_atr: 0.3,
    bias_rsi: 50,
    trigger_rsi: 35,
    trigger_delta: 0.1,
    max_bias_age_s: 60,
    use_bias: true,
    allow_short: true,
    bracket: { target_atr: 1.5, stop_atr: 1.0, max_hold_s: 180 },
  },
  execution: {
    contracts: 1,
    commission_per_contract: 1.0,
    feed_latency_ms: 5,
    close_delay_ms: 100,
    order_latency_ms: 50,
    limit_fill: "through",
    depth_penalty_ticks: 1,
    cooldown_s: 10,
    flat_before_close_s: 300,
  },
  features: { rsi_period: 7, atr_period: 7, volume_period: 7 },
};

type Section = "strategy_params" | "execution" | "features";

export function RunForm({
  catalog,
  spec,
  setSpec,
  busy,
  onSubmit,
}: {
  catalog: CatalogProduct[];
  spec: RunSpec;
  setSpec: (spec: RunSpec) => void;
  busy: boolean;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const product = catalog.find((p) => p.root === spec.product);
  const dates = product?.dates.filter((d) => d.present) ?? [];
  const contracts = [...new Set(dates.flatMap((d) => d.contracts))];
  const set = (section: Section, key: string, value: unknown) =>
    setSpec({ ...spec, [section]: { ...spec[section], [key]: value } });
  const setBracket = (key: string, value: number) =>
    set("strategy_params", "bracket", {
      ...spec.strategy_params.bracket,
      [key]: value,
    });
  const field = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    step = 1,
    min = 0,
  ) => (
    <label>
      {label}
      <input
        type="number"
        required
        min={min}
        step={step}
        value={Number.isNaN(value) ? "" : value}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  );
  const s = spec.strategy_params;
  const x = spec.execution;
  // The automatic front month is chosen from the previous session's volume, so it needs at
  // least one warmup session.
  const withContract = (next: RunSpec, contract: string | null): RunSpec => ({
    ...next,
    contract,
    warmup_sessions:
      contract === null
        ? Math.max(1, next.warmup_sessions)
        : next.warmup_sessions,
  });
  function selectProduct(root: string) {
    const p = catalog.find((c) => c.root === root);
    const last = p?.dates.filter((d) => d.present).at(-1)?.date ?? spec.end;
    setSpec(
      withContract({ ...spec, product: root, start: last, end: last }, null),
    );
  }
  return (
    <form onSubmit={onSubmit}>
      <fieldset disabled={busy}>
        <div className="panel-title">
          <h2>Experiment setup</h2>
          <span>01</span>
        </div>
        <label>
          Product
          <select
            value={spec.product}
            onChange={(e) => selectProduct(e.target.value)}
          >
            {catalog.map((p) => (
              <option key={p.root} value={p.root}>
                {p.root} · {p.name} ({p.dates.length} days)
              </option>
            ))}
          </select>
        </label>
        <p className="hint">
          {product
            ? `$${product.tick_value} per ${product.tick_size} tick · ${product.calendar}`
            : "No TBBO files found under data/."}
        </p>
        <label>
          Contract
          <select
            value={spec.contract ?? ""}
            onChange={(e) =>
              setSpec(withContract(spec, e.target.value || null))
            }
          >
            <option value="">Front month (previous-session volume)</option>
            {contracts.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <div className="pair">
          <label>
            First session
            <input
              type="date"
              value={spec.start}
              onChange={(e) => setSpec({ ...spec, start: e.target.value })}
            />
          </label>
          <label>
            Last session
            <input
              type="date"
              value={spec.end}
              onChange={(e) => setSpec({ ...spec, end: e.target.value })}
            />
          </label>
        </div>
        {field("Warmup sessions", spec.warmup_sessions, (v) =>
          setSpec({ ...spec, warmup_sessions: v }),
        )}
        <div className="rule" />
        <h3>Bias · 1h@1m</h3>
        <label className="check">
          <input
            type="checkbox"
            checked={s.use_bias}
            onChange={(e) =>
              set("strategy_params", "use_bias", e.target.checked)
            }
          />{" "}
          Filter direction by hourly bias
        </label>
        <div className="pair">
          {field(
            "Min hourly move (ATR)",
            s.bias_ret_atr,
            (v) => set("strategy_params", "bias_ret_atr", v),
            0.05,
          )}
          {field(
            "Hourly RSI above",
            s.bias_rsi,
            (v) => set("strategy_params", "bias_rsi", v),
            1,
          )}
        </div>
        <h3>Entry timing · 1m@1s</h3>
        <div className="pair">
          {field(
            "Pullback RSI ≤",
            s.trigger_rsi,
            (v) => set("strategy_params", "trigger_rsi", v),
            1,
          )}
          {field(
            "Delta ratio ≥",
            s.trigger_delta,
            (v) => set("strategy_params", "trigger_delta", v),
            0.05,
            -1,
          )}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={s.allow_short}
            onChange={(e) =>
              set("strategy_params", "allow_short", e.target.checked)
            }
          />{" "}
          Allow shorts (mirrored thresholds)
        </label>
        <h3>Exit bracket · 1-minute ATR</h3>
        <div className="triple">
          {field(
            "Target",
            s.bracket.target_atr,
            (v) => setBracket("target_atr", v),
            0.1,
          )}
          {field(
            "Stop",
            s.bracket.stop_atr,
            (v) => setBracket("stop_atr", v),
            0.1,
          )}
          {field(
            "Max hold s",
            s.bracket.max_hold_s,
            (v) => setBracket("max_hold_s", v),
            1,
            1,
          )}
        </div>
        <details className="advanced">
          <summary>Execution and indicator settings</summary>
          <div className="pair">
            {field(
              "Contracts",
              x.contracts,
              (v) => set("execution", "contracts", v),
              1,
              1,
            )}
            {field(
              "Commission/side $",
              x.commission_per_contract,
              (v) => set("execution", "commission_per_contract", v),
              0.01,
            )}
          </div>
          <div className="triple">
            {field("Feed ms", x.feed_latency_ms, (v) =>
              set("execution", "feed_latency_ms", v),
            )}
            {field("Close delay ms", x.close_delay_ms, (v) =>
              set("execution", "close_delay_ms", v),
            )}
            {field("Order ms", x.order_latency_ms, (v) =>
              set("execution", "order_latency_ms", v),
            )}
          </div>
          <div className="triple">
            {field("Cooldown s", x.cooldown_s, (v) =>
              set("execution", "cooldown_s", v),
            )}
            {field("Flat before close s", x.flat_before_close_s, (v) =>
              set("execution", "flat_before_close_s", v),
            )}
            {field("Depth penalty ticks", x.depth_penalty_ticks, (v) =>
              set("execution", "depth_penalty_ticks", v),
            )}
          </div>
          <label>
            Target fill rule
            <select
              value={x.limit_fill}
              onChange={(e) => set("execution", "limit_fill", e.target.value)}
            >
              <option value="through">
                Trade through the limit (conservative)
              </option>
              <option value="touch">Trade at the limit</option>
            </select>
          </label>
          <div className="triple">
            {field(
              "RSI period",
              spec.features.rsi_period,
              (v) => set("features", "rsi_period", v),
              1,
              2,
            )}
            {field(
              "ATR period",
              spec.features.atr_period,
              (v) => set("features", "atr_period", v),
              1,
              2,
            )}
            {field(
              "Volume EMA",
              spec.features.volume_period,
              (v) => set("features", "volume_period", v),
              1,
              2,
            )}
          </div>
          <p className="hint">
            Periods count same-phase candles: 14 hourly periods need 15 hours of
            history.
          </p>
        </details>
        <button className="primary" disabled={busy || !dates.length}>
          {busy ? "Running backtest…" : "Run backtest"} <span>↗</span>
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => setSpec(SAMPLE_SPEC)}
        >
          Reset to the sample-day preset
        </button>
      </fieldset>
    </form>
  );
}
