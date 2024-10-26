"use server";

import { LogsOptions } from "./types";
import { sqlQuery } from "../../sql/sqlQuery";
import { getCurrentIpAddress } from "../../nextjs/getCurrentIpAddress";
import { pool } from "../../sql/pool/events";

type LogType = "error" | "info" | "debug" | "warn" | "log" | "trade-error" | "trade-warn" | "trade-info" | "trade-debug" | "trade-log";

export const addLog = async function (type: LogType, message: string, logData: Record<string, any>, options: LogsOptions = {}) {
  "use server";

  const access_key = options.access_key;
  const dev = process.env.NODE_ENV === "development";
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  const addr = (await getCurrentIpAddress()) || {};
  const sql = "INSERT INTO v1.logs (name, message, stack, access_key, server_name, app_name, dev, time) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *";
  try {
    // Log
    const stack = JSON.stringify({ ...logData, ...addr }, null, " ");
    await sqlQuery(pool, sql, [type, message, stack, access_key, server_name, app_name, dev, Date.now()]);
    return stack;
    //@ts-ignore
  } catch (e: Error) {
    // Error
    try {
      const stack = JSON.stringify(
        {
          name: "Error",
          message: e.message,
          stack: e.stack,
        },
        null,
        " "
      );
      const message = "Error in try addLog.ts";
      await sqlQuery(pool, sql, ["Error", message, stack, access_key, server_name, app_name, dev, Date.now()]);
      //@ts-ignore
    } catch (err: Error) {
      // Error sending
      console.error("Error in catch addLog.ts", { logData, options, err });
    }
    return null;
  }
};
