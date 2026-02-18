"use server";

import { LogRowAdd } from "./types";
import { getDb } from "../../lib/db/postgres";
import { getCurrentIpAddress, type IpAddressContext } from "../../lib/nextjs/getCurrentIpAddress";
import { sendToMyselfSMS } from "../../twillio/sendToMyselfSMS";

export const sqlLogAdd = async function (row: LogRowAdd, ipContext?: IpAddressContext) {
  "use server";

  if (row.sms || row.name === "error" || row.name === "warn") {
    await sendToMyselfSMS(row.message);
  }

  const access_key = row.access_key;
  const node_env = process.env.NODE_ENV || "";
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  const addr = (await getCurrentIpAddress(ipContext)) || {};
  const category = row.stack?.category || null;
  const tag = row.stack?.tag || null;

  const client = await getDb().connect();
  try {
    const queryText = `
      INSERT INTO log_v1(name, message, stack, access_key, server_name, app_name, node_env, category, tag)
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`;
    const values = [row.name.toLowerCase(), row.message, JSON.stringify({ ...row.stack, ...addr }), access_key, server_name, app_name, node_env, category, tag];
    await client.query(queryText, values);
  } catch (e: any) {
    try {
      const errorStack = {
        name: "Error",
        message: e?.message,
        stack: e?.stack,
      };
      const message = "Error in try sqlLogAdd.ts";
      const queryText = `
        INSERT INTO log_v1(name, message, stack, access_key, server_name, app_name, node_env, category, tag)
        VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`;
      const values = ["error", message, JSON.stringify(errorStack), access_key, server_name, app_name, node_env, category, tag];
      await client.query(queryText, values);
    } catch (err: any) {
      console.error("Error in catch sqlLogAdd.ts", row, err);
    }
    return null;
  } finally {
    client.release();
  }
};
