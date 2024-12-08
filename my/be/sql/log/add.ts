"use server";

import { LogOptions, LogLevel } from "./types";
import { sqlQuery } from "../../sql/sqlQuery";
import { getCurrentIpAddress } from "../../nextjs/getCurrentIpAddress";
import { pool } from "../../sql/pool/events";
import { sendToMyselfSMS } from "../../twillio/sendToMyselfSMS";

export const logAdd = async function (level: LogLevel, message: string, logData: Record<string, any>, options: LogOptions = {}) {
  "use server";
  message = message.substring(0, 1000);
  if (options.sms) {
    await sendToMyselfSMS(message); //`${level}: ${message}`);
  }
  const access_key = options.access_key;
  const dev = process.env.NODE_ENV === "development";
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  const addr = (await getCurrentIpAddress()) || {};
  const sql =
    "INSERT INTO v1.logs (name, message, stack, access_key, server_name, app_name, dev, time, category, tag) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *";
  try {
    // Log
    const stack = JSON.stringify({ ...logData, ...addr }, null, " ");
    await sqlQuery(pool, sql, [level.toLowerCase(), message, stack, access_key, server_name, app_name, dev, Date.now(), options.category, options.tag]);
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
      const message = "Error in try logAdd.ts";
      await sqlQuery(pool, sql, ["Error", message, stack, access_key, server_name, app_name, dev, Date.now()]);
      //@ts-ignore
    } catch (err: Error) {
      // Error sending
      console.error("Error in catch logAdd.ts", { logData, options, err });
    }
    return null;
  }
};
