import { QueryResult } from 'pg';
import { pool } from './pool';

export const getSql = async function (query: string, values: any[] = []): Promise<QueryResult> {
  try {
    const result = await pool.query(query, values);
    const numericFieldsKeys: string[] = [];
    for (let i = 0; i < result.fields.length; i++) {
      if (
        result.fields[i].dataTypeSize === 2 ||
        result.fields[i].dataTypeSize === 4 ||
        result.fields[i].dataTypeSize === 8
      ) {
        numericFieldsKeys.push(result.fields[i].name);
      }
    }

    // Convert "int2/4/8" columns to numbers (for some reason, all columns are returned as "text")
    result.rows = result.rows.map((row) => {
      for (let i = 0; i < numericFieldsKeys.length; i++) {
        const key = numericFieldsKeys[i];
        if (row[key] !== null) {
          // eslint-disable-next-line no-param-reassign
          row[key] = Number(row[key]);
        }
      }
      return row;
    });

    return result;
  } catch (error) {
    console.error('Error running query:', error);
    throw error;
  }
};
