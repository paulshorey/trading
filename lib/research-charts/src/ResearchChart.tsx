import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  type UTCTimestamp,
} from "lightweight-charts";
import { getChartConfig } from "./chartConfig";
import { VerticalLinePrimitive } from "./VerticalLinePrimitive";

export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}
export interface ChartFill {
  time: number;
  quantity: number;
  price: number;
}
export interface ChartPoint {
  time: number;
  value: number;
}
export function ResearchChart({
  bars,
  fills,
  equity,
  haltTime,
}: {
  bars: ChartBar[];
  fills: ChartFill[];
  equity: ChartPoint[];
  haltTime?: number;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(container.current, getChartConfig(470));
    const price = chart.addSeries(CandlestickSeries, {
      upColor: "#8fe0aa",
      downColor: "#e49d87",
      wickUpColor: "#8fe0aa",
      wickDownColor: "#e49d87",
      borderVisible: false,
    });
    price.setData(bars.map((b) => ({ ...b, time: b.time as UTCTimestamp })));
    const balance = chart.addSeries(
      LineSeries,
      { color: "#dfc17b", lineWidth: 2, title: "Equity" },
      1,
    );
    balance.setData(
      equity.map((p) => ({ ...p, time: p.time as UTCTimestamp })),
    );
    createSeriesMarkers(
      price,
      fills.map((f) => ({
        time: f.time as UTCTimestamp,
        position: f.quantity > 0 ? "belowBar" : "aboveBar",
        color: f.quantity > 0 ? "#8fe0aa" : "#e49d87",
        shape: f.quantity > 0 ? "arrowUp" : "arrowDown",
        text: "",
      })),
    );
    if (haltTime)
      price.attachPrimitive(
        new VerticalLinePrimitive(haltTime as UTCTimestamp, {
          color: "#edb082",
          labelText: "Risk halt",
        }),
      );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, fills, equity, haltTime]);
  return (
    <div
      ref={container}
      style={{ height: 470, width: "100%" }}
      aria-label="Price candles, trade fills, and equity chart in UTC"
    />
  );
}
