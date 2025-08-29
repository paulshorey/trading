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
  // Debug logging with timestamp
  const timestamp = new Date().toISOString();
  // DB
  const access_key = row.access_key ?? "";
  const node_env = process.env.NODE_ENV ?? "";
  const server_name = process.env.SERVER_NAME ?? "";
  const app_name = process.env.APP_NAME ?? "";
  const addr = {}; //(await getCurrentIpAddress()) ?? {};
  let sqlQuery = "";
  let res = null;
  let values: any[] = [];
  let client = null;

  try {
    // SMS notification (uncomment when needed)
    // if (row.sms || row.name === "error" || row.name === "warn") {
    //   if (process.env.NODE_ENV !== "development") {
    //     await sendToMyselfSMS(row.message);
    //   }
    // }

    client = await getDb().connect();

    // Build and execute query
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
      row.category || null,
      row.tag || null,
      new Date().toISOString(),
    ];
    res = await client.query(sqlQuery, values);

    // Return the inserted row
    return res?.rows[0] || null;
  } catch (error: any) {
    console.error(`[${timestamp}] sqlLogAdd ERROR`, {
      error: {
        message: error?.message,
        stack: error?.stack,
        code: error?.code,
      },
      row,
    });

    // Try to log the error to the database
    if (client) {
      try {
        const errorStack = {
          originalError: {
            message: error?.message,
            stack: error?.stack,
            code: error?.code,
          },
          originalRow: row,
        };

        const errorQuery = `
          INSERT INTO logs_v1(name, message, stack, access_key, server_name, app_name, node_env, category, tag, time)
          VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING *`;

        const errorValues = [
          "error",
          `sqlLogAdd failed: ${error?.message || "Unknown error"}`,
          JSON.stringify(errorStack),
          access_key,
          server_name,
          app_name,
          node_env,
          "system_error",
          "sqlLogAdd",
          new Date().toISOString(),
        ];

        await client.query(errorQuery, errorValues);
      } catch (secondaryError: any) {
        console.error(`[${timestamp}] sqlLogAdd CRITICAL - Failed to log error to DB`, {
          primaryError: error?.message,
          secondaryError: secondaryError?.message,
        });
      }
    }

    // Return null to indicate failure
    return null;
  } finally {
    // Always release the client connection if it exists
    if (client) {
      try {
        client.release();
      } catch (releaseError: any) {
        console.error(`[${timestamp}] sqlLogAdd failed to release connection`, {
          error: releaseError?.message,
        });
      }
    }
  }
};
