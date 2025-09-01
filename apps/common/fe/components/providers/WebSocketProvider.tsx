"use client";

import React, { createContext, useContext, useEffect } from "react";
import { useWebSocket, UseWebSocketReturn } from "../../hooks/useWebSocket";

interface WebSocketContextValue extends UseWebSocketReturn {
  isReady: boolean;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

export interface WebSocketProviderProps {
  children: React.ReactNode;
  url?: string;
  autoConnect?: boolean;
}

/**
 * WebSocket Provider Component
 * Wraps the application to provide WebSocket functionality
 */
export function WebSocketProvider({ children, url, autoConnect = true }: WebSocketProviderProps) {
  const webSocket = useWebSocket({
    url,
    autoConnect,
    reconnection: true,
    reconnectionAttempts: 5,
    reconnectionDelay: 1000,
  });

  // Initialize WebSocket server on mount
  useEffect(() => {
    if (typeof window !== "undefined" && autoConnect) {
      // Call the socket initialization endpoint to ensure server is set up
      fetch("/api/socket")
        .then((res) => res.json())
        .then((data) => {
          if (data.ok) {
            console.log("WebSocket server initialized");
          } else {
            console.error("Failed to initialize WebSocket server:", data.error);
          }
        })
        .catch((err) => {
          console.error("Error initializing WebSocket:", err);
        });
    }
  }, [autoConnect]);

  const contextValue: WebSocketContextValue = {
    ...webSocket,
    isReady: webSocket.connected,
  };

  return <WebSocketContext.Provider value={contextValue}>{children}</WebSocketContext.Provider>;
}

/**
 * Hook to use WebSocket context
 */
export function useWebSocketContext(): WebSocketContextValue {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error("useWebSocketContext must be used within WebSocketProvider");
  }
  return context;
}
