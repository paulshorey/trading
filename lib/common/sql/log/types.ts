export type LogRowGet = {
  id: number;
  dev: boolean;
  name: string;
  message: string;
  stack: string;
  category: string;
  tag: string;
  access_key: string;
  server_name: string;
  app_name: string;
  node_env: string;
  created_at: Date; // DateTime as ISO string
};

export type LogRowAdd = {
  // core, received in arguments
  name: LogLevel;
  message: string;
  stack: Record<string, any>;
  access_key?: string;
  category?: string;
  tag?: string;
  // only in logic, not sent to database
  type?: string;
  title?: string;
  sms?: boolean;
  // automatically added
  server_name?: string;
  app_name?: string;
  node_env?: string;
  created_at?: Date; // DateTime as ISO string
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
