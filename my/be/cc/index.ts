import { add } from "../sql/log/add";

export const cc = {
  log: function (...args: any[]) {
    const message = args.shift();
    add("log", message, args);
  },
  info: function (...args: any[]) {
    const message = args.shift();
    add("info", message, args);
  },
  warn: function (...args: any[]) {
    const message = args.shift();
    add("warn", message, args);
  },
  error: function (...args: any[]) {
    const message = args.shift();
    add("error", message, args);
  },
};
