"use server";

import { StrengthDataAdd } from "./types";
import { getDb } from "../../lib/neon";
import { cc } from "../../cc";
import { sqlLogAdd } from "../../sql/log";

/**
 * Adds strength record to `strength_v1` table.
 *
 * This function consolidates multiple interval strength values into the same table row
 * for each 2-minute period. It creates exactly one row per 2 minutes and updates it with
 * different interval values as they come in.
 *
 * The function normalizes the current time to every 2 minutes (seconds set to 00 and odd
 * minutes rounded down to even) and either updates an existing row or inserts a new one.
 *
 * When updating an existing row:
 * - If the interval column is empty (NULL), it sets the new value
 * - If the interval column already has a value, it averages the existing value with the new value
 * - Price and volume are always updated to the latest values
 *
 * @param data - A `StrengthDataAdd` object containing the strength details.
 * @returns The result of the SQL query, which includes the newly inserted or updated row.
 */
export const strengthAdd = async function (data: StrengthDataAdd) {
  "use server";

  const client = await getDb().connect();
  try {
    // Validate and filter data
    if (!data.ticker || !data.interval || !data.strength) {
      throw new Error("Missing required fields");
    }
    for (let key of ["price", "volume", "strength"]) {
      if (typeof data[key as keyof StrengthDataAdd] !== "number" || isNaN(data[key as keyof StrengthDataAdd] as number)) {
        if (key === "strength") {
          // required
          throw new Error(`Invalid NaN value for ${key}`);
        } else {
          // optional
          delete data[key as keyof StrengthDataAdd];
        }
      }
    }

    // Normalize current time to every 2 minutes (set seconds to 00 and round down odd minutes)
    const normalizedTimenow = new Date();
    normalizedTimenow.setSeconds(0, 0); // Set seconds and milliseconds to 0

    // Round down to the nearest even minute (0, 2, 4, 6, ... 58)
    const currentMinute = normalizedTimenow.getMinutes();
    if (currentMinute % 2 === 1) {
      // If minute is odd, reduce by 1 to make it even
      normalizedTimenow.setMinutes(currentMinute - 1);
    }

    // First, check if a row exists for this ticker and normalized minute
    const checkQuery = `
      SELECT * FROM strength_v1 
      WHERE ticker = $1 AND timenow = $2
      LIMIT 1
    `;
    const existingRow = await client.query(checkQuery, [data.ticker, normalizedTimenow]);

    let res: any;
    let sqlQuery = "";
    const values = [data.ticker, normalizedTimenow, data.strength, data.price ?? null, data.volume ?? null];

    if (existingRow.rows.length > 0) {
      // Row exists - UPDATE it
      // If a value already exists for this interval, average it with the new value
      sqlQuery = `
        UPDATE strength_v1
        SET "${data.interval}" = CASE
              WHEN "${data.interval}" IS NULL THEN $3
              ELSE ("${data.interval}" + $3) / 2
            END,
            price = $4,
            volume = $5
        WHERE ticker = $1 AND timenow = $2
        RETURNING *
      `;
      res = await client.query(sqlQuery, values);
    } else {
      // Row doesn't exist - INSERT new row
      sqlQuery = `
        INSERT INTO strength_v1("ticker", "timenow", "${data.interval}", "price", "volume")
        VALUES(${values.map((_, i) => `$${i + 1}`).join(", ")})
        RETURNING *
      `;
      res = await client.query(sqlQuery, values);
    }
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
