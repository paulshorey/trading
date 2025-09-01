"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { SOCKET_EVENTS, CHANNELS } from "../../websocket/events";

export interface UseWebSocketOptions {
  autoConnect?: boolean;
  reconnection?: boolean;
  reconnectionAttempts?: number;
  reconnectionDelay?: number;
  url?: string;
}

export interface UseWebSocketReturn {
  socket: Socket | null;
  connected: boolean;
  connect: () => void;
  disconnect: () => void;
  subscribe: (channel: string) => void;
  unsubscribe: (channel: string) => void;
  on: (event: string, handler: (data: any) => void) => void;
  off: (event: string, handler?: (data: any) => void) => void;
  emit: (event: string, data: any) => void;
}

/**
 * React hook for WebSocket connection and event handling
 */
export function useWebSocket(options: UseWebSocketOptions = {}): UseWebSocketReturn {
  const {
    autoConnect = true,
    reconnection = true,
    reconnectionAttempts = 5,
    reconnectionDelay = 1000,
    url = typeof window !== "undefined" ? window.location.origin : "",
  } = options;

  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Initialize socket connection
  const connect = useCallback(() => {
    if (socketRef.current?.connected) {
      console.log("Socket already connected");
      return;
    }

    console.log("Connecting to WebSocket server...");

    const newSocket = io(url, {
      path: "/api/socket",
      reconnection,
      reconnectionAttempts,
      reconnectionDelay,
      transports: ["websocket", "polling"],
    });

    // Set up event listeners
    newSocket.on("connect", () => {
      console.log("WebSocket connected:", newSocket.id);
      setConnected(true);
    });

    newSocket.on("disconnect", () => {
      console.log("WebSocket disconnected");
      setConnected(false);
    });

    newSocket.on("error", (error) => {
      console.error("WebSocket error:", error);
    });

    socketRef.current = newSocket;
    setSocket(newSocket);
  }, [url, reconnection, reconnectionAttempts, reconnectionDelay]);

  // Disconnect socket
  const disconnect = useCallback(() => {
    if (socketRef.current) {
      console.log("Disconnecting WebSocket...");
      socketRef.current.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
    }
  }, []);

  // Subscribe to a channel
  const subscribe = useCallback((channel: string) => {
    if (socketRef.current?.connected) {
      console.log(`Subscribing to channel: ${channel}`);
      socketRef.current.emit(SOCKET_EVENTS.SUBSCRIBE, channel);
    } else {
      console.warn("Cannot subscribe: Socket not connected");
    }
  }, []);

  // Unsubscribe from a channel
  const unsubscribe = useCallback((channel: string) => {
    if (socketRef.current?.connected) {
      console.log(`Unsubscribing from channel: ${channel}`);
      socketRef.current.emit(SOCKET_EVENTS.UNSUBSCRIBE, channel);
    } else {
      console.warn("Cannot unsubscribe: Socket not connected");
    }
  }, []);

  // Add event listener
  const on = useCallback((event: string, handler: (data: any) => void) => {
    if (socketRef.current) {
      socketRef.current.on(event, handler);
    } else {
      console.warn("Cannot add listener: Socket not initialized");
    }
  }, []);

  // Remove event listener
  const off = useCallback((event: string, handler?: (data: any) => void) => {
    if (socketRef.current) {
      if (handler) {
        socketRef.current.off(event, handler);
      } else {
        socketRef.current.off(event);
      }
    }
  }, []);

  // Emit event
  const emit = useCallback((event: string, data: any) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit(event, data);
    } else {
      console.warn("Cannot emit: Socket not connected");
    }
  }, []);

  // Auto-connect on mount if enabled
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      if (socketRef.current) {
        disconnect();
      }
    };
  }, [autoConnect]); // Only depend on autoConnect, not connect/disconnect functions

  return {
    socket,
    connected,
    connect,
    disconnect,
    subscribe,
    unsubscribe,
    on,
    off,
    emit,
  };
}

/**
 * Hook for subscribing to strength data updates
 */
export function useStrengthUpdates(ticker?: string, onUpdate?: (data: any) => void) {
  const { connected, subscribe, unsubscribe, on, off } = useWebSocket();
  const [latestData, setLatestData] = useState<any>(null);

  useEffect(() => {
    if (!connected) return;

    // Subscribe to appropriate channel
    const channel = ticker ? CHANNELS.STRENGTH_TICKER(ticker) : CHANNELS.STRENGTH;

    subscribe(channel);

    // Set up event handler
    const handleUpdate = (data: any) => {
      console.log("Received strength update:", data);
      setLatestData(data);
      onUpdate?.(data);
    };

    on(SOCKET_EVENTS.STRENGTH_ADDED, handleUpdate);

    // Cleanup
    return () => {
      off(SOCKET_EVENTS.STRENGTH_ADDED, handleUpdate);
      unsubscribe(channel);
    };
  }, [connected, ticker, onUpdate]);

  return latestData;
}

/**
 * Hook for subscribing to order updates
 */
export function useOrderUpdates(ticker?: string, onUpdate?: (data: any) => void) {
  const { connected, subscribe, unsubscribe, on, off } = useWebSocket();
  const [latestData, setLatestData] = useState<any>(null);

  useEffect(() => {
    if (!connected) return;

    // Subscribe to appropriate channel
    const channel = ticker ? CHANNELS.ORDERS_TICKER(ticker) : CHANNELS.ORDERS;

    subscribe(channel);

    // Set up event handler
    const handleUpdate = (data: any) => {
      console.log("Received order update:", data);
      setLatestData(data);
      onUpdate?.(data);
    };

    on(SOCKET_EVENTS.ORDER_ADDED, handleUpdate);

    // Cleanup
    return () => {
      off(SOCKET_EVENTS.ORDER_ADDED, handleUpdate);
      unsubscribe(channel);
    };
  }, [connected, ticker, onUpdate]);

  return latestData;
}
