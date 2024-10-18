"use server";

import { headers } from "next/headers";
import { sqlQuery } from "./sqlQuery";

type Output = {
  ip?: string;
  result?: any;
  error?: {
    name: string;
    message: string;
    stack: string;
  };
};

export const getLogs = async function (): Promise<Output> {
  "use server";

  const output = {} as Output;
  const headersList = headers();
  const ip = headersList.get("x-forwarded-for") || headersList.get("remote-addr") || "IP not available";

  try {
    const result = await sqlQuery("SELECT * FROM events.logs ORDER BY time DESC LIMIT 100");
    output.ip = ip;
    output.result = result;
    //@ts-ignore
  } catch (e: Error) {
    try {
      const dev = process.env.NODE_ENV === "development";
      const error = {
        name: "Error lib/sql/getLogs.ts catch",
        message: e.message,
        stack: e.stack,
      };
      output.error = error;
      const dataString = JSON.stringify(error);
      await sqlQuery("INSERT INTO events.logs (type, data, dev, time) VALUES ($1, $2, $3, $4, $5) RETURNING *", ["Error", dataString, dev, Date.now()]);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(output.error);
    }
  }
  return output;
};
