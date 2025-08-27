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
      for (let fr0 of strengths) {
        rows.push({
          id: fr0.id,
          ticker: fr0.ticker,
          time: new Date(fr0.time),
          timenow: new Date(fr0.timenow),
          price: fr0.price,
          volume: fr0.volume,
          "30S": fr0["30S"],
          "1": fr0["1"],
          "2": fr0["2"],
          "3": fr0["3"],
          "4": fr0["4"],
          "5": fr0["5"],
          "6": fr0["6"],
          "7": fr0["7"],
          "9": fr0["9"],
          "12": fr0["12"],
          "24": fr0["24"],
          "48": fr0["48"],
          "60": fr0["60"],
          "72": fr0["72"],
          "90": fr0["90"],
          server_name: fr0.server_name || "",
          app_name: fr0.app_name || "",
          node_env: fr0.node_env || "",
          created_at: new Date(fr0.created_at),
        });
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
