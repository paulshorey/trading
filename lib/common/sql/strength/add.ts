"use server";

import { StrengthDataAdd } from "./types";
import { getDb } from "../../lib/db/neon";
import { cc } from "../../cc";
import {
  STRENGTH_INTERVALS,
  FORWARD_FILL_DEPTH,
  forwardFillAllIntervals,
  calculateAverage,
  extractIntervalValues,
  StrengthRow,
  StrengthInterval,
} from "./utils";

/**
 * Adds strength record to `strength_v1` table.
 *
 * This function consolidates multiple interval strength values into the same table row
 * for each 1-minute period. It creates exactly one row per minute and updates it with
 * different interval values as they come in.
 *
 * Key features:
 * 1. Normalizes current time to every minute (seconds set to 00)
 * 2. Pre-creates current and next rows to prevent race conditions
 * 3. Forward-fills missing interval values from previous rows (up to 3 rows back)
 * 4. Calculates and stores the average of all interval columns
 *
 * The forward-fill ensures that the average is always accurate, not missing any data.
 * When a new interval value arrives, the function:
 * - Updates that interval column
 * - Forward-fills any other missing intervals from historical data
 * - Recalculates the average with all available values
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

    // Normalize current time to every minute (set seconds to 00)
    const normalizedTimenow = new Date();
    normalizedTimenow.setSeconds(0, 0); // Set seconds and milliseconds to 0

    // Calculate the future timenow (1 minute ahead)
    const futureTimenow = new Date(normalizedTimenow);
    const futureMinutes = futureTimenow.getMinutes() + 1;

    if (futureMinutes >= 60) {
      // Handle minute overflow - increment hour and set minutes
      futureTimenow.setHours(futureTimenow.getHours() + 1);
      futureTimenow.setMinutes(futureMinutes - 60);
    } else {
      futureTimenow.setMinutes(futureMinutes);
    }

    // Pre-create both current and future rows to avoid race conditions
    await preCreateRows(client, data.ticker, normalizedTimenow, futureTimenow);

    // Fetch recent rows for forward-filling (current + FORWARD_FILL_DEPTH previous rows)
    const recentRows = await fetchRecentRows(client, data.ticker, normalizedTimenow, FORWARD_FILL_DEPTH + 1);

    // Update the current row with new interval value and calculate average
    const updatedRow = await updateRowWithForwardFill(
      client,
      data.ticker,
      normalizedTimenow,
      data.interval as StrengthInterval,
      data.strength,
      data.price ?? null,
      data.volume ?? null,
      recentRows
    );

    return updatedRow;
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

/**
 * Pre-create current and future rows to prevent race conditions.
 * Uses ON CONFLICT DO NOTHING to safely handle simultaneous creation attempts.
 */
async function preCreateRows(client: any, ticker: string, currentTime: Date, futureTime: Date): Promise<void> {
  const insertQuery = `
    INSERT INTO strength_v1("ticker", "timenow")
    VALUES($1, $2)
    ON CONFLICT (ticker, timenow) DO NOTHING
  `;

  try {
    await client.query(insertQuery, [ticker, currentTime]);
  } catch (error: any) {
    cc.log(`Pre-creating current row (expected occasional conflicts): ${error.message}`);
  }

  try {
    await client.query(insertQuery, [ticker, futureTime]);
  } catch (error: any) {
    cc.log(`Pre-creating future row (expected occasional conflicts): ${error.message}`);
  }
}

/**
 * Fetch recent rows for a ticker, sorted by timenow DESC (newest first).
 * Used for forward-filling missing values.
 */
async function fetchRecentRows(client: any, ticker: string, currentTime: Date, limit: number): Promise<StrengthRow[]> {
  const query = `
    SELECT id, ticker, timenow, "30S", "3", "5", "7", "13", "19", "39", "59", "71", "101", average
    FROM strength_v1
    WHERE ticker = $1 AND timenow <= $2
    ORDER BY timenow DESC
    LIMIT $3
  `;

  const result = await client.query(query, [ticker, currentTime, limit]);
  return result.rows as StrengthRow[];
}

/**
 * Update a row with the new interval value, forward-fill missing intervals,
 * and calculate the average.
 */
async function updateRowWithForwardFill(
  client: any,
  ticker: string,
  timenow: Date,
  interval: StrengthInterval,
  strengthValue: number,
  price: number | null,
  volume: number | null,
  recentRows: StrengthRow[]
): Promise<any> {
  // Get the current row (should be first in recentRows, or create empty object)
  const currentRowIndex = recentRows.findIndex((row) => row.timenow.getTime() === timenow.getTime());
  const currentRow = currentRowIndex >= 0 ? recentRows[currentRowIndex] : null;

  // Build the current interval values, starting with existing values
  // Convert to numbers explicitly (PostgreSQL may return strings)
  const currentValues: Record<string, number | null> = {};
  for (const int of STRENGTH_INTERVALS) {
    const rawValue = currentRow?.[int];
    currentValues[int] = rawValue !== null && rawValue !== undefined ? Number(rawValue) : null;
  }

  // Set the new interval value
  currentValues[interval] = strengthValue;

  // Forward-fill missing intervals from previous rows
  if (recentRows.length > 0) {
    // Create a modified rows array where current row has the new value
    const modifiedRows = [...recentRows];
    if (currentRowIndex >= 0) {
      modifiedRows[currentRowIndex] = {
        ...modifiedRows[currentRowIndex]!,
        [interval]: strengthValue,
      };
    }

    // Forward-fill each missing interval
    for (const int of STRENGTH_INTERVALS) {
      if (currentValues[int] === null) {
        // Look back through previous rows to find a value
        const startIdx = currentRowIndex >= 0 ? currentRowIndex : 0;
        for (let i = startIdx + 1; i < Math.min(modifiedRows.length, startIdx + FORWARD_FILL_DEPTH + 1); i++) {
          const rawValue = modifiedRows[i]?.[int];
          if (rawValue !== null && rawValue !== undefined) {
            // Convert to number (PostgreSQL may return strings)
            currentValues[int] = Number(rawValue);
            break;
          }
        }
      }
    }
  }

  // Calculate the average of all interval values
  const average = calculateAverage(currentValues as Record<StrengthInterval, number | null>);

  // Build the UPDATE query dynamically
  const setClauses: string[] = [];
  const values: any[] = [ticker, timenow];
  let paramIndex = 3;

  // Always update the specified interval
  setClauses.push(`"${interval}" = $${paramIndex}`);
  values.push(strengthValue);
  paramIndex++;

  // Update forward-filled intervals (only if they were null before)
  for (const int of STRENGTH_INTERVALS) {
    if (int !== interval && currentValues[int] !== null && (currentRow?.[int] === null || currentRow?.[int] === undefined)) {
      setClauses.push(`"${int}" = COALESCE("${int}", $${paramIndex})`);
      values.push(currentValues[int]);
      paramIndex++;
    }
  }

  // Always update average
  setClauses.push(`"average" = $${paramIndex}`);
  values.push(average);
  paramIndex++;

  // Update price and volume if provided
  if (price !== null) {
    setClauses.push(`price = COALESCE($${paramIndex}, price)`);
    values.push(price);
    paramIndex++;
  }
  if (volume !== null) {
    setClauses.push(`volume = COALESCE($${paramIndex}, volume)`);
    values.push(volume);
    paramIndex++;
  }

  const updateQuery = `
    UPDATE strength_v1
    SET ${setClauses.join(", ")}
    WHERE ticker = $1 AND timenow = $2
    RETURNING *
  `;

  const result = await client.query(updateQuery, values);
  return result.rows[0];
}
