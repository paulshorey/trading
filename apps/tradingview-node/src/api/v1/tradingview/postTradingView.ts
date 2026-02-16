import type { Request, Response } from "express";
import { sqlLogAdd as sqlLogAddReal } from "@lib/common/sql/log/add";
import { formatResponse } from "../../../lib/http.js";
import { parseStrengthText } from "../../../lib/strength.js";
import type { StrengthDataAdd } from "../../../types/strength.js";

type StrengthAdd = (data: StrengthDataAdd) => Promise<{ id: number }>;
type SqlLogAdd = typeof sqlLogAddReal;

export const createPostTradingView = (deps: { strengthAdd: StrengthAdd; sqlLogAdd?: SqlLogAdd }) => {
  const { strengthAdd, sqlLogAdd = sqlLogAddReal } = deps;
  return async (req: Request, res: Response) => {
  try {
    const bodyText = typeof req.body === "string" ? req.body : "";
    const strengthData = parseStrengthText(bodyText);

    if (strengthData?.strength === undefined || strengthData?.interval === undefined || strengthData?.ticker === undefined) {
      const ipContext = {
        getHeader: (name: string) => req.get(name) ?? undefined,
        ip: req.ip,
      };
      await sqlLogAdd(
        {
          name: "warn",
          message: "POST /api/v1/tradingview missing required fields: ticker, interval, strength",
          stack: {
            bodyText: bodyText.slice(0, 500),
          },
        },
        ipContext,
      );
      return formatResponse(
        res,
        {
          ok: false,
          error: "Missing required fields: ticker, interval, strength",
        },
        400,
      );
    }

    if (strengthData.strength === null || strengthData.interval === null || strengthData.ticker === null) {
      const ipContext = {
        getHeader: (name: string) => req.get(name) ?? undefined,
        ip: req.ip,
      };
      await sqlLogAdd(
        {
          name: "warn",
          message: "POST /api/v1/tradingview invalid strengthData payload",
          stack: {
            bodyText: bodyText.slice(0, 500),
          },
        },
        ipContext,
      );
      return formatResponse(
        res,
        {
          ok: false,
          error: "Invalid strengthData",
        },
        400,
      );
    }

    const result = await strengthAdd(strengthData);

    return formatResponse(res, {
      ok: true,
      message: "Strength data saved successfully",
      resultId: result?.id,
      data: strengthData,
    });
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    const ipContext = {
      getHeader: (name: string) => req.get(name) ?? undefined,
      ip: req.ip,
    };
    await sqlLogAdd(
      {
        name: "error",
        message: err.message,
        stack: {
          stack: err.stack,
        },
      },
      ipContext,
    );
    console.error("POST /api/v1/tradingview error:", err);
    return formatResponse(
      res,
      {
        ok: false,
        error: err.message,
      },
      400,
    );
  }
  };
};
