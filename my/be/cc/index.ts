import { addLog } from "../sql/addLog";
import { LogsData, LogsOptions } from "../sql/types";

export const cc = {
  log: (getData: LogsData, options?: LogsOptions) => addLog(getData, { ...options, type: "log" }),
  info: (getData: LogsData, options?: LogsOptions) => addLog(getData, { ...options, type: "info" }),
  warn: (getData: LogsData, options?: LogsOptions) => addLog(getData, { ...options, type: "warn" }),
  error: (getData: LogsData, options?: LogsOptions) => addLog(getData, { ...options, type: "error" }),
};
