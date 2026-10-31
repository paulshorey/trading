import { useEffect, useMemo, useState } from "react";
import {
  PriceChart,
  type ChartEvent,
  type ChartLevel,
  type ChartMarker,
} from "@lib/research-charts";
import { api, money, num, seconds, utc } from "@/api";
import type { FeatureSpec, Run, TradeWindow } from "@/types";

/** One trade in detail: one-second candles around it and the exact inputs at the decision. */
export function TradeInspector({ run, index }: { run: Run; index: number }) {
  const [window, setWindow] = useState<TradeWindow | null>(null);
  const [error, setError] = useState("");
  const trade = run.trades[index];
  useEffect(() => {
    setWindow(null);
    setError("");
    api<TradeWindow>(`runs/${run.id}/trades/${index}/bars`)
      .then(setWindow)
      .catch((e) => setError(String(e)));
  }, [run.id, index]);
  const marks = useMemo(() => {
    const long = trade.direction > 0;
    const markers: ChartMarker[] = [
      {
        time: seconds(trade.entry_ns),
        side: long ? "buy" : "sell",
        text: "entry",
      },
      {
        time: seconds(trade.exit_ns),
        side: long ? "sell" : "buy",
        text: trade.exit_reason,
      },
    ];
    const levels: ChartLevel[] = [
      { price: trade.entry_px, title: "entry", color: "#b5c7b9" },
      { price: trade.target_px, title: "target", color: "#8fe0aa" },
      { price: trade.stop_px, title: "stop", color: "#e49d87" },
    ];
    const events: ChartEvent[] = [
      {
        time: seconds(trade.signal_end_ns) - 1,
        label: "signal",
        color: "#dfc17b",
      },
    ];
    return { markers, levels, events };
  }, [trade]);
  const specs = new Map<string, FeatureSpec>(
    run.feature_specs.map((s) => [s.name, s]),
  );
  const groups = [
    ["Entry timing · 1m@1s", "1m@1s."],
    ["Bias · 1h@1m", "1h@1m."],
  ] as const;
  return (
    <section className="panel inspector">
      <div className="panel-title padded">
        <div>
          <h2>
            Trade {index + 1} · {trade.direction > 0 ? "long" : "short"}{" "}
            {trade.contract}
          </h2>
          <p className="hint">
            Signal second ended {utc(trade.signal_end_ns)} · decision{" "}
            {utc(trade.decision_ns)} · filled {utc(trade.entry_ns)} (
            {num(trade.entry_delay_ms, 0)} ms later) · exit {utc(trade.exit_ns)}{" "}
            · UTC
          </p>
        </div>
        <span className={trade.pnl_usd >= 0 ? "buy" : "sell"}>
          {num(trade.pnl_ticks, 1)} ticks · {money(trade.pnl_usd)}
        </span>
      </div>
      {error && <div className="error">{error}</div>}
      {window ? (
        <PriceChart bars={window.bars} {...marks} height={380} />
      ) : (
        !error && (
          <p className="hint padding">Rebuilding one-second bars from DBN…</p>
        )
      )}
      <div className="inspector-grid">
        <table>
          <tbody>
            {[
              ["Entry / exit", `${trade.entry_px} → ${trade.exit_px}`],
              ["Target / stop", `${trade.target_px} / ${trade.stop_px}`],
              ["R multiple", num(trade.r_multiple)],
              [
                "Best / worst excursion",
                `${num(trade.mfe_ticks, 1)} / ${num(trade.mae_ticks, 1)} ticks`,
              ],
              ["Held", `${num(trade.hold_s, 1)} s`],
              ["Commission", money(trade.commission_usd)],
              ["Flags", trade.flags.join(", ") || "none"],
            ].map(([k, v]) => (
              <tr key={k}>
                <td>{k}</td>
                <td>{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {groups.map(([title, prefix]) => (
          <table key={prefix}>
            <thead>
              <tr>
                <th>{title}</th>
                <th>Value</th>
                <th>Unit</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(trade.features)
                .filter(([name]) => name.startsWith(prefix))
                .map(([name, value]) => (
                  <tr key={name} title={specs.get(name)?.description}>
                    <td>{name.slice(prefix.length)}</td>
                    <td>{value === null ? "—" : value.toFixed(3)}</td>
                    <td>{specs.get(name)?.unit}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ))}
      </div>
      <p className="hint padding">
        Values are the exact normalized inputs the strategy saw at the decision;
        the same rows train models. Hover a name for its definition.
      </p>
    </section>
  );
}
