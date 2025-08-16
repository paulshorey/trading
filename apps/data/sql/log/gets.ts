"use server";

import { headers } from "next/headers";
import { prisma } from "../../lib/prisma";
import { cc } from "../../cc";
import { LogRowGet } from "./types";

type Output = {
  ip?: string;
  rows?: LogRowGet[];
  error?: {
    name: string;
    message: string;
    stack: string;
  };
};

type Props = {
  where?: {
    name?: string;
    category?: string;
    tag?: string;
    access_key?: string;
    limit?: number;
  };
};

export const logGets = async function ({ where }: Props = {}): Promise<Output> {
  "use server";

  const output = {} as Output;
  const headersList = await headers();
  const ip = headersList.get("x-forwarded-for") || headersList.get("remote-addr") || "IP not available";

  try {
    const logs = await prisma.log.findMany({
      where: {
        ...(where?.name && { name: where.name }),
        ...(where?.category && { category: where.category }),
        ...(where?.tag && { tag: where.tag }),
        ...(where?.access_key && { access_key: where.access_key }),
      },
      orderBy: { time: "desc" },
      take: where?.limit || 100,
    });

    // Convert Prisma results to LogRowGet format
    const rows = logs.map((log) => ({
      id: log.id,
      dev: log.node_env === "development",
      name: log.name,
      message: log.message,
      stack: JSON.stringify(log.stack),
      category: log.category || "",
      tag: log.tag || "",
      access_key: log.access_key || "",
      server_name: log.server_name || "",
      app_name: log.app_name || "",
      node_env: log.node_env || "",
      time: log.time.getTime(),
    })) as LogRowGet[];

    output.ip = ip;
    output.rows = rows;
    //@ts-ignore - this Error type is correct
  } catch (e: any) {
    try {
      const error = {
        name: "Error lib/sql/logsGet.ts catch",
        message: e?.message?.toString(),
        stack: e?.stack?.toString(),
      };
      output.error = error;
      cc.error("sql/log/gets Error", error);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(e);
    }
  }
  return output;
};
