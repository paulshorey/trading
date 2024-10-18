import { QueryResult } from "pg";
import { pool } from "./pool";

export const sqlQuery = async function (query: string, values: any[] = []): Promise<QueryResult> {
  try {
    const result = (await pool.query(query, values)) as any;
    if (!result) {
      throw new Error("No result");
    }

    // Find name of any column that is "int" but mistakenly returned as "text"
    // result.fields == schema
    const numKeys = [] as Array<string>;
    for (let i = 0; i < result.fields.length; i++) {
      if (
        result.fields[i].format === "text" &&
        (result.fields[i].dataTypeSize === 2 || result.fields[i].dataTypeSize === 4 || result.fields[i].dataTypeSize === 8)
      ) {
        numKeys.push(result.fields[i].dataTypeSize);
      }
    }

    // Fix numeric values (should be Number type, but returened as String)
    // result.rows == data
    result.rows = result.rows.map((row: Record<string, string | number | boolean>) => {
      for (let i in numKeys) {
        const key = numKeys[i] as string;
        if (row[key] !== null) {
          // eslint-disable-next-line no-param-reassign
          row[key] = Number(row[key]);
        }
      }
      return row;
    });

    console.log("numKeys", numKeys);
    console.log("result.fields", result.fields);
    console.log("result.rows", result.rows);

    return result;
  } catch (error) {
    console.error("Error running query:", error);
    throw error;
  }
};
