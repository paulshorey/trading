import { useEffect, useRef } from "react";
import { LineSeries, createChart, type UTCTimestamp } from "lightweight-charts";
import { getChartConfig } from "./chartConfig";

export interface ChartPoint {
  time: number;
  value: number;
}

/** Points must have strictly increasing times (UTC seconds). */
export function LineChart({
  points,
  height = 220,
  color = "#dfc17b",
  title,
}: {
  points: ChartPoint[];
  height?: number;
  color?: string;
  title?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const chart = createChart(
      container.current,
      getChartConfig(height, { seconds: true }),
    );
    const line = chart.addSeries(LineSeries, { color, lineWidth: 2, title });
    line.setData(points.map((p) => ({ ...p, time: p.time as UTCTimestamp })));
    // Fit every point, even thousands (the default keeps at least 0.5 px per point and so
    // shows only the latest part of a long run).
    chart.timeScale().applyOptions({ minBarSpacing: 0.001 });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [points, height, color, title]);
  return <div ref={container} style={{ height, width: "100%" }} />;
}
