import { logAdd } from "../sql/log/add";
import { consoleAction } from "./lib/consoleAction";

export const cc = {
  // @ts-ignore
  no: async function (message: string, data?: any, options: Record<string, any> = {}) {},
  log: async function (message: string, data?: any, options: Record<string, any> = {}) {
    try {
      consoleAction("log", message, data);
      // await logAdd("log", message, data);
    } catch (e) {
      console.error(e);
    }
  },
  info: async function (message: string, data?: any, options: Record<string, any> = {}) {
    try {
      consoleAction("info", message, data);
      await logAdd("info", message, data, options);
    } catch (e) {
      console.error(e);
    }
  },
  warn: async function (message: string, data?: any, options: Record<string, any> = {}) {
    try {
      consoleAction("warn", message, data);
      await logAdd("warn", message, data, { sms: true, ...options });
    } catch (e) {
      console.error(e);
    }
  },
  error: async function (message: string, data?: any, options: Record<string, any> = {}) {
    try {
      consoleAction("error", message, data);
      await logAdd("error", message, data, { sms: true, ...options });
    } catch (e) {
      console.error(e);
    }
  },
};
