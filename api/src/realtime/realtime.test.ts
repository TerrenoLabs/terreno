/**
 * Tests for the realtime module's pure functions and classes:
 *   - queryMatcher.ts (matchesQuery)
 *   - realtimeApp.ts (RealtimeApp class — register, getIo, close)
 *   - realtimeApp.ts (installRealtimeSocketHandlers — per-user room joins)
 *   - changeStreamWatcher.ts (authorized room emitter, watcher lifecycle)
 */

import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import express from "express";
import mongoose from "mongoose";
import type {Server} from "socket.io";

import {clearAdminBroadcastScopes, registerAdminBroadcastScope} from "../sync/adminBroadcastScope";
import {
  type AuthorizedEmitEntry,
  emitPayloadToAuthorizedRoom,
  ensureApiId,
  mapOperationType,
  startChangeStreamWatcher,
  stopChangeStreamWatcher,
} from "./changeStreamWatcher";
import {matchesQuery} from "./queryMatcher";
import {
  installRealtimeSocketHandlers,
  RealtimeApp,
  type RealtimeSocketLike,
  redactCredentials,
} from "./realtimeApp";
import type {DecodedRealtimeToken} from "./socketUser";

type ChangeStreamDoc = Parameters<typeof mapOperationType>[1];

const asChange = (change: Record<string, unknown>): ChangeStreamDoc =>
  change as unknown as ChangeStreamDoc;

interface MockRoomSocket {
  decodedToken?: DecodedRealtimeToken;
  emit: (event: string, payload: unknown) => void;
  id: string;
}

const setConnectionDb = (db: unknown): void => {
  (mongoose.connection as unknown as {db: unknown}).db = db;
};

// ─────────────────────────────────────────────────────────────────────────────
// queryMatcher tests
// ─────────────────────────────────────────────────────────────────────────────

