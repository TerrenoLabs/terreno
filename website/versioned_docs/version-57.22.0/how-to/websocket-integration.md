# How to Add WebSocket Integration

Step-by-step guide to adding real-time Socket.io connections to your Terreno application using `@terreno/rtk`.

## Prerequisites

- Backend with Socket.io server configured
- Frontend using `@terreno/rtk` and `@terreno/ui`
- Redux store set up with `generateAuthSlice`

## Installation

Socket.io dependencies are already included in `@terreno/rtk`:

``````bash
bun install @terreno/rtk
# socket.io-client is a peer dependency
bun install socket.io-client
``````

## Backend Setup

### 1. Add Socket.io to Express Server

``````typescript
import {createServer} from "node:http";
import {Server} from "socket.io";
import {setupServer} from "@terreno/api";

const app = setupServer({
  userModel: User,
  addRoutes: (router) => {
    // Your routes
  },
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:8081",
    credentials: true,
  },
  transports: ["websocket"],
});

// Authentication middleware
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token?.replace("Bearer ", "");
  
  if (!token) {
    return next(new Error("Authentication required"));
  }
  
  try {
    // Verify JWT token
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.sub);
    
    if (!user) {
      return next(new Error("User not found"));
    }
    
    socket.data.user = user;
    next();
  } catch (error) {
    next(new Error("Invalid token"));
  }
});

// Connection handling
io.on("connection", (socket) => {
  const user = socket.data.user;
  console.log(`User connected: ${user.email} (${socket.id})`);
  
  // Join user-specific room
  socket.join(`user:${user._id}`);
  
  // Handle custom events
  socket.on("subscribe:todos", () => {
    socket.join("todos");
    console.log(`${user.email} subscribed to todos`);
  });
  
  socket.on("disconnect", (reason) => {
    console.log(`User disconnected: ${user.email} (${reason})`);
  });
});

httpServer.listen(4000, () => {
  console.log("Server listening on port 4000");
});

export {io}; // Export for emitting events from routes
``````

### 2. Emit Events from API Routes

``````typescript
import {io} from "./server";

// In your modelRouter postCreate hook
modelRouter(Todo, {
  permissions: {
    create: [Permissions.IsAuthenticated],
  },
  postCreate: (todo, req) => {
    // Emit to all clients in the todos room
    io.to("todos").emit("todo:created", {
      id: todo._id,
      title: todo.title,
      ownerId: todo.ownerId,
    });
    
    // Emit to specific user
    io.to(`user:${todo.ownerId}`).emit("notification", {
      type: "todo_created",
      message: `Todo "${todo.title}" created`,
    });
  },
});
``````

## Frontend Setup

### 1. Configure WebSocket URL

Add to your `app.json` or environment:

``````json
{
  "expo": {
    "extra": {
      "WEBSOCKET_URL": "wss://api.example.com",
      "WEBSOCKETS_DEBUG": false
    }
  }
}
``````

### 2. Register the token source

The hook reads its handshake token from the token source the app registers once at startup
with `setTokenSource`. A JWT app registers nothing: the default source reads the JWT in
storage. A Better Auth app registers the adapter it builds for syncdb:

``````typescript
// store/tokenSource.ts: import once from the app entry, before the store is created
import {setTokenSource} from "@terreno/rtk";
import {betterAuthAdapter, bridgeBetterAuthReactClient} from "@terreno/syncdb";
import {authClient} from "@/lib/betterAuth";

setTokenSource(betterAuthAdapter(bridgeBetterAuthReactClient(authClient)));
``````

