/**
 * TimeRangeHighlight - A custom primitive for shading time ranges on lightweight-charts
 *
 * Based on the official TradingView session-highlighting plugin:
 * https://github.com/tradingview/lightweight-charts/tree/master/plugin-examples/src/plugins/session-highlighting
 *
 * This implementation draws semi-transparent rectangles between specified time ranges
 * to highlight periods like market hours, overnight sessions, etc.
 */

import {
  IChartApi,
  ISeriesApi,
  ISeriesPrimitive,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  Time,
  Coordinate,
  SeriesType,
  SeriesAttachedParameter,
  PrimitivePaneViewZOrder,
} from 'lightweight-charts'

// Type for the canvas rendering target
interface CanvasRenderingTarget2D {
  useBitmapCoordinateSpace: (
    callback: (scope: {
      context: CanvasRenderingContext2D
      bitmapSize: { width: number; height: number }
      horizontalPixelRatio: number
      verticalPixelRatio: number
    }) => void
  ) => void
}

export interface TimeRangeConfig {
  /** Unique identifier for the range */
  id: string
  /** Start time in UTC */
  startUtcHour: number
  startUtcMinute: number
  /** End time in UTC */
  endUtcHour: number
  endUtcMinute: number
  /** Background color (should include alpha for transparency) */
  color: string
}

interface RangeData {
  x1: Coordinate | null
  x2: Coordinate | null
  color: string
}

/**
 * Renderer - handles the actual canvas drawing
 */
class TimeRangeHighlightRenderer implements IPrimitivePaneRenderer {
  private _ranges: RangeData[]

  constructor(ranges: RangeData[]) {
    this._ranges = ranges
  }

  draw(target: CanvasRenderingTarget2D): void {
    target.useBitmapCoordinateSpace((scope) => {
      const ctx = scope.context
      const height = scope.bitmapSize.height

      this._ranges.forEach((range) => {
        if (range.x1 === null || range.x2 === null) return

        const x1Scaled = Math.round(range.x1 * scope.horizontalPixelRatio)
        const x2Scaled = Math.round(range.x2 * scope.horizontalPixelRatio)

        // Ensure x1 < x2
        const xStart = Math.min(x1Scaled, x2Scaled)
        const xEnd = Math.max(x1Scaled, x2Scaled)

        // Skip if completely off screen
        if (xEnd < 0 || xStart > scope.bitmapSize.width) return

        // Clamp to visible area
        const x1Clamped = Math.max(0, xStart)
        const x2Clamped = Math.min(scope.bitmapSize.width, xEnd)

        ctx.fillStyle = range.color
        ctx.fillRect(x1Clamped, 0, x2Clamped - x1Clamped, height)
      })
    })
  }
}

interface ViewData {
  ranges: RangeData[]
}

/**
 * PaneView - manages the renderer and updates coordinates
 */
class TimeRangeHighlightPaneView implements IPrimitivePaneView {
  private _source: TimeRangeHighlightPrimitive
  private _data: ViewData

  constructor(source: TimeRangeHighlightPrimitive) {
    this._source = source
    this._data = { ranges: [] }
  }

  update(): void {
    const chart = this._source.chart
    if (!chart) {
      this._data.ranges = []
      return
    }

    const timeScale = chart.timeScale()
    this._data.ranges = this._source.rangeTimestamps.map((range) => ({
      x1: timeScale.timeToCoordinate(range.startTime as Time),
      x2: timeScale.timeToCoordinate(range.endTime as Time),
      color: range.color,
    }))
  }

  renderer(): IPrimitivePaneRenderer {
    return new TimeRangeHighlightRenderer(this._data.ranges)
  }

  zOrder(): PrimitivePaneViewZOrder {
    return 'bottom'
  }
}

interface RangeTimestamp {
  startTime: number
  endTime: number
  color: string
}

/**
 * TimeRangeHighlightPrimitive - Main primitive class that attaches to a series
 */
export class TimeRangeHighlightPrimitive implements ISeriesPrimitive<Time> {
  private _chart: IChartApi | null = null
  private _series: ISeriesApi<SeriesType> | null = null
  private _configs: TimeRangeConfig[]
  private _paneViews: TimeRangeHighlightPaneView[]
  private _rangeTimestamps: RangeTimestamp[] = []
  private _dataStartTime: number = 0
  private _dataEndTime: number = 0

  constructor(configs: TimeRangeConfig[]) {
    this._configs = configs
    this._paneViews = [new TimeRangeHighlightPaneView(this)]
  }

  // Public getters
  get chart(): IChartApi | null {
    return this._chart
  }

  get rangeTimestamps(): RangeTimestamp[] {
    return this._rangeTimestamps
  }

  // Called when primitive is attached to a series
  attached(param: SeriesAttachedParameter<Time>): void {
    this._chart = param.chart
    this._series = param.series
  }

  // Called when primitive is detached
  detached(): void {
    this._chart = null
    this._series = null
  }

  // Called to update all views before rendering
  updateAllViews(): void {
    this._paneViews.forEach((pw) => pw.update())
  }

  // Returns the pane views for rendering
  paneViews(): readonly IPrimitivePaneView[] {
    return this._paneViews
  }

  /**
   * Set the data range and calculate all time range occurrences
   */
  setDataRange(dataStartTime: number, dataEndTime: number): void {
    this._dataStartTime = dataStartTime
    this._dataEndTime = dataEndTime
    this._calculateRangeTimestamps()
    this.updateAllViews()
  }

  /**
   * Calculate all occurrences of the time ranges within the data range
   */
  private _calculateRangeTimestamps(): void {
    this._rangeTimestamps = []

    if (this._dataStartTime === 0 || this._dataEndTime === 0) return

    const startDate = new Date(this._dataStartTime * 1000)
    const endDate = new Date(this._dataEndTime * 1000)

    this._configs.forEach((config) => {
      // Start from the beginning of the data range
      const currentDate = new Date(
        Date.UTC(
          startDate.getUTCFullYear(),
          startDate.getUTCMonth(),
          startDate.getUTCDate(),
          config.startUtcHour,
          config.startUtcMinute,
          0,
          0
        )
      )

      // If start time is before data start, move to next occurrence
      if (currentDate.getTime() < startDate.getTime()) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1)
      }

      // Find all occurrences within the data range
      while (currentDate.getTime() <= endDate.getTime()) {
        const rangeStart = Math.floor(currentDate.getTime() / 1000)

        // Calculate end time
        let endHour = config.endUtcHour
        let endMinute = config.endUtcMinute
        let dayOffset = 0

        // Handle ranges that cross midnight
        if (
          config.endUtcHour < config.startUtcHour ||
          (config.endUtcHour === config.startUtcHour &&
            config.endUtcMinute < config.startUtcMinute)
        ) {
          dayOffset = 1
        }

        const rangeEndDate = new Date(
          Date.UTC(
            currentDate.getUTCFullYear(),
            currentDate.getUTCMonth(),
            currentDate.getUTCDate() + dayOffset,
            endHour,
            endMinute,
            0,
            0
          )
        )
        const rangeEnd = Math.floor(rangeEndDate.getTime() / 1000)

        this._rangeTimestamps.push({
          startTime: rangeStart,
          endTime: rangeEnd,
          color: config.color,
        })

        // Move to next day
        currentDate.setUTCDate(currentDate.getUTCDate() + 1)
      }
    })
  }

  /**
   * Update configs dynamically
   */
  setConfigs(configs: TimeRangeConfig[]): void {
    this._configs = configs
    this._calculateRangeTimestamps()
    this.updateAllViews()
  }
}
