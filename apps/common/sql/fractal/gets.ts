"use server";

import { cc } from "../../cc";
import { FractalRowGet } from "./types";
import { getDb } from "../../lib/neon";

type Output = {
  rows?: FractalRowGet[];
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
  key: keyof FractalRowGet,
  fr0: FractalRowGet,
  fr1?: FractalRowGet,
  fr2?: FractalRowGet,
  fr3?: FractalRowGet,
  fr4?: FractalRowGet,
  fr5?: FractalRowGet
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

export const fractalGets = async function ({ where }: Props = {}): Promise<Output> {
  "use server";

  const output = {} as Output;

  try {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const client = await getDb().connect();
    try {
      let queryText = `
        SELECT * FROM (
          SELECT DISTINCT ON (timenow) *
          FROM fractal_v1
          ORDER BY timenow DESC
        ) AS distinct_fractals
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
      console.log("queryText", queryText);
      const result = await client.query(queryText, params);
      console.log("result", result);
      const fractals = result.rows as FractalRowGet[];

      const rows: FractalRowGet[] = [];
      for (let index = 0; index < fractals.length; index++) {
        const fr0 = fractals[index] as FractalRowGet;
        const fr1 = fractals[index + 1];
        const fr2 = fractals[index + 2];
        const fr3 = fractals[index + 3];
        const fr4 = fractals[index + 4];
        const fr5 = fractals[index + 5];
        rows.push({
          id: fr0.id,
          ticker: fr0.ticker,
          interval: fr0.interval,
          time: new Date(fr0.time),
          timenow: new Date(fr0.timenow),
          close: Number(fr0.close),
          volume: Number(fr0.volume),
          average_strength: Number(fr0.average_strength),
          volume_strength: Number(fr0.volume_strength),
          price_strength: Number(fr0.price_strength),
          price_volume_strength: Number(fr0.price_volume_strength),
          volume_strength_ma: avgFrNum("volume_strength", fr0, fr1, fr2, fr3, fr4, fr5),
          price_strength_ma: avgFrNum("price_strength", fr0, fr1, fr2, fr3, fr4, fr5),
          price_volume_strength_ma: avgFrNum("price_volume_strength", fr0, fr1, fr2, fr3, fr4, fr5),
          server_name: fr0.server_name || "",
          app_name: fr0.app_name || "",
          node_env: fr0.node_env || "",
          created_at: new Date(fr0.created_at),
        });
        fractals.splice(index, 1);
        fractals.splice(index, 1);
        if (fr0.interval === "30S") {
          fractals.splice(index, 1);
          fractals.splice(index, 1);
          fractals.splice(index, 1);
        }
      }

      output.rows = rows.reverse();
    } finally {
      client.release();
    }
  } catch (e: any) {
    try {
      const error = {
        name: "Error fractal/gets.ts catch",
        message: e?.message?.toString(),
        stack: e?.stack?.toString(),
      };
      output.error = error;
      cc.error("sql/fractal/gets Error", error);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(e);
    }
  }
  return output;
};
