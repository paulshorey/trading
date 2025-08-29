"use server";

import { OrderRowAdd } from "./types";
import { getDb } from "../../lib/neon";
import { cc } from "../../cc";

/**
 * Inserts a new order into the `order_v1` table.
 *
 * This function takes an `OrderRow` object, which contains the details of the order,
 * and inserts it into the database. It uses the `sqlQuery` function to execute the
 * INSERT statement and the `pool` from `../pool/events` for the database connection.
 *
 * The `server_name` and `app_name` are retrieved from environment variables and
 * added to the database record for tracking purposes.
 *
 * In case of an error during the database operation, the error is caught, formatted,
 * and logged using the `cc.error` function, which ensures that error details are
 * recorded for debugging.
 *
 * @param row - An `OrderRow` object containing the order details.
 * @returns The result of the SQL query, which includes the newly inserted row.
 */
export const orderAdd = async function (row: OrderRowAdd) {
  "use server";
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  const node_env = process.env.NODE_ENV || "";

  const client = await getDb().connect();
  try {
    const queryText = `
      INSERT INTO order_v1(client_id, type, ticker, side, amount, price, server_name, app_name, node_env)
      VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *`;
    const values = [row.client_id, row.type, row.ticker, row.side, row.amount, row.price, server_name, app_name, node_env];
    const res = await client.query(queryText, values);
    return res.rows[0];
  } catch (e: any) {
    const error = {
      name: "Error order/add.ts catch",
      message: e.message || "",
      stack: e.stack || "",
    };
    cc.error(`${error.name} ${e.message} ${e.stack?.substring(0, e.stack?.indexOf("\n"))}`, error);
  } finally {
    client.release();
  }
};
