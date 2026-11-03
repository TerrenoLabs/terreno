/**
 * Tests for the realtime module's pure functions and classes:
 *   - queryMatcher.ts (matchesQuery)
 *   - queryStore.ts (addQuerySubscription, removeQuerySubscription, etc.)
 *   - registry.ts (registerRealtime, getRealtimeRegistry, etc.)
 *   - realtimeApp.ts (RealtimeApp class — register, getIo, close)
 *   - realtimeApp.ts (installRealtimeSocketHandlers — permission and rate-limit logic)
 *   - changeStreamWatcher.ts (serializeDoc — responseHandler fallback)
 */

import {afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {assert} from "chai";
import express from "express";
import mongoose, {type Model} from "mongoose";
import type {Server} from "socket.io";

import type {JSONValue, ModelRouterOptions} from "../api";

import {clearAdminBroadcastScopes, registerAdminBroadcastScope} from "../sync/adminBroadcastScope";
import {
  emitToAuthorizedRoom,
  emitToDocumentAndQueryRooms,
  ensureApiId,
  mapOperationType,
  resolveRooms,
  serializeDoc,
  startChangeStreamWatcher,
  stopChangeStreamWatcher,
} from "./changeStreamWatcher";
import {matchesQuery} from "./queryMatcher";
import {
  addQuerySubscription,
  clearQueryStore,
  computeQueryId,
  getQuerySubscriptionsForCollection,
  removeAllSocketQueries,
  removeQuerySubscription,
} from "./queryStore";
import {
  installRealtimeSocketHandlers,
  MAX_MODEL_SUBSCRIPTIONS,
  MAX_QUERY_SUBSCRIPTIONS,
  RealtimeApp,
  type RealtimeSocketLike,
  redactCredentials,
} from "./realtimeApp";
import {
  clearRealtimeRegistry,
  findRegistryEntryByCollection,
  findRegistryEntryByRoutePath,
  getRealtimeRegistry,
  type RealtimeRegistryEntry,
  registerRealtime,
  updateRealtimeRegistryOptions,
} from "./registry";
import type {DecodedRealtimeToken} from "./socketUser";
import type {RealtimeConfig, RealtimeEvent} from "./types";

type ChangeStreamDoc = Parameters<typeof mapOperationType>[1];

const asChange = (change: Record<string, unknown>): ChangeStreamDoc =>
  change as unknown as ChangeStreamDoc;

type ResponseHandler = NonNullable<ModelRouterOptions<unknown>["responseHandler"]>;

interface MockRoomSocket {
  decodedToken?: DecodedRealtimeToken;
  emit: (event: string, payload: unknown) => void;
  id: string;
}

const permissiveOptions: ModelRouterOptions<unknown> = {
  permissions: {
    create: [() => true],
    delete: [() => true],
    list: [() => true],
    read: [() => true],
    update: [() => true],
  },
};

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
// queryStore tests
// ─────────────────────────────────────────────────────────────────────────────

describe("queryStore", () => {
  beforeEach(() => {
    clearQueryStore();
    clearAdminBroadcastScopes();
  });

  afterEach(() => {
    clearQueryStore();
    clearAdminBroadcastScopes();
  });

  describe("computeQueryId", () => {
    it("produces a deterministic id from collection and query", () => {
      const id1 = computeQueryId("todos", {completed: false});
      const id2 = computeQueryId("todos", {completed: false});
      expect(id1).toBe(id2);
    });

    it("normalizes key order before computing id", () => {
      const id1 = computeQueryId("todos", {completed: false, ownerId: "abc"});
      const id2 = computeQueryId("todos", {completed: false, ownerId: "abc"});
      expect(id1).toBe(id2);
    });

    it("includes the collection name in the id", () => {
      const id = computeQueryId("todos", {completed: false});
      expect(id.startsWith("todos:")).toBe(true);
    });

    it("produces different ids for different collections", () => {
      const id1 = computeQueryId("todos", {completed: false});
      const id2 = computeQueryId("items", {completed: false});
      expect(id1).not.toBe(id2);
    });

    it("produces different ids for different queries", () => {
      const id1 = computeQueryId("todos", {completed: false});
      const id2 = computeQueryId("todos", {completed: true});
      expect(id1).not.toBe(id2);
    });
  });

  describe("addQuerySubscription", () => {
    it("stores a subscription and makes it retrievable", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      const subs = getQuerySubscriptionsForCollection("todos");
      expect(subs).toHaveLength(1);
      expect(subs[0].queryId).toBe("todos:q1");
    });

    it("allows the same socket to subscribe to multiple queries", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      addQuerySubscription("socket1", "todos", {completed: true}, "todos:q2");
      const subs = getQuerySubscriptionsForCollection("todos");
      expect(subs).toHaveLength(2);
    });

    it("allows multiple sockets to subscribe to the same query", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      addQuerySubscription("socket2", "todos", {completed: false}, "todos:q1");
      const subs = getQuerySubscriptionsForCollection("todos");
      // Same queryId — deduplicated in the store
      expect(subs).toHaveLength(1);
    });
  });

  describe("removeQuerySubscription", () => {
    it("removes a specific query for a socket", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      removeQuerySubscription("socket1", "todos:q1");
      const subs = getQuerySubscriptionsForCollection("todos");
      expect(subs).toHaveLength(0);
    });

    it("does not remove a query if another socket still uses it", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      addQuerySubscription("socket2", "todos", {completed: false}, "todos:q1");
      removeQuerySubscription("socket1", "todos:q1");
      const subs = getQuerySubscriptionsForCollection("todos");
      expect(subs).toHaveLength(1);
    });

    it("is safe to call for a socket that has no subscriptions", () => {
      expect(() => removeQuerySubscription("nonexistent", "todos:q1")).not.toThrow();
    });
  });

  describe("removeAllSocketQueries", () => {
    it("removes all subscriptions for a socket", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      addQuerySubscription("socket1", "todos", {completed: true}, "todos:q2");
      removeAllSocketQueries("socket1");
      const subs = getQuerySubscriptionsForCollection("todos");
      expect(subs).toHaveLength(0);
    });

    it("preserves subscriptions for other sockets", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      addQuerySubscription("socket2", "todos", {completed: true}, "todos:q2");
      removeAllSocketQueries("socket1");
      const subs = getQuerySubscriptionsForCollection("todos");
      expect(subs).toHaveLength(1);
      expect(subs[0].queryId).toBe("todos:q2");
    });

    it("is safe to call for a socket that has no subscriptions", () => {
      expect(() => removeAllSocketQueries("nonexistent")).not.toThrow();
    });

    it("only removes a shared query if no other sockets use it", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      addQuerySubscription("socket2", "todos", {completed: false}, "todos:q1");
      removeAllSocketQueries("socket1");
      // socket2 still subscribes — query should remain
      const subs = getQuerySubscriptionsForCollection("todos");
      expect(subs).toHaveLength(1);
    });
  });

  describe("getQuerySubscriptionsForCollection", () => {
    it("returns only subscriptions for the given collection", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      addQuerySubscription("socket2", "items", {status: "active"}, "items:q1");
      const todoSubs = getQuerySubscriptionsForCollection("todos");
      expect(todoSubs).toHaveLength(1);
      expect(todoSubs[0].queryId).toBe("todos:q1");
    });

    it("returns an empty array when no subscriptions exist for collection", () => {
      const subs = getQuerySubscriptionsForCollection("nonexistent");
      expect(subs).toHaveLength(0);
    });

    it("returns query data for each subscription", () => {
      const query = {completed: false, ownerId: "user1"};
      addQuerySubscription("socket1", "todos", query, "todos:q1");
      const subs = getQuerySubscriptionsForCollection("todos");
      expect(subs[0].query).toEqual(query);
    });
  });

  describe("clearQueryStore", () => {
    it("removes all subscriptions", () => {
      addQuerySubscription("socket1", "todos", {completed: false}, "todos:q1");
      addQuerySubscription("socket2", "items", {status: "active"}, "items:q1");
      clearQueryStore();
      expect(getQuerySubscriptionsForCollection("todos")).toHaveLength(0);
      expect(getQuerySubscriptionsForCollection("items")).toHaveLength(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// registry tests
// ─────────────────────────────────────────────────────────────────────────────

describe("realtimeRegistry", () => {
  const makeEntry = (overrides: Partial<RealtimeRegistryEntry> = {}): RealtimeRegistryEntry => ({
    collectionName: "todos",
    config: {
      methods: ["create" as const, "update" as const, "delete" as const],
      roomStrategy: "owner" as const,
    },
    modelName: "Todo",
    options: permissiveOptions,
    routePath: "/todos",
    ...overrides,
  });

  beforeEach(() => {
    clearRealtimeRegistry();
  });

  afterEach(() => {
    clearRealtimeRegistry();
  });

  describe("registerRealtime", () => {
    it("adds an entry to the registry", () => {
      registerRealtime(makeEntry());
      expect(getRealtimeRegistry()).toHaveLength(1);
    });

    it("allows multiple entries", () => {
      registerRealtime(makeEntry({modelName: "Todo", routePath: "/todos"}));
      registerRealtime(
        makeEntry({collectionName: "items", modelName: "Item", routePath: "/items"})
      );
      expect(getRealtimeRegistry()).toHaveLength(2);
    });
  });

  describe("getRealtimeRegistry", () => {
    it("returns all registered entries", () => {
      registerRealtime(makeEntry({modelName: "Todo"}));
      registerRealtime(
        makeEntry({collectionName: "items", modelName: "Item", routePath: "/items"})
      );
      const registry = getRealtimeRegistry();
      expect(registry).toHaveLength(2);
      expect(registry.map((e) => e.modelName)).toEqual(["Todo", "Item"]);
    });

    it("returns empty array when nothing is registered", () => {
      expect(getRealtimeRegistry()).toHaveLength(0);
    });
  });

  describe("findRegistryEntryByCollection", () => {
    it("finds an entry by collection name", () => {
      registerRealtime(makeEntry({collectionName: "todos"}));
      const entry = findRegistryEntryByCollection("todos");
      expect(entry).toBeDefined();
      expect(entry?.collectionName).toBe("todos");
    });

    it("returns undefined for unknown collection", () => {
      const entry = findRegistryEntryByCollection("nonexistent");
      expect(entry).toBeUndefined();
    });

    it("returns first match when multiple entries exist", () => {
      registerRealtime(makeEntry({collectionName: "todos", modelName: "Todo1"}));
      registerRealtime(makeEntry({collectionName: "todos", modelName: "Todo2"}));
      const entry = findRegistryEntryByCollection("todos");
      expect(entry?.modelName).toBe("Todo1");
    });
  });

  describe("findRegistryEntryByRoutePath", () => {
    it("finds an entry by exact route path with leading slash", () => {
      registerRealtime(makeEntry({routePath: "/todos"}));
      const entry = findRegistryEntryByRoutePath("todos");
      expect(entry).toBeDefined();
      expect(entry?.routePath).toBe("/todos");
    });

    it("finds an entry when collection matches routePath exactly", () => {
      registerRealtime(makeEntry({routePath: "todos"}));
      const entry = findRegistryEntryByRoutePath("todos");
      expect(entry).toBeDefined();
    });

    it("returns undefined for unknown route path", () => {
      registerRealtime(makeEntry({routePath: "/todos"}));
      const entry = findRegistryEntryByRoutePath("items");
      expect(entry).toBeUndefined();
    });
  });

  describe("clearRealtimeRegistry", () => {
    it("removes all entries", () => {
      registerRealtime(makeEntry());
      clearRealtimeRegistry();
      expect(getRealtimeRegistry()).toHaveLength(0);
    });
  });

  describe("updateRealtimeRegistryOptions", () => {
    it("replaces options on an existing entry by route path", () => {
      registerRealtime(makeEntry({routePath: "/todos"}));
      const updatedOptions: ModelRouterOptions<unknown> = {
        permissions: {create: [], delete: [], list: [], read: [], update: []},
      };
      updateRealtimeRegistryOptions("/todos", updatedOptions);

      expect(getRealtimeRegistry()[0]?.options).toBe(updatedOptions);
    });

    it("no-ops when the route path is not registered", () => {
      registerRealtime(makeEntry({routePath: "/todos"}));
      const originalOptions = getRealtimeRegistry()[0]?.options;
      updateRealtimeRegistryOptions("/missing", {permissions: {}} as ModelRouterOptions<unknown>);

      expect(getRealtimeRegistry()[0]?.options).toBe(originalOptions);
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
  beforeEach(() => {
    clearRealtimeRegistry();
    clearQueryStore();
  });

  afterEach(() => {
    clearRealtimeRegistry();
    clearQueryStore();
  });

  const registerOwnerCollection = (): void => {
    registerRealtime({
      collectionName: "todos",
      config: {methods: ["create", "update", "delete"], roomStrategy: "owner"},
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
        queryFields: ["completed", "priority"],
      },
      routePath: "/todos",
    });
  };

  const registerModelCollection = (): void => {
    registerRealtime({
      collectionName: "broadcasts",
      config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      modelName: "Broadcast",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
        queryFields: ["priority"],
      },
      routePath: "/broadcasts",
    });
  };

  const registerAdminOnlyCollection = (): void => {
    registerRealtime({
      collectionName: "secrets",
      config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      modelName: "Secret",
      options: {
        permissions: {
          create: [(_method: string, user?: {admin?: boolean}) => user?.admin === true],
          delete: [(_method: string, user?: {admin?: boolean}) => user?.admin === true],
          list: [(_method: string, user?: {admin?: boolean}) => user?.admin === true],
          read: [(_method: string, user?: {admin?: boolean}) => user?.admin === true],
          update: [(_method: string, user?: {admin?: boolean}) => user?.admin === true],
        },
        queryFields: ["classification"],
      },
      routePath: "/secrets",
    });
  };

  describe("connection setup", () => {
    it("joins user-specific and authenticated rooms when token has userId", async () => {
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      // joinUserRooms is fire-and-forget — give microtasks a chance to flush.
      await Promise.resolve();
      await Promise.resolve();
      expect(socket.rooms.has("user:user1")).toBe(true);
      expect(socket.rooms.has("authenticated")).toBe(true);
    });

    it("joins admin room for admin tokens", async () => {
      const socket = createMockSocket({admin: true, id: "admin1"});
      installRealtimeSocketHandlers(socket);
      await Promise.resolve();
      await Promise.resolve();
      expect(socket.rooms.has("admin")).toBe(true);
    });

    it("does not join admin room for non-admin tokens", async () => {
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await Promise.resolve();
      await Promise.resolve();
      expect(socket.rooms.has("admin")).toBe(false);
    });
  });

  describe("subscribe:model permission", () => {
    it("denies unregistered collections", async () => {
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:model", "nonexistent");
      expect(socket.rooms.has("model:nonexistent")).toBe(false);
    });

    it("denies owner-strategy model room for non-admin users", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:model", "todos");
      expect(socket.rooms.has("model:todos")).toBe(false);
    });

    it("allows owner-strategy model room for admins", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: true, id: "admin1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:model", "todos");
      expect(socket.rooms.has("model:todos")).toBe(true);
    });

    it("allows non-admins to subscribe to model-strategy collections", async () => {
      registerModelCollection();
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:model", "broadcasts");
      expect(socket.rooms.has("model:broadcasts")).toBe(true);
    });

    it("denies model-strategy collections when modelRouter list permission fails", async () => {
      registerAdminOnlyCollection();
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:model", "secrets");
      expect(socket.rooms.has("model:secrets")).toBe(false);
    });

    it("allows model-strategy collections when modelRouter list permission passes", async () => {
      registerAdminOnlyCollection();
      const socket = createMockSocket({admin: true, id: "admin1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:model", "secrets");
      expect(socket.rooms.has("model:secrets")).toBe(true);
    });

    it("ignores empty or non-string model names", async () => {
      registerModelCollection();
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:model", "");
      await socket.trigger("subscribe:model", 123);
      await socket.trigger("subscribe:model", null);
      const modelRooms = Array.from(socket.rooms).filter((r) => r.startsWith("model:"));
      expect(modelRooms).toHaveLength(0);
    });

    it("enforces MAX_MODEL_SUBSCRIPTIONS cap", async () => {
      // Register MAX + 5 model-strategy collections.
      for (let i = 0; i < MAX_MODEL_SUBSCRIPTIONS + 5; i++) {
        registerRealtime({
          collectionName: `coll${i}`,
          config: {methods: ["create"], roomStrategy: "model"},
          modelName: `Coll${i}`,
          options: {
            permissions: {
              create: [() => true],
              delete: [() => true],
              list: [() => true],
              read: [() => true],
              update: [() => true],
            },
          },
          routePath: `/coll${i}`,
        });
      }
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      for (let i = 0; i < MAX_MODEL_SUBSCRIPTIONS + 5; i++) {
        await socket.trigger("subscribe:model", `coll${i}`);
      }
      const modelRooms = Array.from(socket.rooms).filter((r) => r.startsWith("model:"));
      expect(modelRooms.length).toBe(MAX_MODEL_SUBSCRIPTIONS);
    });
  });

  describe("subscribe:document permission", () => {
    it("denies unregistered collections", async () => {
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:document", {collection: "nonexistent", id: "abc"});
      const docRooms = Array.from(socket.rooms).filter((r) => r.startsWith("document:"));
      expect(docRooms).toHaveLength(0);
    });

    it("denies owner-strategy document subscription for non-admin", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:document", {collection: "todos", id: "doc1"});
      expect(socket.rooms.has("document:todos:doc1")).toBe(false);
    });

    it("allows owner-strategy document subscription for admins", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: true, id: "admin1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:document", {collection: "todos", id: "doc1"});
      expect(socket.rooms.has("document:todos:doc1")).toBe(true);
    });

    it("allows model-strategy document subscription for non-admin", async () => {
      registerModelCollection();
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:document", {collection: "broadcasts", id: "doc1"});
      expect(socket.rooms.has("document:broadcasts:doc1")).toBe(true);
    });

    it("denies document subscriptions when modelRouter read permission fails", async () => {
      registerAdminOnlyCollection();
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:document", {collection: "secrets", id: "doc1"});
      expect(socket.rooms.has("document:secrets:doc1")).toBe(false);
    });

    it("ignores malformed payloads", async () => {
      registerModelCollection();
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:document", null);
      await socket.trigger("subscribe:document", {});
      await socket.trigger("subscribe:document", {collection: "broadcasts"});
      await socket.trigger("subscribe:document", {id: "doc1"});
      await socket.trigger("subscribe:document", {collection: 123, id: "doc1"});
      const docRooms = Array.from(socket.rooms).filter((r) => r.startsWith("document:"));
      expect(docRooms).toHaveLength(0);
    });
  });

  describe("subscribe:query permission", () => {
    it("denies unregistered collections", async () => {
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {collection: "nope", query: {a: 1}});
      const queryRooms = Array.from(socket.rooms).filter((r) => r.startsWith("query:"));
      expect(queryRooms).toHaveLength(0);
    });

    it("injects ownerId for owner-strategy non-admin subscribers", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {
        collection: "todos",
        query: {completed: false},
      });

      // queryId emitted back must encode the injected ownerId
      const subscribed = socket.emitted.find((e) => e.event === "query:subscribed");
      expect(subscribed).toBeDefined();
      if (!subscribed) {
        throw new Error("Expected a query subscription event");
      }
      expect((subscribed.payload as {queryId: string}).queryId).toContain("user1");
    });

    it("does NOT inject ownerId for admins (admins see all)", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: true, id: "admin1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {
        collection: "todos",
        query: {completed: false},
      });
      const subscribed = socket.emitted.find((e) => e.event === "query:subscribed");
      expect(subscribed).toBeDefined();
      if (!subscribed) {
        throw new Error("Expected a query subscription event");
      }
      expect((subscribed.payload as {queryId: string}).queryId).not.toContain("admin1");
    });

    it("ignores subscriptions when user has no id (anonymous) for owner strategy", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: false}); // no id
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {
        collection: "todos",
        query: {completed: false},
      });
      const queryRooms = Array.from(socket.rooms).filter((r) => r.startsWith("query:"));
      expect(queryRooms).toHaveLength(0);
    });

    it("computes the queryId server-side regardless of client-provided value", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: true, id: "admin1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {
        collection: "todos",
        query: {completed: false},
        queryId: "EVIL_HIJACK", // client-provided is ignored
      });
      const subscribed = socket.emitted.find((e) => e.event === "query:subscribed");
      const payload = subscribed?.payload as {queryId: string};
      expect(payload.queryId).not.toBe("EVIL_HIJACK");
      // Must match what the server computes
      expect(payload.queryId).toBe(computeQueryId("todos", {completed: false}));
    });

    it("denies query subscriptions when modelRouter list permission fails", async () => {
      registerAdminOnlyCollection();
      const socket = createMockSocket({admin: false, id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {
        collection: "secrets",
        query: {classification: "restricted"},
      });
      const queryRooms = Array.from(socket.rooms).filter((r) => r.startsWith("query:"));
      expect(queryRooms).toHaveLength(0);
      expect(getQuerySubscriptionsForCollection("secrets")).toHaveLength(0);
    });

    it("applies modelRouter queryFilter before storing a query subscription", async () => {
      registerRealtime({
        collectionName: "filtered",
        config: {methods: ["create"], roomStrategy: "model"},
        modelName: "Filtered",
        options: {
          permissions: {
            create: [() => true],
            delete: [() => true],
            list: [() => true],
            read: [() => true],
            update: [() => true],
          },
          queryFields: ["status"],
          queryFilter: () => ({tenantId: "tenant-1"}),
        },
        routePath: "/filtered",
      });
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {
        collection: "filtered",
        query: {status: "active"},
      });
      const subs = getQuerySubscriptionsForCollection("filtered");
      expect(subs).toHaveLength(1);
      expect(subs[0].query).toEqual({status: "active", tenantId: "tenant-1"});
    });

    it("denies query subscriptions when modelRouter queryFilter throws", async () => {
      registerRealtime({
        collectionName: "filtered",
        config: {methods: ["create"], roomStrategy: "model"},
        modelName: "Filtered",
        options: {
          permissions: {
            create: [() => true],
            delete: [() => true],
            list: [() => true],
            read: [() => true],
            update: [() => true],
          },
          queryFields: ["status"],
          queryFilter: () => {
            throw new Error("tenant lookup failed");
          },
        },
        routePath: "/filtered",
      });
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {
        collection: "filtered",
        query: {status: "active"},
      });
      const queryRooms = Array.from(socket.rooms).filter((r) => r.startsWith("query:"));
      expect(queryRooms).toHaveLength(0);
      expect(getQuerySubscriptionsForCollection("filtered")).toHaveLength(0);
      expect(socket.emitted.some((e) => e.event === "query:subscribed")).toBe(false);
    });

    it("denies query keys outside the modelRouter queryFields allowlist", async () => {
      registerRealtime({
        collectionName: "charts",
        config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
        modelName: "Chart",
        options: {...permissiveOptions, queryFields: ["status"]},
        routePath: "/charts",
      });
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {
        collection: "charts",
        query: {diagnosis: {$in: ["F32.1"]}},
      });
      await socket.trigger("subscribe:query", {
        collection: "charts",
        query: {$or: [{status: "open"}, {diagnosis: "F41.1"}]},
      });
      await socket.trigger("subscribe:query", {
        collection: "charts",
        query: {"diagnosis.code": "F41", status: "open"},
      });
      expect(getQuerySubscriptionsForCollection("charts")).toHaveLength(0);
      expect(socket.emitted.some((e) => e.event === "query:subscribed")).toBe(false);

      await socket.trigger("subscribe:query", {
        collection: "charts",
        query: {$or: [{status: "open"}, {status: {$in: ["closed"]}}]},
      });
      expect(getQuerySubscriptionsForCollection("charts")).toHaveLength(1);
    });

    it("ignores malformed query payloads", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", null);
      await socket.trigger("subscribe:query", {});
      await socket.trigger("subscribe:query", {collection: "todos"});
      await socket.trigger("subscribe:query", {collection: "todos", query: [1, 2, 3]});
      await socket.trigger("subscribe:query", {collection: "todos", query: {$and: [null]}});
      await socket.trigger("subscribe:query", {collection: "todos", query: {$or: "priority"}});
      const queryRooms = Array.from(socket.rooms).filter((r) => r.startsWith("query:"));
      expect(queryRooms).toHaveLength(0);
    });

    it("enforces MAX_QUERY_SUBSCRIPTIONS cap", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: true, id: "admin1"});
      installRealtimeSocketHandlers(socket);
      for (let i = 0; i < MAX_QUERY_SUBSCRIPTIONS + 5; i++) {
        await socket.trigger("subscribe:query", {
          collection: "todos",
          query: {priority: i},
        });
      }
      const queryRooms = Array.from(socket.rooms).filter((r) => r.startsWith("query:"));
      expect(queryRooms.length).toBe(MAX_QUERY_SUBSCRIPTIONS);
    });
  });

  describe("unsubscribe and counters", () => {
    it("unsubscribe:model frees a slot so further subscriptions are allowed", async () => {
      registerModelCollection();
      registerRealtime({
        collectionName: "other",
        config: {methods: ["create"], roomStrategy: "model"},
        modelName: "Other",
        options: {
          permissions: {
            create: [() => true],
            delete: [() => true],
            list: [() => true],
            read: [() => true],
            update: [() => true],
          },
        },
        routePath: "/other",
      });
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:model", "broadcasts");
      expect(socket.rooms.has("model:broadcasts")).toBe(true);
      await socket.trigger("unsubscribe:model", "broadcasts");
      expect(socket.rooms.has("model:broadcasts")).toBe(false);
      // can re-subscribe
      await socket.trigger("subscribe:model", "other");
      expect(socket.rooms.has("model:other")).toBe(true);
    });

    it("unsubscribe:document removes the room and decrements the counter", async () => {
      registerModelCollection();
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:document", {collection: "broadcasts", id: "doc1"});
      expect(socket.rooms.has("document:broadcasts:doc1")).toBe(true);
      await socket.trigger("unsubscribe:document", {collection: "broadcasts", id: "doc1"});
      expect(socket.rooms.has("document:broadcasts:doc1")).toBe(false);
    });

    it("unsubscribe:document ignores malformed payloads", async () => {
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      // None of these should throw or affect rooms
      await socket.trigger("unsubscribe:document", null);
      await socket.trigger("unsubscribe:document", {});
      await socket.trigger("unsubscribe:document", {collection: "broadcasts"});
      await socket.trigger("unsubscribe:document", {id: "doc1"});
      const docRooms = Array.from(socket.rooms).filter((r) => r.startsWith("document:"));
      expect(docRooms).toHaveLength(0);
    });

    it("unsubscribe:query removes the query subscription and leaves the room", async () => {
      registerModelCollection();
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {collection: "broadcasts", query: {priority: 1}});
      const subscribed = socket.emitted.find((e) => e.event === "query:subscribed");
      expect(subscribed).toBeDefined();
      if (!subscribed) {
        throw new Error("Expected a query subscription event");
      }
      const queryId = (subscribed.payload as {queryId: string}).queryId;
      expect(socket.rooms.has(`query:${queryId}`)).toBe(true);
      expect(getQuerySubscriptionsForCollection("broadcasts").length).toBe(1);
      await socket.trigger("unsubscribe:query", {queryId});
      expect(socket.rooms.has(`query:${queryId}`)).toBe(false);
      expect(getQuerySubscriptionsForCollection("broadcasts").length).toBe(0);
    });

    it("unsubscribe:query ignores malformed payloads", async () => {
      const socket = createMockSocket({id: "user1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("unsubscribe:query", null);
      await socket.trigger("unsubscribe:query", {});
      // No assertion needed — just exercises the no-op path
    });

    it("disconnect removes all query subscriptions for the socket", async () => {
      registerOwnerCollection();
      const socket = createMockSocket({admin: true, id: "admin1"});
      installRealtimeSocketHandlers(socket);
      await socket.trigger("subscribe:query", {collection: "todos", query: {priority: 1}});
      await socket.trigger("subscribe:query", {collection: "todos", query: {priority: 2}});
      expect(getQuerySubscriptionsForCollection("todos").length).toBeGreaterThan(0);
      await socket.trigger("disconnect");
      // The mock leaves rooms intact but the store should be cleared for this socket.
      // Other sockets aren't subscribed, so the store should be empty.
      expect(getQuerySubscriptionsForCollection("todos").length).toBe(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// serializeDoc — responseHandler fallback for change stream events
// ─────────────────────────────────────────────────────────────────────────────

describe("serializeDoc (change stream serializer)", () => {
  const makeEntry = (overrides: Partial<RealtimeRegistryEntry> = {}): RealtimeRegistryEntry => ({
    collectionName: "users",
    config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
    modelName: "User",
    options: permissiveOptions,
    routePath: "/users",
    ...overrides,
  });

  it("prefers realtimeResponseHandler when provided", async () => {
    const entry = makeEntry({
      config: {
        methods: ["update"],
        realtimeResponseHandler: (doc) => ({customized: doc.name}),
        roomStrategy: "model",
      },
    });
    const result = await serializeDoc(entry, {name: "Alice", secret: "x"}, "update");
    expect(result).toEqual({customized: "Alice"});
  });

  it("falls back to modelRouter responseHandler when no realtime handler is set", async () => {
    // Mimics a stripping responseHandler like the example-backend users router.
    const handler: ResponseHandler = async (doc) => {
      const record = {...(doc as unknown as Record<string, unknown>)};
      delete record.hash;
      delete record.salt;
      return record as unknown as JSONValue;
    };
    const responseHandler = mock(handler);
    const entry = makeEntry({options: {...permissiveOptions, responseHandler}});
    const result = await serializeDoc(
      entry,
      {email: "a@b.com", hash: "h", name: "Alice", salt: "s"},
      "update"
    );
    expect(result).toEqual({email: "a@b.com", name: "Alice"});
    expect(responseHandler).toHaveBeenCalled();
  });

  it("maps 'delete' method to 'read' when invoking the REST responseHandler", async () => {
    let observedMethod: string | undefined;
    const responseHandler: ResponseHandler = async (doc, method) => {
      observedMethod = method;
      return doc as unknown as JSONValue;
    };
    const entry = makeEntry({options: {...permissiveOptions, responseHandler}});
    await serializeDoc(entry, {name: "Alice"}, "delete");
    expect(observedMethod).toBe("read");
  });

  it("re-throws when modelRouter responseHandler throws (event dropped, no leak)", async () => {
    // Critical: do NOT fall back to toJSON, which would skip the handler's sanitization
    // (e.g. stripping hash/salt) and leak the raw document.
    const responseHandler: ResponseHandler = async () => {
      throw new Error("boom");
    };
    const entry = makeEntry({options: {...permissiveOptions, responseHandler}});
    const doc = {hash: "h", name: "Alice", salt: "s", toJSON: () => ({hash: "h", name: "Alice"})};
    await expect(serializeDoc(entry, doc, "update")).rejects.toThrow("boom");
  });

  it("re-throws when realtimeResponseHandler throws (event dropped, no leak)", async () => {
    const entry = makeEntry({
      config: {
        methods: ["update"],
        realtimeResponseHandler: () => {
          throw new Error("boom");
        },
        roomStrategy: "model",
      },
    });
    const doc = {name: "Alice", toJSON: () => ({name: "Alice-json"})};
    await expect(serializeDoc(entry, doc, "update")).rejects.toThrow("boom");
  });

  it("returns toJSON output when no handlers are configured", async () => {
    const entry = makeEntry();
    const doc = {name: "Alice", toJSON: () => ({id: "1", name: "Alice"})};
    const result = await serializeDoc(entry, doc, "create");
    expect(result).toEqual({id: "1", name: "Alice"});
  });

  it("returns raw doc when toJSON is missing and no handlers configured", async () => {
    const entry = makeEntry();
    const result = await serializeDoc(entry, {name: "Alice"}, "create");
    expect(result).toEqual({name: "Alice"});
  });

  it("adds id from _id when handlers omit it (change stream raw document shape)", async () => {
    const entry = makeEntry();
    const result = await serializeDoc(
      entry,
      {_id: "507f1f77bcf86cd799439011", name: "Alice"},
      "create"
    );
    expect(result).toEqual({
      _id: "507f1f77bcf86cd799439011",
      id: "507f1f77bcf86cd799439011",
      name: "Alice",
    });
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

  it("maps update with deleted=true to delete (soft delete) when delete is enabled", () => {
    expect(
      mapOperationType("update", asChange({updateDescription: {updatedFields: {deleted: true}}}), [
        "create",
        "update",
        "delete",
      ])
    ).toBe("delete");
  });

  it("keeps soft delete as update when delete is NOT in the enabled methods", () => {
    // A model configured with methods: ["create", "update"] must still see
    // soft-delete events as updates — otherwise they'd be silently dropped.
    expect(
      mapOperationType("update", asChange({updateDescription: {updatedFields: {deleted: true}}}), [
        "create",
        "update",
      ])
    ).toBe("update");
  });

  it("maps delete to delete", () => {
    expect(mapOperationType("delete", asChange({}))).toBe("delete");
  });

  it("returns null for unknown operation types", () => {
    expect(mapOperationType("invalidate", asChange({}))).toBeNull();
    expect(mapOperationType("drop", asChange({}))).toBeNull();
  });
});

describe("resolveRooms", () => {
  const baseEntry: RealtimeRegistryEntry = {
    collectionName: "todos",
    config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
    modelName: "Todo",
    options: permissiveOptions,
    routePath: "/todos",
  };

  it("returns user-specific room for owner strategy with ownerId", () => {
    const entry = {...baseEntry, config: {...baseEntry.config, roomStrategy: "owner" as const}};
    const rooms = resolveRooms(entry, {ownerId: "user-1"}, "create");
    expect(rooms).toEqual(["user:user-1"]);
  });

  it("converts ObjectId-like ownerId to string", () => {
    const entry = {...baseEntry, config: {...baseEntry.config, roomStrategy: "owner" as const}};
    const ownerId = {toString: (): string => "owner-from-obj"};
    const rooms = resolveRooms(entry, {ownerId}, "create");
    expect(rooms).toEqual(["user:owner-from-obj"]);
  });

  it("falls back to model room when owner strategy has no ownerId", () => {
    const entry = {...baseEntry, config: {...baseEntry.config, roomStrategy: "owner" as const}};
    const rooms = resolveRooms(entry, {}, "create");
    expect(rooms).toEqual(["model:todos"]);
  });

  it("returns model room for model strategy", () => {
    const entry = {...baseEntry, config: {...baseEntry.config, roomStrategy: "model" as const}};
    const rooms = resolveRooms(entry, {}, "create");
    expect(rooms).toEqual(["model:todos"]);
  });

  it("returns authenticated room for broadcast strategy", () => {
    const entry = {...baseEntry, config: {...baseEntry.config, roomStrategy: "broadcast" as const}};
    const rooms = resolveRooms(entry, {}, "create");
    expect(rooms).toEqual(["authenticated"]);
  });

  it("defaults to model room for unknown strategy", () => {
    const entry = {
      ...baseEntry,
      config: {
        ...baseEntry.config,
        roomStrategy: "unknown" as unknown as RealtimeConfig["roomStrategy"],
      },
    };
    const rooms = resolveRooms(entry, {}, "create");
    expect(rooms).toEqual(["model:todos"]);
  });

  it("invokes custom function room resolver", () => {
    const entry: RealtimeRegistryEntry = {
      ...baseEntry,
      config: {
        ...baseEntry.config,
        roomStrategy: (doc, method): string[] => [`custom:${method}:${String(doc.id)}`],
      },
    };
    const rooms = resolveRooms(entry, {id: "42"}, "update");
    expect(rooms).toEqual(["custom:update:42"]);
  });
});

describe("emitToDocumentAndQueryRooms", () => {
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
      to: (room: string) => ({
        emit: (event: string, payload: unknown): void => {
          emissions.push({event, payload, room});
        },
      }),
    } as unknown as Server;
    return {addSocketToRoom, emissions, io};
  };

  beforeEach(() => {
    clearQueryStore();
  });

  afterEach(() => {
    clearQueryStore();
  });

  it("emits to the document room", async () => {
    const {emissions, io} = makeIo();
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "update",
      model: "Todo",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "todos", event, {}, () => {});
    expect(emissions.some((e) => e.room === "document:todos:doc-1")).toBe(true);
  });

  it("keeps fanning out to later query rooms when one subscription fails", async () => {
    addQuerySubscription("socket-a", "todos", {priority: 1}, "failing");
    const healthyId = computeQueryId("todos", {priority: 1});
    addQuerySubscription("socket-b", "todos", {priority: 1}, healthyId);
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom(`query:${healthyId}`);
    const throwingIo = {
      ...io,
      to: (room: string) => {
        if (room === "query:failing") {
          throw new Error("emit failed");
        }
        return io.to(room);
      },
    } as unknown as Server;
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "create",
      model: "Todo",
      timestamp: 1,
    };

    await emitToDocumentAndQueryRooms(
      throwingIo,
      "todos",
      event,
      {name: "x", priority: 1},
      () => {}
    );

    expect(emissions.some((e) => e.room === `query:${healthyId}`)).toBe(true);
  });

  it("forwards hard deletes to every query room for non-owner strategies", async () => {
    const queryId = computeQueryId("todos", {priority: 1});
    addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom(`query:${queryId}`);
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "delete",
      model: "Todo",
      timestamp: 1,
    };
    const entry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["delete"], roomStrategy: "model"},
      modelName: "Todo",
      options: permissiveOptions,
      routePath: "/todos",
    };
    await emitToDocumentAndQueryRooms(io, "todos", event, undefined, () => {}, entry);
    expect(emissions.some((e) => e.room === `query:${queryId}` && e.event === "sync")).toBe(true);
  });

  it("does NOT forward hard deletes to query rooms for owner-strategy collections", async () => {
    const queryId = computeQueryId("todos", {ownerId: "user-1"});
    addQuerySubscription("socket-a", "todos", {ownerId: "user-1"}, queryId);
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom("document:todos:doc-1");
    addSocketToRoom(`query:${queryId}`);
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "delete",
      model: "Todo",
      timestamp: 1,
    };
    const entry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["delete"], roomStrategy: "owner"},
      modelName: "Todo",
      options: permissiveOptions,
      routePath: "/todos",
    };
    await emitToDocumentAndQueryRooms(io, "todos", event, undefined, () => {}, entry);
    // Document room still receives the event, but query rooms must not — otherwise users
    // would see deletes for docs they don't own.
    expect(emissions.some((e) => e.room === `query:${queryId}`)).toBe(false);
    expect(emissions.some((e) => e.room === "document:todos:doc-1")).toBe(true);
  });

  it("forwards soft deletes only to query rooms whose filter the document satisfies", async () => {
    const matchingQueryId = computeQueryId("todos", {priority: 1});
    const nonMatchingQueryId = computeQueryId("todos", {priority: 9});
    addQuerySubscription("socket-a", "todos", {priority: 1}, matchingQueryId);
    addQuerySubscription("socket-b", "todos", {priority: 9}, nonMatchingQueryId);
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom(`query:${matchingQueryId}`);
    addSocketToRoom(`query:${nonMatchingQueryId}`);
    const event: RealtimeEvent = {
      collection: "todos",
      data: {deleted: true, priority: 1},
      id: "doc-1",
      method: "delete",
      model: "Todo",
      timestamp: 1,
    };
    const entry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["delete"], roomStrategy: "owner"},
      modelName: "Todo",
      options: permissiveOptions,
      routePath: "/todos",
    };
    await emitToDocumentAndQueryRooms(
      io,
      "todos",
      event,
      {deleted: true, priority: 1},
      () => {},
      entry
    );
    expect(emissions.some((e) => e.room === `query:${matchingQueryId}`)).toBe(true);
    expect(emissions.some((e) => e.room === `query:${nonMatchingQueryId}`)).toBe(false);
  });

  it("skips matching when fullDocument is missing on non-delete events", async () => {
    const queryId = computeQueryId("todos", {priority: 1});
    addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
    const {emissions, io} = makeIo();
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "create",
      model: "Todo",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "todos", event, undefined, () => {});
    expect(emissions.some((e) => e.room === `query:${queryId}`)).toBe(false);
  });

  it("emits create events to query rooms when the doc matches", async () => {
    const queryId = computeQueryId("todos", {priority: 1});
    addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
    const {emissions, io} = makeIo();
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "create",
      model: "Todo",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "todos", event, {priority: 1}, () => {});
    const queryEmissions = emissions.filter((e) => e.room === `query:${queryId}`);
    expect(queryEmissions.length).toBe(1);
    expect(queryEmissions[0].payload).toMatchObject({method: "create"});
  });

  it("does not emit create events to query rooms when the doc does not match", async () => {
    const queryId = computeQueryId("todos", {priority: 1});
    addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
    const {emissions, io} = makeIo();
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "create",
      model: "Todo",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "todos", event, {priority: 9}, () => {});
    expect(emissions.some((e) => e.room === `query:${queryId}`)).toBe(false);
  });

  it("emits update as-is when the document still matches the query", async () => {
    const queryId = computeQueryId("todos", {priority: 1});
    addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
    const {emissions, io} = makeIo();
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "update",
      model: "Todo",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "todos", event, {priority: 1}, () => {});
    const queryEmissions = emissions.filter((e) => e.room === `query:${queryId}`);
    expect(queryEmissions.length).toBe(1);
    expect(queryEmissions[0].payload).toMatchObject({method: "update"});
  });

  it("converts updates that no longer match into delete events for the query", async () => {
    const queryId = computeQueryId("todos", {priority: 1});
    addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
    const {emissions, io} = makeIo();
    const event: RealtimeEvent = {
      collection: "todos",
      id: "doc-1",
      method: "update",
      model: "Todo",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "todos", event, {priority: 9}, () => {});
    const queryEmissions = emissions.filter((e) => e.room === `query:${queryId}`);
    expect(queryEmissions.length).toBe(1);
    expect(queryEmissions[0].payload).toMatchObject({method: "delete"});
  });

  it("filters socket emissions by object read permission and responseHandler", async () => {
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom("model:todos", {id: "owner-1"});
    addSocketToRoom("model:todos", {id: "other-user"});
    const entry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["update"], roomStrategy: "model"},
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [
            (_method: string, user?: {admin?: boolean; id?: string}, obj?: unknown) =>
              user?.admin === true || user?.id === (obj as {ownerId?: string} | undefined)?.ownerId,
          ],
          update: [() => true],
        },
        responseHandler: async (doc, _method, req) => {
          const record = doc as unknown as {_id?: unknown; title?: unknown};
          return {
            id: record._id,
            title: record.title,
            visibleTo: req.user?.id,
          } as unknown as JSONValue;
        },
      },
      routePath: "/todos",
    };

    await emitToAuthorizedRoom(
      io,
      "model:todos",
      {
        collection: "todos",
        id: "todo-1",
        method: "update",
        model: "Todo",
        timestamp: 1,
      },
      entry,
      {_id: "todo-1", ownerId: "owner-1", secret: "hidden", title: "Visible"},
      () => {}
    );

    expect(emissions).toHaveLength(1);
    expect(emissions[0].payload).toMatchObject({
      data: {id: "todo-1", title: "Visible", visibleTo: "owner-1"},
    });
  });

  it("continues emitting to other sockets when per-socket serialization fails", async () => {
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom("model:todos", {id: "bad-user"});
    addSocketToRoom("model:todos", {id: "good-user"});
    const entry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["update"], roomStrategy: "model"},
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
        responseHandler: async (doc, _method, req) => {
          if (req.user?.id === "bad-user") {
            throw new Error("cannot serialize for bad user");
          }

          return {
            ...(doc as unknown as Record<string, unknown>),
            visibleTo: req.user?.id,
          } as unknown as JSONValue;
        },
      },
      routePath: "/todos",
    };

    await emitToAuthorizedRoom(
      io,
      "model:todos",
      {
        collection: "todos",
        id: "todo-1",
        method: "update",
        model: "Todo",
        timestamp: 1,
      },
      entry,
      {_id: "todo-1", title: "Visible"},
      () => {}
    );

    expect(emissions).toHaveLength(1);
    expect(emissions[0].payload).toMatchObject({
      data: {id: "todo-1", title: "Visible", visibleTo: "good-user"},
    });
  });

  it("allows admin broadcast sockets without running product read permissions", async () => {
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom("sync:todos|admin", {admin: true, id: "admin-user"});
    registerAdminBroadcastScope("Todo", {
      listPermissions: [() => true],
      readPermissions: [() => true],
    });
    const entry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["update"], roomStrategy: "model"},
      modelName: "Todo",
      options: {
        ...permissiveOptions,
        permissions: {...permissiveOptions.permissions, read: [() => false]},
      },
      routePath: "/todos",
    };

    await emitToAuthorizedRoom(
      io,
      "sync:todos|admin",
      {
        collection: "todos",
        id: "todo-1",
        method: "update",
        model: "Todo",
        timestamp: 1,
      },
      entry,
      {_id: "todo-1", ownerId: "owner-1"},
      () => {}
    );

    assert.lengthOf(emissions, 1);
  });

  it("does not emit admin broadcast documents denied by the admin scope", async () => {
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom("sync:todos|admin", {admin: true, id: "admin-user"});
    registerAdminBroadcastScope("Todo", {
      listPermissions: [() => false],
      readPermissions: [() => true],
    });
    const entry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["update"], roomStrategy: "model"},
      modelName: "Todo",
      options: permissiveOptions,
      routePath: "/todos",
    };

    await emitToAuthorizedRoom(
      io,
      "sync:todos|admin",
      {
        collection: "todos",
        id: "todo-1",
        method: "update",
        model: "Todo",
        timestamp: 1,
      },
      entry,
      {_id: "todo-1", ownerId: "owner-1"},
      () => {}
    );

    assert.isEmpty(emissions);
  });

  it("does not emit hard delete metadata when read permission requires an object owner", async () => {
    const {addSocketToRoom, emissions, io} = makeIo();
    addSocketToRoom("model:todos", {id: "other-user"});
    const entry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["delete"], roomStrategy: "model"},
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [
            (_method: string, user?: {admin?: boolean; id?: string}, obj?: unknown) =>
              user?.admin === true || user?.id === (obj as {ownerId?: string} | undefined)?.ownerId,
          ],
          update: [() => true],
        },
      },
      routePath: "/todos",
    };

    await emitToAuthorizedRoom(
      io,
      "model:todos",
      {
        collection: "todos",
        id: "todo-1",
        method: "delete",
        model: "Todo",
        timestamp: 1,
      },
      entry,
      undefined,
      () => {}
    );

    expect(emissions).toEqual([]);
  });

  describe("query room fanout with a registry entry", () => {
    const modelEntry: RealtimeRegistryEntry = {
      collectionName: "todos",
      config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/todos",
    };

    const makeEvent = (method: RealtimeEvent["method"]): RealtimeEvent => ({
      collection: "todos",
      id: "doc-1",
      method,
      model: "Todo",
      timestamp: 1,
    });

    it("emits creates through the permission-filtered path", async () => {
      const queryId = computeQueryId("todos", {priority: 1});
      addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
      const {addSocketToRoom, emissions, io} = makeIo();
      addSocketToRoom(`query:${queryId}`, {id: "user-1"});

      await emitToDocumentAndQueryRooms(
        io,
        "todos",
        makeEvent("create"),
        {priority: 1},
        () => {},
        modelEntry
      );

      const queryEmissions = emissions.filter((e) => e.room === `query:${queryId}`);
      expect(queryEmissions).toHaveLength(1);
      expect(queryEmissions[0].payload).toMatchObject({data: {priority: 1}, method: "create"});
    });

    it("emits updates through the permission-filtered path when the doc still matches", async () => {
      const queryId = computeQueryId("todos", {priority: 1});
      addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
      const {addSocketToRoom, emissions, io} = makeIo();
      addSocketToRoom(`query:${queryId}`, {id: "user-1"});

      await emitToDocumentAndQueryRooms(
        io,
        "todos",
        makeEvent("update"),
        {priority: 1},
        () => {},
        modelEntry
      );

      const queryEmissions = emissions.filter((e) => e.room === `query:${queryId}`);
      expect(queryEmissions).toHaveLength(1);
      expect(queryEmissions[0].payload).toMatchObject({method: "update"});
    });

    it("converts non-matching updates into deletes through the permission-filtered path", async () => {
      const queryId = computeQueryId("todos", {priority: 1});
      addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
      const {addSocketToRoom, emissions, io} = makeIo();
      addSocketToRoom(`query:${queryId}`, {id: "user-1"});

      await emitToDocumentAndQueryRooms(
        io,
        "todos",
        makeEvent("update"),
        {priority: 9},
        () => {},
        modelEntry
      );

      const queryEmissions = emissions.filter((e) => e.room === `query:${queryId}`);
      expect(queryEmissions).toHaveLength(1);
      expect(queryEmissions[0].payload).toMatchObject({method: "delete"});
    });

    it("matches query rooms against the recipient's RBAC-masked document", async () => {
      const fieldMaskRequests: unknown[] = [];
      const rbacEntry: RealtimeRegistryEntry = {
        ...modelEntry,
        options: {
          ...modelEntry.options,
          access: {resource: "chart"},
          accessControl: {
            can: async () => ({allowed: true}),
            fieldMask: async (args: unknown) => {
              fieldMaskRequests.push(args);
              return {omit: ["diagnosis"], read: "*", write: "*"};
            },
            statements: {chart: ["read", "list"]},
          } as unknown as NonNullable<RealtimeRegistryEntry["options"]["accessControl"]>,
        },
      };
      const matchingId = computeQueryId("todos", {diagnosis: "F32.1"});
      const otherId = computeQueryId("todos", {diagnosis: "F41.1"});
      addQuerySubscription("socket-a", "todos", {diagnosis: "F32.1"}, matchingId);
      addQuerySubscription("socket-b", "todos", {diagnosis: "F41.1"}, otherId);
      const {addSocketToRoom, emissions, io} = makeIo();
      addSocketToRoom(`query:${matchingId}`, {id: "scheduler"});
      addSocketToRoom(`query:${otherId}`, {id: "scheduler"});

      await emitToDocumentAndQueryRooms(
        io,
        "todos",
        makeEvent("update"),
        {_id: "doc-1", diagnosis: "F32.1", status: "open"},
        () => {},
        rbacEntry
      );

      const methodFor = (queryId: string): unknown =>
        (emissions.find((e) => e.room === `query:${queryId}`)?.payload as {method?: string})
          ?.method;
      // The hidden value must not decide which event each room receives.
      expect(methodFor(matchingId)).toBe(methodFor(otherId));
      expect(methodFor(matchingId)).toBe("delete");
      for (const emission of emissions) {
        expect((emission.payload as {data?: Record<string, unknown>}).data).not.toHaveProperty(
          "diagnosis"
        );
      }
      expect(fieldMaskRequests.length).toBeGreaterThan(0);
    });

    it("skips query rooms whose subscribers cannot read the document", async () => {
      const queryId = computeQueryId("todos", {priority: 1});
      addQuerySubscription("socket-a", "todos", {priority: 1}, queryId);
      const {addSocketToRoom, emissions, io} = makeIo();
      addSocketToRoom(`query:${queryId}`, {id: "other-user"});
      const ownerEntry: RealtimeRegistryEntry = {
        ...modelEntry,
        options: {
          permissions: {
            create: [() => true],
            delete: [() => true],
            list: [() => true],
            read: [
              (_method, user?: {admin?: boolean; id?: string}, obj?: unknown) =>
                user?.admin === true ||
                user?.id === (obj as {ownerId?: string} | undefined)?.ownerId,
            ],
            update: [() => true],
          },
        },
      };

      await emitToDocumentAndQueryRooms(
        io,
        "todos",
        makeEvent("create"),
        {ownerId: "user-1", priority: 1},
        () => {},
        ownerEntry
      );

      expect(emissions.some((e) => e.room === `query:${queryId}`)).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// redactCredentials — Redis URL logging
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// startChangeStreamWatcher / stopChangeStreamWatcher — MongoDB change stream
// ─────────────────────────────────────────────────────────────────────────────

describe("startChangeStreamWatcher", () => {
  let originalDb: typeof mongoose.connection.db;

  beforeEach(() => {
    originalDb = mongoose.connection.db;
    clearRealtimeRegistry();
  });

  afterEach(async () => {
    setConnectionDb(originalDb);
    clearRealtimeRegistry();
    // Ensure the watcher is stopped between tests
    const {stopChangeStreamWatcher: stop} = await import("./changeStreamWatcher.js");
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

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
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

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
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

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    expect(() => startChangeStreamWatcher(io)).toThrow("Failed to create change stream watcher");
  });

  it("handles change events for registered models", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "model",
      },
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // Trigger an insert change event
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      fullDocument: {_id: "doc-1", name: "Test Todo"},
      ns: {coll: "todos"},
      operationType: "insert",
    });
  });

  it("skips events for unregistered collections", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
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

  it("skips events when method is not enabled for the model", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create"], // only create enabled
        roomStrategy: "model",
      },
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [],
          list: [() => true],
          read: [() => true],
          update: [],
        },
      },
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // Update event should be skipped because "update" not in methods
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      fullDocument: {_id: "doc-1", name: "Updated"},
      ns: {coll: "todos"},
      operationType: "update",
      updateDescription: {updatedFields: {name: "Updated"}},
    });
  });

  it("handles delete events for owner-strategy models", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "owner",
      },
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // Hard delete (no fullDocument)
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      ns: {coll: "todos"},
      operationType: "delete",
    });
  });

  it("handles delete events for broadcast-strategy models", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    registerRealtime({
      collectionName: "broadcasts",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "broadcast",
      },
      modelName: "Broadcast",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/broadcasts",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // Hard delete for broadcast strategy
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      ns: {coll: "broadcasts"},
      operationType: "delete",
    });
  });

  // Records every emission so hard-delete room routing can be asserted.
  const createRecordingIo = (
    room: string,
    decodedToken: {admin?: boolean; id?: string} = {admin: true, id: "admin"}
  ): {
    emissions: Array<{event: string; payload: unknown}>;
    io: import("socket.io").Server;
  } => {
    const emissions: Array<{event: string; payload: unknown}> = [];
    const rooms = new Map<string, Set<string>>([[room, new Set(["socket-1"])]]);
    const sockets = new Map<string, unknown>([
      [
        "socket-1",
        {
          decodedToken,
          emit: (event: string, payload: unknown): void => {
            emissions.push({event, payload});
          },
          id: "socket-1",
        },
      ],
    ]);
    return {
      emissions,
      io: {
        sockets: {adapter: {rooms}, sockets},
        to: (_room: string) => ({emit: (_event: string, _data: unknown) => {}}),
      } as unknown as import("socket.io").Server,
    };
  };

  it("routes hard deletes for model-strategy models to the model room", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "model",
      },
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const {emissions, io} = createRecordingIo("model:todos");

    startChangeStreamWatcher(io, {}, true);

    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      ns: {coll: "todos"},
      operationType: "delete",
    });

    expect(emissions).toHaveLength(1);
    expect(emissions[0].payload).toMatchObject({id: "doc-1", method: "delete", model: "Todo"});
  });

  it("swallows errors thrown while processing a change event", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "model",
      },
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const roomLookup = mock(() => {
      throw new Error("adapter unavailable");
    });
    const io = {
      sockets: {adapter: {rooms: {get: roomLookup}}, sockets: new Map()},
      to: (_room: string) => ({emit: (_event: string, _data: unknown) => {}}),
    } as unknown as import("socket.io").Server;

    startChangeStreamWatcher(io, {}, true);

    // The handler must not reject — a failed emission cannot take down the change stream.
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      fullDocument: {_id: "doc-1", name: "Test Todo"},
      ns: {coll: "todos"},
      operationType: "insert",
    });

    expect(roomLookup).toHaveBeenCalled();
  });

  it("includes updatedFields in event for update operations", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "model",
      },
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      fullDocument: {_id: "doc-1", name: "Updated", status: "done"},
      ns: {coll: "todos"},
      operationType: "update",
      updateDescription: {updatedFields: {name: "Updated", status: "done"}},
    });
  });

  it("respects ignoredCollections config", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
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

    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "model",
      },
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
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

  it("skips events with no collectionName or docId", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
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

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // "drop" is not in our pipeline filter, should be skipped
    await invokeRegisteredChangeHandler(mockStream, {
      operationType: "drop",
    });
  });

  it("returns early when the mapped realtime operation is null", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "model",
      },
      modelName: "Todo",
      options: {permissions: permissiveOptions.permissions},
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const {emissions, io} = createRecordingIo("model:todos");
    let operationTypeReads = 0;
    startChangeStreamWatcher(io, {}, true);

    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      fullDocument: {_id: "doc-1"},
      ns: {coll: "todos"},
      get operationType(): string {
        operationTypeReads += 1;
        return operationTypeReads === 1 ? "insert" : "invalidate";
      },
    });

    assert.isAtLeast(operationTypeReads, 2);
    assert.isEmpty(emissions);
  });

  it("handles error/close/end events gracefully", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    startChangeStreamWatcher(io, {}, true);

    // Trigger error, close, end — should not throw
    mockStream.trigger("error", new Error("test error"));
    mockStream.trigger("close");
    mockStream.trigger("end");
  });

  // Task 9.16: a transient stream failure used to be logged and then permanently starve
  // every realtime event and sync delta until the process restarted.
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

    const registerTodos = (): void => {
      registerRealtime({
        collectionName: "todos",
        config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
        modelName: "Todo",
        options: {
          permissions: {
            create: [() => true],
            delete: [() => true],
            list: [() => true],
            read: [() => true],
            update: [() => true],
          },
        },
        routePath: "/todos",
      });
    };

    /** An io whose room socket records deliveries, plus a recorded server-wide `emit`. */
    const createRecordingIo = (): {
      io: import("socket.io").Server;
      deliveries: {event: string; payload: unknown}[];
      serverEmissions: {event: string; payload: unknown}[];
    } => {
      const deliveries: {event: string; payload: unknown}[] = [];
      const serverEmissions: {event: string; payload: unknown}[] = [];
      const rooms = new Map<string, Set<string>>();
      rooms.set("model:todos", new Set(["sock-1"]));
      const sockets = new Map<string, MockRoomSocket>();
      sockets.set("sock-1", {
        decodedToken: {id: "user-1"},
        emit: (event: string, payload: unknown) => {
          deliveries.push({event, payload});
        },
        id: "sock-1",
      });
      return {
        deliveries,
        io: {
          emit: (event: string, payload: unknown) => {
            serverEmissions.push({event, payload});
          },
          sockets: {adapter: {rooms}, sockets},
          to: () => ({emit: () => {}}),
        } as unknown as import("socket.io").Server,
        serverEmissions,
      };
    };

    it("reopens with resumeAfter after a stream error and keeps delivering changes", async () => {
      const firstStream = createMockChangeStream();
      const secondStream = createMockChangeStream();
      const streams = [firstStream, secondStream];
      const mockDb = {watch: mock(() => streams.shift() ?? secondStream)};
      setConnectionDb(mockDb);
      registerTodos();

      const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
      const {deliveries, io} = createRecordingIo();
      startChangeStreamWatcher(io, {}, true);

      // A change on the first stream establishes the resume position.
      await invokeRegisteredChangeHandler(firstStream, {
        _id: {_data: "token-1"},
        documentKey: {_id: "doc-1"},
        fullDocument: {_id: "doc-1", name: "before the failure"},
        ns: {coll: "todos"},
        operationType: "insert",
      });
      expect(deliveries).toHaveLength(1);

      firstStream.trigger("error", new Error("replica set election"));
      await waitFor(() => mockDb.watch.mock.calls.length >= 2, "the stream to reopen");

      const reopenOptions = (mockDb.watch.mock.calls[1] as unknown[])[1] as {
        resumeAfter?: unknown;
      };
      expect(reopenOptions.resumeAfter).toEqual({_data: "token-1"});

      // The reopened stream is fully wired: later writes still fan out.
      await invokeRegisteredChangeHandler(secondStream, {
        _id: {_data: "token-2"},
        documentKey: {_id: "doc-2"},
        fullDocument: {_id: "doc-2", name: "after the restart"},
        ns: {coll: "todos"},
        operationType: "insert",
      });
      expect(deliveries).toHaveLength(2);
    });

    it("drops the resume token and asks clients to resync when the oplog history is lost", async () => {
      const firstStream = createMockChangeStream();
      const secondStream = createMockChangeStream();
      const streams = [firstStream, secondStream];
      const mockDb = {watch: mock(() => streams.shift() ?? secondStream)};
      setConnectionDb(mockDb);

      const {SYNC_RESYNC_EVENT, startChangeStreamWatcher} = await import(
        "./changeStreamWatcher.js"
      );
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
        "./changeStreamWatcher.js"
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

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");
    const io = createMockIo();

    startChangeStreamWatcher(io, {batchSize: 100, fullDocument: "whenAvailable"}, true);

    const options = (mockDb.watch.mock.calls[0] as unknown[])[1] as {
      batchSize?: number;
      fullDocument?: string;
    };
    expect(options.batchSize).toBe(100);
    expect(options.fullDocument).toBe("whenAvailable");
  });

  it("catches errors thrown in the change handler", async () => {
    const mockStream = createMockChangeStream();
    const mockDb = {
      watch: mock(() => mockStream),
    };
    setConnectionDb(mockDb);

    // Register with a model that will throw during permission check
    registerRealtime({
      collectionName: "todos",
      config: {
        methods: ["create", "update", "delete"],
        roomStrategy: "model",
      },
      modelName: "Todo",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [
            () => {
              throw new Error("permission check error");
            },
          ],
          update: [() => true],
        },
      },
      routePath: "/todos",
    });

    const {startChangeStreamWatcher} = await import("./changeStreamWatcher.js");

    // Create an IO with a socket in the target room
    const emissions: Array<{_data: unknown; _event: string}> = [];
    const mockSocket: MockRoomSocket = {
      decodedToken: {id: "user-1"},
      emit: (_event: string, _data: unknown) => {
        emissions.push({_data, _event});
      },
      id: "sock-1",
    };
    const rooms = new Map<string, Set<string>>();
    rooms.set("model:todos", new Set(["sock-1"]));
    const sockets = new Map<string, MockRoomSocket>();
    sockets.set("sock-1", mockSocket);
    const io = {
      sockets: {
        adapter: {rooms},
        sockets,
      },
      to: () => ({emit: () => {}}),
    } as unknown as import("socket.io").Server;

    startChangeStreamWatcher(io, {}, true);

    // Should not throw even though permission check throws
    await invokeRegisteredChangeHandler(mockStream, {
      documentKey: {_id: "doc-1"},
      fullDocument: {_id: "doc-1", name: "Test"},
      ns: {coll: "todos"},
      operationType: "insert",
    });
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
      "./changeStreamWatcher.js"
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
    clearRealtimeRegistry();
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

