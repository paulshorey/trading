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
        const newRow = {
          id: fr0.id,
          ticker: fr0.ticker,
          timenow: new Date(fr0.timenow),
          price: fr0.price,
          volume: fr0.volume,
          server_name: fr0.server_name || "",
          app_name: fr0.app_name || "",
          node_env: fr0.node_env || "",
          created_at: new Date(fr0.created_at),
        } as StrengthRowGet;
        for (let key in fr0) {
          if (key === "30S" || !isNaN(Number(key))) {
            const value = fr0[key];
            if (value !== undefined) {
              newRow[key] = value;
            }
          }
        }
        rows.push(newRow);
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
