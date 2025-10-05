"use server";

import { StrengthDataAdd } from "./types";
import { getDb } from "../../lib/db/neon";
import { cc } from "../../cc";

/**
 * Adds strength record to `strength_v1` table.
 *
 * This function consolidates multiple interval strength values into the same table row
 * for each 2-minute period. It creates exactly one row per 2 minutes and updates it with
 * different interval values as they come in.
 *
 * The function normalizes the current time to every 2 minutes (seconds set to 00 and odd
 * minutes rounded down to even).
 *
 * To prevent race conditions where multiple concurrent requests try to create or update
 * the same rows, this function pre-creates BOTH the current 2-minute interval row AND
 * the next 2-minute interval row (without data) before processing. This ensures both rows
 * always exist, eliminating any race conditions during data insertion. The database's
 * UNIQUE constraint on (ticker, timenow) prevents duplicate rows, and ON CONFLICT DO NOTHING
 * safely handles simultaneous creation attempts.
 *
 * After pre-creating the rows, the function always performs an UPDATE:
 * - If the interval column is empty (NULL), it sets the new value
 * - If the interval column already has a value, it averages the existing value with the new value
 * - Price and volume use COALESCE to preserve existing values when NULL is provided
 *
 * @param data - A `StrengthDataAdd` object containing the strength details.
 * @returns The result of the SQL query, which includes the newly inserted or updated row.
 */
export const strengthAdd = async function (data: StrengthDataAdd) {
  "use server";

  console.log("strengthAdd", JSON.stringify(data, null, 2));

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

    // Calculate the future timenow (2 minutes ahead)
    const futureTimenow = new Date(normalizedTimenow);
    const futureMinutes = futureTimenow.getMinutes() + 2;

    if (futureMinutes >= 60) {
      // Handle minute overflow - increment hour and set minutes
      futureTimenow.setHours(futureTimenow.getHours() + 1);
      futureTimenow.setMinutes(futureMinutes - 60);
    } else {
      futureTimenow.setMinutes(futureMinutes);
    }

    // Pre-create both current and future rows to avoid race conditions
    // This ensures both rows exist before we start processing data
    // The UNIQUE constraint on (ticker, timenow) will prevent duplicates

    // Pre-create current row
    try {
      const currentInsertQuery = `
        INSERT INTO strength_v1("ticker", "timenow")
        VALUES($1, $2)
        ON CONFLICT (ticker, timenow) DO NOTHING
        RETURNING *
      `;
      await client.query(currentInsertQuery, [data.ticker, normalizedTimenow]);
    } catch (preCreateError: any) {
      // If there's a conflict (another request created it), that's fine - continue
      cc.log(`Pre-creating current row (expected occasional conflicts): ${preCreateError.message}`);
    }

    // Pre-create future row
    try {
      const futureInsertQuery = `
        INSERT INTO strength_v1("ticker", "timenow")
        VALUES($1, $2)
        ON CONFLICT (ticker, timenow) DO NOTHING
        RETURNING *
      `;
      await client.query(futureInsertQuery, [data.ticker, futureTimenow]);
    } catch (preCreateError: any) {
      // If there's a conflict (another request created it), that's fine - continue
      cc.log(`Pre-creating future row (expected occasional conflicts): ${preCreateError.message}`);
    }

    // Now update the row with the strength data
    let res: any;
    const values = [data.ticker, normalizedTimenow, data.strength, data.price ?? null, data.volume ?? null];

    // UPDATE row values
    // Use COALESCE to replace the value if new value is provided,
    // otherwise keep the existing value (don't overwrite with null)
    const sqlQuery = `
      UPDATE strength_v1
      SET "${data.interval}" = COALESCE($3, "${data.interval}"),
          price = COALESCE($4, price),
          volume = COALESCE($5, volume)
      WHERE ticker = $1 AND timenow = $2
      RETURNING *
    `;
    res = await client.query(sqlQuery, values);
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
