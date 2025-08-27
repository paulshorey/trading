"use server";

import { cc } from "../../cc";
import { StrengthRowGet } from "./types";
import { getDb } from "../../lib/neon";

type Output = {
  rows?: StrengthRowGet[];
  error?: {
    name: string;
    message: string;
    stack: string;
  };
};

type Props = {
  where?: {
    ticker?: string;
    interval?: string;
  };
  take?: number;
};

function avgFrNum(
  key: keyof StrengthRowGet,
  fr0: StrengthRowGet,
  fr1?: StrengthRowGet,
  fr2?: StrengthRowGet,
  fr3?: StrengthRowGet,
  fr4?: StrengthRowGet,
  fr5?: StrengthRowGet
): number {
  if (fr5?.[key]) {
    return (
      (Number(fr0[key]) + (Number(fr0[key]) + Number(fr1?.[key]) + Number(fr2?.[key]) + Number(fr3?.[key]) + Number(fr4?.[key]) + Number(fr5?.[key])) / 6) / 2
    );
  }
  if (fr4?.[key]) {
    return (Number(fr0[key]) + (Number(fr0[key]) + Number(fr1?.[key]) + Number(fr2?.[key]) + Number(fr3?.[key]) + Number(fr4?.[key])) / 5) / 2;
  }
  if (fr3?.[key]) {
    return (Number(fr0[key]) + (Number(fr0[key]) + Number(fr1?.[key]) + Number(fr2?.[key]) + Number(fr3?.[key])) / 4) / 2;
  }
  if (fr2?.[key]) {
    return (Number(fr0[key]) + (Number(fr0[key]) + Number(fr1?.[key]) + Number(fr2?.[key])) / 3) / 2;
  }
  if (fr1?.[key]) {
    return (Number(fr0[key]) + (Number(fr0[key]) + Number(fr1?.[key])) / 2) / 2;
  }
  return Number(fr0[key]);
}

export const strengthGets = async function ({ where }: Props = {}): Promise<Output> {
  "use server";

  const output = {} as Output;

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const client = await getDb().connect();
    try {
      let queryText = `
SELECT 
    id,
    ticker,
    "interval",
    "time",
    timenow,
    "30S",
    "1",
    "2",
    "3",
    "4",
    "5",
    "7",
    "9",
    price,
    volume,
    created_at
FROM (
    SELECT DISTINCT ON (timenow) *
    FROM strength_v1
    ORDER BY timenow DESC
) AS distinct_strengths
WHERE timenow >= $1
      `;
      const params: any[] = [twoDaysAgo];

      if (where?.ticker) {
        params.push(where.ticker);
        queryText += ` AND ticker = $${params.length}`;
      }
      if (where?.interval) {
        params.push(where.interval);
        queryText += ` AND interval = $${params.length}`;
      }

      queryText += " ORDER BY timenow DESC";
      const result = await client.query(queryText, params);
      const strengths = result.rows as StrengthRowGet[];

      /**
       * Save 1 avg value out of 3 minutes (3 rows). Discard the next 2 rows.
       * For 30S, save 1 avg value out of 3 minutes (6 rows). Discard next 5 rows.
       */
      const rows: StrengthRowGet[] = [];
      for (let index = 0; index < strengths.length; index++) {
        const fr0 = strengths[index] as StrengthRowGet;
        const fr1 = strengths[index + 1];
        const fr2 = strengths[index + 2];
        const fr3 = strengths[index + 3];
        const fr4 = strengths[index + 4];
        const fr5 = strengths[index + 5];
        rows.push({
          id: fr0.id,
          ticker: fr0.ticker,
          interval: fr0.interval,
          time: new Date(fr0.time),
          timenow: new Date(fr0.timenow),
          price: fr0.interval === "30S" ? avgFrNum("price", fr0, fr1) : avgFrNum("price", fr0),
          volume: fr0.interval === "30S" ? avgFrNum("volume", fr0, fr1) : avgFrNum("volume", fr0),
          "30S": fr0["30S"],
          "1": fr0["1"],
          "2": fr0["2"],
          "3": fr0["3"],
          "4": fr0["4"],
          "5": fr0["5"],
          "7": fr0["7"],
          "9": fr0["9"],
          // volume_strength: fr0.interval === "30S" ? avgFrNum("volume_strength", fr0, fr1, fr2, fr3, fr4, fr5) : avgFrNum("volume_strength", fr0, fr1, fr2),
          // price_strength: fr0.interval === "30S" ? avgFrNum("price_strength", fr0, fr1, fr2, fr3, fr4, fr5) : avgFrNum("price_strength", fr0, fr1, fr2),
          // price_volume_strength:
          //   fr0.interval === "30S" ? avgFrNum("price_volume_strength", fr0, fr1, fr2, fr3, fr4, fr5) : avgFrNum("price_volume_strength", fr0, fr1, fr2),
          // volume_strength_ma: avgFrNum("volume_strength", fr0, fr1, fr2, fr3, fr4, fr5),
          // price_strength_ma: avgFrNum("price_strength", fr0, fr1, fr2, fr3, fr4, fr5),
          // price_volume_strength_ma: avgFrNum("price_volume_strength", fr0, fr1, fr2, fr3, fr4, fr5),
          server_name: fr0.server_name || "",
          app_name: fr0.app_name || "",
          node_env: fr0.node_env || "",
          created_at: new Date(fr0.created_at),
        });
        // strengths.splice(index, 1);
        // strengths.splice(index, 1);
        if (fr0.interval === "30S") {
          strengths.splice(index, 1);
          // strengths.splice(index, 1);
          // strengths.splice(index, 1);
        }
      }

      output.rows = rows.reverse();
    } finally {
      client.release();
    }
  } catch (e: any) {
    try {
      const error = {
        name: "Error strength/gets.ts catch",
        message: e?.message?.toString(),
        stack: e?.stack?.toString(),
      };
      output.error = error;
      cc.error("sql/strength/gets Error", error);
    } catch (err: any) {
      console.error("sql/strength/gets Error", err);
    }
  }
  return output;
};
