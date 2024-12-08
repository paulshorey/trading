"use server";

import { headers } from "next/headers";
import { sqlQuery } from "../sqlQuery";
import { pool } from "../pool/events";
import { cc } from "../../cc";

type Output = {
  ip?: string;
  result?: any;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
};

type Props = {
  where?: Record<string, string | string[]>;
  groupBy?: string;
  limit?: number;
};

export const logGets = async function ({ where, groupBy, limit }: Props = {}): Promise<Output> {
  "use server";

  const output = {} as Output;
  const headersList = headers();
  const ip = headersList.get("x-forwarded-for") || headersList.get("remote-addr") || "IP not available";

  try {
    let whereSQL = "";
    let whereArr = [];
    if (where) {
      for (let key in where) {
        let val = where[key];
        if (Array.isArray(val)) {
          whereArr.push(`${key} IN ('${val.join("','")}')`);
        } else if (!val) {
          whereArr.push(`${key} IS NOT NULL'`);
        } else {
          let op = "=";
          if (val[0] === ">") {
            op = ">=";
            val = val.substring(1, val.length);
            continue;
          } else if (val[0] === "<") {
            op = "<=";
            val = val.substring(1, val.length);
          } else if (val[0] === "!") {
            op = "!=";
            val = val.substring(1, val.length);
          }
          whereArr.push(`${key}${op}'${val?.replace(/'/g, "''")}'`);
        }
      }
    }
    let selectSQL = groupBy
      ? `WITH ranked_logs AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY ${groupBy} ORDER BY time DESC) AS rn
  FROM v1.logs
) SELECT * FROM ranked_logs`
      : `SELECT * FROM v1.logs`;
    if (whereArr.length || groupBy) {
      whereSQL = "WHERE " + (groupBy ? "rn = 1" : "") + (whereArr.length ? (groupBy ? " AND " : "") + whereArr.join(" AND ") : "");
    }
    try {
      const result = await sqlQuery(pool, `${selectSQL} ${whereSQL} ORDER BY time DESC LIMIT ${limit || 100}`);
      output.ip = ip;
      output.result = result.rows || [];
    } catch (e) {
      output.result = {
        name: "error",
        message: "SQL query failed. Probably because a requested column does not exist",
        trace: { table: "logs", where },
      };
    }
    //@ts-ignore
  } catch (e: Error) {
    try {
      const dev = process.env.NODE_ENV === "development";
      const error = {
        name: "Error lib/sql/logsGet.ts catch",
        message: e.message,
        stack: e.stack,
      };
      output.error = error;
      cc.error("@my/be/sql/log Error", error);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(output.error);
    }
  }
  return output;
};
