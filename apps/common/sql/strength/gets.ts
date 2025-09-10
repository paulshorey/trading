"use server";

import { headers } from "next/headers";
import { getDb } from "../../lib/db/neon";
import { cc } from "../../cc";
import { StrengthRowGet } from "./types";

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
  };
};

/**
 * This utility function fetches data from the strength_v1 table, allowing the component calling it to specify parameters for WHERE to filter the results.
 *
 * Supports date range filtering on timenow column:
 * - timenow_gt: Get records on or after this date
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
    let queryText = "SELECT * FROM strength_v1";
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

    // Starting time
    if (where?.timenow_gt) {
      params.push(where.timenow_gt);
      whereClauses.push(`timenow >= $${params.length}`);
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
    // Note: Adding 'time' field for consistency with other modules' UI display
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
      "15S": strength["15S"] !== null ? Number(strength["15S"]) : null,
      "2": strength["2"] !== null ? Number(strength["2"]) : null,
      "3": strength["3"] !== null ? Number(strength["3"]) : null,
      "7": strength["7"] !== null ? Number(strength["7"]) : null,
      "44": strength["44"] !== null ? Number(strength["44"]) : null,
      "59": strength["59"] !== null ? Number(strength["59"]) : null,
      "180": strength["180"] !== null ? Number(strength["180"]) : null,
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
