import "dotenv/config";
import cors from "cors";
import express from "express";
import { formatResponse } from "./lib/http.js";
import { Router } from "express";
import { createGetTradingView } from "./api/v1/tradingview/get.js";
import { createPostTradingView } from "./api/v1/tradingview/post.js";
import { getStrengthRows, strengthAdd } from "./lib/strength.js";

export function createApp(options?: {
  getStrengthRows?: typeof getStrengthRows;
  strengthAdd?: typeof strengthAdd;
  sqlLogAdd?: typeof import("@lib/common/sql/log/add").sqlLogAdd;
}) {
  const getStrengthRowsFn = options?.getStrengthRows ?? getStrengthRows;
  const strengthAddFn = options?.strengthAdd ?? strengthAdd;
  const sqlLogAddFn = options?.sqlLogAdd;
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.text({ type: "*/*" }));

  app.get("/health", (_req, res) => {
    formatResponse(res, { ok: true });
  });

  const tradingViewRouter = Router();
  tradingViewRouter.get("/", createGetTradingView({ getStrengthRows: getStrengthRowsFn }));
  tradingViewRouter.post("/", createPostTradingView({ strengthAdd: strengthAddFn, ...(sqlLogAddFn && { sqlLogAdd: sqlLogAddFn }) }));
  app.use("/api/v1/tradingview", tradingViewRouter);

  return app;
}

// START - only when run directly, not when imported for tests
if (process.env.NODE_ENV !== "test") {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`TradingView API server running on port ${port}`);
  });
}
