"use server";

import { headers } from "next/headers";
import { sqlQuery } from "../sqlQuery";
import { pool } from "../pool/orders";
import { cc } from "../../cc";
import { OrderRowGet } from "./types";
import { buildWhereClause } from "../buildWhereClause";
import { Where } from "../types";

type Output = {
  ip?: string;
  result?: Record<string, any> & { rows: OrderRowGet[] };
  error?: {
    name: string;
    message: string;
    stack: string;
  };
};

type Props = {
  where?: Where;
};

export const orderGets = async function ({ where }: Props = {}): Promise<Output> {
  "use server";

  const output = {} as Output;
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") || headersList.get("remote-addr") || "IP not available";

  try {
    const { where: whereSQL, params } = buildWhereClause(where);
    const result = await sqlQuery(pool, `SELECT * FROM orders_v1 ${whereSQL} ORDER BY time DESC LIMIT 100`, params);
    output.ip = ip;
    output.result = result;
    //@ts-ignore
  } catch (e: Error) {
    try {
      const error = {
        name: "Error lib/sql/ordersGet.ts catch",
        message: e.message,
        stack: e.stack,
      };
      output.error = error;
      cc.error("@my/be/sql/order/gets Error", error);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(output.error);
    }
  }
  console.log("output", output);
  return output;
};
