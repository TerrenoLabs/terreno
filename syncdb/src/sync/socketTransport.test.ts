import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {createServer, type Server as HttpServer} from "node:http";
import type {AddressInfo} from "node:net";
import {Server, type Socket as ServerSocket} from "socket.io";

import type {
  SyncAck,
  SyncDelta,
  SyncMutateBatchRequest,
  SyncMutateRequest,
  SyncNack,
} from "../types";
import {createSocketTransport} from "./socketTransport";
import type {SyncTransport, TransportStatus} from "./transport";

interface TestServer {
  baseUrl: string;
  io: Server;
  httpServer: HttpServer;
  /** Sockets that have connected, most recent last. */
  sockets: ServerSocket[];
  /** sync:subscribe payloads received, in order. */
  subscribes: {collections: string[]; mode?: string}[];
  /** Handler answering sync:mutate; replace per test. */
  mutateHandler: (request: SyncMutateRequest, socket: ServerSocket) => void;
  /** Handler answering sync:mutateBatch; replace per test (no-op = unsupported). */
  mutateBatchHandler?: (
    request: SyncMutateBatchRequest,
    socket: ServerSocket,
    ack: (response: unknown) => void
  ) => void;
  close: () => Promise<void>;
}

const startServer = async (): Promise<TestServer> => {
  const httpServer = createServer();
  const io = new Server(httpServer);
  const server: TestServer = {
    baseUrl: "",
    close: async () => {
      io.disconnectSockets(true);
      // Kill lingering HTTP long-polling connections so close() can complete.
      httpServer.closeAllConnections();
      await new Promise<void>((resolve) => {
        io.close(() => resolve());
      });
    },
    httpServer,
    io,
    mutateHandler: () => {},
    sockets: [],
    subscribes: [],
  };
  io.on("connection", (socket) => {
    server.sockets.push(socket);
    socket.on("sync:subscribe", (payload: {collections: string[]; mode?: string}) => {
      server.subscribes.push(payload);
    });
    socket.on("sync:mutate", (request: SyncMutateRequest) => {
      server.mutateHandler(request, socket);
    });
    socket.on(
      "sync:mutateBatch",
      (request: SyncMutateBatchRequest, ack: (response: unknown) => void) => {
        server.mutateBatchHandler?.(request, socket, ack);
      }
    );
  });
  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve());
  });
  const {port} = httpServer.address() as AddressInfo;
  server.baseUrl = `http://127.0.0.1:${port}`;
  return server;
};

