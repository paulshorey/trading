import { QueryResult, Pool } from "pg";
import { cc } from "../cc";

/**
 * Executes a SQL query using a connection from the provided pool.
 *
 * This function is a generic utility for running SQL queries. It takes a `pg.Pool`
 * instance, a query string, and an optional array of values for parameterized queries.
 *
 * The function also includes logic to handle a specific data type issue where numeric
 * values (int2, int4, int8) are returned as strings from the database. It inspects
 * the result fields and automatically converts these string representations back
 * to numbers.
 *
 * If the query execution fails, the error is logged to the console, and the
 * exception is re-thrown to be handled by the calling function.
 *
 * @param pool - A `pg.Pool` instance for database connections.
 * @param query - The SQL query string to execute.
 * @param values - An optional array of values for parameterized queries.
 * @returns A `Promise` that resolves with the `QueryResult` from the database.
 */
export const sqlQuery = async function (pool: Pool, query: string, values: any[] = []): Promise<QueryResult> {
  try {
    // Execute sql
    const result = (await pool.query(query, values)) as any;
    if (!result) {
      throw new Error("No result");
    }

    // Return sql output
    return result;
  } catch (error) {
    cc.error("Error in sqlQuery.ts", { error });
    throw error;
  }
};
