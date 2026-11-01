// Extracted/adapted from view-next: no global state, database imports, CSS zoom, or local-time ambiguity.
import {
  ColorType,
  type DeepPartial,
  type ChartOptions,
  type Time,
} from "lightweight-charts";
export function getChartConfig(
  height: number,
  { seconds = false }: { seconds?: boolean } = {},
): DeepPartial<ChartOptions> {
  const format = (time: Time) =>
    typeof time === "number"
      ? new Date(time * 1000)
          .toISOString()
          .slice(seconds ? 11 : 5, seconds ? 19 : 16)
          .replace("T", " ")
      : String(time);
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
      tickMarkFormatter: format,
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
