// Extracted/adapted from view-next: no global state, database imports, CSS zoom, or local-time ambiguity.
import {
  ColorType,
  TickMarkType,
  type DeepPartial,
  type ChartOptions,
  type Time,
} from "lightweight-charts";

// Slices of an ISO UTC timestamp ("2026-08-31T13:09:38") for each kind of axis tick, so a run
// spanning days or months labels its ticks with dates rather than only clock times.
const TICK: Record<TickMarkType, [number, number]> = {
  [TickMarkType.Year]: [0, 4],
  [TickMarkType.Month]: [0, 7],
  [TickMarkType.DayOfMonth]: [5, 10],
  [TickMarkType.Time]: [11, 16],
  [TickMarkType.TimeWithSeconds]: [11, 19],
};

export function getChartConfig(
  height: number,
  { seconds = false }: { seconds?: boolean } = {},
): DeepPartial<ChartOptions> {
  const iso = (time: Time) =>
    typeof time === "number"
      ? new Date(time * 1000).toISOString()
      : String(time);
  // The crosshair label always shows the date with the time.
  const format = (time: Time) =>
    iso(time)
      .slice(5, seconds ? 19 : 16)
      .replace("T", " ");
  const tick = (time: Time, type: TickMarkType) =>
    typeof time === "number" ? iso(time).slice(...TICK[type]) : String(time);
  return {
    height,
    autoSize: true,
    layout: {
      background: { type: ColorType.Solid, color: "#131b17" },
      textColor: "#98aa9e",
      attributionLogo: true,
    },
    grid: { vertLines: { visible: false }, horzLines: { color: "#223128" } },
    localization: { timeFormatter: format },
    rightPriceScale: { minimumWidth: 80, borderColor: "#2b3b30" },
    timeScale: {
      timeVisible: true,
      secondsVisible: seconds,
      borderColor: "#2b3b30",
      tickMarkFormatter: tick,
    },
    crosshair: {
      mode: 0,
      vertLine: { color: "#819986" },
      horzLine: { color: "#819986" },
    },
    handleScroll: true,
    handleScale: true,
  };
}
