import { cc } from "./index";

export const ccLog = async function (...args: any) {
  "use server";
  return await cc.log(...args);
};
