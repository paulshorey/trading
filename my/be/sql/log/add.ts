"use server";

import { LogRow } from "./types";
import { sqlQuery } from "../../sql/sqlQuery";
import { getCurrentIpAddress } from "../../nextjs/getCurrentIpAddress";
import { pool } from "../../sql/pool/events";
import { sendToMyselfSMS } from "../../twillio/sendToMyselfSMS";

export const logAdd = async function (row: LogRow) {
  "use server";

  // SMS
  if (row.sms || row.name === "error") {
    await sendToMyselfSMS(row.message);
  }

  // DB
  const access_key = row.access_key;
  const node_env = process.env.NODE_ENV || "";
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  const addr = (await getCurrentIpAddress()) || {};
  const sql =
    "INSERT INTO logs_v1 (name, message, stack, access_key, server_name, app_name, node_env, category, tag) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *";
  try {
    await sqlQuery(pool, sql, [
      row.name.toLowerCase(),
      row.message,
      { ...row.stack, ...addr },
      access_key,
      server_name,
      app_name,
      node_env,
      row.category,
      row.tag,
    ]);
  } catch (e) {
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
      await sqlQuery(pool, sql, ["Error", message, stack, access_key, server_name, app_name, node_env]);
      //@ts-ignore
    } catch (err: Error) {
      // Error sending
      console.error("Error in catch logAdd.ts", row, err);
    }
    return null;
  }
};
