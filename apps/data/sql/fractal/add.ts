"use server";

import { FractalRowAdd } from "./types";
import { prisma } from "../../lib/prisma";
import { cc } from "../../cc";

/**
 * Inserts a new fractal record into the `fractal_v1` table.
 *
 * This function takes a `FractalRowAdd` object, which contains the details of the fractal data,
 * and inserts it into the database. It uses Prisma to execute the INSERT operation.
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
  const server_name = process.env.SERVER_NAME || "";
  const app_name = process.env.APP_NAME || "";
  const node_env = process.env.NODE_ENV || "";

  try {
    const fractal = await prisma.fractal.create({
      data: {
        ticker: row.ticker,
        interval: row.interval,
        time: row.time,
        timenow: row.timenow,
        volumeStrength: row.volumeStrength,
        priceStrength: row.priceStrength,
        priceVolumeStrength: row.priceVolumeStrength,
        volumeStrengthMa: row.volumeStrengthMa,
        priceStrengthMa: row.priceStrengthMa,
        priceVolumeStrengthMa: row.priceVolumeStrengthMa,
        server_name,
        app_name,
        node_env,
      },
    });
    return fractal;

    //@ts-ignore
  } catch (e: Error) {
    const error = {
      name: "Error fractal/add.ts catch",
      message: e.message || "",
      stack: e.stack || "",
    };
    cc.error(`${error.name} ${e.message} ${e.stack?.substring(0, e.stack.indexOf(/\n/))}`, error);
  }
};
