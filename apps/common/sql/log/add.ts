"use server";

import { LogRowAdd } from "./types";
import { prisma } from "../../lib/prisma";
import { getCurrentIpAddress } from "../../lib/nextjs/getCurrentIpAddress";
import { sendToMyselfSMS } from "../../twillio/sendToMyselfSMS";

/**
 * Inserts a log entry into the `logs_v1` table and sends an SMS for critical logs.
 *
 * This function is responsible for persisting log data. It takes a `LogRow` object
 * and inserts it into the database. It also includes logic to send an SMS notification
 * via `sendToMyselfSMS` if the log level is "error", "warn", or if the `sms` flag
 * is explicitly set in the `LogRow`.
 *
 * The function enriches the log data with the current IP address, server name, app
 * name, and Node.js environment before insertion.
 *
 * It includes a try-catch block to handle errors during the logging process itself.
 * If `sqlQuery` fails, it attempts to log the failure as a new error record.
 *
 * @param row - A `LogRow` object containing the log details.
 */
export const sqlLogAdd = async function (row: LogRowAdd) {
  "use server";

  // SMS
  if (row.sms || row.name === "error" || row.name === "warn") {
    if (process.env.NODE_ENV !== "development") {
      await sendToMyselfSMS(row.message);
    }
  }

  // DB
  const access_key = row.access_key;
  const node_env = process.env.NODE_ENV || "";
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  const addr = (await getCurrentIpAddress()) || {};

  try {
    await prisma.log.create({
      data: {
        name: row.name.toLowerCase(),
        message: row.message,
        stack: { ...row.stack, ...addr },
        access_key,
        server_name,
        app_name,
        node_env,
        category: row.category,
        tag: row.tag,
      },
    });
    // @ts-ignore
  } catch (e: Error) {
    try {
      const errorStack = {
        name: "Error",
        message: e?.message,
        stack: e?.stack,
      };
      const message = "Error in try sqlLogAdd.ts";
      await prisma.log.create({
        data: {
          name: "error",
          message,
          stack: errorStack,
          access_key,
          server_name,
          app_name,
          node_env,
          category: row.category,
          tag: row.tag,
        },
      });
      //@ts-ignore
    } catch (err: Error) {
      // Error sending
      console.error("Error in catch sqlLogAdd.ts", row, err);
    }
    return null;
  }
};
