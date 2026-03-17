interface QueryResultLike<Row> {
  rows: Row[];
}

interface Queryable {
  query: <Row = unknown>(text: string, values?: unknown[]) => Promise<QueryResultLike<Row>>;
}

export interface PipelineStreamStatus {
  connected: boolean;
  authenticated: boolean;
  streaming: boolean;
  reconnectAttempts: number;
}

export interface PipelineStreamStats {
  marketOpen: boolean;
  marketOpenByTicker: Record<string, boolean>;
  messagesReceived?: number;
  parseErrors?: number;
  skippedMarketClosed?: number;
}

interface TickerLagRow {
  ticker: string;
  latest_source_time: Date | string | null;
  latest_source_row_count: number | string;
  latest_target_time: Date | string | null;
}

export interface TickerPipelineHealth {
  ticker: string;
  marketOpen: boolean;
  status: "ok" | "warming_up" | "stale" | "market_closed" | "waiting_for_source";
  latestSourceTime: string | null;
  latestTargetTime: string | null;
  latestSourceRowCount: number;
  lagMinutes: number | null;
}

export interface WritePipelineHealthReport {
  ok: boolean;
  status: "ok" | "warming_up" | "unhealthy";
  checkedAt: string;
  reasons: string[];
  stream: PipelineStreamStatus & {
    marketOpen: boolean;
    marketOpenByTicker: Record<string, boolean>;
    messagesReceived: number | null;
    parseErrors: number | null;
    skippedMarketClosed: number | null;
    startupGraceActive: boolean;
    processUptimeSeconds: number;
  };
  lag: {
    maxAllowedLagMinutes: number;
    tickers: TickerPipelineHealth[];
    staleTickers: string[];
    warmingUpTickers: string[];
  };
}

export interface WritePipelineHealthOptions {
  queryable: Queryable;
  streamStatus: PipelineStreamStatus;
  streamStats: PipelineStreamStats;
  now?: Date;
  maxAllowedLagMinutes?: number;
  processUptimeMs?: number;
  startupGraceMs?: number;
}

const HEALTH_LAG_QUERY = `
  WITH source_ranked AS (
    SELECT
      ticker,
      time,
      ROW_NUMBER() OVER (PARTITION BY ticker ORDER BY time DESC) AS rn
    FROM candles_1m_1s
    WHERE time = date_trunc('minute', time)
  ),
  source_summary AS (
    SELECT
      ticker,
      MAX(time) FILTER (WHERE rn = 1) AS latest_source_time,
      COUNT(*) FILTER (WHERE rn <= 60) AS latest_source_row_count
    FROM source_ranked
    GROUP BY ticker
  ),
  target_summary AS (
    SELECT DISTINCT ON (ticker)
      ticker,
      time AS latest_target_time
    FROM candles_1h_1m
    ORDER BY ticker ASC, time DESC
  )
  SELECT
    COALESCE(source_summary.ticker, target_summary.ticker) AS ticker,
    source_summary.latest_source_time,
    COALESCE(source_summary.latest_source_row_count, 0) AS latest_source_row_count,
    target_summary.latest_target_time
  FROM source_summary
  FULL OUTER JOIN target_summary
    ON target_summary.ticker = source_summary.ticker
  ORDER BY ticker ASC
`;

