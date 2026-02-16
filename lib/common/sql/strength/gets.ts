"use server";

import { headers } from "next/headers";
import { getDb } from "../../lib/db/neon";
import { cc } from "../../cc";
import { StrengthRowGet } from "./types";
import { extractIntervalValues } from "./constants";

type Output = {
  ip?: string;
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
    server_name?: string;
    app_name?: string;
    node_env?: string;
    limit?: number;
    timenow_gt?: Date | string; // Greater than or equal to (on or after)
    timenow_lt?: Date | string; // Less than (before)
  };
};

/**
 * This utility function fetches data from the tradingview_v1 table, allowing the component calling it to specify parameters for WHERE to filter the results.
 *
 * Supports date range filtering on timenow column:
 * - timenow_gt: Get records on or after this date (>=)
 * - timenow_lt: Get records before this date (<) - used for lazy loading historical data
 *
 * Date parameters accept Date objects or ISO string timestamps.
 */
export const strengthGets = async function ({ where }: Props = {}): Promise<Output> {
  "use server";

  const output = {} as Output;
  const headersList = headers();
  const ip = headersList.get("x-forwarded-for") || headersList.get("remote-addr") || "IP not available";

  const client = await getDb().connect();
  try {
    let queryText = "SELECT * FROM tradingview_v1";
    const params: any[] = [];
    const whereClauses: string[] = [];

    if (where?.ticker) {
      params.push(where.ticker);
      whereClauses.push(`ticker = $${params.length}`);
    }
    if (where?.server_name) {
      params.push(where.server_name);
      whereClauses.push(`server_name = $${params.length}`);
    }
    if (where?.app_name) {
      params.push(where.app_name);
      whereClauses.push(`app_name = $${params.length}`);
    }
    if (where?.node_env) {
      params.push(where.node_env);
      whereClauses.push(`node_env = $${params.length}`);
    }

    // Starting time (on or after)
    if (where?.timenow_gt) {
      params.push(where.timenow_gt);
      whereClauses.push(`timenow >= $${params.length}`);
    }

    // Ending time (before) - used for lazy loading historical data
    if (where?.timenow_lt) {
      params.push(where.timenow_lt);
      whereClauses.push(`timenow < $${params.length}`);
    }

    if (whereClauses.length > 0) {
      queryText += ` WHERE ${whereClauses.join(" AND ")}`;
    }

    queryText += " ORDER BY timenow DESC";
    params.push(where?.limit || 10000);
    queryText += ` LIMIT $${params.length}`;

    const result = await client.query(queryText, params);
    const strengths = result.rows;

    // Convert database results to StrengthRowGet format
    // Interval values are extracted dynamically using the centralized utility
    const rows = strengths.map((strength) => ({
      id: strength.id,
      ticker: strength.ticker,
      timenow: new Date(strength.timenow),
      price: Number(strength.price),
      volume: Number(strength.volume),
      server_name: strength.server_name || "",
      app_name: strength.app_name || "",
      node_env: strength.node_env || "",
      created_at: new Date(strength.created_at),
      average: strength.average !== null ? Number(strength.average) : null,
      // Extract all interval values dynamically from constants
      ...extractIntervalValues(strength),
    })) as StrengthRowGet[];

    output.ip = ip;
    output.rows = rows;
    //@ts-ignore - this Error type is correct
  } catch (e: any) {
    try {
      const error = {
        name: "Error lib/sql/strengthGets.ts catch",
        message: e?.message?.toString(),
        stack: e?.stack?.toString(),
      };
      output.error = error;
      cc.error("sql/strength/gets Error", error);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(e);
    }
  } finally {
    client.release();
  }
  return output;
};
