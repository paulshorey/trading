import { Server as HTTPServer } from "http";
import { Socket as NetSocket } from "net";
import { NextApiResponse } from "next";
import { Server as IOServer } from "socket.io";

export interface SocketServer extends HTTPServer {
  io?: IOServer | undefined;
}

export interface SocketWithIO extends NetSocket {
  server: SocketServer;
}

export interface NextApiResponseWithSocket extends NextApiResponse {
  socket: SocketWithIO;
}

/**
 * Global singleton for Socket.IO server instance
 */
let io: IOServer | undefined;

/**
 * Get or create Socket.IO server instance
 */
export function getSocketIO(res?: NextApiResponseWithSocket): IOServer | undefined {
  if (!res?.socket?.server) {
    console.warn("No server available for Socket.IO");
    return undefined;
  }

  if (!res.socket.server.io) {
    console.log("Initializing Socket.IO server...");

    // Create Socket.IO server
    io = new IOServer(res.socket.server, {
      path: "/api/socket",
      cors: {
        origin:
          process.env.NODE_ENV === "production"
            ? [process.env.NEXT_PUBLIC_APP_URL || ""]
            : (origin, cb) => {
                if (!origin) return cb(null, true);
                const ok = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
                cb(ok ? null : new Error("Not allowed by CORS"), ok);
              },
        methods: ["GET", "POST"],
      },
      transports: ["websocket", "polling"],
    });

    // Attach to server
    res.socket.server.io = io;

    // Set up connection handler
    io.on("connection", (socket) => {
      console.log(`Client connected: ${socket.id}`);

      // Handle joining specific channels
      socket.on("subscribe", (channel: string) => {
        console.log(`Client ${socket.id} subscribing to channel: ${channel}`);
        socket.join(channel);
        socket.emit("subscribed", { channel });
      });

      // Handle leaving channels
      socket.on("unsubscribe", (channel: string) => {
        console.log(`Client ${socket.id} unsubscribing from channel: ${channel}`);
        socket.leave(channel);
        socket.emit("unsubscribed", { channel });
      });

      socket.on("disconnect", () => {
        console.log(`Client disconnected: ${socket.id}`);
      });
    });
  } else {
    io = res.socket.server.io;
  }

  return io;
}

/**
 * Emit an event to all connected clients or specific room
 */
export function emitSocketEvent(event: string, data: any, room?: string): boolean {
  try {
    // Get the global io instance if available
    const globalIO = (global as any).io as IOServer | undefined;

    if (globalIO) {
      if (room) {
        globalIO.to(room).emit(event, data);
        console.log(`Emitted '${event}' to room '${room}'`);
      } else {
        globalIO.emit(event, data);
        console.log(`Emitted '${event}' to all clients`);
      }
      return true;
    } else {
      console.warn("Socket.IO server not initialized - cannot emit event");
      return false;
    }
  } catch (error) {
    console.error("Error emitting socket event:", error);
    return false;
  }
}

/**
 * Store IO instance globally for access from anywhere
 */
export function setGlobalIO(ioInstance: IOServer) {
  (global as any).io = ioInstance;
}
