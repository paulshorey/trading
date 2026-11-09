import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { LineChart } from "@lib/research-charts";
import { api, money, num, pct, seconds, utc } from "@/api";
import { RunForm, SAMPLE_SPEC } from "@/RunForm";
import { TradeInspector } from "@/TradeInspector";
import type { CatalogProduct, Run, RunSpec, RunSummary } from "@/types";
import "@/style.css";

function App() {
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [spec, setSpec] = useState<RunSpec>(SAMPLE_SPEC);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<Run | null>(null);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(false);
  useEffect(() => {
    Promise.all([api<CatalogProduct[]>("catalog"), api<RunSummary[]>("runs")])
      .then(([products, history]) => {
        setCatalog(products);
        setRuns(history);
        setOnline(true);
      })
      .catch(() =>
        setError(
          "Cannot reach the research API. Start both apps with pnpm dev, then reload.",
        ),
      );
  }, []);
  async function execute(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<Run>("runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
      });
      setRun(result);
      setSelected(0);
      setRuns(await api<RunSummary[]>("runs"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function openRun(id: string) {
    setBusy(true);
    setError("");
    try {
      const result = await api<Run>(`runs/${id}`);
      setRun(result);
      setSelected(0);
      // The saved spec holds only what was set; provenance has every effective value.
      const { strategy, execution, features } = result.provenance;
      setSpec({
        ...result.spec,
        strategy_params: strategy.params,
        execution,
        features,
      });
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const equity = useMemo(() => {
    const points = new Map<number, number>();
    for (const p of run?.equity ?? []) points.set(seconds(p.exit_ns), p.value);
    return [...points].map(([time, value]) => ({ time, value }));
  }, [run]);
  const s = run?.summary;
  return (
    <div className="shell">
      <header>
        <a className="brand" href="/">
          ◫{" "}
          <span>
            TRADING<span className="brand-light"> / RESEARCH</span>
          </span>
        </a>
        <span className="status">
          <i className={online ? "online" : ""} />{" "}
          {online ? "Local research API" : "Connecting"}{" "}
          <span className="divider">/</span> Simulation only
        </span>
      </header>
      <div className="intro">
        <div>
          <p className="eyebrow">STRATEGY DEVELOPMENT · BACKTEST INSPECTOR</p>
          <h1>
            Strategy lab<span>.</span>
          </h1>
          <p className="muted">
            Hourly bias, one-second timing. Replay every second; inspect every
            decision.
          </p>
        </div>
        <span className="tag">DATABENTO TBBO · SAME ENGINE AS LIVE</span>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
      <main>
        <aside>
          <RunForm
            catalog={catalog}
            loaded={online}
            spec={spec}
            setSpec={setSpec}
            busy={busy}
            onSubmit={execute}
          />
        </aside>
        <section className="results">
          <div className="metrics six">
            {[
              ["Net P&L", s ? money(s.net_usd) : "—"],
              [
                "Trades · win rate",
                s ? `${s.trades} · ${pct(s.win_rate)}` : "—",
              ],
              [
                "Avg ticks · R",
                s ? `${num(s.avg_ticks, 1)} · ${num(s.avg_r)}` : "—",
              ],
              ["Profit factor", s ? num(s.profit_factor) : "—"],
              ["Max drawdown", s ? money(s.max_drawdown_usd) : "—"],
              [
                "Fill delay p50 · p90",
                s
                  ? `${num(s.entry_delay_ms_p50, 0)} · ${num(s.entry_delay_ms_p90, 0)} ms`
                  : "—",
              ],
            ].map(([label, value]) => (
              <div className="metric" key={label}>
                <p>{label}</p>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          {run ? (
            <>
              <div className="data-note">
                <span>RUN</span> {run.spec.product} {run.contracts.join(", ")} ·{" "}
                {run.spec.start} → {run.spec.end} ·{" "}
                {run.performance.seconds_processed.toLocaleString()} seconds in{" "}
                {run.performance.elapsed_s}s · {s!.signal_rows.toLocaleString()}{" "}
                signal seconds · exits{" "}
                {Object.entries(s!.exit_reasons)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(", ")}
                <a href={`/api/runs/${run.id}`} download={`${run.id}.json`}>
                  Export run JSON ↗
                </a>
              </div>
              <div className="bottom-grid">
                <section className="panel">
                  <div className="panel-title">
                    <h2>Equity · closed trades</h2>
                    <span>{money(s!.net_usd)}</span>
                  </div>
                  {equity.length > 1 ? (
                    <LineChart points={equity} height={230} title="Net $" />
                  ) : (
                    <p className="hint padding">
                      Needs at least two closed trades.
                    </p>
                  )}
                </section>
                <section className="panel">
                  <div className="panel-title">
                    <h2>Every signal as a would-be trade</h2>
                    <span>{run.candidates.rows}</span>
                  </div>
                  <div className="padding">
                    <p className="hint">
                      Each signal second is simulated on its own with the same
                      fills and bracket. These overlapping rows are the ML
                      training set: inputs at the decision, outcome after it.
                    </p>
                    <table>
                      <tbody>
                        <tr>
                          <td>Win rate</td>
                          <td>{pct(run.candidates.win_rate)}</td>
                        </tr>
                        <tr>
                          <td>Average outcome</td>
                          <td>
                            {run.candidates.avg_usd === undefined
                              ? "—"
                              : money(run.candidates.avg_usd)}
                          </td>
                        </tr>
                        <tr>
                          <td>Average R</td>
                          <td>{num(run.candidates.avg_r)}</td>
                        </tr>
                        <tr>
                          <td>Exits</td>
                          <td>
                            {Object.entries(run.candidates.exit_reasons ?? {})
                              .map(([k, v]) => `${k} ${v}`)
                              .join(", ") || "—"}
                          </td>
                        </tr>
                        <tr>
                          <td>Not closed</td>
                          <td>
                            {run.candidates.unfilled ?? 0} unfilled,{" "}
                            {run.candidates.censored ?? 0} open at session end
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
              <section className="panel spaced">
                <div className="panel-title padded">
                  <h2>Trades</h2>
                  <span>{run.trades.length}</span>
                </div>
                <div className="ledger">
                  {run.trades.length ? (
                    <table className="clickable">
                      <thead>
                        <tr>
                          {[
                            "#",
                            "Entry UTC",
                            "Side",
                            "Entry",
                            "Exit",
                            "Reason",
                            "Ticks",
                            "Net $",
                            "R",
                            "Held s",
                            "Fill ms",
                          ].map((h) => (
                            <th key={h}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {run.trades.map((t, i) => (
                          <tr
                            key={i}
                            className={i === selected ? "active" : ""}
                            onClick={() => setSelected(i)}
                          >
                            <td>{i + 1}</td>
                            <td>{utc(t.entry_ns)}</td>
                            <td className={t.direction > 0 ? "buy" : "sell"}>
                              {t.direction > 0 ? "LONG" : "SHORT"}
                            </td>
                            <td>{t.entry_px}</td>
                            <td>{t.exit_px}</td>
                            <td>{t.exit_reason}</td>
                            <td>{num(t.pnl_ticks, 1)}</td>
                            <td className={t.pnl_usd >= 0 ? "buy" : "sell"}>
                              {num(t.pnl_usd)}
                            </td>
                            <td>{num(t.r_multiple)}</td>
                            <td>{num(t.hold_s, 0)}</td>
                            <td>{num(t.entry_delay_ms, 0)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="hint padding">
                      No trades. Check the signal count above and the data
                      quality below: hourly indicators need history before the
                      bias is known.
                    </p>
                  )}
                </div>
              </section>
              {run.trades.length > 0 && (
                <TradeInspector run={run} index={selected} />
              )}
              <section className="panel spaced">
                <div className="panel-title padded">
                  <h2>Data quality by session</h2>
                  <span>{Object.keys(run.quality).length}</span>
                </div>
                <div className="ledger">
                  <table>
                    <thead>
                      <tr>
                        {[
                          "Session",
                          "Trades",
                          "Unknown side",
                          "Late",
                          "Outside schedule",
                          "Missing slots",
                          "Observed slots",
                          "Outside book",
                          "Bad flags",
                        ].map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(run.quality).map(([name, q]) => (
                        <tr key={name}>
                          <td>{name}</td>
                          <td>{q.trades?.toLocaleString()}</td>
                          <td>
                            {q.volume
                              ? pct((q.unknown_side_volume ?? 0) / q.volume)
                              : "—"}
                          </td>
                          <td>{q.late_trades}</td>
                          <td>{q.outside_schedule}</td>
                          <td>{q.missing_slots?.toLocaleString()}</td>
                          <td>{q.observed_slots?.toLocaleString()}</td>
                          <td>{q.raw_outside_pre_trade_book}</td>
                          <td>
                            {(q.raw_bad_ts_recv_flag ?? 0) +
                              (q.raw_maybe_bad_book_flag ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <details>
                <summary>Execution assumptions & provenance · {run.id}</summary>
                <ul>
                  {run.assumptions.map((a) => (
                    <li key={a}>{a}</li>
                  ))}
                </ul>
                <p>Calendar: {run.provenance.calendar}</p>
                <p>
                  Data:{" "}
                  {Object.entries(run.provenance.data_files)
                    .map(
                      ([n, f]) =>
                        `${n} (${f.condition}, ${f.sha256.slice(0, 12)})`,
                    )
                    .join("; ")}
                </p>
                <p>Code SHA-256: {run.provenance.code_sha256}</p>
                <p>
                  Packages:{" "}
                  {Object.entries(run.provenance.packages)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(", ")}
                </p>
              </details>
            </>
          ) : (
            <div className="chart-panel">
              <div className="empty">
                <div className="empty-graphic">▁ ▃ ▂ ▅ ▄ ▆ ▃ ▇</div>
                <h2>Your next experiment starts here.</h2>
                <p>
                  Run the sample-day preset, then open any trade to see the
                  second-by-second replay and the exact features behind the
                  decision.
                </p>
              </div>
            </div>
          )}
          <section className="panel spaced">
            <div className="panel-title padded">
              <h2>Run history</h2>
              <span>{runs.length.toString().padStart(2, "0")}</span>
            </div>
            {runs.length ? (
              <div className="history">
                {runs.slice(0, 20).map((r) => (
                  <button
                    disabled={busy}
                    key={r.id}
                    onClick={() => openRun(r.id)}
                    className={
                      run?.id === r.id ? "history-item active" : "history-item"
                    }
                  >
                    <span>
                      {r.spec.product} {r.spec.contract ?? "front"} ·{" "}
                      {r.spec.start} → {r.spec.end}
                      <small>
                        {r.summary.trades} trades · bias{" "}
                        {r.spec.strategy_params.use_bias === false
                          ? "off"
                          : "on"}{" "}
                        · {r.id.slice(0, 8)}
                      </small>
                    </span>
                    <b>{money(r.summary.net_usd)}</b>
                  </button>
                ))}
              </div>
            ) : (
              <p className="hint padding">Completed runs appear here.</p>
            )}
          </section>
        </section>
      </main>
      <footer>
        <span>RESEARCH FIRST. LIVE EXECUTION IS NOT CONNECTED.</span>
        <a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">
          Charts by TradingView
        </a>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
