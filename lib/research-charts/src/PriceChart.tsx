import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  LineStyle,
  createChart,
  createSeriesMarkers,
  type UTCTimestamp,
} from "lightweight-charts";
import { getChartConfig } from "./chartConfig";
import { VerticalLinePrimitive } from "./VerticalLinePrimitive";

/** A bar without prices is a slot with no trades; it keeps the time axis continuous. */
export interface ChartBar {
  time: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
}
export interface ChartMarker {
  time: number;
  side: "buy" | "sell";
  text: string;
}
export interface ChartLevel {
  price: number;
  title: string;
  color: string;
}
export interface ChartEvent {
  time: number;
  label: string;
  color: string;
}

export function PriceChart({
  bars,
  markers = [],
  levels = [],
  events = [],
  height = 420,
  seconds = true,
}: {
  bars: ChartBar[];
  markers?: ChartMarker[];
  levels?: ChartLevel[];
  events?: ChartEvent[];
  height?: number;
  seconds?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(
      container.current,
      getChartConfig(height, { seconds }),
    );
    const price = chart.addSeries(CandlestickSeries, {
      upColor: "#8fe0aa",
      downColor: "#e49d87",
      wickUpColor: "#8fe0aa",
      wickDownColor: "#e49d87",
      borderVisible: false,
    });
    price.setData(
      bars.map((b) =>
        b.close === undefined
          ? { time: b.time as UTCTimestamp }
          : {
              time: b.time as UTCTimestamp,
              open: b.open!,
              high: b.high!,
              low: b.low!,
              close: b.close,
            },
      ),
    );
    createSeriesMarkers(
      price,
      [...markers]
        .sort((a, b) => a.time - b.time)
        .map((m) => ({
          time: m.time as UTCTimestamp,
          position: m.side === "buy" ? "belowBar" : "aboveBar",
          color: m.side === "buy" ? "#8fe0aa" : "#e49d87",
          shape: m.side === "buy" ? "arrowUp" : "arrowDown",
          text: m.text,
        })),
    );
    for (const level of levels)
      price.createPriceLine({
        price: level.price,
        color: level.color,
        title: level.title,
        lineStyle: LineStyle.Dashed,
        lineWidth: 1,
        axisLabelVisible: true,
      });
    for (const event of events)
      price.attachPrimitive(
        new VerticalLinePrimitive(event.time as UTCTimestamp, {
          color: event.color,
          labelBackgroundColor: event.color,
          labelText: event.label,
          width: 1,
        }),
      );
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [bars, markers, levels, events, height, seconds]);
  return (
    <div
      ref={container}
      style={{ height, width: "100%" }}
      aria-label="One-second candles with trade markers and bracket levels, UTC"
    />
  );
}
