import { addLog } from "../sql/log/add";

export const cc = {
  log: function (...args: any[]) {
    const message = args.shift();
    addLog("log", message, args);
  },
  info: function (...args: any[]) {
    const message = args.shift();
    addLog("info", message, args);
  },
  warn: function (...args: any[]) {
    const message = args.shift();
    addLog("warn", message, args);
  },
  error: function (...args: any[]) {
    const message = args.shift();
    addLog("error", message, args);
  },
};
