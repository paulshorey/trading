"use server";

import { StrengthDataAdd, StrengthRowAdd } from "./types";
import { getDb } from "../../lib/neon";
import { cc } from "../../cc";

/**
 * Inserts a new strength record into the `strength_v1` table.
 *
 * This function takes a `StrengthDataAdd` object, which contains the details of the strength data,
 * and inserts it into the Postgres SQL database.
 *
 * The `server_name`, `app_name`, and `node_env` are retrieved from environment variables and
 * added to the database record for tracking purposes.
 *
 * In case of an error during the database operation, the error is caught, formatted,
 * and logged using the `cc.error` function, which ensures that error details are
 * recorded for debugging.
 *
 * @param data - A `StrengthDataAdd` object containing the strength details.
 * @returns The result of the SQL query, which includes the newly inserted row.
 */
export const strengthAdd = async function (data: StrengthDataAdd) {
  "use server";

  const client = await getDb().connect();
  try {
    console.log("strengthAdd", data);
    // Validate and filter data
    if (!data.ticker || !data.interval || !data.time || !data.timenow || !data.price || !data.volume || !data.strength) {
      throw new Error("Missing required fields");
    }
    for (let key of ["price", "volume", "strength"]) {
      if (typeof data[key as keyof StrengthDataAdd] !== "number" || isNaN(data[key as keyof StrengthDataAdd] as number)) {
        throw new Error(`Invalid NaN value for ${key}`);
      }
    }

    // Compile table row
    const row: StrengthRowAdd = {
      ticker: data.ticker,
      time: data.time,
      timenow: data.timenow,
      price: data.price,
      volume: data.volume,
      [data.interval]: data.strength,
    };
    const columns = ["ticker", "time", "timenow"];
    const values: (string | number | Date | null)[] = [data.ticker, data.time, data.timenow];
    for (const col in row) {
      const value = row[col as keyof StrengthRowAdd];
      if (typeof value === "number" && !isNaN(value)) {
        // Quote numeric column names to avoid SQL syntax errors
        columns.push(`"${col}"`);
        values.push(value);
      }
    }

    // Insert SQL row values/columns
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
