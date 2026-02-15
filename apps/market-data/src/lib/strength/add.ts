import { StrengthDataAdd } from "./types.js";
import { getNeonDb } from "../neon.js";
import { ALL_INTERVALS, FORWARD_FILL_DEPTH, calculateAverage, StrengthInterval } from "./constants.js";

/**
 * Row structure for forward-fill operations.
 */
interface StrengthRow {
  id?: number;
  ticker: string;
  timenow: Date;
  average?: number | null;
  [key: string]: unknown;
}

/**
 * Adds strength record to `strength_v1` table.
 *
 * Consolidates multiple interval strength values into the same table row
 * for each 1-minute period. Creates exactly one row per minute and updates it
 * with different interval values as they come in.
 *
 * Key features:
 * 1. Normalizes current time to every minute (seconds set to 00)
 * 2. Pre-creates current and next rows to prevent race conditions
 * 3. Forward-fills missing interval values from previous rows (up to FORWARD_FILL_DEPTH rows back)
 * 4. Calculates and stores the average of all interval columns
 *
 * Adapted from lib/common/sql/strength/add.ts (removed Next.js cc dependency)
 */
export async function strengthAdd(data: StrengthDataAdd) {
  console.log("strengthAdd", JSON.stringify(data, null, 2));

  const client = await getNeonDb().connect();
  try {
    // Validate and filter data
    if (!data.ticker || !data.interval || !data.strength) {
      throw new Error("Missing required fields");
    }
    for (const key of ["price", "volume", "strength"]) {
      if (typeof data[key as keyof StrengthDataAdd] !== "number" || isNaN(data[key as keyof StrengthDataAdd] as number)) {
        if (key === "strength") {
          throw new Error(`Invalid NaN value for ${key}`);
        } else {
          delete data[key as keyof StrengthDataAdd];
        }
      }
    }

    // Normalize current time to every minute (set seconds to 00)
    const normalizedTimenow = new Date();
    normalizedTimenow.setSeconds(0, 0);

    // Calculate the future timenow (1 minute ahead)
    const futureTimenow = new Date(normalizedTimenow);
    const futureMinutes = futureTimenow.getMinutes() + 1;

    if (futureMinutes >= 60) {
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
      recentRows,
    );

    return updatedRow;
  } catch (e: unknown) {
    const error = e instanceof Error ? e : new Error(String(e));
    console.error(`strengthAdd error: ${error.message}`, error.stack?.substring(0, error.stack?.indexOf("\n")));
  } finally {
    client.release();
  }
}

/**
 * Pre-create current and future rows to prevent race conditions.
 * Uses ON CONFLICT DO NOTHING to safely handle simultaneous creation attempts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function preCreateRows(client: any, ticker: string, currentTime: Date, futureTime: Date): Promise<void> {
  const insertQuery = `
    INSERT INTO strength_v1("ticker", "timenow")
    VALUES($1, $2)
    ON CONFLICT (ticker, timenow) DO NOTHING
  `;

  try {
    await client.query(insertQuery, [ticker, currentTime]);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`Pre-creating current row (expected occasional conflicts): ${msg}`);
  }

  try {
    await client.query(insertQuery, [ticker, futureTime]);
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.log(`Pre-creating future row (expected occasional conflicts): ${msg}`);
  }
}

/**
 * Fetch recent rows for a ticker, sorted by timenow DESC (newest first).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchRecentRows(client: any, ticker: string, currentTime: Date, limit: number): Promise<StrengthRow[]> {
  const query = `
    SELECT *
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function updateRowWithForwardFill(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  ticker: string,
  timenow: Date,
  interval: StrengthInterval,
  strengthValue: number,
  price: number | null,
  volume: number | null,
  recentRows: StrengthRow[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  // Get the current row (should be first in recentRows, or create empty object)
  const currentRowIndex = recentRows.findIndex((row) => row.timenow.getTime() === timenow.getTime());
  const currentRow = currentRowIndex >= 0 ? recentRows[currentRowIndex] : null;

  // Build the current interval values, starting with existing values
  const currentValues: Record<string, number | null> = {};
  for (const int of ALL_INTERVALS) {
    const rawValue = currentRow?.[int];
    currentValues[int] = rawValue !== null && rawValue !== undefined ? Number(rawValue) : null;
  }

  // Set the new interval value
  currentValues[interval] = strengthValue;

  // Forward-fill missing intervals from previous rows (recentRows is sorted DESC, newest first)
  if (recentRows.length > 0) {
    const startIdx = currentRowIndex >= 0 ? currentRowIndex : 0;
    for (const int of ALL_INTERVALS) {
      if (currentValues[int] === null) {
        for (let i = startIdx + 1; i < Math.min(recentRows.length, startIdx + FORWARD_FILL_DEPTH + 1); i++) {
          const rawValue = recentRows[i]?.[int];
          if (rawValue !== null && rawValue !== undefined) {
            currentValues[int] = Number(rawValue);
            break;
          }
        }
      }
    }
  }

  // Calculate the average of all interval values
  const average = calculateAverage(currentValues);

  // Build the UPDATE query dynamically
  const setClauses: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [ticker, timenow];
  let paramIndex = 3;

  // Always update the specified interval
  setClauses.push(`"${interval}" = $${paramIndex}`);
  values.push(strengthValue);
  paramIndex++;

  // Update forward-filled intervals (only if they were null before)
  for (const int of ALL_INTERVALS) {
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
