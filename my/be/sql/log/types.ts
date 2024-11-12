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