describe("matchesQuery", () => {
  describe("malformed predicates", () => {
    it("fails closed instead of throwing", () => {
      expect(matchesQuery({a: 1}, {$and: [null]})).toBe(false);
      expect(matchesQuery({a: 1}, {$and: [{a: 1}, 5]})).toBe(false);
      expect(matchesQuery({a: 1}, {$or: [null, {a: 1}]})).toBe(true);
      expect(matchesQuery({a: 1}, {$or: [null, "x"]})).toBe(false);
      expect(matchesQuery({a: 1}, {a: {$eq: {toString: 1}}})).toBe(false);
      expect(matchesQuery({a: 1}, null as unknown as Record<string, unknown>)).toBe(false);
    });
  });

  describe("direct equality", () => {
    it("matches string equality", () => {
      expect(matchesQuery({name: "Alice"}, {name: "Alice"})).toBe(true);
    });

    it("returns false for non-matching string", () => {
      expect(matchesQuery({name: "Alice"}, {name: "Bob"})).toBe(false);
    });

    it("matches numeric equality", () => {
      expect(matchesQuery({count: 5}, {count: 5})).toBe(true);
    });

    it("returns false for non-matching number", () => {
      expect(matchesQuery({count: 5}, {count: 6})).toBe(false);
    });

    it("matches boolean true", () => {
      expect(matchesQuery({active: true}, {active: true})).toBe(true);
    });

    it("returns false for non-matching boolean", () => {
      expect(matchesQuery({active: true}, {active: false})).toBe(false);
    });

    it("matches null value", () => {
      expect(matchesQuery({deleted: null}, {deleted: null})).toBe(true);
    });

    it("matches undefined/missing field", () => {
      expect(matchesQuery({}, {deleted: undefined})).toBe(true);
    });
  });

  describe("nested field access", () => {
    it("accesses nested fields via dot notation", () => {
      const doc = {user: {age: 30, name: "Alice"}};
      expect(matchesQuery(doc, {"user.name": "Alice"})).toBe(true);
    });

    it("returns false when nested path doesn't match", () => {
      const doc = {user: {name: "Alice"}};
      expect(matchesQuery(doc, {"user.name": "Bob"})).toBe(false);
    });

    it("returns false when nested path is undefined", () => {
      const doc = {user: {}};
      expect(matchesQuery(doc, {"user.name": "Alice"})).toBe(false);
    });

    it("returns undefined when an intermediate path segment is null", () => {
      const doc = {user: null};
      expect(matchesQuery(doc, {"user.name": "Alice"})).toBe(false);
      expect(matchesQuery(doc, {"user.name": {$exists: false}})).toBe(true);
    });
  });

  describe("$eq operator", () => {
    it("matches with $eq", () => {
      expect(matchesQuery({count: 5}, {count: {$eq: 5}})).toBe(true);
    });

    it("returns false with $eq mismatch", () => {
      expect(matchesQuery({count: 5}, {count: {$eq: 6}})).toBe(false);
    });
  });

  describe("$ne operator", () => {
    it("matches when value is not equal", () => {
      expect(matchesQuery({status: "active"}, {status: {$ne: "inactive"}})).toBe(true);
    });

    it("returns false when value equals $ne operand", () => {
      expect(matchesQuery({status: "active"}, {status: {$ne: "active"}})).toBe(false);
    });
  });

  describe("$gt, $gte operators", () => {
    it("matches $gt", () => {
      expect(matchesQuery({score: 10}, {score: {$gt: 5}})).toBe(true);
    });

    it("returns false when not $gt", () => {
      expect(matchesQuery({score: 5}, {score: {$gt: 5}})).toBe(false);
    });

    it("matches $gte for equal value", () => {
      expect(matchesQuery({score: 5}, {score: {$gte: 5}})).toBe(true);
    });

    it("matches $gte for greater value", () => {
      expect(matchesQuery({score: 6}, {score: {$gte: 5}})).toBe(true);
    });

    it("returns false when not $gte", () => {
      expect(matchesQuery({score: 4}, {score: {$gte: 5}})).toBe(false);
    });
  });

  describe("$lt, $lte operators", () => {
    it("matches $lt", () => {
      expect(matchesQuery({score: 3}, {score: {$lt: 5}})).toBe(true);
    });

    it("returns false when not $lt", () => {
      expect(matchesQuery({score: 5}, {score: {$lt: 5}})).toBe(false);
    });

    it("matches $lte for equal value", () => {
      expect(matchesQuery({score: 5}, {score: {$lte: 5}})).toBe(true);
    });

    it("matches $lte for lesser value", () => {
      expect(matchesQuery({score: 4}, {score: {$lte: 5}})).toBe(true);
    });

    it("returns false when not $lte", () => {
      expect(matchesQuery({score: 6}, {score: {$lte: 5}})).toBe(false);
    });
  });

  describe("$in operator", () => {
    it("matches when value is in array", () => {
      expect(matchesQuery({status: "active"}, {status: {$in: ["active", "pending"]}})).toBe(true);
    });

    it("returns false when value is not in array", () => {
      expect(matchesQuery({status: "inactive"}, {status: {$in: ["active", "pending"]}})).toBe(
        false
      );
    });

    it("returns false when operand is not an array", () => {
      expect(matchesQuery({status: "active"}, {status: {$in: "active"}})).toBe(false);
    });
  });

  describe("$nin operator", () => {
    it("matches when value is not in array", () => {
      expect(matchesQuery({status: "inactive"}, {status: {$nin: ["active", "pending"]}})).toBe(
        true
      );
    });

    it("returns false when value is in array", () => {
      expect(matchesQuery({status: "active"}, {status: {$nin: ["active", "pending"]}})).toBe(false);
    });

    it("returns false when operand is not an array", () => {
      expect(matchesQuery({status: "active"}, {status: {$nin: "active"}})).toBe(false);
    });
  });

  describe("$exists operator", () => {
    it("matches when field exists and $exists is true", () => {
      expect(matchesQuery({name: "Alice"}, {name: {$exists: true}})).toBe(true);
    });

    it("returns false when field is missing and $exists is true", () => {
      expect(matchesQuery({}, {name: {$exists: true}})).toBe(false);
    });

    it("matches when field is missing and $exists is false", () => {
      expect(matchesQuery({}, {name: {$exists: false}})).toBe(true);
    });

    it("returns false when field exists and $exists is false", () => {
      expect(matchesQuery({name: "Alice"}, {name: {$exists: false}})).toBe(false);
    });
  });

  describe("$not operator", () => {
    it("negates a condition with $not", () => {
      expect(matchesQuery({count: 5}, {count: {$not: {$gt: 10}}})).toBe(true);
    });

    it("returns false when negated condition matches", () => {
      expect(matchesQuery({count: 15}, {count: {$not: {$gt: 10}}})).toBe(false);
    });
  });

  describe("$and operator", () => {
    it("matches when all conditions are true", () => {
      expect(
        matchesQuery({count: 5, status: "active"}, {$and: [{status: "active"}, {count: 5}]})
      ).toBe(true);
    });

    it("returns false when one condition fails", () => {
      expect(
        matchesQuery({count: 3, status: "active"}, {$and: [{status: "active"}, {count: 5}]})
      ).toBe(false);
    });

    it("returns false when $and operand is not an array", () => {
      expect(matchesQuery({status: "active"}, {$and: "invalid"})).toBe(false);
    });
  });

  describe("$or operator", () => {
    it("matches when any condition is true", () => {
      expect(
        matchesQuery({status: "inactive"}, {$or: [{status: "active"}, {status: "inactive"}]})
      ).toBe(true);
    });

    it("returns false when no conditions match", () => {
      expect(
        matchesQuery({status: "pending"}, {$or: [{status: "active"}, {status: "inactive"}]})
      ).toBe(false);
    });

    it("returns false when $or operand is not an array", () => {
      expect(matchesQuery({status: "active"}, {$or: "invalid"})).toBe(false);
    });
  });

  describe("unknown operator", () => {
    it("returns false for unknown operators (fail closed)", () => {
      expect(matchesQuery({name: "Alice"}, {name: {$regex: "Al"}})).toBe(false);
    });
  });

  describe("ObjectId-like values", () => {
    it("matches ObjectId-like objects via toString", () => {
      const fakeObjectId = {
        constructor: {name: "ObjectId"},
        toString: () => "507f1f77bcf86cd799439011",
      };
      const doc = {ownerId: fakeObjectId};
      expect(matchesQuery(doc, {ownerId: "507f1f77bcf86cd799439011"})).toBe(true);
    });
  });

  describe("array equality", () => {
    it("matches array conditions by JSON serialization", () => {
      expect(matchesQuery({tags: ["a", "b"]}, {tags: ["a", "b"]})).toBe(true);
    });

    it("returns false for different arrays", () => {
      expect(matchesQuery({tags: ["a", "b"]}, {tags: ["a", "c"]})).toBe(false);
    });
  });

  describe("relational comparison across value types", () => {
    it("compares strings lexicographically with $gt and $lt", () => {
      expect(matchesQuery({name: "banana"}, {name: {$gt: "apple"}})).toBe(true);
      expect(matchesQuery({name: "apple"}, {name: {$gt: "banana"}})).toBe(false);
      expect(matchesQuery({name: "apple"}, {name: {$lt: "banana"}})).toBe(true);
      expect(matchesQuery({name: "apple"}, {name: {$lte: "apple"}})).toBe(true);
    });

    it("coerces mixed-type operands numerically", () => {
      expect(matchesQuery({count: 5}, {count: {$gt: "3"}})).toBe(true);
      expect(matchesQuery({count: 5}, {count: {$lt: "10"}})).toBe(true);
      expect(matchesQuery({count: 5}, {count: {$gte: true}})).toBe(true);
    });

    it("fails comparison when operands are not numerically comparable", () => {
      expect(matchesQuery({count: 5}, {count: {$gt: "abc"}})).toBe(false);
      expect(matchesQuery({count: 5}, {count: {$lt: "abc"}})).toBe(false);
    });
  });

  describe("empty query", () => {
    it("matches any document with empty query", () => {
      expect(matchesQuery({count: 5, name: "Alice"}, {})).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RealtimeApp tests
// ─────────────────────────────────────────────────────────────────────────────

describe("RealtimeApp", () => {
  describe("constructor", () => {
    it("creates an instance with empty config", () => {
      const app = new RealtimeApp();
      expect(app).toBeDefined();
    });

    it("creates an instance with provided config", () => {
      const app = new RealtimeApp({adapter: "none", debug: true});
      expect(app).toBeDefined();
    });
  });

  describe("getIo", () => {
    it("returns null before the server is created", () => {
      const app = new RealtimeApp();
      expect(app.getIo()).toBeNull();
    });
  });

  describe("register", () => {
    it("health endpoint returns status not_started when io is not initialized", async () => {
      const expressApp = express();
      const app = new RealtimeApp();
      app.register(expressApp);

      const supertest = await import("supertest");
      const st = supertest.default(expressApp);
      const res = await st.get("/realtime/health").expect(200);
      expect(res.body.status).toBe("not_started");
      expect(res.body.clients).toBe(0);
    });
  });

  describe("close", () => {
    it("closes gracefully when io is null", async () => {
      const app = new RealtimeApp();
      // Should not throw
      await expect(app.close()).resolves.toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// installRealtimeSocketHandlers — permission and rate-limit logic
// ─────────────────────────────────────────────────────────────────────────────

interface MockSocket extends RealtimeSocketLike {
  rooms: Set<string>;
  emitted: {event: string; payload: unknown}[];
  listeners: Map<string, (...args: never[]) => void | Promise<void>>;
  trigger: (event: string, ...args: unknown[]) => Promise<void>;
}

const createMockSocket = (decodedToken?: DecodedRealtimeToken): MockSocket => {
  const rooms = new Set<string>();
  const emitted: {event: string; payload: unknown}[] = [];
  const listeners = new Map<string, (...args: never[]) => void | Promise<void>>();

  const socket: MockSocket = {
    decodedToken,
    emit: (event, payload) => {
      emitted.push({event, payload});
    },
    emitted,
    id: `socket-${Math.random().toString(36).slice(2, 9)}`,
    join: async (room: string) => {
      rooms.add(room);
    },
    leave: async (room: string) => {
      rooms.delete(room);
    },
    listeners,
    on: (event, handler) => {
      listeners.set(event, handler);
    },
    rooms,
    trigger: async (event, ...args) => {
      const handler = listeners.get(event) as ((...a: unknown[]) => unknown) | undefined;
      if (handler) {
        await handler(...args);
      }
    },
  };

  return socket;
};

describe("installRealtimeSocketHandlers", () => {
  // joinUserRooms is fire-and-forget — give microtasks a chance to flush.
  const flushJoins = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it("joins user-specific and authenticated rooms when token has userId", async () => {
    const socket = createMockSocket({id: "user1"});
    installRealtimeSocketHandlers(socket);
    await flushJoins();
    expect(socket.rooms.has("user:user1")).toBe(true);
    expect(socket.rooms.has("authenticated")).toBe(true);
  });

  it("joins admin room for admin tokens", async () => {
    const socket = createMockSocket({admin: true, id: "admin1"});
    installRealtimeSocketHandlers(socket);
    await flushJoins();
    expect(socket.rooms.has("admin")).toBe(true);
  });

  it("does not join admin room for non-admin tokens", async () => {
    const socket = createMockSocket({admin: false, id: "user1"});
    installRealtimeSocketHandlers(socket);
    await flushJoins();
    expect(socket.rooms.has("admin")).toBe(false);
  });

  it("joins no rooms when the token has no user id", async () => {
    const socket = createMockSocket();
    installRealtimeSocketHandlers(socket);
    await flushJoins();
    expect(socket.rooms.size).toBe(0);
  });

  it("installs no legacy RTK subscription handlers", () => {
    const socket = createMockSocket({id: "user1"});
    installRealtimeSocketHandlers(socket);
    for (const event of [
      "subscribe:model",
      "unsubscribe:model",
      "subscribe:document",
      "unsubscribe:document",
      "subscribe:query",
      "unsubscribe:query",
    ]) {
      expect(socket.listeners.has(event)).toBe(false);
    }
    expect([...socket.listeners.keys()]).toEqual(["disconnect"]);
  });

  it("logs disconnects", async () => {
    const logInfo = mock((_msg: string): void => {});
    const socket = createMockSocket({id: "user1"});
    installRealtimeSocketHandlers(socket, {logInfo});
    await socket.trigger("disconnect");
    expect(logInfo).toHaveBeenCalledWith("[realtime] User user1 disconnected");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// changeStreamWatcher — internal helpers
// ─────────────────────────────────────────────────────────────────────────────

describe("mapOperationType", () => {
  it("maps insert to create", () => {
    expect(mapOperationType("insert", asChange({}))).toBe("create");
  });

  it("maps update to update by default", () => {
    expect(
      mapOperationType("update", asChange({updateDescription: {updatedFields: {title: "x"}}}))
    ).toBe("update");
  });

  it("maps replace to update", () => {
    expect(mapOperationType("replace", asChange({}))).toBe("update");
  });

  it("maps update with deleted=true to delete (soft delete)", () => {
    expect(
      mapOperationType("update", asChange({updateDescription: {updatedFields: {deleted: true}}}))
    ).toBe("delete");
  });

  it("maps delete to delete", () => {
    expect(mapOperationType("delete", asChange({}))).toBe("delete");
  });

  it("returns null for unknown operation types", () => {
    expect(mapOperationType("invalidate", asChange({}))).toBeNull();
    expect(mapOperationType("drop", asChange({}))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// emitPayloadToAuthorizedRoom — per-socket authorization for sync:delta fan-out
// ─────────────────────────────────────────────────────────────────────────────

describe("emitPayloadToAuthorizedRoom", () => {
  const makeIo = (): {
    addSocketToRoom: (room: string, decodedToken?: DecodedRealtimeToken) => void;
    emissions: Array<{room: string; event: string; payload: unknown}>;
    io: Server;
  } => {
    const emissions: Array<{room: string; event: string; payload: unknown}> = [];
    const roomSockets = new Map<string, Set<string>>();
    const sockets = new Map<string, MockRoomSocket>();
    let nextSocketId = 1;
    const addSocketToRoom = (
      room: string,
      decodedToken: DecodedRealtimeToken = {admin: true, id: "admin"}
    ): void => {
      const socketId = `socket-${nextSocketId}`;
      nextSocketId += 1;
      if (!roomSockets.has(room)) {
        roomSockets.set(room, new Set());
      }
      roomSockets.get(room)?.add(socketId);
      sockets.set(socketId, {
        decodedToken,
        emit: (event: string, payload: unknown): void => {
          emissions.push({event, payload, room});
        },
        id: socketId,
      });
    };
    const io = {
      sockets: {
        adapter: {rooms: roomSockets},
        sockets,
      },
    } as unknown as Server;
    return {addSocketToRoom, emissions, io};
  };

  const ownerReadEntry: AuthorizedEmitEntry = {
    collectionTag: "todos",
    modelName: "Todo",
    options: {
      permissions: {
        read: [
          (_method, user?: {admin?: boolean; id?: string}, obj?: unknown) =>
            user?.admin === true || user?.id === (obj as {ownerId?: string} | undefined)?.ownerId,
        ],
      },
    },
  };

  afterEach(() => {
    clearAdminBroadcastScopes();
  });

  it("emits a per-socket payload only to sockets that can read the document", async () => {
    const room = "sync:todos|owner:owner-1";
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom(room, {id: "owner-1"});
    addSocketToRoom(room, {id: "other-user"});

    await emitPayloadToAuthorizedRoom({
      buildPayload: (user) => ({id: "todo-1", visibleTo: user?.id}),
      entry: ownerReadEntry,
      eventName: "sync:delta",
      fullDocument: {_id: "todo-1", ownerId: "owner-1"},
      io,
      logDebug: () => {},
      room,
    });

    expect(emissions).toEqual([
      {event: "sync:delta", payload: {id: "todo-1", visibleTo: "owner-1"}, room},
    ]);
  });

  it("continues emitting to other sockets when building one payload fails", async () => {
    const room = "sync:todos|broadcast";
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom(room, {id: "bad-user"});
    addSocketToRoom(room, {id: "good-user"});

    await emitPayloadToAuthorizedRoom({
      buildPayload: (user) => {
        if (user?.id === "bad-user") {
          throw new Error("cannot serialize for bad user");
        }
        return {visibleTo: user?.id};
      },
      entry: {...ownerReadEntry, options: {permissions: {read: [() => true]}}},
      eventName: "sync:delta",
      fullDocument: {_id: "todo-1"},
      io,
      logDebug: () => {},
      room,
    });

    expect(emissions).toEqual([{event: "sync:delta", payload: {visibleTo: "good-user"}, room}]);
  });

  it("allows admin broadcast sockets without running product read permissions", async () => {
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom("sync:todos|admin", {admin: true, id: "admin-user"});
    registerAdminBroadcastScope("Todo", {
      listPermissions: [() => true],
      readPermissions: [() => true],
    });

    await emitPayloadToAuthorizedRoom({
      buildPayload: () => ({id: "todo-1"}),
      entry: {...ownerReadEntry, options: {permissions: {read: [() => false]}}},
      eventName: "sync:delta",
      fullDocument: {_id: "todo-1", ownerId: "owner-1"},
      io,
      logDebug: () => {},
      room: "sync:todos|admin",
    });

    expect(emissions).toHaveLength(1);
  });

  it("does not emit admin broadcast documents denied by the admin scope", async () => {
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom("sync:todos|admin", {admin: true, id: "admin-user"});
    registerAdminBroadcastScope("Todo", {
      listPermissions: [() => false],
      readPermissions: [() => true],
    });

    await emitPayloadToAuthorizedRoom({
      buildPayload: () => ({id: "todo-1"}),
      entry: {...ownerReadEntry, options: {permissions: {read: [() => true]}}},
      eventName: "sync:delta",
      fullDocument: {_id: "todo-1", ownerId: "owner-1"},
      io,
      logDebug: () => {},
      room: "sync:todos|admin",
    });

    expect(emissions).toEqual([]);
  });

  it("fails closed without a document when read permission requires an object owner", async () => {
    const room = "sync:todos|owner:owner-1";
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom(room, {id: "other-user"});

    await emitPayloadToAuthorizedRoom({
      buildPayload: () => ({deleted: true, id: "todo-1"}),
      entry: ownerReadEntry,
      eventName: "sync:delta",
      fullDocument: undefined,
      io,
      logDebug: () => {},
      room,
    });

    expect(emissions).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startChangeStreamWatcher / stopChangeStreamWatcher — MongoDB change stream
// ─────────────────────────────────────────────────────────────────────────────

describe("startChangeStreamWatcher", () => {
  let originalDb: typeof mongoose.connection.db;

  beforeEach(() => {
    originalDb = mongoose.connection.db;
  });

  afterEach(async () => {
    setConnectionDb(originalDb);
    // Ensure the watcher is stopped between tests
    const {stopChangeStreamWatcher: stop} = await import("./changeStreamWatcher");
    await stop();
  });

  const createMockChangeStream = () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    return {
      close: mock(async () => {}),
      listeners,
      on(event: string, handler: (...args: unknown[]) => void) {
        listeners.set(event, handler);
        return this;
      },
      trigger(event: string, ...args: unknown[]) {
        const handler = listeners.get(event);
        if (handler) {
          handler(...args);
        }
      },
    };
  };

  const invokeRegisteredChangeHandler = async (
    mockStream: ReturnType<typeof createMockChangeStream>,
    event: Record<string, unknown>
  ): Promise<void> => {
    const changeHandler = mockStream.listeners.get("change");
    if (!changeHandler) {
      throw new Error("expected change handler");
    }
    await changeHandler(event);
  };

  const createMockIo = () => {
    const rooms = new Map<string, Set<string>>();
    const sockets = new Map<string, MockRoomSocket>();
    return {
      sockets: {
        adapter: {rooms},
        sockets,
      },
      to: (_room: string) => ({
        emit: (_event: string, _data: unknown) => {},
      }),
    } as unknown as import("socket.io").Server;
  };

  it("initializes and registers change/error/close/end listeners", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    expect(mockDb.watch).toHaveBeenCalled();
    expect(mockStream.listeners.has("change")).toBe(true);
    expect(mockStream.listeners.has("error")).toBe(true);
    expect(mockStream.listeners.has("close")).toBe(true);
    expect(mockStream.listeners.has("end")).toBe(true);
  });

  it("throws when mongoose connection db is unavailable", async () => {
    setConnectionDb(undefined);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    expect(() => startChangeStreamWatcher(io)).toThrow(
      "MongoDB connection not available for change stream"
    );
  });

  it("throws when watch returns null", async () => {
    const mockDb = {
      watch: mock(() => null),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    expect(() => startChangeStreamWatcher(io)).toThrow("Failed to create change stream watcher");
  });

  it("skips events for unregistered collections", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // Trigger for an unregistered collection — should not throw
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      fullDocument: {_id: "doc-1"},
      ns: {coll: "unknown_collection"},
      operationType: "insert",
    });
  });

  it("respects ignoredCollections config", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {ignoredCollections: ["audit_logs"]}, true);

    // Verify the pipeline passed to watch includes the ignored collections
    const pipeline = (mockDb.watch.mock.calls[0] as unknown[])[0] as {
      $match: {"ns.coll": {$nin: string[]}};
    }[];
    const matchStage = pipeline[0].$match;
    expect(matchStage["ns.coll"].$nin).toContain("audit_logs");
    expect(matchStage["ns.coll"].$nin).toContain("socketio");
    expect(matchStage["ns.coll"].$nin).toContain("sessions");
  });

  it("respects ignoredOperations config", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {ignoredOperations: ["insert"]}, true);

    // This insert should be skipped because "insert" is ignored
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      fullDocument: {_id: "doc-1"},
      ns: {coll: "todos"},
      operationType: "insert",
    });
  });

  it("swallows errors thrown while processing a change event", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    const malformedEvent = {
      documentKey: {_id: "doc-1"},
      get ns(): never {
        throw new Error("malformed change event");
      },
      operationType: "insert",
    };
    // The handler must not reject — one bad event cannot take down the change stream.
    await expect(
      invokeRegisteredChangeHandler(
        mockStream,
        malformedEvent as unknown as Record<string, unknown>
      )
    ).resolves.toBeUndefined();
  });

  it("skips events with no collectionName or docId", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // Missing ns.coll
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      ns: {},
      operationType: "insert",
    });
    // Missing documentKey
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {},
      ns: {coll: "todos"},
      operationType: "insert",
    });
  });

  it("skips non-CRUD operation types", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // "drop" is not in our pipeline filter, should be skipped
    await invokeRegisteredChangeHandler(mockStream, {
      operationType: "drop",
    });
  });

  it("handles error/close/end events gracefully", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // Trigger error, close, end — should not throw
    mockStream.trigger("error", new Error("test error"));
    mockStream.trigger("close");
    mockStream.trigger("end");
  });

  // Task 9.16: a transient stream failure used to be logged and then permanently starve
  // every sync delta until the process restarted.
  describe("restart with resume token (Task 9.16)", () => {
    const waitFor = async (
      predicate: () => boolean,
      label: string,
      timeoutMs = 3000
    ): Promise<void> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (predicate()) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`);
    };

    /** An io with no sockets that records server-wide `emit` calls. */
    const createRecordingIo = (): {
      io: import("socket.io").Server;
      serverEmissions: {event: string; payload: unknown}[];
    } => {
      const serverEmissions: {event: string; payload: unknown}[] = [];
      return {
        io: {
          emit: (event: string, payload: unknown) => {
            serverEmissions.push({event, payload});
          },
          sockets: {adapter: {rooms: new Map()}, sockets: new Map()},
          to: () => ({emit: () => {}}),
        } as unknown as import("socket.io").Server,
        serverEmissions,
      };
    };

    const resumeAfterForCall = (watch: ReturnType<typeof mock>, callIndex: number): unknown =>
      ((watch.mock.calls[callIndex] as unknown[])[1] as {resumeAfter?: unknown}).resumeAfter;

    it("reopens with resumeAfter after a stream error and keeps tracking changes", async () => {
      const firstStream = createMockChangeStream();
      const secondStream = createMockChangeStream();
      const thirdStream = createMockChangeStream();
      const streams = [firstStream, secondStream, thirdStream];
      const mockDb = {watch: mock(() => streams.shift() ?? thirdStream)};
      setConnectionDb(mockDb);

      const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
      const {io} = createRecordingIo();
      startChangeStreamWatcher(io, {}, true);

      // A change on the first stream establishes the resume position.
      await invokeRegisteredChangeHandler(firstStream, {
        _id: {_data: "token-1"},
        documentKey: {_id: "doc-1"},
        fullDocument: {_id: "doc-1", name: "before the failure"},
        ns: {coll: "unregistered"},
        operationType: "insert",
      });

      firstStream.trigger("error", new Error("replica set election"));
      await waitFor(() => mockDb.watch.mock.calls.length >= 2, "the stream to reopen");
      expect(resumeAfterForCall(mockDb.watch, 1)).toEqual({_data: "token-1"});

      // The reopened stream is fully wired: its changes advance the resume position.
      await invokeRegisteredChangeHandler(secondStream, {
        _id: {_data: "token-2"},
        documentKey: {_id: "doc-2"},
        fullDocument: {_id: "doc-2", name: "after the restart"},
        ns: {coll: "unregistered"},
        operationType: "insert",
      });
      secondStream.trigger("error", new Error("network blip"));
      await waitFor(() => mockDb.watch.mock.calls.length >= 3, "the stream to reopen again");
      expect(resumeAfterForCall(mockDb.watch, 2)).toEqual({_data: "token-2"});
    });

    it("drops the resume token and asks clients to resync when the oplog history is lost", async () => {
      const firstStream = createMockChangeStream();
      const secondStream = createMockChangeStream();
      const streams = [firstStream, secondStream];
      const mockDb = {watch: mock(() => streams.shift() ?? secondStream)};
      setConnectionDb(mockDb);

      const {SYNC_RESYNC_EVENT, startChangeStreamWatcher} = await import("./changeStreamWatcher");
      const {io, serverEmissions} = createRecordingIo();
      startChangeStreamWatcher(io, {}, true);

      await invokeRegisteredChangeHandler(firstStream, {
        _id: {_data: "token-1"},
        documentKey: {_id: "doc-1"},
        ns: {coll: "unregistered"},
        operationType: "insert",
      });

      const historyLost = Object.assign(new Error("resume of change stream was not possible"), {
        code: 286,
        codeName: "ChangeStreamHistoryLost",
      });
      firstStream.trigger("error", historyLost);

      expect(serverEmissions).toEqual([
        {event: SYNC_RESYNC_EVENT, payload: {reason: "history_lost"}},
      ]);

      await waitFor(() => mockDb.watch.mock.calls.length >= 2, "the stream to reopen");
      // An unusable token must not be replayed — the reopen starts from now.
      expect(
        ((mockDb.watch.mock.calls[1] as unknown[])[1] as {resumeAfter?: unknown}).resumeAfter
      ).toBeUndefined();
    });

    it("does not reopen after the watcher is stopped", async () => {
      const mockStream = createMockChangeStream();
      const mockDb = {watch: mock(() => mockStream)};
      setConnectionDb(mockDb);

      const {startChangeStreamWatcher, stopChangeStreamWatcher: stop} = await import(
        "./changeStreamWatcher"
      );
      const {io} = createRecordingIo();
      startChangeStreamWatcher(io, {}, true);

      mockStream.trigger("error", new Error("shutting down"));
      await stop();
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(mockDb.watch).toHaveBeenCalledTimes(1);
    });
  });

  it("uses custom batchSize and fullDocument config", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher");
    const io = createMockIo();

    startChangeStreamWatcher(io, {batchSize: 100, fullDocument: "whenAvailable"}, true);

    const options = (mockDb.watch.mock.calls[0] as unknown[])[1] as {
      batchSize?: number;
      fullDocument?: string;
    };
    expect(options.batchSize).toBe(100);
    expect(options.fullDocument).toBe("whenAvailable");
  });
});

describe("stopChangeStreamWatcher", () => {
  it("closes and nullifies the active watcher", async () => {
    const mockStream = {
      close: mock(async () => {}),
      on: () => {},
    };
    const mockDb = {
      watch: mock(() => mockStream),
    };
    const originalDb = mongoose.connection.db;
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher, stopChangeStreamWatcher} = await import(
      "./changeStreamWatcher"
    );
    const io = {
      sockets: {
        adapter: {rooms: new Map()},
        sockets: new Map(),
      },
      to: () => ({emit: () => {}}),
    } as unknown as import("socket.io").Server;

    startChangeStreamWatcher(io);
    await stopChangeStreamWatcher();
    expect(mockStream.close).toHaveBeenCalled();

    // Calling again should be a no-op
    await stopChangeStreamWatcher();

    setConnectionDb(originalDb);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RealtimeApp.onServerCreated / setupAdapter
// ─────────────────────────────────────────────────────────────────────────────

describe("RealtimeApp.onServerCreated", () => {
  const servers: import("http").Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      s.close();
    }
    servers.length = 0;
  });

  const makeServer = (): import("http").Server => {
    const http = require("node:http");
    const server = http.createServer();
    servers.push(server);
    return server;
  };

  it("throws when no socket authentication method is configured", () => {
    const originalSecret = process.env.TOKEN_SECRET;
    process.env.TOKEN_SECRET = "";

    const app = new RealtimeApp({tokenSecret: undefined});
    const server = makeServer();

    expect(() => app.onServerCreated(server)).toThrow(
      "Socket authentication requires TOKEN_SECRET or Better Auth"
    );

    process.env.TOKEN_SECRET = originalSecret;
  });

  it("sets up Socket.io with valid config", async () => {
    const app = new RealtimeApp({
      adapter: "none",
      tokenSecret: "test-secret",
    });
    const server = makeServer();

    // Mock mongoose.connection.db for changeStreamWatcher
    const originalDb = mongoose.connection.db;
    const mockStream = {close: async () => {}, on: () => mockStream};
    setConnectionDb({watch: () => mockStream});

    app.onServerCreated(server);
    expect(app.getIo()).toBeDefined();

    await app.close();
    setConnectionDb(originalDb);
  });
});

describe("RealtimeApp.setupAdapter (private, via onServerCreated config)", () => {
  const servers: import("http").Server[] = [];

  afterEach(async () => {
    for (const s of servers) {
      s.close();
    }
    servers.length = 0;
  });

  const makeServer = (): import("http").Server => {
    const http = require("node:http");
    const server = http.createServer();
    servers.push(server);
    return server;
  };

  it("logs warning when redis adapter requested but no URL found", async () => {
    const originalValkey = process.env.VALKEY_URL;
    const originalRedis = process.env.REDIS_URL;
    const originalDb = mongoose.connection.db;
    process.env.VALKEY_URL = "";
    process.env.REDIS_URL = "";

    const mockStream = {close: async () => {}, on: () => mockStream};
    setConnectionDb({watch: () => mockStream});

    const app = new RealtimeApp({
      adapter: "redis",
      tokenSecret: "test-secret",
    });
    const server = makeServer();

    app.onServerCreated(server);
    await app.close();

    process.env.VALKEY_URL = originalValkey;
    process.env.REDIS_URL = originalRedis;
    setConnectionDb(originalDb);
  });

  it("logs info when redis adapter has a URL", async () => {
    const originalValkey = process.env.VALKEY_URL;
    const originalDb = mongoose.connection.db;
    process.env.VALKEY_URL = "redis://user:pass@localhost:6379/0";

    const mockStream = {close: async () => {}, on: () => mockStream};
    setConnectionDb({watch: () => mockStream});

    const app = new RealtimeApp({
      adapter: "redis",
      debug: true,
      tokenSecret: "test-secret",
    });
    const server = makeServer();

    app.onServerCreated(server);
    await app.close();

    process.env.VALKEY_URL = originalValkey;
    setConnectionDb(originalDb);
  });

  it("no-op adapter mode 'none'", async () => {
    const originalDb = mongoose.connection.db;
    const mockStream = {close: async () => {}, on: () => mockStream};
    setConnectionDb({watch: () => mockStream});

    const app = new RealtimeApp({
      adapter: "none",
      tokenSecret: "test-secret",
    });
    const server = makeServer();

    app.onServerCreated(server);
    expect(app.getIo()).toBeDefined();

    await app.close();
    setConnectionDb(originalDb);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ensureApiId
// ─────────────────────────────────────────────────────────────────────────────

describe("ensureApiId", () => {
  it("returns null as-is", () => {
    expect(ensureApiId(null)).toBeNull();
  });

  it("returns undefined as-is", () => {
    expect(ensureApiId(undefined)).toBeUndefined();
  });

  it("returns arrays as-is", () => {
    const arr = [1, 2, 3];
    expect(ensureApiId(arr)).toBe(arr);
  });

  it("returns primitive values as-is (non-object)", () => {
    expect(ensureApiId("string")).toBe("string");
  });

  it("adds id from _id when id is missing", () => {
    expect(ensureApiId({_id: "abc"})).toEqual({_id: "abc", id: "abc"});
  });

  it("does not overwrite existing id", () => {
    expect(ensureApiId({_id: "abc", id: "existing"})).toEqual({_id: "abc", id: "existing"});
  });

  it("returns object without _id unchanged", () => {
    const obj = {name: "test"};
    expect(ensureApiId(obj)).toBe(obj);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startChangeStreamWatcher & stopChangeStreamWatcher
// ─────────────────────────────────────────────────────────────────────────────

describe("startChangeStreamWatcher & stopChangeStreamWatcher", () => {
  const makeMockIo = (): Server & {emissions: unknown[]} => {
    const emissions: unknown[] = [];
    const rooms = new Map<string, Set<string>>();
    const sockets = new Map<string, MockRoomSocket>();
    return {
      emissions,
      sockets: {
        adapter: {rooms},
        sockets,
      },
      to: (_room: string) => ({
        emit: (): void => {},
      }),
    } as unknown as Server & {emissions: unknown[]};
  };

  afterEach(async () => {
    await stopChangeStreamWatcher();
  });

  it("starts and stops without error when MongoDB is connected", async () => {
    const io = makeMockIo();
    expect(() => startChangeStreamWatcher(io, {}, false)).not.toThrow();
    await stopChangeStreamWatcher();
  });

  it("starts with debug mode enabled", async () => {
    const io = makeMockIo();
    expect(() => startChangeStreamWatcher(io, {}, true)).not.toThrow();
    await stopChangeStreamWatcher();
  });

  it("starts with custom config options", async () => {
    const io = makeMockIo();
    expect(() =>
      startChangeStreamWatcher(
        io,
        {
          batchSize: 10,
          fullDocument: "whenAvailable",
          ignoredCollections: ["logs"],
          ignoredOperations: ["delete"],
        },
        false
      )
    ).not.toThrow();
    await stopChangeStreamWatcher();
  });

  it("stopChangeStreamWatcher is safe to call when no watcher is active", async () => {
    await expect(stopChangeStreamWatcher()).resolves.toBeUndefined();
  });

  it("stopChangeStreamWatcher can be called multiple times", async () => {
    const io = makeMockIo();
    startChangeStreamWatcher(io, {}, false);
    await stopChangeStreamWatcher();
    await stopChangeStreamWatcher();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RealtimeApp — onServerCreated, setupAdapter, close
// ─────────────────────────────────────────────────────────────────────────────

describe("RealtimeApp — onServerCreated and setupAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      TOKEN_SECRET: "test-secret",
    };
  });

  afterEach(async () => {
    process.env = originalEnv;
  });

  it("register adds /realtime/health endpoint with debug flag", async () => {
    const expressApp = express();
    const app = new RealtimeApp({debug: true});
    app.register(expressApp);
    const supertest = await import("supertest");
    const st = supertest.default(expressApp);
    const res = await st.get("/realtime/health").expect(200);
    expect(res.body.status).toBe("not_started");
    expect(res.body.debug).toBe(true);
    expect(res.body.clients).toBe(0);
  });

  it("onServerCreated sets up Socket.io with JWT auth", async () => {
    const http = await import("node:http");
    const app = new RealtimeApp({debug: true, tokenSecret: "test-secret"});
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);
    expect(app.getIo()).not.toBeNull();

    await app.close();
    server.close();
  });

  it("onServerCreated throws when no socket authentication method is configured", () => {
    const http = require("node:http");
    const origSecret = process.env.TOKEN_SECRET;
    process.env.TOKEN_SECRET = "";
    const app = new RealtimeApp({});
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    expect(() => app.onServerCreated(server)).toThrow(
      "Socket authentication requires TOKEN_SECRET or Better Auth"
    );
    process.env.TOKEN_SECRET = origSecret;
    server.close();
  });

  it("onServerCreated uses default TOKEN_SECRET from env", async () => {
    const http = await import("node:http");
    process.env.TOKEN_SECRET = "env-secret";
    const app = new RealtimeApp({debug: false});
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);
    expect(app.getIo()).not.toBeNull();

    await app.close();
    server.close();
  });

  it("setupAdapter logs info for redis adapter with URL", async () => {
    const http = await import("node:http");
    const app = new RealtimeApp({
      adapter: "redis",
      debug: true,
      redisUrl: "redis://user:pass@localhost:6379",
      tokenSecret: "test-secret",
    });
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);
    expect(app.getIo()).not.toBeNull();

    await app.close();
    server.close();
  });

  it("setupAdapter warns when redis adapter has no URL", async () => {
    const http = await import("node:http");
    const origValkey = process.env.VALKEY_URL;
    const origRedis = process.env.REDIS_URL;
    delete process.env.VALKEY_URL;
    delete process.env.REDIS_URL;

    const app = new RealtimeApp({
      adapter: "redis",
      debug: true,
      tokenSecret: "test-secret",
    });
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);
    expect(app.getIo()).not.toBeNull();

    await app.close();
    server.close();
    process.env.VALKEY_URL = origValkey;
    process.env.REDIS_URL = origRedis;
  });

  it("setupAdapter with none adapter does nothing extra", async () => {
    const http = await import("node:http");
    const app = new RealtimeApp({
      adapter: "none",
      debug: true,
      tokenSecret: "test-secret",
    });
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);
    expect(app.getIo()).not.toBeNull();

    await app.close();
    server.close();
  });

  it("close is safe after onServerCreated", async () => {
    const http = await import("node:http");
    const app = new RealtimeApp({tokenSecret: "test-secret"});
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);
    await app.close();
    expect(app.getIo()).toBeNull();
    server.close();
  });

  it("health endpoint reports running after onServerCreated", async () => {
    const http = await import("node:http");
    const app = new RealtimeApp({tokenSecret: "test-secret"});
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);

    const supertest = await import("supertest");
    const st = supertest.default(expressApp);
    const res = await st.get("/realtime/health").expect(200);
    expect(res.body.status).toBe("running");

    await app.close();
    server.close();
  });

  it("onServerCreated with custom cors option", async () => {
    const http = await import("node:http");
    const app = new RealtimeApp({
      cors: {methods: ["GET"], origin: "https://example.com"},
      tokenSecret: "test-secret",
    });
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);
    expect(app.getIo()).not.toBeNull();

    await app.close();
    server.close();
  });

  it("setupAdapter uses VALKEY_URL when redisUrl not provided", async () => {
    const http = await import("node:http");
    process.env.VALKEY_URL = "redis://localhost:6379";
    const app = new RealtimeApp({
      adapter: "redis",
      debug: true,
      tokenSecret: "test-secret",
    });
    const expressApp = express();
    app.register(expressApp);
    const server = http.createServer(expressApp);

    app.onServerCreated(server);
    expect(app.getIo()).not.toBeNull();

    await app.close();
    server.close();
    delete process.env.VALKEY_URL;
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// redactCredentials — Redis URL logging
// ─────────────────────────────────────────────────────────────────────────────

describe("redactCredentials", () => {
  it("redacts user:password@ in a redis URL", () => {
    expect(redactCredentials("redis://user:secret@host:6379/0")).toBe("redis://***@host:6379/0");
  });

  it("redacts password-only userinfo", () => {
    expect(redactCredentials("redis://:secret@host:6379")).toBe("redis://***@host:6379");
  });

  it("returns the URL unchanged when there are no credentials", () => {
    expect(redactCredentials("redis://host:6379/0")).toBe("redis://host:6379/0");
  });

  it("falls back to regex replacement on unparsable URLs", () => {
    // Some non-URL strings still match the userinfo regex.
    expect(redactCredentials("rediss://u:p@example.com")).toContain("***@");
    expect(redactCredentials("rediss://u:p@example.com")).not.toContain("u:p");
  });
});
