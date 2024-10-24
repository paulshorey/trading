"use server";

import { LogsData, LogsOptions } from "./types";
import { sqlQuery } from "../../sql/sqlQuery";
import { getCurrentIpAddress } from "../../nextjs/getCurrentIpAddress";
import { pool } from "../../sql/pool/events";

export const add = async function (logData: LogsData, options: LogsOptions = {}) {
  "use server";

  const type = options.type || "log";
  const access_key = options.access_key;
  const dev = process.env.NODE_ENV === "development";
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  const addr = (await getCurrentIpAddress()) || {};
  const sql = "INSERT INTO v1.logs (name, message, stack, access_key, server_name, app_name, dev, time) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *";
  try {
    // Log
    const stack = JSON.stringify({ ...logData, ...addr }, null, " ");
    const message = addr?.server_location || addr?.server_ip || "unknown server address";
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
      const message = "Error lib/sql/addLog.ts catch";
      await sqlQuery(pool, sql, [type, message, stack, access_key, server_name, app_name, dev, Date.now()]);
      //@ts-ignore
    } catch (err: Error) {
      // Error sending
      console.error("catch catch addLog.ts", { logData, options, err });
    }
    return null;
  }
};
