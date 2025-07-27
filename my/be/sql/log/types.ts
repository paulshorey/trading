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
  time?: EpochTimeStamp;
};

export type LogRow = {
  name: LogLevel;
  message: string;
  stack: Record<string, any>;
  type?: string;
  access_key?: string;
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
