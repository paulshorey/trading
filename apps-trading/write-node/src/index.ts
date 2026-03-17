import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./lib/db.js";
import { getWritePipelineHealth } from "./lib/health/write-pipeline-health.js";
import { getStreamStats, getStreamStatus, startDatabentoStream, stopDatabentoStream } from "./stream/tbbo-stream.js";

const app = express();
const port = Number(process.env.PORT) || 8080;
const maxAllowedLagMinutes = Number(process.env.HOURLY_HEALTH_MAX_LAG_MINUTES || "2");
const healthAlertIntervalMs = Number(process.env.WRITE_PIPELINE_HEALTH_ALERT_INTERVAL_MS || "60000");
const healthStartupGraceMs = Number(process.env.WRITE_PIPELINE_HEALTH_STARTUP_GRACE_MS || "120000");
let shuttingDown = false;
let healthMonitorTimer: NodeJS.Timeout | null = null;
let lastHealthSnapshot = "";

app.use(cors());

async function buildWritePipelineHealth() {
  return getWritePipelineHealth({
    queryable: pool,
    streamStatus: getStreamStatus(),
    streamStats: getStreamStats(),
    maxAllowedLagMinutes,
    processUptimeMs: process.uptime() * 1000,
    startupGraceMs: healthStartupGraceMs,
  });
}

async function checkWritePipelineHealthAndLog(): Promise<void> {
  try {
    const report = await buildWritePipelineHealth();
    const snapshot = `${report.status}|${report.reasons.join("||")}|${report.lag.staleTickers.join(",")}|${report.lag.warmingUpTickers.join(",")}`;

    if (snapshot === lastHealthSnapshot) {
      return;
    }

    if (!report.ok) {
      console.warn(
        `⚠️ Write pipeline unhealthy: ${report.reasons.join(" | ")} ` +
          `(stale: ${report.lag.staleTickers.join(", ") || "none"})`,
      );
    } else if (report.status === "warming_up") {
      const warmingUpDetails =
        report.lag.warmingUpTickers.length > 0
          ? `hourly candles for: ${report.lag.warmingUpTickers.join(", ")}`
          : `stream startup grace active (${report.stream.processUptimeSeconds}s uptime)`;
      console.log(`⏳ Write pipeline warming up ${warmingUpDetails}`);
    } else if (lastHealthSnapshot !== "") {
      console.log("✅ Write pipeline health recovered");
    }

    lastHealthSnapshot = snapshot;
  } catch (error) {
    const snapshot = "error";
    if (snapshot === lastHealthSnapshot) {
      return;
    }
    console.error("❌ Write pipeline health check failed:", error);
    lastHealthSnapshot = snapshot;
  }
}

app.get("/api/v1/health", async (_req, res) => {
  try {
    const report = await buildWritePipelineHealth();
    res.status(report.ok ? 200 : 503).json(report);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(503).json({
      ok: false,
      status: "unhealthy",
      checkedAt: new Date().toISOString(),
      reasons: [`health check failed: ${message}`],
    });
  }
});

const startStreamWithRetry = async () => {
  try {
    await startDatabentoStream();
  } catch (error) {
    console.error("Failed to start Databento stream, retrying in 5s:", error);
    const retryTimer = setTimeout(() => {
      void startStreamWithRetry();
    }, 60_000); // Don't reconnect more than once per minute.
    retryTimer.unref();
  }
};

const server = app.listen(port, "::", () => {
  console.log(`🚀 Market write pipeline running on port ${port}`);
  console.log(`   Environment: ${process.env.RAILWAY_ENVIRONMENT_NAME || "local"}`);
  if (healthMonitorTimer) {
    clearInterval(healthMonitorTimer);
  }
  healthMonitorTimer = setInterval(() => {
    void checkWritePipelineHealthAndLog();
  }, healthAlertIntervalMs);
  healthMonitorTimer.unref();
  void checkWritePipelineHealthAndLog();
  void startStreamWithRetry();
});

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);

  server.close();
  if (healthMonitorTimer) {
    clearInterval(healthMonitorTimer);
    healthMonitorTimer = null;
  }
  await stopDatabentoStream();
  await pool.end();
  process.exit(0);
};

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
