require("dotenv").config();

const express = require("express");
const cors = require("cors");
const { pool } = require("./lib/db");
const { getSchema } = require("./lib/schema");
const { getCandles, getDateRange } = require("./lib/candles");

const app = express();
const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

/**
 * Health Check
 */
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.status(200).json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: "connected",
    });
  } catch (error) {
    console.error("Health check failed:", error.message);
    res.status(503).json({
      status: "unhealthy",
      timestamp: new Date().toISOString(),
      database: "disconnected",
      error: error.message,
    });
  }
});

/**
 * Database Schema
 */
app.get("/tables", async (req, res) => {
  try {
    const schema = await getSchema();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      environment: process.env.RAILWAY_ENVIRONMENT_NAME || "local",
      database: schema,
    });
  } catch (error) {
    console.error("Error fetching schema:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch database schema",
      message: error.message,
    });
  }
});

// Default date range: 2010-01-01 to now
const DEFAULT_START_MS = new Date("2010-01-01").getTime();

/**
 * Historical Candles
 *
 * Query params:
 *   ticker - Ticker symbol (required)
 *   start  - Start timestamp in ms (default: 2010-01-01)
 *   end    - End timestamp in ms (default: now)
 *
 * Returns array of tuples: [timestamp_ms, open, high, low, close, volume]
 * Automatically selects the best timeframe based on date range.
 */
app.get("/historical/candles", async (req, res) => {
  try {
    const { start, end, ticker } = req.query;

    if (!ticker) {
      return res.status(400).json({
        error: "Missing required param: ticker",
      });
    }

    // Use defaults if not provided
    const startMs = start ? parseInt(start, 10) : DEFAULT_START_MS;
    const endMs = end ? parseInt(end, 10) : Date.now();

    if (isNaN(startMs) || isNaN(endMs)) {
      return res.status(400).json({
        error: "Invalid timestamps: start and end must be numbers (ms)",
      });
    }

    if (startMs >= endMs) {
      return res.status(400).json({
        error: "Invalid range: start must be less than end",
      });
    }

    const result = await getCandles(startMs, endMs, ticker);

    // Return just the data array for Highcharts compatibility
    // Include metadata in headers for debugging
    res.set("X-Timeframe", result.timeframe);
    res.set("X-Table", result.table);
    res.set("X-Count", result.count.toString());

    res.json(result.data);
  } catch (error) {
    console.error("Error fetching candles:", error);
    res.status(500).json({
      error: "Failed to fetch candle data",
      message: error.message || String(error),
    });
  }
});

/**
 * Historical Candles - Date Range
 * Returns the available date range for a ticker
 */
app.get("/historical/range", async (req, res) => {
  try {
    const { ticker } = req.query;

    if (!ticker) {
      return res.status(400).json({
        error: "Missing required param: ticker",
      });
    }

    const range = await getDateRange(ticker);

    if (!range) {
      return res.status(404).json({ error: "No data available for ticker" });
    }

    res.json(range);
  } catch (error) {
    console.error("Error fetching date range:", error.message);
    res.status(500).json({
      error: "Failed to fetch date range",
      message: error.message,
    });
  }
});

/**
 * Start Server
 */
app.listen(port, "::", () => {
  console.log(`🚀 Market Data API server running on port ${port}`);
  console.log(`   Environment: ${process.env.RAILWAY_ENVIRONMENT_NAME || "local"}`);
  console.log(`   Health: http://localhost:${port}/health`);
  console.log(`   Schema: http://localhost:${port}/tables`);
  console.log(`   Candles: http://localhost:${port}/historical/candles?start=...&end=...`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  await pool.end();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  await pool.end();
  process.exit(0);
});