With `webAuth: "bearer"`, also pass the adapter `getBearerToken`
([syncdb adapter](../reference/syncdb.md#createsyncdb-configuration)).

With a token source, the hook:

- reads `getToken()` on every connect and reconnect;
- calls `refresh()` once when the server rejects the token, then reconnects, and stops after a
  second rejection (`onConnectError` fires). With no `refresh`, or a failed one, it stops at
  once;
- reconnects with the new token when `onAuthChange` fires, and disconnects when there is no
  token.

To use a different source for one socket, pass it as `tokenSource`. Passing the legacy
`getAuthToken` getter instead turns the token source off for that hook. See
[Token source](../reference/legacy/rtk.md#token-source).

### 3. Set Up Connection Hook

Create a custom hook to manage the connection. A Better Auth app gates `shouldConnect` on
`selectBetterAuthUserId` instead of the JWT user id:

``````typescript
// hooks/useWebSocket.ts
import {useSocketConnection, baseWebsocketsUrl} from "@terreno/rtk";
import {selectBetterAuthUserId} from "@terreno/rtk";
import {useSelector} from "react-redux";
import {useCallback} from "react";
import * as Sentry from "@sentry/react-native";

export const useWebSocket = () => {
  const userId = useSelector(selectBetterAuthUserId); // JWT apps: useSelectCurrentUserId()
  
  const {socket, isSocketConnected} = useSocketConnection({
    baseUrl: baseWebsocketsUrl,
    shouldConnect: !!userId,
    onConnect: () => {
      console.info("[WebSocket] Connected");
    },
    onDisconnect: () => {
      console.warn("[WebSocket] Disconnected");
    },
    onConnectError: (error) => {
      console.error("[WebSocket] Connection error:", error.message);
    },
    captureEvent: (eventName, data) => {
      Sentry.captureMessage(eventName, {
        level: "info",
        extra: data,
      });
    },
  });
  
  return {socket, isSocketConnected};
};
``````

#### Transports

`useSocketConnection` starts with HTTP long-polling and upgrades to WebSocket (`transports: ["polling", "websocket"]`), so a restarting dev server does not fail the first handshake. Polling needs every request of a session to reach the same server process. Hosts without session affinity, such as Vercel Functions, need WebSocket only:

``````typescript
useSocketConnection({
  baseUrl,
  shouldConnect: !!userId,
  transports: ["websocket"],
});
``````

`@terreno/syncdb` takes the same list as `createSyncDb({socketTransports: ["websocket"]})`. Cloud Run with `--session-affinity` works with the default. See [Run Terreno WebSockets on Vercel Functions](vercel-function-websockets.md).

`baseWebsocketsUrl` replaces `api.` with `ws.` in the API host (`https://api.example.com` becomes `ws.example.com`), for deployments that run sockets on a separate host. If sockets are served by the API host itself, as on Vercel, pass `baseUrl` instead.

### 4. Subscribe to Events in Components

``````typescript
// screens/TodoList.tsx
import {useWebSocket} from "@/hooks/useWebSocket";
import {useEffect, useCallback} from "react";

export const TodoListScreen = () => {
  const {data: todos, refetch} = useGetTodosQuery();
  const {socket} = useWebSocket();
  
  // Subscribe to todo events
  useEffect(() => {
    if (!socket) return;
    
    // Join the todos room
    socket.emit("subscribe:todos");
    
    // Handle todo created event
    const handleTodoCreated = (todo) => {
      console.info("New todo created:", todo);
      refetch(); // Refresh the list
    };
    
    // Handle todo updated event
    const handleTodoUpdated = (todo) => {
      console.info("Todo updated:", todo);
      refetch();
    };
    
    socket.on("todo:created", handleTodoCreated);
    socket.on("todo:updated", handleTodoUpdated);
    
    // Cleanup
    return () => {
      socket.off("todo:created", handleTodoCreated);
      socket.off("todo:updated", handleTodoUpdated);
    };
  }, [socket, refetch]);
  
  return (
    <Page title="Todos">
      {todos?.data.map((todo) => (
        <TodoItem key={todo._id} todo={todo} />
      ))}
    </Page>
  );
};
``````

### 5. Show Connection Status (Optional)

``````typescript
import {useWebSocket} from "@/hooks/useWebSocket";
import {Box, Text, Badge} from "@terreno/ui";

export const ConnectionStatus = () => {
  const {isSocketConnected} = useWebSocket();
  
  return (
    <Box direction="row" gap={2} alignItems="center">
      <Badge
        variant={isSocketConnected.isConnected ? "success" : "error"}
        text={isSocketConnected.isConnected ? "Connected" : "Disconnected"}
      />
      {!isSocketConnected.isConnected && isSocketConnected.lastDisconnectedAt && (
        <Text size="sm" color="secondaryDark">
          Reconnecting...
        </Text>
      )}
    </Box>
  );
};
``````

## Advanced Patterns

### Optimistic Updates with Real-time Sync

``````typescript
const [updateTodo] = usePatchTodosMutation();

const handleToggle = useCallback(async (todo) => {
  // Optimistic update
  const completed = !todo.completed;
  
  try {
    await updateTodo({
      id: todo._id,
      body: {completed},
    }).unwrap();
    
    // Server will emit event, triggering refetch for other clients
  } catch (error) {
    console.error("Failed to update todo:", error);
    // Revert optimistic update
  }
}, [updateTodo]);
``````

### Room-based Subscriptions

``````typescript
// Backend: User joins project-specific room
socket.on("join:project", (projectId) => {
  socket.join(`project:${projectId}`);
});

// Emit to project room
io.to(`project:${projectId}`).emit("project:updated", project);

// Frontend: Subscribe to project updates
useEffect(() => {
  if (!socket || !projectId) return;
  
  socket.emit("join:project", projectId);
  socket.on("project:updated", handleProjectUpdate);
  
  return () => {
    socket.off("project:updated", handleProjectUpdate);
  };
}, [socket, projectId]);
``````

### Presence System

``````typescript
// Backend: Track active users
const activeUsers = new Map();

io.on("connection", (socket) => {
  const user = socket.data.user;
  activeUsers.set(user._id, {socketId: socket.id, lastSeen: new Date()});
  
  io.emit("presence:update", Array.from(activeUsers.keys()));
  
  socket.on("disconnect", () => {
    activeUsers.delete(user._id);
    io.emit("presence:update", Array.from(activeUsers.keys()));
  });
});

// Frontend: Show active users
const [activeUsers, setActiveUsers] = useState<string[]>([]);

useEffect(() => {
  if (!socket) return;
  
  socket.on("presence:update", (userIds) => {
    setActiveUsers(userIds);
  });
  
  return () => {
    socket.off("presence:update");
  };
}, [socket]);
``````

## Debugging

Enable debug logging in your `app.json`:

``````json
{
  "expo": {
    "extra": {
      "WEBSOCKETS_DEBUG": true
    }
  }
}
``````

This logs:
- Connection attempts
- Disconnection events with reasons
- Token refresh attempts
- Reconnection failures

## Troubleshooting

### "Authentication required" error

**Cause:** Token not provided or invalid.

**Solution:**
1. Ensure the token source returns a valid token: `await getTokenSource()?.getToken()` (or
   `getAuthToken()` on a JWT app with no source registered)
2. Check backend token verification logic
3. Enable `WEBSOCKETS_DEBUG` to see token status

### Frequent disconnections

**Cause:** Token expiration, network issues, or server restarts.

**Solution:**
- `useSocketConnection` automatically reconnects (5 attempts)
- Tokens are refreshed if expiring within 60 seconds
- Toast notifications inform users after 9+ seconds
- On Vercel Functions, every socket closes at the Function max duration (300s by default); see [reconnects](vercel-function-websockets.md#reconnects)

### "Session ID unknown" or a 400 on `transport=polling`

**Cause:** Polling requests for one session reached different server instances (no session affinity).

**Solution:** Pass `transports: ["websocket"]` to `useSocketConnection` and `socketTransports: ["websocket"]` to `createSyncDb`, or enable session affinity on the host.

### Events not received

**Cause:** Not subscribed to the correct room, or event name mismatch.

**Solution:**
1. Verify room subscription: `socket.emit("subscribe:todos")`
2. Check event names match between backend and frontend
3. Use `socket.onAny((event, ...args) => console.log(event, args))` to debug

### Token refresh loops

**Cause:** Backend rejecting refresh token.

**Solution:**
1. Check `REFRESH_TOKEN_SECRET` matches between backend and frontend config
2. Verify refresh token hasn't expired
3. Check Sentry/logs for token verification errors

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `WEBSOCKET_URL` | Yes | WebSocket server URL (e.g., `wss://api.example.com`) |
| `WEBSOCKETS_DEBUG` | No | Enable debug logging (default: false) |
| `TOKEN_SECRET` | Yes | JWT secret for token verification (backend) |
| `REFRESH_TOKEN_SECRET` | Yes | Refresh token secret (backend) |

## Security Considerations

1. **Use WSS (TLS):** Always use `wss://` in production
2. **Validate tokens:** Always verify JWT tokens in Socket.io middleware
3. **Room authorization:** Check user permissions before joining rooms
4. **Rate limiting:** Implement rate limits on event emissions
5. **Input validation:** Validate all event data on the server

## Related Documentation

- [@terreno/syncdb Reference](../reference/syncdb.md) — Local-first data layer (replaces RTK for synced collections)
- [@terreno/rtk Reference (legacy)](../reference/legacy/rtk.md) — RTK Query utilities during the support window
- [Authentication Architecture](../explanation/authentication.md) — JWT system deep-dive
- [Run Terreno WebSockets on Vercel Functions](vercel-function-websockets.md) — Vercel's WebSocket beta: transports, reconnects, cross-instance state
- [Socket.io Documentation](https://socket.io/docs/v4/) — Official Socket.io docs
