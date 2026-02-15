import { Request, Response } from "express";
import { parseStrengthText } from "../../lib/strength/parse-text.js";
import { strengthAdd } from "../../lib/strength/add.js";

/**
 * POST /v1/tradingview
 *
 * Accepts TradingView webhook text body with strength data and saves to database.
 * Migrated from apps/trade/app/api/v1/market/route.ts (strength section).
 *
 * Expected body format (text/plain):
 *   ticker=ES interval=60 time=2024-01-01 strength=0.75 price=5000 volume=1000
 */
export async function strengthHandler(req: Request, res: Response): Promise<void> {
  try {
    // Parse text body
    const bodyText = typeof req.body === "string" ? req.body : JSON.stringify(req.body);

    const strengthData = parseStrengthText(bodyText);

    // Check if we have the required fields
    if (strengthData?.strength === undefined || strengthData?.interval === undefined || strengthData?.ticker === undefined) {
      res.status(400).json({
        ok: false,
        error: "Missing required fields: ticker, interval, strength",
      });
      return;
    }

    // Validate parsed data
    if (strengthData.strength === null || strengthData.interval === null || strengthData.ticker === null) {
      console.error("/v1/tradingview invalid strengthData", { bodyText });
      res.status(400).json({
        ok: false,
        error: "Invalid strengthData",
      });
      return;
    }

    // Save to database
    const result = await strengthAdd(strengthData);

    res.json({
      ok: true,
      message: "Strength data saved successfully",
      resultId: result?.id,
      data: strengthData,
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(`POST /v1/tradingview error: ${err.message}`, err.stack);
    res.status(400).json({
      ok: false,
      error: err.message,
    });
  }
}
