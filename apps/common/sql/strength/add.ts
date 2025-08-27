"use server";

import { StrengthRowAdd } from "./types";
import { getDb } from "../../lib/neon";
import { cc } from "../../cc";

/**
 * Inserts a new strength record into the `strength_v1` table.
 *
 * This function takes a `StrengthRowAdd` object, which contains the details of the strength data,
 * and inserts it into the database. It uses Neon SQL to execute the INSERT operation.
 *
 * The `server_name`, `app_name`, and `node_env` are retrieved from environment variables and
 * added to the database record for tracking purposes.
 *
 * In case of an error during the database operation, the error is caught, formatted,
 * and logged using the `cc.error` function, which ensures that error details are
 * recorded for debugging.
 *
 * @param row - A `StrengthRowAdd` object containing the strength details.
 * @returns The result of the SQL query, which includes the newly inserted row.
 */
export const strengthAdd = async function (row: StrengthRowAdd) {
  "use server";

  const client = await getDb().connect();
  try {
    const columns = ["ticker", "time", "timenow"];
    const values: (string | number | Date | null)[] = [row.ticker, row.time, row.timenow];

    const numericColumns = ["price", "volume", "30S", "1", "2", "3", "4", "5", "7", "9"] as const;

    for (const col of numericColumns) {
      const value = row[col];
      if (typeof value === "number" && !isNaN(value)) {
        // Quote numeric column names to avoid SQL syntax errors
        columns.push(`"${col}"`);
        values.push(value);
      }
    }

    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const queryText = `
      INSERT INTO strength_v1(${columns.join(", ")})
      VALUES(${placeholders})
      RETURNING *`;

    const res = await client.query(queryText, values);
    return res.rows[0];
  } catch (e: any) {
    const error = {
      name: "Error strength/add.ts catch",
      message: e.message || "",
      stack: e.stack || "",
    };
    cc.error(`${error.name} ${e.message} ${e.stack?.substring(0, e.stack?.indexOf("\n"))}`, error);
  } finally {
    client.release();
  }
};
