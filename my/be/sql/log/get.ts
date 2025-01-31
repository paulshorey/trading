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
};

export const logGets = async function ({ where }: Props = {}): Promise<Output> {
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
        } else {
          whereArr.push(`${key}='${val?.replace(/'/g, "''")}'`);
        }
      }
    }
    if (whereArr.length) {
      whereSQL = "WHERE " + whereArr.join(" AND ");
    }
    const result = await sqlQuery(pool, `SELECT * FROM logs_v1 ${whereSQL} ORDER BY time DESC LIMIT 100`);
    output.ip = ip;
    output.result = result;
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
      cc.error("@my/be/sql/log/get Error", error);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(output.error);
    }
  }
  return output;
};
