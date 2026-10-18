/**
 * Tests for the sync socket layer (Tasks 2.3–2.5):
 *   - socketHandlers.ts (sync:subscribe / sync:unsubscribe / sync:mutate, caps, rate limit)
 *   - changeStreamWatcher.ts sync:delta emission (mock change streams + real change
 *     streams gated on replica-set availability, following realtime.test.ts conventions)
 *
 * socketAuth.ts (legacy JWT validator chain + Better Auth session validator) has its own
 * dedicated test file: realtime/socketAuth.test.ts.
 */

import {afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import mongoose, {type Model, model, Schema} from "mongoose";
import type {Server} from "socket.io";

import type {ModelRouterOptions} from "../api";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "../plugins";
import {
  emitSyncDeltaForChange,
  startChangeStreamWatcher,
  stopChangeStreamWatcher,
} from "../realtime/changeStreamWatcher";
import {setupDb} from "../tests";
import {defaultResponseHandler} from "../transformers";
import {registerAdminBroadcastScope} from "./adminBroadcastScope";
import {SyncCounter, SyncMutation, SyncScopeMove} from "./models";
import {MAX_SYNC_MUTATIONS_PER_BATCH} from "./mutationHandler";
import {
  clearSyncRegistry,
  findSyncEntryByCollectionTag,
  registerSync,
  type SyncRegistryEntry,
} from "./registry";
import type {SyncAppOptions} from "./routes";
import {
  installSyncSocketHandlers,
  MAX_SYNC_COLLECTION_SUBSCRIPTIONS,
  MAX_SYNC_SUBSCRIBE_ARRAY_LENGTH,
  type SyncSocketLike,
  syncRoomForStream,
} from "./socketHandlers";
import {getSyncAppOptions, SyncApp} from "./syncApp";
import {
  evictExpiredSyncMutationWindows,
  MAX_SYNC_MUTATIONS_PER_SECOND,
  resetSyncMutationRateLimits,
  syncMutationRateLimitWindowCount,
} from "./syncBatch";
import {syncPlugin} from "./syncSeqPlugin";
import type {SyncAck, SyncDelta, SyncNack} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Test models
// ─────────────────────────────────────────────────────────────────────────────

interface SockStuff extends IsDeleted {
  _id: string;
  name: string;
  ownerId: string;
  created: Date;
  _syncSeq?: number;
}

const sockStuffSchema = new Schema<SockStuff>({
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", type: String},
});
sockStuffSchema.plugin(isDeletedPlugin);
sockStuffSchema.plugin(createdUpdatedPlugin);
sockStuffSchema.plugin(syncPlugin);
const SockStuffModel = model<SockStuff>("SockStuff", sockStuffSchema);

interface SockProject extends IsDeleted {
  _id: string;
  title: string;
  orgId: string;
  _syncSeq?: number;
}

const sockProjectSchema = new Schema<SockProject>({
  orgId: {description: "The organization this project belongs to", type: String},
  title: {description: "The project title", required: true, type: String},
});
sockProjectSchema.plugin(isDeletedPlugin);
sockProjectSchema.plugin(createdUpdatedPlugin);
sockProjectSchema.plugin(syncPlugin);
const SockProjectModel = model<SockProject>("SockProject", sockProjectSchema);

interface SockNews extends IsDeleted {
  _id: string;
  headline: string;
  _syncSeq?: number;
}

const sockNewsSchema = new Schema<SockNews>({
  headline: {description: "The news headline", required: true, type: String},
});
sockNewsSchema.plugin(isDeletedPlugin);
sockNewsSchema.plugin(createdUpdatedPlugin);
sockNewsSchema.plugin(syncPlugin);
const SockNewsModel = model<SockNews>("SockNews", sockNewsSchema);

const permissiveOptions = {
  permissions: {
    create: [() => true],
    delete: [() => true],
    list: [() => true],
    read: [() => true],
    update: [() => true],
  },
} as unknown as ModelRouterOptions<unknown>;

const adminOnlyOptions = {
  permissions: {
    create: [(_m: string, user?: {admin?: boolean}) => user?.admin === true],
    delete: [(_m: string, user?: {admin?: boolean}) => user?.admin === true],
    list: [(_m: string, user?: {admin?: boolean}) => user?.admin === true],
    read: [(_m: string, user?: {admin?: boolean}) => user?.admin === true],
    update: [(_m: string, user?: {admin?: boolean}) => user?.admin === true],
  },
} as unknown as ModelRouterOptions<unknown>;

const ownerReadOptions = {
  permissions: {
    create: [() => true],
    delete: [() => true],
    list: [() => true],
    read: [
      (_m: string, user?: {admin?: boolean; id?: string}, obj?: {ownerId?: unknown}) =>
        user?.admin === true || (obj?.ownerId != null && String(obj.ownerId) === user?.id),
    ],
    update: [() => true],
  },
} as unknown as ModelRouterOptions<unknown>;

/**
 * A minimal fake Mongoose model satisfying registerSync's schema/collection checks, for
 * tests that need many registrations (each real registration requires a distinct
 * compiled model).
 */
const makeFakeSyncModel = (name: string): Model<unknown> =>
  ({
    collection: {
      collectionName: name.toLowerCase(),
      createIndex: async () => {},
    },
    modelName: name,
    schema: {
      path: (p: string) => {
        if (p === "deleted") {
          return {instance: "Boolean"};
        }
        if (p === "_syncSeq") {
          return {instance: "Number"};
        }
        return undefined;
      },
    },
  }) as unknown as Model<unknown>;

// The shared test database can be dropped by another test file mid-suite
// (configurationPlugin.test.ts drops it in an afterAll); rebuild the unique indexes the
// duplicate-mutation tests depend on.
beforeAll(async () => {
  await Promise.all([SyncCounter.ensureIndexes(), SyncMutation.ensureIndexes()]);
});

const registerAll = (): void => {
  clearSyncRegistry();
  registerSync({
    config: {scope: {type: "owner"}},
    model: SockStuffModel as unknown as Model<unknown>,
    options: permissiveOptions,
    routePath: "/sockStuff",
  });
  registerSync({
    config: {scope: {field: "orgId", type: "tenant"}},
    model: SockProjectModel as unknown as Model<unknown>,
    options: permissiveOptions,
    routePath: "/sockProjects",
  });
  registerSync({
    config: {scope: {type: "broadcast"}},
    model: SockNewsModel as unknown as Model<unknown>,
    options: permissiveOptions,
    routePath: "/sockNews",
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock socket (realtime.test.ts conventions)
// ─────────────────────────────────────────────────────────────────────────────

type SyncSocketListener = (...args: never[]) => void | Promise<void>;

interface MockSocket extends SyncSocketLike {
  rooms: Set<string>;
  emitted: {event: string; payload: unknown}[];
  listeners: Map<string, SyncSocketListener>;
  trigger: (event: string, ...args: unknown[]) => Promise<void>;
}

const createMockSocket = (decodedToken?: {id?: string; admin?: boolean}): MockSocket => {
  const rooms = new Set<string>();
  const emitted: {event: string; payload: unknown}[] = [];
  const listeners = new Map<string, SyncSocketListener>();

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
      const handler = listeners.get(event);
      if (handler) {
        await (handler as (...handlerArgs: unknown[]) => void | Promise<void>)(...args);
      }
    },
  };

  return socket;
};

const syncErrors = (socket: MockSocket): Array<{collection: string; message: string}> =>
  socket.emitted
    .filter((e) => e.event === "sync:error")
    .map((e) => e.payload as {collection: string; message: string});

const install = (socket: MockSocket, options: SyncAppOptions = {}): void => {
  installSyncSocketHandlers(null, socket, options);
};

// ─────────────────────────────────────────────────────────────────────────────
// sync:subscribe / sync:unsubscribe
// ─────────────────────────────────────────────────────────────────────────────

describe("installSyncSocketHandlers — subscribe/unsubscribe", () => {
  beforeAll(async () => {
    await setupDb();
  });

  beforeEach(() => {
    registerAll();
  });

  afterEach(() => {
    clearSyncRegistry();
  });

  it("owner scope joins the socket's own owner stream room", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"]});
    expect(socket.rooms.has("sync:sockStuff|owner:user1")).toBe(true);
    const subscribed = socket.emitted.find((e) => e.event === "sync:subscribed");
    expect(subscribed?.payload).toEqual({
      collection: "sockStuff",
      streams: ["sockStuff|owner:user1"],
    });
  });

  it("window mode joins {collection}|admin and does not emit snapshot pages", async () => {
    clearSyncRegistry();
    registerSync({
      config: {adminBroadcast: true, scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: ownerReadOptions,
      routePath: "/sockStuff",
    });
    const socket = createMockSocket({admin: true, id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"], mode: "window"});

    assert.isTrue(socket.rooms.has("sync:sockStuff|admin"));
    assert.isFalse(socket.rooms.has("sync:sockStuff|owner:user1"));
    const subscribed = socket.emitted.filter((e) => e.event === "sync:subscribed");
    assert.deepEqual(
      subscribed.map((e) => e.payload),
      [{collection: "sockStuff", mode: "window", streams: ["sockStuff|admin"]}]
    );
    const snapshotLike = socket.emitted.filter(
      (e) => e.event.includes("snapshot") || (e.payload as {entities?: unknown})?.entities
    );
    assert.deepEqual(snapshotLike, []);
  });

  it("nacks window subscribe when the caller is not admin", async () => {
    clearSyncRegistry();
    registerSync({
      config: {adminBroadcast: true, scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: ownerReadOptions,
      routePath: "/sockStuff",
    });
    const socket = createMockSocket({admin: false, id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"], mode: "window"});

    assert.isFalse(socket.rooms.has("sync:sockStuff|admin"));
    assert.deepEqual(
      socket.emitted.filter((e) => e.event === "sync:subscribed"),
      []
    );
    const errors = syncErrors(socket);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].collection, "sockStuff");
    assert.match(errors[0].message, /admin/i);
  });

  it("nacks window subscribe when accessControl denies admin:access", async () => {
    clearSyncRegistry();
    registerSync({
      config: {adminBroadcast: true, scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: ownerReadOptions,
      routePath: "/sockStuff",
    });
    const socket = createMockSocket({admin: true, id: "user1"});
    install(socket, {
      accessControl: {
        can: async () => ({allowed: false}),
      } as never,
    });
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"], mode: "window"});

    assert.isFalse(socket.rooms.has("sync:sockStuff|admin"));
    assert.deepEqual(
      socket.emitted.filter((e) => e.event === "sync:subscribed"),
      []
    );
    const errors = syncErrors(socket);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /admin panel access/i);
  });

  it("nacks window subscribe when AdminApp list permission is denied", async () => {
    clearSyncRegistry();
    registerSync({
      config: {adminBroadcast: true, scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: ownerReadOptions,
      routePath: "/sockStuff",
    });
    registerAdminBroadcastScope("SockStuff", {
      listPermissions: [() => false],
      readPermissions: [() => true],
    });
    const socket = createMockSocket({admin: true, id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"], mode: "window"});

    assert.isFalse(socket.rooms.has("sync:sockStuff|admin"));
    const errors = syncErrors(socket);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /admin collection access/i);
  });

  it("owner scope never uses a client-supplied user id", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    // The payload has no place for a user id — assert the room is keyed by the token id.
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"], userId: "victim"});
    expect(socket.rooms.has("sync:sockStuff|owner:user1")).toBe(true);
    expect(Array.from(socket.rooms).some((r) => r.includes("victim"))).toBe(false);
  });

  it("tenant scope joins one room per scope from getUserScopes", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket, {getUserScopes: () => ["org1", "org2"]});
    await socket.trigger("sync:subscribe", {collections: ["sockProjects"]});
    expect(socket.rooms.has("sync:sockProjects|tenant:org1")).toBe(true);
    expect(socket.rooms.has("sync:sockProjects|tenant:org2")).toBe(true);
  });

  // Task 9.21: the handshake full-user load is fire-and-forget, so an eager client can
  // subscribe before it resolves. Authorizing that against the synthetic JWT-claim user
  // (no membership fields) resolved tenant scopes to nothing — connected, but no data.
  it("waits for the in-flight handshake full-user load before resolving tenant streams", async () => {
    const socket = createMockSocket({id: "user1"});
    let landFullUser: () => void = () => {};
    const handshake = new Promise<void>((resolve) => {
      landFullUser = resolve;
    });
    socket.data = {
      fullUserLoad: handshake.then(() => {
        (socket.data as {fullUser?: unknown}).fullUser = {
          _id: "user1",
          admin: false,
          id: "user1",
          organizationIds: ["org7"],
        };
      }),
    };
    install(socket, {
      getUserScopes: (user) =>
        (user as unknown as {organizationIds?: string[]}).organizationIds ?? [],
    });

    const subscribing = socket.trigger("sync:subscribe", {collections: ["sockProjects"]});
    landFullUser();
    await subscribing;

    expect(socket.rooms.has("sync:sockProjects|tenant:org7")).toBe(true);
    expect(syncErrors(socket)).toHaveLength(0);
  });

  it("tenant scope without a getUserScopes resolver emits sync:error", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket, {});
    await socket.trigger("sync:subscribe", {collections: ["sockProjects"]});
    expect(socket.rooms.size).toBe(0);
    expect(syncErrors(socket)).toHaveLength(1);
    expect(syncErrors(socket)[0].collection).toBe("sockProjects");
  });

  it("tenant scope emits sync:error when getUserScopes throws", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket, {
      getUserScopes: () => {
        throw new Error("membership lookup failed");
      },
    });
    await socket.trigger("sync:subscribe", {collections: ["sockProjects"]});
    expect(socket.rooms.size).toBe(0);
    expect(syncErrors(socket)).toHaveLength(1);
  });

  it("broadcast scope joins the shared all room", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockNews"]});
    expect(socket.rooms.has("sync:sockNews|all")).toBe(true);
  });

  it("custom scope resolves streams from getUserScopes values", async () => {
    registerSync({
      config: {
        scope: (doc: Record<string, unknown>) => String(doc.region),
        snapshotFilter: () => ({}),
      },
      model: makeFakeSyncModel("SockRegion"),
      options: permissiveOptions,
      routePath: "/sockRegions",
    });
    const socket = createMockSocket({id: "user1"});
    install(socket, {getUserScopes: () => ["us-east", "eu-west"]});
    await socket.trigger("sync:subscribe", {collections: ["sockRegions"]});
    expect(socket.rooms.has("sync:sockRegions|custom:us-east")).toBe(true);
    expect(socket.rooms.has("sync:sockRegions|custom:eu-west")).toBe(true);
  });

  it("unknown collection emits sync:error and skips, without affecting others", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["nope", "sockStuff"]});
    expect(syncErrors(socket)).toEqual([
      {collection: "nope", message: "Unknown sync collection: nope"},
    ]);
    expect(socket.rooms.has("sync:sockStuff|owner:user1")).toBe(true);
  });

  it("denies subscription when list permission fails", async () => {
    clearSyncRegistry();
    registerSync({
      config: {scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: adminOnlyOptions,
      routePath: "/sockStuff",
    });
    const socket = createMockSocket({admin: false, id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"]});
    expect(socket.rooms.size).toBe(0);
    expect(syncErrors(socket)).toHaveLength(1);
  });

  it("allows admin subscription when list permission requires admin", async () => {
    clearSyncRegistry();
    registerSync({
      config: {scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: adminOnlyOptions,
      routePath: "/sockStuff",
    });
    const socket = createMockSocket({admin: true, id: "admin1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"]});
    expect(socket.rooms.has("sync:sockStuff|owner:admin1")).toBe(true);
  });

  it("emits sync:error for unauthenticated sockets", async () => {
    const socket = createMockSocket(undefined);
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"]});
    expect(socket.rooms.size).toBe(0);
    expect(syncErrors(socket)[0].message).toBe("Authentication required");
  });

  it("ignores malformed payloads", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", null);
    await socket.trigger("sync:subscribe", {});
    await socket.trigger("sync:subscribe", {collections: "sockStuff"});
    await socket.trigger("sync:subscribe", {collections: [42, "", null]});
    expect(socket.rooms.size).toBe(0);
    expect(syncErrors(socket)).toHaveLength(0);
  });

  it("is idempotent for repeated subscriptions to the same collection", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"]});
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"]});
    const subscribedEvents = socket.emitted.filter((e) => e.event === "sync:subscribed");
    expect(subscribedEvents).toHaveLength(1);
  });

  it("enforces the per-socket collection cap with sync:error", async () => {
    clearSyncRegistry();
    for (let i = 0; i < MAX_SYNC_COLLECTION_SUBSCRIPTIONS + 3; i++) {
      registerSync({
        config: {scope: {type: "broadcast"}},
        model: makeFakeSyncModel(`CapColl${i}`),
        options: permissiveOptions,
        routePath: `/capColl${i}`,
      });
    }
    const socket = createMockSocket({id: "user1"});
    install(socket);
    const collections = Array.from(
      {length: MAX_SYNC_COLLECTION_SUBSCRIPTIONS + 3},
      (_v, i) => `capColl${i}`
    );
    await socket.trigger("sync:subscribe", {collections});
    const syncRooms = Array.from(socket.rooms).filter((r) => r.startsWith("sync:"));
    expect(syncRooms).toHaveLength(MAX_SYNC_COLLECTION_SUBSCRIPTIONS);
    expect(syncErrors(socket)).toHaveLength(3);
  });

  it("C8: rejects an oversized sync:subscribe array before iterating (length check first)", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    // An array over the cap must be rejected wholesale with a single sync:error and NO
    // room joins — the length guard runs before any per-collection work.
    const collections = Array.from(
      {length: MAX_SYNC_SUBSCRIBE_ARRAY_LENGTH + 1},
      (_v, i) => `sockStuff${i}`
    );
    await socket.trigger("sync:subscribe", {collections});
    expect(Array.from(socket.rooms).filter((r) => r.startsWith("sync:"))).toHaveLength(0);
    const errors = syncErrors(socket);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/at most/i);
  });

  it("sync:unsubscribe leaves the rooms and frees the cap slot", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket, {getUserScopes: () => ["org1", "org2"]});
    await socket.trigger("sync:subscribe", {collections: ["sockStuff", "sockProjects"]});
    expect(socket.rooms.has("sync:sockStuff|owner:user1")).toBe(true);
    expect(socket.rooms.has("sync:sockProjects|tenant:org1")).toBe(true);

    await socket.trigger("sync:unsubscribe", {collections: ["sockProjects"]});
    expect(socket.rooms.has("sync:sockProjects|tenant:org1")).toBe(false);
    expect(socket.rooms.has("sync:sockProjects|tenant:org2")).toBe(false);
    expect(socket.rooms.has("sync:sockStuff|owner:user1")).toBe(true);

    // Re-subscribing after unsubscribe emits a fresh sync:subscribed.
    await socket.trigger("sync:subscribe", {collections: ["sockProjects"]});
    const subscribedEvents = socket.emitted.filter(
      (e) =>
        e.event === "sync:subscribed" &&
        (e.payload as {collection?: string}).collection === "sockProjects"
    );
    expect(subscribedEvents).toHaveLength(2);
  });

  it("sync:unsubscribe ignores malformed payloads and unknown collections", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:unsubscribe", null);
    await socket.trigger("sync:unsubscribe", {collections: ["neverSubscribed", 42]});
    expect(socket.rooms.size).toBe(0);
  });

  it("disconnect clears tracked subscriptions", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"]});
    await socket.trigger("disconnect");
    // Rooms are cleaned by Socket.io itself on disconnect; the tracking map is cleared, so
    // a re-subscribe emits sync:subscribed again instead of being treated as a duplicate.
    await socket.trigger("sync:subscribe", {collections: ["sockStuff"]});
    const subscribedEvents = socket.emitted.filter((e) => e.event === "sync:subscribed");
    expect(subscribedEvents).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sync:mutate
// ─────────────────────────────────────────────────────────────────────────────

describe("installSyncSocketHandlers — sync:mutate", () => {
  beforeAll(async () => {
    await setupDb();
  });

  beforeEach(async () => {
    registerAll();
    // Task 9.20: the mutation budget is module-level per user now, so a flooding test
    // would otherwise leave the next test's user over budget within the same second.
    resetSyncMutationRateLimits();
    await Promise.all([
      SockStuffModel.collection.deleteMany({}),
      SyncCounter.deleteMany({}),
      SyncMutation.deleteMany({}),
    ]);
  });

  afterEach(() => {
    clearSyncRegistry();
  });

  const lastAck = (socket: MockSocket): SyncAck | undefined => {
    const acks = socket.emitted.filter((e) => e.event === "sync:ack");
    return acks[acks.length - 1]?.payload as SyncAck | undefined;
  };

  const lastNack = (socket: MockSocket): SyncNack | undefined => {
    const nacks = socket.emitted.filter((e) => e.event === "sync:nack");
    return nacks[nacks.length - 1]?.payload as SyncNack | undefined;
  };

  it("applies a create mutation and emits sync:ack", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:mutate", {
      collection: "sockStuff",
      data: {name: "created over socket", ownerId: "user1"},
      mutationId: "sock-mut-1",
      operation: "create",
    });
    const ack = lastAck(socket);
    expect(ack?.mutationId).toBe("sock-mut-1");
    expect(ack?.seq).toBe(1);
    const doc = await SockStuffModel.findById(ack?.id);
    expect(doc?.name).toBe("created over socket");
  });

  it("invokes the Socket.io ack callback with the outcome", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    const replies: unknown[] = [];
    await socket.trigger(
      "sync:mutate",
      {
        collection: "sockStuff",
        data: {name: "cb", ownerId: "user1"},
        mutationId: "sock-mut-cb",
        operation: "create",
      },
      (response: unknown) => replies.push(response)
    );
    expect(replies).toHaveLength(1);
    expect((replies[0] as {ack: SyncAck}).ack.mutationId).toBe("sock-mut-cb");
  });

  it("stale baseVersion emits sync:nack conflict carrying the server doc", async () => {
    const doc = await SockStuffModel.create({name: "v1", ownerId: "user1"});
    await SockStuffModel.findOneAndUpdate({_id: doc._id}, {$set: {name: "v2"}});

    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:mutate", {
      baseVersion: 1,
      collection: "sockStuff",
      data: {name: "stale write"},
      id: String(doc._id),
      mutationId: "sock-mut-conflict",
      operation: "update",
    });
    const nack = lastNack(socket);
    expect(nack?.code).toBe("conflict");
    expect(nack?.serverSeq).toBe(2);
    expect((nack?.serverDoc as {name?: string} | undefined)?.name).toBe("v2");
  });

  it("duplicate mutationId over the socket returns the recorded outcome without re-applying", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    const mutation = {
      collection: "sockStuff",
      data: {name: "dup", ownerId: "user1"},
      mutationId: "sock-mut-dup",
      operation: "create",
    };
    await socket.trigger("sync:mutate", mutation);
    await socket.trigger("sync:mutate", mutation);
    const acks = socket.emitted.filter((e) => e.event === "sync:ack");
    expect(acks).toHaveLength(2);
    expect((acks[0].payload as SyncAck).id).toBe((acks[1].payload as SyncAck).id);
    expect((acks[0].payload as SyncAck).seq).toBe((acks[1].payload as SyncAck).seq);
    expect(await SockStuffModel.countDocuments({name: "dup"})).toBe(1);
  });

  it("nacks validation for an unknown collection", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await socket.trigger("sync:mutate", {
      collection: "nope",
      data: {},
      mutationId: "sock-mut-unknown",
      operation: "create",
    });
    expect(lastNack(socket)?.code).toBe("validation");
  });

  it("nacks unauthorized for unauthenticated sockets", async () => {
    const socket = createMockSocket(undefined);
    install(socket);
    await socket.trigger("sync:mutate", {
      collection: "sockStuff",
      data: {name: "x"},
      mutationId: "sock-mut-anon",
      operation: "create",
    });
    expect(lastNack(socket)?.code).toBe("unauthorized");
  });

  it("rate-limits mutations beyond the per-second cap with a rate_limited nack carrying retryAfterMs (FIX 1)", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    // Exceed the window with cheap validation nacks (unknown collection) — the rate limit
    // triggers before the mutation is applied, so these never hit the database.
    for (let i = 0; i < MAX_SYNC_MUTATIONS_PER_SECOND + 5; i++) {
      await socket.trigger("sync:mutate", {
        collection: "nope",
        mutationId: `flood-${i}`,
        operation: "create",
      });
    }
    const nacks = socket.emitted.filter((e) => e.event === "sync:nack");
    expect(nacks).toHaveLength(MAX_SYNC_MUTATIONS_PER_SECOND + 5);
    const rateLimited = nacks.filter((e) =>
      (e.payload as SyncNack).message?.includes("Rate limit")
    );
    expect(rateLimited).toHaveLength(5);
    // FIX 1: the nack code is "rate_limited" (never "error") so the client
    // never treats it as a durable-data failure, and it carries a
    // retryAfterMs hint for the client's backoff floor.
    for (const nack of rateLimited) {
      const payload = nack.payload as SyncNack;
      expect(payload.code).toBe("rate_limited");
      expect(typeof (payload as {retryAfterMs?: number}).retryAfterMs).toBe("number");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sync:mutateBatch
// ─────────────────────────────────────────────────────────────────────────────

describe("installSyncSocketHandlers — sync:mutateBatch", () => {
  beforeAll(async () => {
    await setupDb();
  });

  beforeEach(async () => {
    registerAll();
    resetSyncMutationRateLimits();
    await Promise.all([
      SockStuffModel.collection.deleteMany({}),
      SyncCounter.deleteMany({}),
      SyncMutation.deleteMany({}),
    ]);
  });

  afterEach(() => {
    clearSyncRegistry();
  });

  const create = (mutationId: string, name: string) => ({
    collection: "sockStuff",
    data: {name, ownerId: "user1"},
    mutationId,
    operation: "create",
  });

  const triggerBatch = async (
    socket: MockSocket,
    mutations: unknown[]
  ): Promise<{results: Array<{type: string; ack?: SyncAck; nack?: SyncNack}>}> => {
    let response: {results: Array<{type: string; ack?: SyncAck; nack?: SyncNack}>} | undefined;
    await socket.trigger("sync:mutateBatch", {mutations}, (res: unknown) => {
      response = res as {results: Array<{type: string; ack?: SyncAck; nack?: SyncNack}>};
    });
    if (!response) {
      throw new Error("sync:mutateBatch did not invoke the ack callback");
    }
    return response;
  };

  it("applies a batch strictly in order via the ack callback", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    const mutations = Array.from({length: 5}, (_v, i) => create(`sock-batch-${i}`, `item ${i}`));
    const response = await triggerBatch(socket, mutations);
    expect(response.results).toHaveLength(5);
    expect(response.results.every((r) => r.type === "ack")).toBe(true);
    const seqs = response.results.map((r) => r.ack?.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops at the first nack, leaving later mutations unattempted", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    const mutations = [
      create("sock-batch-halt-1", "ok"),
      {collection: "nope", mutationId: "sock-batch-halt-2", operation: "create"},
      create("sock-batch-halt-3", "never"),
    ];
    const response = await triggerBatch(socket, mutations);
    expect(response.results).toHaveLength(2);
    expect(response.results[0].type).toBe("ack");
    expect(response.results[1].type).toBe("nack");
    expect(response.results[1].nack?.code).toBe("validation");
    expect(await SockStuffModel.countDocuments({name: "never"})).toBe(0);
  });

  it("rejects an oversized batch before processing", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    const mutations = Array.from({length: MAX_SYNC_MUTATIONS_PER_BATCH + 1}, (_v, i) =>
      create(`sock-batch-oversized-${i}`, `item ${i}`)
    );
    const response = await triggerBatch(socket, mutations);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].nack?.code).toBe("validation");
    expect(await SockStuffModel.countDocuments({})).toBe(0);
  });

  it("rejects intra-batch duplicate mutationIds before processing", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    const mutations = [create("sock-batch-dup", "a"), create("sock-batch-dup", "b")];
    const response = await triggerBatch(socket, mutations);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].nack?.code).toBe("validation");
    expect(await SockStuffModel.countDocuments({})).toBe(0);
  });

  it("nacks unauthorized for unauthenticated sockets", async () => {
    const socket = createMockSocket(undefined);
    install(socket);
    const response = await triggerBatch(socket, [create("sock-batch-anon", "x")]);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].nack?.code).toBe("unauthorized");
  });

  it("rate-limits batch mutations against the same window as sync:mutate with a rate_limited nack carrying retryAfterMs (FIX 1)", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    // Two batches within the per-batch size cap, but together exceeding the
    // per-second mutation budget — the shared window rejects the second batch
    // before any of its mutations are attempted.
    const firstBatch = Array.from({length: MAX_SYNC_MUTATIONS_PER_BATCH}, (_v, i) => ({
      collection: "nope",
      mutationId: `flood-batch-a-${i}`,
      operation: "create",
    }));
    const secondBatch = Array.from({length: 10}, (_v, i) => ({
      collection: "nope",
      mutationId: `flood-batch-b-${i}`,
      operation: "create",
    }));
    await triggerBatch(socket, firstBatch);
    const response = await triggerBatch(socket, secondBatch);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].nack?.message).toContain("Rate limit");
    // FIX 1: rate limiting must never look like a durable-data error — the
    // client treats "rate_limited" like a transport failure (never terminal).
    expect(response.results[0].nack?.code).toBe("rate_limited");
    expect(typeof (response.results[0].nack as {retryAfterMs?: number})?.retryAfterMs).toBe(
      "number"
    );
  });

  it("emits sync:batchReceived immediately, before any mutation is applied (FIX 5)", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    const mutations = [create("sock-batch-receipt-1", "a")];
    await socket.trigger("sync:mutateBatch", {batchId: "b-123", mutations}, () => {});
    const receipts = socket.emitted.filter((e) => e.event === "sync:batchReceived");
    expect(receipts).toHaveLength(1);
    expect(receipts[0].payload).toEqual({batchId: "b-123"});
  });

  it("does not emit sync:batchReceived when the request has no batchId (HTTP-shaped payload)", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    await triggerBatch(socket, [create("sock-batch-no-id", "a")]);
    expect(socket.emitted.filter((e) => e.event === "sync:batchReceived")).toHaveLength(0);
  });

  // Task 9.20: the budget used to live in the per-connection handler closure, so a client
  // could simply open another socket to get another full allowance.
  it("shares one per-user budget across sockets, and keeps separate users independent", async () => {
    const firstSocket = createMockSocket({id: "user1"});
    const secondSocket = createMockSocket({id: "user1"});
    const otherUserSocket = createMockSocket({id: "user2"});
    install(firstSocket);
    install(secondSocket);
    install(otherUserSocket);
    const flood = (label: string, length: number): unknown[] =>
      Array.from({length}, (_v, i) => ({
        collection: "nope",
        mutationId: `${label}-${i}`,
        operation: "create",
      }));

    // The first socket exhausts the whole per-second budget...
    await triggerBatch(firstSocket, flood("shared-a", MAX_SYNC_MUTATIONS_PER_BATCH));
    // ...so the SECOND socket for the same user has nothing left.
    const secondResponse = await triggerBatch(secondSocket, flood("shared-b", 1));
    expect(secondResponse.results[0].nack?.code).toBe("rate_limited");
    // A different user is unaffected — the window is per user, not global.
    const otherResponse = await triggerBatch(otherUserSocket, flood("shared-c", 1));
    expect(otherResponse.results[0].nack?.code).toBe("validation");
  });

  it("charges no budget for a batch that fails validation", async () => {
    const socket = createMockSocket({id: "user1"});
    install(socket);
    // An oversized batch is rejected before the budget is touched, so the follow-up batch
    // (which would exceed the budget had the invalid one been charged) still applies.
    const oversized = Array.from({length: MAX_SYNC_MUTATIONS_PER_BATCH + 1}, (_v, i) =>
      create(`no-charge-${i}`, `item ${i}`)
    );
    const rejected = await triggerBatch(socket, oversized);
    expect(rejected.results[0].nack?.code).toBe("validation");

    const applied = await triggerBatch(
      socket,
      Array.from({length: MAX_SYNC_MUTATIONS_PER_BATCH}, (_v, i) => ({
        collection: "nope",
        mutationId: `after-no-charge-${i}`,
        operation: "create",
      }))
    );
    // Stop-on-first-nack means one validation result comes back — the point is that it is
    // NOT a rate_limited result, i.e. the full budget was still available.
    expect(applied.results[0].nack?.code).toBe("validation");
  });

  it("evicts expired per-user windows instead of retaining one per user forever", async () => {
    resetSyncMutationRateLimits();
    const firstSocket = createMockSocket({id: "user1"});
    const otherUserSocket = createMockSocket({id: "user2"});
    install(firstSocket);
    install(otherUserSocket);
    await triggerBatch(firstSocket, [create("evict-1", "a")]);
    await triggerBatch(otherUserSocket, [create("evict-2", "b")]);
    expect(syncMutationRateLimitWindowCount()).toBe(2);
    // The sweep is throttled to once a minute in normal operation; drive it directly with a
    // clock past both windows' expiry rather than waiting.
    expect(evictExpiredSyncMutationWindows({now: Date.now() + 60_000})).toBe(0);
    expect(syncMutationRateLimitWindowCount()).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-app SyncAppOptions wiring (SyncApp -> RealtimeApp)
// ─────────────────────────────────────────────────────────────────────────────

describe("SyncAppOptions context", () => {
  it("SyncApp.register attaches its options to only its Express app", async () => {
    const express = (await import("express")).default;
    const firstApp = express();
    const secondApp = express();
    const options: SyncAppOptions = {getUserScopes: () => ["orgX"]};
    new SyncApp(options).register(firstApp);
    expect(getSyncAppOptions(firstApp)).toBe(options);
    expect(getSyncAppOptions(secondApp)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sync:delta emission — mock io helpers
// ─────────────────────────────────────────────────────────────────────────────

interface TrackedEmission {
  event: string;
  payload: unknown;
  room: string;
  socketId: string;
}

interface TrackedSocket {
  decodedToken?: {id?: string; admin?: boolean};
  emit: (event: string, payload: unknown) => void;
  id: string;
}

/** A Socket.io server stand-in that records every emission it receives. */
type TrackedIo = Server & {
  addSocketToRoom: (room: string, decodedToken?: {id?: string; admin?: boolean}) => void;
  emissions: TrackedEmission[];
};

const makeTrackedIo = (): TrackedIo => {
  const emissions: TrackedEmission[] = [];
  const rooms = new Map<string, Set<string>>();
  const sockets = new Map<string, TrackedSocket>();

  const addSocketToRoom = (
    room: string,
    decodedToken: {id?: string; admin?: boolean} = {admin: true, id: "admin"}
  ): void => {
    const socketId = `socket-${Math.random().toString(36).slice(2, 9)}`;
    if (!rooms.has(room)) {
      rooms.set(room, new Set());
    }
    rooms.get(room)?.add(socketId);
    sockets.set(socketId, {
      decodedToken,
      emit: (event: string, payload: unknown): void => {
        emissions.push({event, payload, room, socketId});
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
        emissions.push({event, payload, room, socketId: "broadcast"});
      },
    }),
  } as unknown as TrackedIo;
};

type WatchedChange = Parameters<typeof emitSyncDeltaForChange>[0]["change"];

const makeChange = (overrides: Record<string, unknown>): WatchedChange =>
  ({
    documentKey: {_id: "doc-1"},
    ns: {coll: "sockstuffs"},
    operationType: "insert",
    ...overrides,
  }) as unknown as WatchedChange;

// ─────────────────────────────────────────────────────────────────────────────
// emitSyncDeltaForChange — unit tests with synthetic changes
// ─────────────────────────────────────────────────────────────────────────────

describe("emitSyncDeltaForChange", () => {
  beforeAll(async () => {
    await setupDb();
  });

  beforeEach(() => {
    registerAll();
  });

  afterEach(() => {
    clearSyncRegistry();
  });

  const ownerEntry = (): SyncRegistryEntry => {
    clearSyncRegistry();
    registerSync({
      config: {scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: ownerReadOptions,
      routePath: "/sockStuff",
    });
    return findSyncEntryByCollectionTag("sockStuff") as SyncRegistryEntry;
  };

  it("emits a create delta with seq and stream to the owner stream room", async () => {
    const entry = ownerEntry();
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user1"), {admin: false, id: "user1"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-1", _syncSeq: 7, name: "hello", ownerId: "user1"},
        operationType: "insert",
      }),
      docId: "doc-1",
      entry,
      io,
      logDebug: () => {},
    });

    const deltas = io.emissions.filter((e) => e.event === "sync:delta");
    expect(deltas).toHaveLength(1);
    const delta = deltas[0].payload as SyncDelta;
    expect(delta.method).toBe("create");
    expect(delta.seq).toBe(7);
    expect(delta.stream).toBe("sockStuff|owner:user1");
    expect(delta.collection).toBe("sockStuff");
    expect((delta.data as Record<string, unknown>).name).toBe("hello");
    expect((delta.data as Record<string, unknown>).id).toBe("doc-1");
  });

  it("adminBroadcast true: create also emits to {collection}|admin", async () => {
    clearSyncRegistry();
    registerSync({
      config: {adminBroadcast: true, scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: ownerReadOptions,
      routePath: "/sockStuff",
    });
    const entry = findSyncEntryByCollectionTag("sockStuff") as SyncRegistryEntry;
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user1"), {admin: false, id: "user1"});
    io.addSocketToRoom(syncRoomForStream("sockStuff|admin"), {admin: true, id: "admin1"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-admin-fan", _syncSeq: 11, name: "hello", ownerId: "user1"},
        operationType: "insert",
      }),
      docId: "doc-admin-fan",
      entry,
      io,
      logDebug: () => {},
    });

    const deltas = io.emissions
      .filter((e) => e.event === "sync:delta")
      .map((e) => e.payload as SyncDelta);
    const streams = deltas.map((d) => d.stream).sort();
    assert.deepEqual(streams, ["sockStuff|admin", "sockStuff|owner:user1"]);
    const adminDelta = deltas.find((d) => d.stream === "sockStuff|admin");
    const ownerDelta = deltas.find((d) => d.stream === "sockStuff|owner:user1");
    assert.strictEqual(adminDelta?.method, "create");
    assert.strictEqual(adminDelta?.seq, 11);
    assert.strictEqual(ownerDelta?.method, "create");
    assert.strictEqual(ownerDelta?.seq, 11);
  });

  it("adminBroadcast room skips sockets excluded by AdminApp queryFilter", async () => {
    clearSyncRegistry();
    registerSync({
      config: {adminBroadcast: true, scope: {type: "owner"}},
      model: SockStuffModel as unknown as Model<unknown>,
      options: ownerReadOptions,
      routePath: "/sockStuff",
    });
    registerAdminBroadcastScope("SockStuff", {
      listPermissions: [() => true],
      queryFilter: () => ({ownerId: "acme"}),
      readPermissions: [() => true],
    });
    const entry = findSyncEntryByCollectionTag("sockStuff") as SyncRegistryEntry;
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|admin"), {admin: true, id: "admin1"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-other-tenant", _syncSeq: 12, name: "hello", ownerId: "user1"},
        operationType: "insert",
      }),
      docId: "doc-other-tenant",
      entry,
      io,
      logDebug: () => {},
    });

    const adminDeltas = io.emissions.filter(
      (e) => e.event === "sync:delta" && (e.payload as SyncDelta).stream === "sockStuff|admin"
    );
    assert.deepEqual(adminDeltas, []);
  });

  it("adminBroadcast false: create emits only the owner stream", async () => {
    const entry = ownerEntry();
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user1"), {admin: false, id: "user1"});
    io.addSocketToRoom(syncRoomForStream("sockStuff|admin"), {admin: true, id: "admin1"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-no-fan", _syncSeq: 2, name: "hello", ownerId: "user1"},
        operationType: "insert",
      }),
      docId: "doc-no-fan",
      entry,
      io,
      logDebug: () => {},
    });

    const streams = io.emissions
      .filter((e) => e.event === "sync:delta")
      .map((e) => (e.payload as SyncDelta).stream);
    assert.deepEqual(streams, ["sockStuff|owner:user1"]);
  });

  it("emits a delta when the REST responseHandler serializes a BSON post-image", async () => {
    const entry = ownerEntry();
    entry.options = {
      ...ownerReadOptions,
      responseHandler: defaultResponseHandler as never,
    };
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user1"), {admin: false, id: "user1"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-bson", _syncSeq: 4, name: "from-change-stream", ownerId: "user1"},
        operationType: "insert",
      }),
      docId: "doc-bson",
      entry,
      io,
      logDebug: () => {},
    });

    const deltas = io.emissions.filter((emission) => emission.event === "sync:delta");
    expect(deltas).toHaveLength(1);
    expect((deltas[0].payload as SyncDelta).data as {name?: string}).toMatchObject({
      name: "from-change-stream",
    });
  });

  it("does not emit to sockets whose read permission fails (owner isolation)", async () => {
    const entry = ownerEntry();
    const io = makeTrackedIo();
    const room = syncRoomForStream("sockStuff|owner:user1");
    io.addSocketToRoom(room, {admin: false, id: "user1"});
    io.addSocketToRoom(room, {admin: false, id: "intruder"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-1", _syncSeq: 1, name: "secret", ownerId: "user1"},
      }),
      docId: "doc-1",
      entry,
      io,
      logDebug: () => {},
    });

    const deltas = io.emissions.filter((e) => e.event === "sync:delta");
    expect(deltas).toHaveLength(1);
    const receiver = io.sockets.sockets.get(deltas[0].socketId);
    expect(receiver.decodedToken.id).toBe("user1");
  });

  it("C7: soft delete emits a delete delta with deleted true and NO data (tombstone stripped)", async () => {
    const entry = ownerEntry();
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user1"), {admin: false, id: "user1"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-1", _syncSeq: 3, deleted: true, name: "gone", ownerId: "user1"},
        operationType: "update",
        updateDescription: {updatedFields: {deleted: true}},
      }),
      docId: "doc-1",
      entry,
      io,
      logDebug: () => {},
    });

    const deltas = io.emissions.filter((e) => e.event === "sync:delta");
    expect(deltas).toHaveLength(1);
    const delta = deltas[0].payload as SyncDelta;
    expect(delta.method).toBe("delete");
    expect(delta.deleted).toBe(true);
    expect(delta.seq).toBe(3);
    // C7: a tombstone delta carries no data (privacy + payload growth).
    expect(delta.data).toBeUndefined();
  });

  it("C4: scope move emits a data-less tombstone (from the durable marker) to the previous stream and a create to the new stream", async () => {
    const entry = ownerEntry();
    await SyncScopeMove.deleteMany({});
    // C4: the tombstone is driven by a durable SyncScopeMove marker, not _syncPrevStream.
    await SyncScopeMove.create({
      collectionTag: "sockStuff",
      entityId: "doc-1",
      fromStream: "sockStuff|owner:user1",
      seq: 9,
      toStream: "sockStuff|owner:user2",
    });
    const io = makeTrackedIo();
    const oldRoom = syncRoomForStream("sockStuff|owner:user1");
    const newRoom = syncRoomForStream("sockStuff|owner:user2");
    io.addSocketToRoom(oldRoom, {admin: true, id: "admin"});
    io.addSocketToRoom(newRoom, {admin: true, id: "admin"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {
          _id: "doc-1",
          _syncSeq: 9,
          name: "moved",
          ownerId: "user2",
        },
        operationType: "update",
        updateDescription: {updatedFields: {ownerId: "user2"}},
      }),
      docId: "doc-1",
      entry,
      io,
      logDebug: () => {},
    });

    const deltas = io.emissions.filter((e) => e.event === "sync:delta");
    expect(deltas).toHaveLength(2);

    const tombstone = deltas.find((e) => e.room === oldRoom)?.payload as SyncDelta;
    expect(tombstone.method).toBe("delete");
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.stream).toBe("sockStuff|owner:user1");
    expect(tombstone.seq).toBe(9);
    expect(tombstone.data).toBeUndefined();

    const create = deltas.find((e) => e.room === newRoom)?.payload as SyncDelta;
    expect(create.method).toBe("create");
    expect(create.stream).toBe("sockStuff|owner:user2");
    expect((create.data as Record<string, unknown>).name).toBe("moved");
    await SyncScopeMove.deleteMany({});
  });

  it("C4: a racing second write cannot suppress the tombstone (the marker is durable, not the post-image)", async () => {
    // Simulates the race the design fixes: a second write reset _syncPrevStream to null
    // before this change event was processed. With the OLD implementation the old stream
    // would never get a tombstone; with the marker it still does.
    const entry = ownerEntry();
    await SyncScopeMove.deleteMany({});
    await SyncScopeMove.create({
      collectionTag: "sockStuff",
      entityId: "doc-1",
      fromStream: "sockStuff|owner:user1",
      seq: 11,
      toStream: "sockStuff|owner:user2",
    });
    const io = makeTrackedIo();
    const oldRoom = syncRoomForStream("sockStuff|owner:user1");
    io.addSocketToRoom(oldRoom, {admin: true, id: "admin"});
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user2"), {admin: true, id: "admin"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {
          _id: "doc-1",
          // _syncPrevStream is null (overwritten by the racing second write) — irrelevant now.
          _syncPrevStream: null,
          _syncSeq: 12,
          name: "moved then edited",
          ownerId: "user2",
        },
        operationType: "update",
        updateDescription: {updatedFields: {name: "moved then edited"}},
      }),
      docId: "doc-1",
      entry,
      io,
      logDebug: () => {},
    });

    const deltas = io.emissions.filter((e) => e.event === "sync:delta");
    const tombstone = deltas.find((e) => e.room === oldRoom)?.payload as SyncDelta;
    expect(tombstone).toBeDefined();
    expect(tombstone.method).toBe("delete");
    expect(tombstone.stream).toBe("sockStuff|owner:user1");
    expect(tombstone.seq).toBe(11);
    await SyncScopeMove.deleteMany({});
  });

  it("C4: no marker for the current stream means a plain update (no spurious tombstone)", async () => {
    const entry = ownerEntry();
    await SyncScopeMove.deleteMany({});
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user1"), {admin: false, id: "user1"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {
          _id: "doc-1",
          _syncSeq: 4,
          name: "same stream",
          ownerId: "user1",
        },
        operationType: "update",
        updateDescription: {updatedFields: {name: "same stream"}},
      }),
      docId: "doc-1",
      entry,
      io,
      logDebug: () => {},
    });

    const deltas = io.emissions.filter((e) => e.event === "sync:delta");
    expect(deltas).toHaveLength(1);
    expect((deltas[0].payload as SyncDelta).method).toBe("update");
  });

  it("skips hard deletes (no post-image)", async () => {
    const entry = ownerEntry();
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user1"), {admin: false, id: "user1"});

    await emitSyncDeltaForChange({
      change: makeChange({operationType: "delete"}),
      docId: "doc-1",
      entry,
      io,
      logDebug: () => {},
    });

    expect(io.emissions.filter((e) => e.event === "sync:delta")).toHaveLength(0);
  });

  it("logs and skips changes without a full document", async () => {
    const entry = ownerEntry();
    const io = makeTrackedIo();
    const logs: string[] = [];

    await emitSyncDeltaForChange({
      change: makeChange({operationType: "update"}),
      docId: "doc-no-image",
      entry,
      io,
      logDebug: (message) => logs.push(message),
    });

    assert.deepEqual(logs, ["[sync] Skipping sockStuff/doc-no-image: change has no fullDocument"]);
    assert.isEmpty(io.emissions);
  });

  it("skips changes whose operation type does not map to a sync method", async () => {
    const entry = ownerEntry();
    const io = makeTrackedIo();
    const logs: string[] = [];

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-invalid", _syncSeq: 1, ownerId: "user1"},
        operationType: "invalidate",
      }),
      docId: "doc-invalid",
      entry,
      io,
      logDebug: (message) => logs.push(message),
    });

    assert.isEmpty(logs);
    assert.isEmpty(io.emissions);
  });

  it("applies the sync responseHandler to delta data", async () => {
    clearSyncRegistry();
    registerSync({
      config: {
        responseHandler: (doc: Record<string, unknown>) => ({onlyName: doc.name}),
        scope: {type: "owner"},
      },
      model: SockStuffModel as unknown as Model<unknown>,
      options: permissiveOptions,
      routePath: "/sockStuff",
    });
    const entry = findSyncEntryByCollectionTag("sockStuff") as SyncRegistryEntry;
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:user1"), {admin: false, id: "user1"});

    await emitSyncDeltaForChange({
      change: makeChange({
        fullDocument: {_id: "doc-1", _syncSeq: 1, name: "shaped", ownerId: "user1", secret: "x"},
      }),
      docId: "doc-1",
      entry,
      io,
      logDebug: () => {},
    });

    const delta = io.emissions.find((e) => e.event === "sync:delta")?.payload as SyncDelta;
    expect(delta.data).toEqual({onlyName: "shaped"});
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// sync:delta — change stream integration (requires a replica set, like
// realtime.test.ts's change event integration block)
// ─────────────────────────────────────────────────────────────────────────────

const hasReplicaSet = async (): Promise<boolean> => {
  try {
    const admin = mongoose.connection.db?.admin();
    const status = await admin?.command({replSetGetStatus: 1});
    return Boolean(status?.ok);
  } catch {
    return false;
  }
};

/**
 * Start the watcher and give the change-stream cursor a moment to open so writes made
 * immediately afterwards are not missed (change streams only deliver post-open events).
 */
const startWatcherAndSettle = async (io: TrackedIo): Promise<void> => {
  startChangeStreamWatcher(io, {}, true);
  await new Promise((resolve) => setTimeout(resolve, 300));
};

const waitForDelta = async (
  io: TrackedIo,
  predicate: (delta: SyncDelta, emission: TrackedEmission) => boolean,
  timeoutMs = 5000
): Promise<void> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const match = io.emissions.some(
      (e) => e.event === "sync:delta" && predicate(e.payload as SyncDelta, e)
    );
    if (match) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

describe("sync:delta — change stream integration", () => {
  let replicaSetAvailable = false;

  beforeAll(async () => {
    await setupDb();
    replicaSetAvailable = await hasReplicaSet();
  });

  beforeEach(async () => {
    clearSyncRegistry();
    registerAll();
    await Promise.all([
      SockStuffModel.collection.deleteMany({}),
      SockProjectModel.collection.deleteMany({}),
      SyncCounter.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    await stopChangeStreamWatcher();
    clearSyncRegistry();
  });

  it("create, update, and soft delete each produce exactly one delta with correct seq and stream", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:cs-user"), {admin: false, id: "cs-user"});
    await startWatcherAndSettle(io);

    const doc = await SockStuffModel.create({name: "cs-create", ownerId: "cs-user"});
    const docId = String(doc._id);
    await waitForDelta(io, (d) => d.id === docId && d.method === "create");

    doc.name = "cs-updated";
    await doc.save();
    await waitForDelta(io, (d) => d.id === docId && d.method === "update");

    doc.deleted = true;
    await doc.save();
    await waitForDelta(io, (d) => d.id === docId && d.method === "delete");

    const deltas = io.emissions
      .filter((e) => e.event === "sync:delta")
      .map((e) => e.payload as SyncDelta);

    const creates = deltas.filter((d) => d.method === "create");
    const updates = deltas.filter((d) => d.method === "update");
    const deletes = deltas.filter((d) => d.method === "delete");
    expect(creates).toHaveLength(1);
    expect(updates).toHaveLength(1);
    expect(deletes).toHaveLength(1);

    expect(creates[0].seq).toBe(1);
    expect(updates[0].seq).toBe(2);
    expect(deletes[0].seq).toBe(3);
    for (const delta of deltas) {
      expect(delta.stream).toBe("sockStuff|owner:cs-user");
      expect(delta.collection).toBe("sockStuff");
    }
    expect(deletes[0].deleted).toBe(true);
    expect((deletes[0].data as Record<string, unknown>).name).toBe("cs-updated");
  });

  it("a socket subscribed to tenant org1 never receives org2's delta", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockProjects|tenant:org1"), {admin: false, id: "u1"});
    await startWatcherAndSettle(io);

    const org1Doc = await SockProjectModel.create({orgId: "org1", title: "org1 project"});
    const org2Doc = await SockProjectModel.create({orgId: "org2", title: "org2 project"});
    await waitForDelta(io, (d) => d.id === String(org1Doc._id));
    // Give the org2 event a chance to (incorrectly) arrive too.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const deltas = io.emissions
      .filter((e) => e.event === "sync:delta")
      .map((e) => e.payload as SyncDelta);
    expect(deltas.some((d) => d.id === String(org1Doc._id))).toBe(true);
    expect(deltas.some((d) => d.id === String(org2Doc._id))).toBe(false);
    expect(deltas.every((d) => d.stream === "sockProjects|tenant:org1")).toBe(true);
  });

  it("scope move emits a tombstone to the old stream and a create to the new stream", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    const io = makeTrackedIo();
    const oldRoom = syncRoomForStream("sockProjects|tenant:org1");
    const newRoom = syncRoomForStream("sockProjects|tenant:org2");
    io.addSocketToRoom(oldRoom, {admin: true, id: "admin"});
    io.addSocketToRoom(newRoom, {admin: true, id: "admin"});

    const doc = await SockProjectModel.create({orgId: "org1", title: "moving project"});
    const docId = String(doc._id);

    await startWatcherAndSettle(io);

    await SockProjectModel.findOneAndUpdate({_id: doc._id}, {$set: {orgId: "org2"}});
    await waitForDelta(io, (d, e) => d.id === docId && e.room === newRoom);
    await waitForDelta(io, (d, e) => d.id === docId && e.room === oldRoom);

    const deltas = io.emissions.filter(
      (e) => e.event === "sync:delta" && (e.payload as SyncDelta).id === docId
    );
    const tombstones = deltas.filter((e) => e.room === oldRoom);
    const creates = deltas.filter((e) => e.room === newRoom);
    expect(tombstones).toHaveLength(1);
    expect(creates).toHaveLength(1);

    const tombstone = tombstones[0].payload as SyncDelta;
    expect(tombstone.method).toBe("delete");
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.stream).toBe("sockProjects|tenant:org1");
    expect(tombstone.data).toBeUndefined();

    const create = creates[0].payload as SyncDelta;
    expect(create.method).toBe("create");
    expect(create.stream).toBe("sockProjects|tenant:org2");
    expect((create.data as Record<string, unknown>).orgId).toBe("org2");
  });

  it("never emits the legacy RTK sync event, even to legacy realtime rooms", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    const io = makeTrackedIo();
    io.addSocketToRoom("model:sockStuff", {admin: true, id: "admin"});
    io.addSocketToRoom("authenticated", {admin: true, id: "admin"});
    io.addSocketToRoom("user:legacy-user", {admin: false, id: "legacy-user"});
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:legacy-user"), {
      admin: false,
      id: "legacy-user",
    });
    await startWatcherAndSettle(io);

    const doc = await SockStuffModel.create({name: "legacy", ownerId: "legacy-user"});
    const docId = String(doc._id);
    await waitForDelta(io, (d) => d.id === docId);

    const deltas = io.emissions.filter(
      (e) => e.event === "sync:delta" && (e.payload as SyncDelta).id === docId
    );
    expect(deltas).toHaveLength(1);
    expect((deltas[0].payload as SyncDelta).seq).toBe(1);
    expect(io.emissions.filter((e) => e.event === "sync")).toHaveLength(0);
  });

  it("a sync model emits deltas through its sync stream room", async () => {
    if (!replicaSetAvailable) {
      return;
    }
    const io = makeTrackedIo();
    io.addSocketToRoom(syncRoomForStream("sockStuff|owner:only-user"), {
      admin: false,
      id: "only-user",
    });
    await startWatcherAndSettle(io);

    const doc = await SockStuffModel.create({name: "sync only", ownerId: "only-user"});
    await waitForDelta(io, (d) => d.id === String(doc._id));

    const deltas = io.emissions.filter((e) => e.event === "sync:delta");
    expect(deltas).toHaveLength(1);
    expect(io.emissions.filter((e) => e.event === "sync")).toHaveLength(0);
  });
});
