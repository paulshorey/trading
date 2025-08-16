"use server";

import { headers } from "next/headers";
import { prisma } from "../../lib/prisma";
import { cc } from "../../cc";
import { OrderRowGet } from "./types";

type Output = {
  ip?: string;
  rows?: OrderRowGet[];
  error?: {
    name: string;
    message: string;
    stack: string;
  };
};

type Props = {
  where?: {
    client_id?: number;
    type?: string;
    ticker?: string;
    side?: string;
    limit?: number;
  };
};

export const orderGets = async function ({ where }: Props = {}): Promise<Output> {
  "use server";

  const output = {} as Output;
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") || headersList.get("remote-addr") || "IP not available";

  try {
    const orders = await prisma.order.findMany({
      where: {
        ...(where?.client_id && { client_id: where.client_id }),
        ...(where?.type && { type: where.type }),
        ...(where?.ticker && { ticker: where.ticker }),
        ...(where?.side && { side: where.side }),
      },
      orderBy: { time: "desc" },
      take: where?.limit || 100,
    });

    // Convert Prisma results to OrderRowGet format
    const rows = orders.map((order) => ({
      id: order.id,
      dev: order.node_env === "development",
      client_id: order.client_id,
      type: order.type as "MARKET" | "LIMIT" | "STOP_MARKET",
      ticker: order.ticker,
      side: order.side as "LONG" | "SHORT",
      amount: Number(order.amount),
      price: Number(order.price),
      server_name: order.server_name || "",
      app_name: order.app_name || "",
      node_env: order.node_env || "",
      time: order.time.getTime(),
    })) as OrderRowGet[];

    output.ip = ip;
    output.rows = rows;
    //@ts-ignore
  } catch (e: Error) {
    try {
      const error = {
        name: "Error lib/sql/ordersGet.ts catch",
        message: e.message,
        stack: e.stack,
      };
      output.error = error;
      cc.error("sql/order/gets Error", error);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(output.error);
    }
  }
  return output;
};
