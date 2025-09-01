import { SOCKET_EVENTS, CHANNELS, StrengthAddedEvent, OrderAddedEvent, LogAddedEvent } from "./events";
import { emitSocketEvent } from "./socket";

/**
 * Emit strength added event to WebSocket clients
 */
export function emitStrengthAdded(data: StrengthAddedEvent): boolean {
  // Emit to general strength channel
  const generalSuccess = emitSocketEvent(SOCKET_EVENTS.STRENGTH_ADDED, data, CHANNELS.STRENGTH);

  // Also emit to ticker-specific channel
  const tickerSuccess = emitSocketEvent(SOCKET_EVENTS.STRENGTH_ADDED, data, CHANNELS.STRENGTH_TICKER(data.ticker));

  return generalSuccess || tickerSuccess;
}

/**
 * Emit order added event to WebSocket clients
 */
export function emitOrderAdded(data: OrderAddedEvent): boolean {
  // Emit to general orders channel
  const generalSuccess = emitSocketEvent(SOCKET_EVENTS.ORDER_ADDED, data, CHANNELS.ORDERS);

  // Also emit to ticker-specific channel
  const tickerSuccess = emitSocketEvent(SOCKET_EVENTS.ORDER_ADDED, data, CHANNELS.ORDERS_TICKER(data.ticker));

  return generalSuccess || tickerSuccess;
}

/**
 * Emit log added event to WebSocket clients
 */
export function emitLogAdded(data: LogAddedEvent): boolean {
  return emitSocketEvent(SOCKET_EVENTS.LOG_ADDED, data, CHANNELS.LOGS);
}
