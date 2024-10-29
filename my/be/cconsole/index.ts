import { logAdd } from "../sql/log/add";

export const cconsoleLog = async function (...args: any[]) {
  const message = args.shift();
  await logAdd("log", message, args);
};
