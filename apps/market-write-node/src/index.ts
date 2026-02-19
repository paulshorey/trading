import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./lib/db.js";
import { startDatabentoStream, stopDatabentoStream } from "./stream/tbbo-stream.js";

const app = express();
const port = Number(process.env.PORT) || 8080;

app.use(cors());
app.use(express.json());
app.use(express.text());

// Routes
app.get("/health", (_req, res) => {
  res.json(true);
});

/**
 * Start Server
 */
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

app.listen(port, "::", () => {
  console.log(`🚀 Market Data API server running on port ${port}`);
  console.log(`   Environment: ${process.env.RAILWAY_ENVIRONMENT_NAME || "local"}`);

  // Start the Databento live stream after API server is ready
  // This loads CVD from database before processing any trades
  void startStreamWithRetry();
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  stopDatabentoStream(); // Stop stream and flush pending candles
  await pool.end();
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log("SIGINT received, shutting down gracefully...");
  stopDatabentoStream(); // Stop stream and flush pending candles
  await pool.end();
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("unhandledRejection:", reason);
});
