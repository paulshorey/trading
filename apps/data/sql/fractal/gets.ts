"use server";

import { Prisma } from "../../prisma/..prisma/client";
import { prisma } from "../../lib/prisma";
import { cc } from "../../cc";
import { FractalRowGet } from "./types";

type Output = {
  rows?: FractalRowGet[];
  error?: {
    name: string;
    message: string;
    stack: string;
  };
};

type Props = {
  where?: {
    ticker?: string;
    interval?: string;
  };
};

export const fractalGets = async function ({ where }: Props = {}): Promise<Output> {
  "use server";

  const output = {} as Output;

  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const query = {
      where: {
        ...(where?.ticker && { ticker: where.ticker }),
        ...(where?.interval && { interval: where.interval }),
        timenow: {
          gte: sevenDaysAgo,
        },
      },
      distinct: [Prisma.FractalScalarFieldEnum.timenow],
      orderBy: { timenow: "asc" as const },
    };
    const fractals = await prisma.fractal.findMany(query);

    // Convert Prisma results to FractalRowGet format
    const rows: FractalRowGet[] = fractals.map((fractal) => ({
      id: fractal.id,
      ticker: fractal.ticker,
      interval: fractal.interval,
      time: fractal.time.toISOString(),
      timenow: fractal.timenow.toISOString(),
      volumeStrength: Number(fractal.volumeStrength),
      priceStrength: Number(fractal.priceStrength),
      priceVolumeStrength: Number(fractal.priceVolumeStrength),
      volumeStrengthMa: Number(fractal.volumeStrengthMa),
      priceStrengthMa: Number(fractal.priceStrengthMa),
      priceVolumeStrengthMa: Number(fractal.priceVolumeStrengthMa),
      server_name: fractal.server_name || "",
      app_name: fractal.app_name || "",
      node_env: fractal.node_env || "",
      created_at: fractal.created_at.toISOString(),
    }));

    output.rows = rows;
    //@ts-ignore - this Error type is correct
  } catch (e: any) {
    try {
      const error = {
        name: "Error fractal/gets.ts catch",
        message: e?.message?.toString(),
        stack: e?.stack?.toString(),
      };
      output.error = error;
      cc.error("sql/fractal/gets Error", error);
      //@ts-ignore
      // eslint-disable-next-line @typescript-eslint/no-shadow
    } catch (e: Error) {
      console.error(e);
    }
  }
  return output;
};
