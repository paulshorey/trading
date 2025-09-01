# WebSocket Implementation Guide

## Overview

This monorepo now includes WebSocket functionality for real-time data updates. When new strength data is added to the database, connected clients receive instant notifications without polling.

## Architecture

### Server-Side Components

1. **WebSocket Server** (`apps/common/websocket/`)
   - `socket.ts` - Core Socket.IO server setup and singleton management
   - `events.ts` - Event names and payload type definitions
   - `emitter.ts` - Helper functions to emit specific events

2. **API Integration**
   - `apps/trade/pages/api/socket.ts` - WebSocket server initialization endpoint
   - `apps/trade/app/api/v1/market/route.ts` - Emits events when strength data is saved

3. **Database Integration**
   - `apps/common/sql/strength/add.ts` - Optional WebSocket emission after database save

### Client-Side Components

1. **React Hooks** (`apps/common/fe/hooks/`)
   - `useWebSocket.ts` - Core WebSocket hook for connection management
   - `useStrengthUpdates()` - Subscribe to strength data updates
   - `useOrderUpdates()` - Subscribe to order updates

2. **Provider Component**
   - `apps/common/fe/components/providers/WebSocketProvider.tsx` - Context provider for WebSocket

3. **Example Components**
   - `apps/data/components/RealtimeStrengthMonitor.tsx` - Real-time monitoring component
   - `apps/data/app/realtime/page.tsx` - Example page implementation

## Setup Instructions

### 1. Install Dependencies

The Socket.IO packages have already been installed in both `apps/trade` and `apps/common`:

```bash
# Already installed via:
cd apps/trade && pnpm add socket.io socket.io-client
cd apps/common && pnpm add socket.io socket.io-client
```

### 2. Start the Applications

```bash
# From monorepo root
pnpm dev

# Or start specific apps
cd apps/trade && pnpm dev  # Runs on port 3001
cd apps/data && pnpm dev   # Runs on port 3000
```

### 3. View Real-time Updates

1. Open the monitoring page: http://localhost:3000/realtime
2. The WebSocket connection will establish automatically
3. Send test data to see real-time updates

## Testing WebSocket

### Method 1: Using the Test Script

```bash
# From apps/trade directory
./scripts/test-websocket.sh
```

### Method 2: Manual API Calls

Send strength data to the API endpoint:

```bash
curl -X POST http://localhost:3001/api/v1/market?access_key=testkeyx \
  -H "Content-Type: text/plain" \
  -d "ETHUSD 75.5 @ 5m price=3250.50 volume=1234567"
```

### Method 3: Using Production Indicators

Your production TradingView indicators can continue sending data as usual. The WebSocket events will be emitted automatically.

## Event Types

### Strength Events

- **Event Name**: `strength:added`
- **Channels**:
  - `strength` - All strength updates
  - `strength:TICKER` - Ticker-specific updates (e.g., `strength:BTCUSD`)

### Payload Structure

```typescript
{
  id?: string;
  ticker: string;
  interval: string;
  strength: number;
  price?: number;
  volume?: number;
  timenow: Date | string;
}
```

## Usage in React Components

### Basic WebSocket Hook Usage

```tsx
import { useWebSocket } from "@apps/common/fe/hooks/useWebSocket";

function MyComponent() {
  const { connected, subscribe, on } = useWebSocket();

  useEffect(() => {
    if (connected) {
      subscribe("strength");

      on("strength:added", (data) => {
        console.log("New strength data:", data);
      });
    }
  }, [connected]);
}
```

### Using the Strength Updates Hook

```tsx
import { useStrengthUpdates } from "@apps/common/fe/hooks/useWebSocket";

function StrengthMonitor() {
  // Subscribe to all strength updates
  const latestUpdate = useStrengthUpdates();

  // Or subscribe to specific ticker
  const btcUpdate = useStrengthUpdates("BTCUSD", (data) => {
    console.log("BTC update:", data);
  });

  return (
    <div>
      {latestUpdate && (
        <p>
          Latest: {latestUpdate.ticker} - {latestUpdate.strength}
        </p>
      )}
    </div>
  );
}
```

### With WebSocket Provider

```tsx
import { WebSocketProvider } from "@apps/common/fe/components/providers/WebSocketProvider";
import { RealtimeStrengthMonitor } from "../components/RealtimeStrengthMonitor";

export default function Page() {
  return (
    <WebSocketProvider>
      <RealtimeStrengthMonitor />
    </WebSocketProvider>
  );
}
```

## Advanced Configuration

### Custom WebSocket URL

```tsx
<WebSocketProvider url="https://your-domain.com">{/* Your app */}</WebSocketProvider>
```

### Manual Connection Control

```tsx
const { connect, disconnect, connected } = useWebSocket({
  autoConnect: false,
});

// Connect manually
const handleConnect = () => connect();
const handleDisconnect = () => disconnect();
```

## Troubleshooting

### Connection Issues

1. **Check WebSocket server is initialized**:

   ```bash
   curl http://localhost:3001/api/socket
   ```

2. **Verify CORS settings** in `apps/common/websocket/socket.ts` if connecting from different origins

3. **Check browser console** for WebSocket connection errors

### Events Not Received

1. **Ensure subscription to correct channel**:

   ```tsx
   subscribe("strength"); // or specific: subscribe("strength:BTCUSD")
   ```

2. **Verify event names match** between server and client

3. **Check WebSocket connection status** in the monitoring component

### Development vs Production

- Development uses localhost with multiple ports
- Production should use environment variables for URLs:
  ```tsx
  url: process.env.NEXT_PUBLIC_WEBSOCKET_URL || window.location.origin;
  ```

## Security Considerations

1. **Authentication**: Currently uses `access_key` for API authentication. Consider adding Socket.IO authentication for production.

2. **Rate Limiting**: Implement rate limiting for WebSocket connections and events.

3. **SSL/TLS**: Use WSS (WebSocket Secure) in production.

4. **Input Validation**: Always validate data before emitting events.

## Future Enhancements

- [ ] Add authentication to WebSocket connections
- [ ] Implement room-based permissions
- [ ] Add event acknowledgments
- [ ] Create admin dashboard for monitoring connections
- [ ] Add reconnection with event replay
- [ ] Implement event history/persistence