// Change streams require a MongoDB replica set. CI (api-ci.yml) runs standalone MongoDB,
// so these tests are skipped when replica sets are not available.
const hasReplicaSet = async (): Promise<boolean> => {
  try {
    const mongoose = require("mongoose");
    const admin = mongoose.connection.db.admin();
    const status = await admin.command({replSetGetStatus: 1});
    return !!status.ok;
  } catch {
    return false;
  }
};

describe("startChangeStreamWatcher — change event integration", () => {
  const mongoose = require("mongoose");
  let replicaSetAvailable = false;

  const realtimeTestSchema = new mongoose.Schema(
    {
      deleted: {default: false, type: Boolean},
      name: {type: String},
      ownerId: {type: String},
    },
    {collection: "realtimetests", strict: "throw"}
  );

  interface RealtimeTestDoc {
    deleted?: boolean;
    name?: string;
    ownerId?: string;
  }

  let RealtimeTestModel: Model<RealtimeTestDoc>;
  try {
    RealtimeTestModel = mongoose.model("RealtimeTest");
  } catch {
    RealtimeTestModel = mongoose.model("RealtimeTest", realtimeTestSchema);
  }

  interface TrackedEmission {
    event: string;
    payload: RealtimeEvent;
    room?: string;
    socketId?: string;
  }

  const makeTrackedIo = (): Server & {
    addSocketToRoom: (room: string, decodedToken?: DecodedRealtimeToken) => void;
    emissions: TrackedEmission[];
  } => {
    const emissions: TrackedEmission[] = [];
    const rooms = new Map<string, Set<string>>();
    const sockets = new Map<string, MockRoomSocket>();

    const addSocketToRoom = (
      room: string,
      decodedToken: DecodedRealtimeToken = {admin: true, id: "admin"}
    ): void => {
      const socketId = `socket-${Math.random().toString(36).slice(2, 9)}`;
      if (!rooms.has(room)) {
        rooms.set(room, new Set());
      }
      rooms.get(room)?.add(socketId);
      sockets.set(socketId, {
        decodedToken,
        emit: (event: string, payload: unknown): void => {
          emissions.push({event, payload: payload as RealtimeEvent, room, socketId});
        },
        id: socketId,
      });
    };

    return {
      addSocketToRoom,
      emissions,
      sockets: {
        adapter: {rooms},
        sockets,
      },
      to: (room: string) => ({
        emit: (event: string, payload: unknown): void => {
          emissions.push({event, payload: payload as RealtimeEvent, room});
        },
      }),
    } as unknown as Server & {
      addSocketToRoom: (room: string, decodedToken?: DecodedRealtimeToken) => void;
      emissions: TrackedEmission[];
    };
  };

  beforeAll(async () => {
    replicaSetAvailable = await hasReplicaSet();
  });

  beforeEach(async () => {
    clearRealtimeRegistry();
    clearQueryStore();
    await RealtimeTestModel.deleteMany({});
  });

  afterEach(async () => {
    await stopChangeStreamWatcher();
    clearRealtimeRegistry();
    clearQueryStore();
    await RealtimeTestModel.deleteMany({});
  });

  it("processes insert events from MongoDB change stream", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    registerRealtime({
      collectionName: "realtimetests",
      config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      modelName: "RealtimeTest",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/realtimetests",
    });

    const io = makeTrackedIo();
    io.addSocketToRoom("model:realtimetests");
    startChangeStreamWatcher(io, {}, true);

    await RealtimeTestModel.create({name: "test-item", ownerId: "user-1"});

    // Wait for the change stream event to be processed
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const createEmissions = io.emissions.filter(
      (e) => e.event === "sync" && e.payload.method === "create"
    );
    expect(createEmissions.length).toBeGreaterThanOrEqual(1);
    await stopChangeStreamWatcher();
  });

  it("processes update events from MongoDB change stream", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    registerRealtime({
      collectionName: "realtimetests",
      config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      modelName: "RealtimeTest",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/realtimetests",
    });

    const doc = await RealtimeTestModel.create({name: "item-to-update", ownerId: "user-1"});

    const io = makeTrackedIo();
    io.addSocketToRoom("model:realtimetests");
    startChangeStreamWatcher(io, {}, true);

    await RealtimeTestModel.updateOne({_id: doc._id}, {$set: {name: "updated-item"}});

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const updateEmissions = io.emissions.filter(
      (e) => e.event === "sync" && e.payload?.method === "update"
    );
    expect(updateEmissions.length).toBeGreaterThanOrEqual(1);
    await stopChangeStreamWatcher();
  });

  it("processes hard delete events from MongoDB change stream", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    registerRealtime({
      collectionName: "realtimetests",
      config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      modelName: "RealtimeTest",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/realtimetests",
    });

    const doc = await RealtimeTestModel.create({name: "item-to-delete"});

    const io = makeTrackedIo();
    io.addSocketToRoom("model:realtimetests");
    startChangeStreamWatcher(io, {}, true);

    await RealtimeTestModel.deleteOne({_id: doc._id});

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const deleteEmissions = io.emissions.filter(
      (e) => e.event === "sync" && e.payload?.method === "delete"
    );
    expect(deleteEmissions.length).toBeGreaterThanOrEqual(1);
    await stopChangeStreamWatcher();
  });

  it("processes soft delete events from MongoDB change stream", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    registerRealtime({
      collectionName: "realtimetests",
      config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      modelName: "RealtimeTest",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/realtimetests",
    });

    const doc = await RealtimeTestModel.create({name: "item-to-soft-delete"});

    const io = makeTrackedIo();
    io.addSocketToRoom("model:realtimetests");
    startChangeStreamWatcher(io, {}, true);

    await RealtimeTestModel.updateOne({_id: doc._id}, {$set: {deleted: true}});

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const deleteEmissions = io.emissions.filter(
      (e) => e.event === "sync" && e.payload?.method === "delete"
    );
    expect(deleteEmissions.length).toBeGreaterThanOrEqual(1);
    await stopChangeStreamWatcher();
  });

  it("includes updatedFields and emits to document rooms", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    registerRealtime({
      collectionName: "realtimetests",
      config: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      modelName: "RealtimeTest",
      options: {
        permissions: {
          create: [() => true],
          delete: [() => true],
          list: [() => true],
          read: [() => true],
          update: [() => true],
        },
      },
      routePath: "/realtimetests",
    });

    const doc = await RealtimeTestModel.create({name: "fields-test"});
    const docId = doc._id.toString();

    const io = makeTrackedIo();
    io.addSocketToRoom("model:realtimetests");
    io.addSocketToRoom(`document:realtimetests:${docId}`);
    startChangeStreamWatcher(io, {}, true);

    await RealtimeTestModel.updateOne({_id: doc._id}, {$set: {name: "fields-updated"}});

    await new Promise((resolve) => setTimeout(resolve, 1500));

    const updateEmissions = io.emissions.filter(
      (e) => e.event === "sync" && e.payload?.method === "update"
    );
    expect(updateEmissions.length).toBeGreaterThanOrEqual(1);
    if (updateEmissions.length > 0) {
      expect(updateEmissions[0].payload.updatedFields).toBeDefined();
      expect(updateEmissions[0].payload.updatedFields).toContain("name");
    }
    await stopChangeStreamWatcher();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// emitToDocumentAndQueryRooms — no-entry path
// ─────────────────────────────────────────────────────────────────────────────

describe("emitToDocumentAndQueryRooms — no registry entry", () => {
  const makeIoSimple = (): Server & {
    emissions: Array<{room: string; event: string; payload: unknown}>;
  } => {
    const emissions: Array<{room: string; event: string; payload: unknown}> = [];
    return {
      emissions,
      sockets: {
        adapter: {rooms: new Map<string, Set<string>>()},
        sockets: new Map<string, MockRoomSocket>(),
      },
      to: (room: string) => ({
        emit: (event: string, payload: unknown): void => {
          emissions.push({event, payload, room});
        },
      }),
    } as unknown as Server & {
      emissions: Array<{room: string; event: string; payload: unknown}>;
    };
  };

  beforeEach(() => {
    clearQueryStore();
  });

  afterEach(() => {
    clearQueryStore();
  });

  it("emits to document room via io.to when no entry is provided", async () => {
    const io = makeIoSimple();
    const event: RealtimeEvent = {
      collection: "items",
      id: "doc-1",
      method: "update",
      model: "Item",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "items", event, {}, () => {});
    expect(io.emissions.some((e) => e.room === "document:items:doc-1")).toBe(true);
  });

  it("emits hard deletes to query rooms via io.to when no entry", async () => {
    const queryId = computeQueryId("items", {status: "active"});
    addQuerySubscription("socket-a", "items", {status: "active"}, queryId);
    const io = makeIoSimple();
    const event: RealtimeEvent = {
      collection: "items",
      id: "doc-1",
      method: "delete",
      model: "Item",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "items", event, undefined, () => {});
    expect(io.emissions.some((e) => e.room === `query:${queryId}`)).toBe(true);
  });

  it("emits soft delete to query rooms via io.to when no entry and doc matches", async () => {
    const queryId = computeQueryId("items", {status: "active"});
    addQuerySubscription("socket-a", "items", {status: "active"}, queryId);
    const io = makeIoSimple();
    const event: RealtimeEvent = {
      collection: "items",
      id: "doc-1",
      method: "delete",
      model: "Item",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "items", event, {status: "active"}, () => {});
    expect(io.emissions.some((e) => e.room === `query:${queryId}`)).toBe(true);
  });

  it("emits create events to query rooms via io.to when no entry and doc matches", async () => {
    const queryId = computeQueryId("items", {status: "active"});
    addQuerySubscription("socket-a", "items", {status: "active"}, queryId);
    const io = makeIoSimple();
    const event: RealtimeEvent = {
      collection: "items",
      id: "doc-1",
      method: "create",
      model: "Item",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "items", event, {status: "active"}, () => {});
    expect(io.emissions.some((e) => e.room === `query:${queryId}`)).toBe(true);
  });

  it("emits update events to query rooms via io.to when no entry and doc matches", async () => {
    const queryId = computeQueryId("items", {status: "active"});
    addQuerySubscription("socket-a", "items", {status: "active"}, queryId);
    const io = makeIoSimple();
    const event: RealtimeEvent = {
      collection: "items",
      id: "doc-1",
      method: "update",
      model: "Item",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "items", event, {status: "active"}, () => {});
    expect(io.emissions.some((e) => e.room === `query:${queryId}`)).toBe(true);
  });

  it("emits delete to query rooms via io.to when update no longer matches and no entry", async () => {
    const queryId = computeQueryId("items", {status: "active"});
    addQuerySubscription("socket-a", "items", {status: "active"}, queryId);
    const io = makeIoSimple();
    const event: RealtimeEvent = {
      collection: "items",
      id: "doc-1",
      method: "update",
      model: "Item",
      timestamp: 1,
    };
    await emitToDocumentAndQueryRooms(io, "items", event, {status: "inactive"}, () => {});
    const queryEmissions = io.emissions.filter((e) => e.room === `query:${queryId}`);
    expect(queryEmissions.length).toBe(1);
    expect(queryEmissions[0].payload).toMatchObject({method: "delete"});
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
    clearRealtimeRegistry();
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
