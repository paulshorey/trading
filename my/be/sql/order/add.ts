"use server";

import { OrderRow } from "./types";
import { sqlQuery } from "../sqlQuery";
import { pool } from "../pool/events";
import { cc } from "../../cc";

export const orderAdd = async function (row: OrderRow) {
  "use server";
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  try {
    const sql =
      "INSERT INTO orders_v1 (client_id, type, ticker, side, size, price, server_name, app_name, node_env) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *";
    return await sqlQuery(pool, sql, [row.client_id, row.type, row.ticker, row.side, row.size, row.price, server_name, app_name, process.env.NODE_ENV]);

    //@ts-ignore
  } catch (e: Error) {
    const error = {
      name: "Error order/add.ts catch",
      message: e.message,
      stack: e.stack,
    };
    cc.error(error.name, error);
  }
};