const waitUntil = async (predicate: () => boolean, timeoutMs = 500): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitUntil timed out");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("createSocketTransport", () => {
  let server: TestServer;
  let transport: SyncTransport | undefined;
  const tokenCalls: number[] = [];

  const makeTransport = (timeoutMs?: number, batchUnsupportedGraceMs?: number): SyncTransport => {
    transport = createSocketTransport({
      authProvider: {
        getToken: async () => {
          tokenCalls.push(Date.now());
          return "test-token";
        },
      },
      baseUrl: server.baseUrl,
      batchUnsupportedGraceMs,
      timeoutMs,
      // Websocket-only: polling→websocket upgrade emits disconnect and
      // flakes the timeout test on GitHub runners.
      transports: ["websocket"],
    });
    return transport;
  };

  beforeEach(async () => {
    tokenCalls.length = 0;
    server = await startServer();
  });

  afterEach(async () => {
    transport?.disconnect();
    transport = undefined;
    await server.close();
  });

  it("connects with the auth token from the provider and reports status", async () => {
    const statuses: TransportStatus[] = [];
    const connecting = makeTransport();
    connecting.onStatusChange((status) => statuses.push(status));
    await connecting.connect();
    expect(statuses).toEqual([{connected: true}]);
    expect(tokenCalls.length).toBeGreaterThanOrEqual(1);
    // The raw provider token is sent Bearer-prefixed, matching the server's
    // legacy JWT socket validator (and the HTTP channel's Authorization header).
    expect(server.sockets[0]?.handshake.auth.token).toBe("Bearer test-token");

    connecting.disconnect();
    // Allow the disconnect event to round-trip.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(statuses).toEqual([{connected: true}, {connected: false}]);
  });

  it("connect() resolves immediately when already connected", async () => {
    const connecting = makeTransport();
    await connecting.connect();
    await connecting.connect();
    expect(server.sockets).toHaveLength(1);
  });

  it("subscribe emits window mode for window collections", async () => {
    const subscriber = makeTransport();
    subscriber.subscribe(["todos"], {mode: "window"});
    await subscriber.connect();
    await waitUntil(() => server.subscribes.length === 1);
    expect(server.subscribes).toEqual([{collections: ["todos"], mode: "window"}]);
  });

  it("subscribe emits sync:subscribe when connected and replays it on connect", async () => {
    const subscriber = makeTransport();
    // Subscribed before connect: sent once the connection opens.
    subscriber.subscribe(["todos"]);
    await subscriber.connect();
    await waitUntil(() => server.subscribes.length === 1);
    expect(server.subscribes).toEqual([{collections: ["todos"]}]);

    // Subscribed while connected: sent immediately.
    subscriber.subscribe(["notes"]);
    await waitUntil(() => server.subscribes.length === 2);
    expect(server.subscribes).toEqual([{collections: ["todos"]}, {collections: ["notes"]}]);
  });

  it("reports sync:subscribed confirmations to onSubscribed listeners", async () => {
    server.io.removeAllListeners("connection");
    server.io.on("connection", (socket) => {
      socket.on("sync:subscribe", (payload: {collections: string[]}) => {
        for (const collection of payload.collections) {
          socket.emit("sync:subscribed", {collection, streams: [`${collection}|owner:u1`]});
        }
      });
    });
    const subscriber = makeTransport();
    const confirmations: {collection: string; streams: string[]}[] = [];
    subscriber.onSubscribed?.((subscribed) => confirmations.push(subscribed));
    subscriber.subscribe(["todos"]);
    await subscriber.connect();
    await waitUntil(() => confirmations.length === 1);
    expect(confirmations).toEqual([{collection: "todos", streams: ["todos|owner:u1"]}]);
  });

  it("ignores malformed sync:subscribed payloads", async () => {
    server.io.removeAllListeners("connection");
    server.io.on("connection", (socket) => {
      socket.on("sync:subscribe", () => {
        socket.emit("sync:subscribed", {collection: "todos"});
        socket.emit("sync:subscribed", {streams: ["todos|owner:u1"]});
        socket.emit("sync:subscribed", {collection: "todos", streams: [1, "todos|owner:u1"]});
      });
    });
    const subscriber = makeTransport();
    const confirmations: {collection: string; streams: string[]}[] = [];
    subscriber.onSubscribed?.((subscribed) => confirmations.push(subscribed));
    subscriber.subscribe(["todos"]);
    await subscriber.connect();
    await waitUntil(() => confirmations.length === 1);
    // Only the third payload is well-formed enough to deliver, with the non-string
    // stream dropped rather than passed through to the store.
    expect(confirmations).toEqual([{collection: "todos", streams: ["todos|owner:u1"]}]);
  });

  it("resolves sendMutation from an emitted sync:ack", async () => {
    server.mutateHandler = (request, socket) => {
      const ack: SyncAck = {id: request.id ?? "x", mutationId: request.mutationId, seq: 3};
      socket.emit("sync:ack", ack);
    };
    const sender = makeTransport();
    await sender.connect();
    const result = await sender.sendMutation({
      collection: "todos",
      data: {title: "a"},
      id: "t1",
      mutationId: "m1",
      operation: "create",
    });
    expect(result).toEqual({ack: {id: "t1", mutationId: "m1", seq: 3}, type: "ack"});
  });

  it("resolves sendMutation from an emitted sync:nack", async () => {
    server.mutateHandler = (request, socket) => {
      const nack: SyncNack = {code: "conflict", mutationId: request.mutationId, serverSeq: 8};
      socket.emit("sync:nack", nack);
    };
    const sender = makeTransport();
    await sender.connect();
    const result = await sender.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m1",
      operation: "update",
    });
    expect(result).toEqual({
      nack: {code: "conflict", mutationId: "m1", serverSeq: 8},
      type: "nack",
    });
  });

  it("resolves sendMutation via the Socket.io ack callback", async () => {
    server.io.removeAllListeners("connection");
    server.io.on("connection", (socket) => {
      socket.on("sync:mutate", (request: SyncMutateRequest, ack: (response: unknown) => void) => {
        ack({ack: {id: request.id ?? "x", mutationId: request.mutationId, seq: 4}});
      });
    });
    const sender = makeTransport();
    await sender.connect();
    const result = await sender.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m1",
      operation: "update",
    });
    expect(result).toEqual({ack: {id: "t1", mutationId: "m1", seq: 4}, type: "ack"});
  });

  it("resolves sendMutation nacks via the Socket.io ack callback", async () => {
    server.io.removeAllListeners("connection");
    server.io.on("connection", (socket) => {
      socket.on("sync:mutate", (request: SyncMutateRequest, ack: (response: unknown) => void) => {
        ack({nack: {code: "validation", mutationId: request.mutationId}});
      });
    });
    const sender = makeTransport();
    await sender.connect();
    const result = await sender.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m1",
      operation: "update",
    });
    expect(result).toEqual({nack: {code: "validation", mutationId: "m1"}, type: "nack"});
  });

  it("correlates concurrent mutations by mutationId", async () => {
    server.mutateHandler = (request, socket) => {
      // Reply to m1 late so its resolution cannot come from ordering alone.
      const delay = request.mutationId === "m1" ? 40 : 5;
      setTimeout(() => {
        socket.emit("sync:ack", {
          id: request.id ?? "x",
          mutationId: request.mutationId,
          seq: request.mutationId === "m1" ? 1 : 2,
        });
      }, delay);
    };
    const sender = makeTransport();
    await sender.connect();
    const [first, second] = await Promise.all([
      sender.sendMutation({collection: "todos", id: "t1", mutationId: "m1", operation: "update"}),
      sender.sendMutation({collection: "todos", id: "t2", mutationId: "m2", operation: "update"}),
    ]);
    expect(first).toEqual({ack: {id: "t1", mutationId: "m1", seq: 1}, type: "ack"});
    expect(second).toEqual({ack: {id: "t2", mutationId: "m2", seq: 2}, type: "ack"});
  });

  it("rejects sendMutation after the configured timeout", async () => {
    server.mutateHandler = () => {
      // Never reply.
    };
    const sender = makeTransport(50);
    await sender.connect();
    await expect(
      sender.sendMutation({collection: "todos", id: "t1", mutationId: "m1", operation: "update"})
    ).rejects.toThrow("Timed out after 50ms");
  });

  it("rejects in-flight mutations when the transport disconnects", async () => {
    server.mutateHandler = () => {
      // Never reply.
    };
    const sender = makeTransport(5_000);
    await sender.connect();
    const pending = sender.sendMutation({
      collection: "todos",
      id: "t1",
      mutationId: "m1",
      operation: "update",
    });
    // Give the emit a beat to leave, then drop the connection client-side.
    await new Promise((resolve) => setTimeout(resolve, 20));
    sender.disconnect();
    await expect(pending).rejects.toThrow("disconnected");
  });

  it("delivers sync:delta events to listeners with unsubscribe support", async () => {
    const receiver = makeTransport();
    const seen: SyncDelta[] = [];
    const unsubscribe = receiver.onDelta((delta) => seen.push(delta));
    await receiver.connect();

    const delta: SyncDelta = {
      collection: "todos",
      data: {title: "hi"},
      id: "t1",
      method: "create",
      seq: 1,
      stream: "todos|owner:u1",
    };
    server.sockets[0]?.emit("sync:delta", delta);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toEqual([delta]);

    unsubscribe();
    server.sockets[0]?.emit("sync:delta", {...delta, id: "t2"});
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(seen).toHaveLength(1);
  });

  it("coalesces deltas delivered across tasks until the next animation frame", async () => {
    const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
    let flushFrame: FrameRequestCallback | undefined;
    globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
      flushFrame = callback;
      return 1;
    };
    try {
      const receiver = makeTransport();
      const batches: SyncDelta[][] = [];
      receiver.onDeltaBatch?.((deltas) => batches.push(deltas));
      await receiver.connect();

      const first: SyncDelta = {
        collection: "todos",
        data: {title: "first"},
        id: "t1",
        method: "create",
        seq: 1,
        stream: "todos|owner:u1",
      };
      const second: SyncDelta = {...first, data: {title: "second"}, id: "t2", seq: 2};
      server.sockets[0]?.emit("sync:delta", first);
      await waitUntil(() => flushFrame !== undefined);
      server.sockets[0]?.emit("sync:delta", second);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(batches).toEqual([]);
      flushFrame?.(0);
      expect(batches).toEqual([[first, second]]);
    } finally {
      globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    }
  });

  it("sendMutationBatch resolves results from the Socket.io ack callback (FIX 5)", async () => {
    server.mutateBatchHandler = (request, socket, ack) => {
      socket.emit("sync:batchReceived", {batchId: request.batchId});
      ack({
        results: request.mutations.map((mutation) => ({
          ack: {id: mutation.id ?? "x", mutationId: mutation.mutationId, seq: 1},
          type: "ack" as const,
        })),
      });
    };
    const sender = makeTransport();
    await sender.connect();
    // biome-ignore lint/style/noNonNullAssertion: sendMutationBatch is always defined on the socket transport.
    const result = await sender.sendMutationBatch!({
      mutations: [{collection: "todos", id: "t1", mutationId: "m1", operation: "create"}],
    });
    expect(result).toEqual({
      results: [{ack: {id: "t1", mutationId: "m1", seq: 1}, type: "ack"}],
      type: "results",
    });
  });

  it("sendMutationBatch resolves unsupported when the grace period elapses with NO receipt and NO ack (FIX 5)", async () => {
    // No mutateBatchHandler registered at all — mirrors a server with no
    // sync:mutateBatch listener (Socket.io silently drops the emit).
    const sender = makeTransport(undefined, 30);
    await sender.connect();
    const start = Date.now();
    // biome-ignore lint/style/noNonNullAssertion: sendMutationBatch is always defined on the socket transport.
    const result = await sender.sendMutationBatch!({
      mutations: [{collection: "todos", id: "t1", mutationId: "m1", operation: "create"}],
    });
    expect(result).toEqual({type: "unsupported"});
    // Resolved close to the grace period, not the full mutation timeout.
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("a receipt within the grace period prevents 'unsupported' even though the final response is slower than the grace window (FIX 5)", async () => {
    server.mutateBatchHandler = (request, socket, ack) => {
      // Emit the receipt immediately (well within the short grace window),
      // then finish the actual batch AFTER the grace period would have
      // elapsed — this must NOT be treated as unsupported, and must NOT
      // fall back to single sends.
      socket.emit("sync:batchReceived", {batchId: request.batchId});
      setTimeout(() => {
        ack({
          results: request.mutations.map((mutation) => ({
            ack: {id: mutation.id ?? "x", mutationId: mutation.mutationId, seq: 1},
            type: "ack" as const,
          })),
        });
      }, 60);
    };
    const sender = makeTransport(undefined, 30);
    await sender.connect();
    // biome-ignore lint/style/noNonNullAssertion: sendMutationBatch is always defined on the socket transport.
    const result = await sender.sendMutationBatch!({
      mutations: [{collection: "todos", id: "t1", mutationId: "m1", operation: "create"}],
    });
    expect(result).toEqual({
      results: [{ack: {id: "t1", mutationId: "m1", seq: 1}, type: "ack"}],
      type: "results",
    });
  });

  it("connect() rejects when the server is unreachable", async () => {
    const dead = createSocketTransport({
      authProvider: {getToken: async () => null},
      baseUrl: "http://127.0.0.1:9",
    });
    await expect(dead.connect()).rejects.toBeDefined();
    dead.disconnect();
  });

  // D1: the server's session re-validation sweep emits sync:auth-expired
  // immediately before disconnect(true) — the transport must tag the resulting
  // status notification so the client maps it into the auth-pause path (not a
  // generic transport blip eligible for unlimited-retry backoff).
  it("tags the disconnect status as authExpired after a sync:auth-expired event", async () => {
    const statuses: TransportStatus[] = [];
    const connecting = makeTransport();
    connecting.onStatusChange((status) => statuses.push(status));
    await connecting.connect();

    server.sockets[0]?.emit("sync:auth-expired", {reason: "expired"});
    server.sockets[0]?.disconnect(true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(statuses).toEqual([{connected: true}, {authExpired: true, connected: false}]);
  });

  it("does not tag an ordinary disconnect as authExpired", async () => {
    const statuses: TransportStatus[] = [];
    const connecting = makeTransport();
    connecting.onStatusChange((status) => statuses.push(status));
    await connecting.connect();

    server.sockets[0]?.disconnect(true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(statuses).toEqual([{connected: true}, {connected: false}]);
  });

  it("does not carry authExpired into a later, unrelated disconnect", async () => {
    const statuses: TransportStatus[] = [];
    const connecting = makeTransport();
    connecting.onStatusChange((status) => statuses.push(status));
    await connecting.connect();

    server.sockets[0]?.emit("sync:auth-expired", {reason: "expired"});
    server.sockets[0]?.disconnect(true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    // Reconnect and disconnect again, ordinarily this time.
    await connecting.connect();
    server.sockets[server.sockets.length - 1]?.disconnect(true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(statuses[statuses.length - 1]).toEqual({connected: false});
  });
});
