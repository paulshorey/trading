"use server";

import { logAdd } from "../sql/log/add";

export const cc = {
  log: async function (...args: any[]) {
    const message = args.shift();
    await logAdd("log", message, args);
  },
  info: async function (...args: any[]) {
    const message = args.shift();
    await logAdd("info", message, args);
  },
  warn: async function (...args: any[]) {
    const message = args.shift();
    await logAdd("warn", message, args);
  },
  error: async function (...args: any[]) {
    const message = args.shift();
    await logAdd("error", message, args);
  },
};
