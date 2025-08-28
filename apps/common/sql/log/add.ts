"use server";

import { LogRowAdd } from "./types";
import { getDb } from "../../lib/neon";
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

  console.log("common/sql/log/add.ts sqlLogAdd start", JSON.stringify(row, null, 2));
  try {
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
    let sqlQuery = "";
    let res = null;
    let values: any[] = [];

    const client = await getDb().connect();
    try {
      sqlQuery = `
      INSERT INTO logs_v1(name, message, stack, access_key, server_name, app_name, node_env, category, tag, time)
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`;
      values = [
        row.name.toLowerCase(),
        row.message,
        JSON.stringify({ ...row.stack, ...addr }),
        access_key,
        server_name,
        app_name,
        node_env,
        row.category,
        row.tag,
        new Date().toISOString(),
      ];
      res = await client.query(sqlQuery, values);
    } catch (e: any) {
      try {
        const errorStack = {
          name: "Error",
          message: e?.message,
          stack: e?.stack,
        };
        const message = "Error in try sqlLogAdd.ts";
        sqlQuery = `
        INSERT INTO logs_v1(name, message, stack, access_key, server_name, app_name, node_env, category, tag, time)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`;
        values = ["error", message, JSON.stringify(errorStack), access_key, server_name, app_name, node_env, row.category, row.tag, new Date().toISOString()];
        res = await client.query(sqlQuery, values);
      } catch (err: any) {
        // Error sending
        console.error("Error in catch sqlLogAdd.ts", row, err);
      }

      console.log("common/sql/log/add.ts sqlLogAdd after sqlQuery", {
        name: "log",
        message: `sqlLogAdd after sqlQuery`,
        stack: {
          resRows0: res?.rows[0],
          sqlQuery,
          values,
          row,
        },
      });

      return null;
    } finally {
      client.release();
    }
  } catch (e: any) {
    console.error("common/sql/log/add.ts sqlLogAdd error", row, e);
  }
};
