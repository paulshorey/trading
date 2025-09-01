/**
 * WebSocket event names and types
 */

// Event names
export const SOCKET_EVENTS = {
  // Connection events
  CONNECTION: "connection",
  DISCONNECT: "disconnect",
  SUBSCRIBE: "subscribe",
  UNSUBSCRIBE: "unsubscribe",
  SUBSCRIBED: "subscribed",
  UNSUBSCRIBED: "unsubscribed",

  // Data events
  STRENGTH_ADDED: "strength:added",
  STRENGTH_UPDATED: "strength:updated",
  ORDER_ADDED: "order:added",
  ORDER_UPDATED: "order:updated",
  LOG_ADDED: "log:added",
} as const;

// Event payload types
export interface StrengthAddedEvent {
  id?: string;
  ticker: string;
  interval: string;
  strength: number;
  price?: number;
  volume?: number;
  timenow: Date | string;
}

export interface OrderAddedEvent {
  id: string;
  ticker: string;
  position: number;
  status: string;
  timenow: Date | string;
}

export interface LogAddedEvent {
  id: string;
  name: string;
  message: string;
  timenow: Date | string;
}

// Channel names for subscribing to specific data streams
export const CHANNELS = {
  STRENGTH: "strength",
  STRENGTH_TICKER: (ticker: string) => `strength:${ticker}`,
  ORDERS: "orders",
  ORDERS_TICKER: (ticker: string) => `orders:${ticker}`,
  LOGS: "logs",
} as const;
