'use server';

import { sql } from '@vercel/postgres';
import { LogsData, LogsOptions } from './types';

export const addLog = async function (data: LogsData, options: LogsOptions = {}) {
  'use server';

  const type = options.type || 'log';
  const access_key = options.access_key;
  const dev = process.env.NODE_ENV === 'development';
  try {
    const dataString = JSON.stringify(data, null, ' ');
    await sql`INSERT INTO events.logs (type, data, access_key, dev, time) VALUES
      (${type}, ${dataString}, ${access_key}, ${dev},  ${Date.now()}) RETURNING *`;
    //@ts-ignore
  } catch (e: Error) {
    try {
      const dataString = JSON.stringify({
        name: 'Error lib/log.ts log() catch',
        message: e.message,
        stack: e.stack,
      });
      await sql`INSERT INTO events.logs (type, data, access_key, dev, time) VALUES
      ('Error', ${dataString}, ${access_key}, ${dev}, ${Date.now()}) RETURNING *`;
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.log('ERROR in addLog', data, options, e);
    }
  }
};
