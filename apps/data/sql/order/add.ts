"use server";

import { OrderRowAdd } from "./types";
import { prisma } from "../../lib/prisma";
import { cc } from "../../cc";

/**
 * Inserts a new order into the `orders_v1` table.
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

  try {
    const order = await prisma.order.create({
      data: {
        client_id: row.client_id,
        type: row.type,
        ticker: row.ticker,
        side: row.side,
        amount: row.amount,
        price: row.price,
        server_name,
        app_name,
        node_env,
      },
    });
    return order;

    //@ts-ignore
  } catch (e: Error) {
    const error = {
      name: "Error order/add.ts catch",
      message: e.message || "",
      stack: e.stack || "",
    };
    cc.error(`${error.name} ${e.message} ${e.stack?.substring(0, e.stack.indexOf(/\n/))}`, error);
  }
};
