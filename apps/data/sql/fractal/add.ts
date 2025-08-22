"use server";

import { FractalRowAdd } from "./types";
import { getDb } from "../../lib/neon";
import { cc } from "../../cc";

/**
 * Inserts a new fractal record into the `fractal_v1` table.
 *
 * This function takes a `FractalRowAdd` object, which contains the details of the fractal data,
 * and inserts it into the database. It uses Neon SQL to execute the INSERT operation.
 *
 * The `server_name`, `app_name`, and `node_env` are retrieved from environment variables and
 * added to the database record for tracking purposes.
 *
 * In case of an error during the database operation, the error is caught, formatted,
 * and logged using the `cc.error` function, which ensures that error details are
 * recorded for debugging.
 *
 * @param row - A `FractalRowAdd` object containing the fractal details.
 * @returns The result of the SQL query, which includes the newly inserted row.
 */
export const fractalAdd = async function (row: FractalRowAdd) {
  "use server";

  const client = await getDb().connect();
  try {
    const columns = ["ticker", "interval", "time", "timenow"];
    const values: (string | number | Date)[] = [row.ticker, row.interval, row.time, row.timenow];

    const numericColumns = [
      "volume_strength",
      "price_strength",
      "price_volume_strength",
      "volume_strength_ma",
      "price_strength_ma",
      "price_volume_strength_ma",
    ] as const;

    for (const col of numericColumns) {
      const value = row[col];
      if (typeof value === "number" && !isNaN(value)) {
        columns.push(col);
        values.push(value);
      }
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const queryText = `
      INSERT INTO fractal_v1(${columns.join(", ")})
      VALUES(${placeholders})
      RETURNING *`;

    const res = await client.query(queryText, values);
    return res.rows[0];
  } catch (e: any) {
    const error = {
      name: "Error fractal/add.ts catch",
      message: e.message || "",
      stack: e.stack || "",
    };
    cc.error(`${error.name} ${e.message} ${e.stack?.substring(0, e.stack?.indexOf("\n"))}`, error);
  } finally {
    client.release();
  }
};