function toIsoString(value: Date | string | null): string | null {
  if (value === null) {
    return null;
  }
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toMs(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  return new Date(value).getTime();
}

function evaluateTickerHealth(
  row: TickerLagRow | null,
  marketOpen: boolean,
  maxAllowedLagMinutes: number,
): TickerPipelineHealth {
  const latestSourceTime = toIsoString(row?.latest_source_time ?? null);
  const latestTargetTime = toIsoString(row?.latest_target_time ?? null);
  const latestSourceRowCount = row ? Number(row.latest_source_row_count) || 0 : 0;
  const lagMinutes =
    latestSourceTime && latestTargetTime
      ? Math.max(0, Math.round((new Date(latestSourceTime).getTime() - new Date(latestTargetTime).getTime()) / 60_000))
      : null;

  if (!marketOpen) {
    return {
      ticker: row?.ticker ?? "__unknown__",
      marketOpen,
      status: "market_closed",
      latestSourceTime,
      latestTargetTime,
      latestSourceRowCount,
      lagMinutes,
    };
  }

  if (latestSourceTime === null) {
    return {
      ticker: row?.ticker ?? "__unknown__",
      marketOpen,
      status: "waiting_for_source",
      latestSourceTime,
      latestTargetTime,
      latestSourceRowCount,
      lagMinutes,
    };
  }

  if (latestTargetTime === null) {
    return {
      ticker: row?.ticker ?? "__unknown__",
      marketOpen,
      status: latestSourceRowCount < 60 ? "warming_up" : "stale",
      latestSourceTime,
      latestTargetTime,
      latestSourceRowCount,
      lagMinutes,
    };
  }

  const sourceMs = toMs(latestSourceTime);
  const targetMs = toMs(latestTargetTime);
  const lagExceeded = sourceMs !== null && targetMs !== null && sourceMs - targetMs > maxAllowedLagMinutes * 60_000;

  return {
    ticker: row?.ticker ?? "__unknown__",
    marketOpen,
    status: lagExceeded ? "stale" : "ok",
    latestSourceTime,
    latestTargetTime,
    latestSourceRowCount,
    lagMinutes,
  };
}

export async function getWritePipelineHealth({
  queryable,
  streamStatus,
  streamStats,
  now = new Date(),
  maxAllowedLagMinutes = 2,
  processUptimeMs = 0,
  startupGraceMs = 120_000,
}: WritePipelineHealthOptions): Promise<WritePipelineHealthReport> {
  const result = await queryable.query<TickerLagRow>(HEALTH_LAG_QUERY);
  const rowsByTicker = new Map(result.rows.map((row) => [row.ticker, row]));
  const tickers = new Set<string>([...Object.keys(streamStats.marketOpenByTicker), ...rowsByTicker.keys()]);

  const tickerHealth = [...tickers]
    .sort((a, b) => a.localeCompare(b))
    .map((ticker) => {
      const base = evaluateTickerHealth(rowsByTicker.get(ticker) ?? { ticker, latest_source_time: null, latest_source_row_count: 0, latest_target_time: null }, streamStats.marketOpenByTicker[ticker] ?? false, maxAllowedLagMinutes);
      return {
        ...base,
        ticker,
      };
    });

  const staleTickers = tickerHealth.filter((ticker) => ticker.status === "stale").map((ticker) => ticker.ticker);
  const warmingUpTickers = tickerHealth.filter((ticker) => ticker.status === "warming_up").map((ticker) => ticker.ticker);
  const reasons: string[] = [];
  const startupGraceActive = processUptimeMs < startupGraceMs;

  if (streamStats.marketOpen && !startupGraceActive && (!streamStatus.connected || !streamStatus.authenticated || !streamStatus.streaming)) {
    reasons.push(
      `market is open but stream is not fully ready (connected=${streamStatus.connected}, authenticated=${streamStatus.authenticated}, streaming=${streamStatus.streaming})`,
    );
  }
  if (staleTickers.length > 0) {
    reasons.push(`candles_1h_1m is stale for: ${staleTickers.join(", ")}`);
  }

  const ok = reasons.length === 0;
  const status: WritePipelineHealthReport["status"] =
    ok && (warmingUpTickers.length > 0 || (streamStats.marketOpen && startupGraceActive)) ? "warming_up" : ok ? "ok" : "unhealthy";

  return {
    ok,
    status,
    checkedAt: now.toISOString(),
    reasons,
    stream: {
      ...streamStatus,
      marketOpen: streamStats.marketOpen,
      marketOpenByTicker: streamStats.marketOpenByTicker,
      messagesReceived: streamStats.messagesReceived ?? null,
      parseErrors: streamStats.parseErrors ?? null,
      skippedMarketClosed: streamStats.skippedMarketClosed ?? null,
      startupGraceActive,
      processUptimeSeconds: Math.round(processUptimeMs / 1000),
    },
    lag: {
      maxAllowedLagMinutes,
      tickers: tickerHealth,
      staleTickers,
      warmingUpTickers,
    },
  };
}
