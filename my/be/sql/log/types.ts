export type LogSchema = {
  name: string;
  message: string;
  stack: string;
  category: string;
  tag: string;
  access_key: string;
  server_name: string;
  app_name: string;
  node_env: string;
  time?: string;
};
// export type RowAddKeys = {
//   0: "name";
//   1: "message";
//   2?: "stack";
//   3?: "access_key";
//   4?: "server_name";
//   5?: "app_name";
//   6?: "node_env";
//   7?: "time";
//   8?: "category";
//   9?: "tag";
// };
// const logExample: LogSchema = {
//   name: "",
//   message: "",
//   stack: "",
//   access_key: "",
//   server_name: "",
//   app_name: "",
//   node_env: "",
//   time: "",
//   category: "",
//   tag: "",
// };

export type LogOptions = {
  type?: string;
  access_key?: string;
  message?: string;
  title?: string;
  sms?: boolean;
  category?: string;
  tag?: string;
};

export type LogLevel =
  | "info"
  | "warn"
  | "error"
  | "debug"
  | "fatal"
  | "trace"
  | "log"
  | "dir"
  | "table"
  | "time"
  | "timeEnd"
  | "group"
  | "groupEnd"
  | "groupCollapsed"
  | "clear"
  | "count"
  | "assert"
  | "profile"
  | "profileEnd"
  | "context"
  | "memory"
  | "exception"
  | "assertion"
  | "dirxml"
  | "profile"
  | "profileEnd"
  | "startGroup"
  | "startGroupCollapsed"
  | "endGroup"
  | "table"
  | "timeStamp"
  | "timeStampEnd";
