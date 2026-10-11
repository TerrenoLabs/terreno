import {beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import {type Model, model, Schema, Types} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import {type ModelRouterOptions, modelRouter} from "../api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "../auth";
import {APIError} from "../errors";
import {OwnerQueryFilter, Permissions} from "../permissions";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "../plugins";
import {authAsUser, getBaseServer, setupDb, UserModel} from "../tests";
import {registerAdminBroadcastScope} from "./adminBroadcastScope";
import {SyncCounter, SyncKey, SyncMutation} from "./models";
import {MAX_SYNC_MUTATIONS_PER_BATCH} from "./mutationHandler";
import {clearSyncRegistry, getSyncRegistry, registerSync, type SyncRegistryEntry} from "./registry";
import {
  buildSnapshotScopeFilter,
  MAX_ENTITY_FETCH,
  MAX_SYNC_HTTP_MUTATIONS_PER_SECOND,
} from "./routes";
import {SyncApp} from "./syncApp";
import {syncPlugin} from "./syncSeqPlugin";

interface RouteStuff extends IsDeleted {
  _id: string;
  name: string;
  ownerId: string;
  created: Date;
  _syncSeq?: number;
}

const routeStuffSchema = new Schema<RouteStuff>({
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", type: String},
});
routeStuffSchema.plugin(isDeletedPlugin);
routeStuffSchema.plugin(createdUpdatedPlugin);
routeStuffSchema.plugin(syncPlugin);
const RouteStuffModel = model<RouteStuff>("SyncRouteStuff", routeStuffSchema);

interface RouteProject extends IsDeleted {
  _id: string;
  title: string;
  orgId: string;
  _syncSeq?: number;
}

const routeProjectSchema = new Schema<RouteProject>({
  orgId: {description: "The organization this project belongs to", type: String},
  title: {description: "The project title", required: true, type: String},
});
routeProjectSchema.plugin(isDeletedPlugin);
routeProjectSchema.plugin(createdUpdatedPlugin);
routeProjectSchema.plugin(syncPlugin);
const RouteProjectModel = model<RouteProject>("SyncRouteProject", routeProjectSchema);

interface RouteBanner extends IsDeleted {
  _id: string;
  name: string;
  ownerId: string;
  _syncSeq?: number;
}

// Broadcast-scoped: sync adds no scope clause of its own, so the modelRouter `queryFilter`
// is the only row-level scoping (Task 9.19).
const routeBannerSchema = new Schema<RouteBanner>({
  name: {description: "The banner name", required: true, type: String},
  ownerId: {description: "The user who owns this banner", type: String},
});
routeBannerSchema.plugin(isDeletedPlugin);
routeBannerSchema.plugin(createdUpdatedPlugin);
routeBannerSchema.plugin(syncPlugin);
const RouteBannerModel = model<RouteBanner>("SyncRouteBanner", routeBannerSchema);

interface RouteNote extends IsDeleted {
  _id: string;
  body: string;
  ownerId: string;
  _syncSeq?: number;
}

// Client-minted string `_id`s (the syncdb default): entity ids are passed through uncast.
const routeNoteSchema = new Schema<RouteNote>({
  _id: {description: "Client-minted note id", type: String},
  body: {description: "The note body", required: true, type: String},
  ownerId: {description: "The user who owns this note", type: String},
});
routeNoteSchema.plugin(isDeletedPlugin);
routeNoteSchema.plugin(createdUpdatedPlugin);
routeNoteSchema.plugin(syncPlugin);
const RouteNoteModel = model<RouteNote>("SyncRouteNote", routeNoteSchema);

interface SnapshotEntity {
  id: string;
  seq: number;
  deleted: boolean;
  data: {name: string} | null;
}

interface StreamInfo {
  collection: string;
  stream: string;
}

interface MutationResult {
  type: string;
  ack: {seq: number};
}

const authedOptions = {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
} as unknown as ModelRouterOptions<unknown>;

const adminOnlyOptions = {
  permissions: {
    create: [Permissions.IsAdmin],
    delete: [Permissions.IsAdmin],
    list: [Permissions.IsAdmin],
    read: [Permissions.IsAdmin],
    update: [Permissions.IsAdmin],
  },
} as unknown as ModelRouterOptions<unknown>;

// The shared test database can be dropped by another test file mid-suite
// (configurationPlugin.test.ts drops it in an afterAll); rebuild the unique indexes the
// duplicate-delivery and key tests depend on.
beforeAll(async () => {
  await Promise.all([
    SyncCounter.ensureIndexes(),
    SyncKey.ensureIndexes(),
    SyncMutation.ensureIndexes(),
  ]);
});

describe("sync routes", () => {
  let app: express.Application;
  let server: TestAgent;
  let agent: TestAgent;
  let adminAgent: TestAgent;
  let notAdminId: string;
  let adminId: string;

  beforeEach(async () => {
    const [admin, notAdmin] = await setupDb();
    notAdminId = String(notAdmin._id);
    adminId = String(admin._id);

    clearSyncRegistry();
    registerSync({
      config: {scope: {type: "owner"}},
      model: RouteStuffModel as unknown as Model<unknown>,
      options: authedOptions,
      routePath: "/routeStuff",
    });
    registerSync({
      config: {scope: {field: "orgId", type: "tenant"}},
      model: RouteProjectModel as unknown as Model<unknown>,
      options: authedOptions,
      routePath: "/routeProjects",
    });

    await Promise.all([
      RouteStuffModel.collection.deleteMany({}),
      RouteProjectModel.collection.deleteMany({}),
      SyncCounter.deleteMany({}),
      SyncKey.deleteMany({}),
      SyncMutation.deleteMany({}),
    ]);

    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    new SyncApp({
      getUserScopes: () => ["org1"],
    }).register(app);

    server = supertest(app);
    agent = await authAsUser(app, "notAdmin");
    adminAgent = await authAsUser(app, "admin");
  });

  // C2: the snapshot endpoint is now per-STREAM. The owner stream for notAdmin is
  // `routeStuff|owner:{notAdminId}`; the tenant stream (getUserScopes -> ["org1"]) is
  // `routeProjects|tenant:org1`.
  describe("GET /sync/snapshot", () => {
    const ownerStream = (): string => `routeStuff|owner:${notAdminId}`;

    it("requires authentication", async () => {
      await server
        .get(`/sync/snapshot?stream=${encodeURIComponent("routeStuff|owner:x")}`)
        .expect(401);
    });

    it("requires a stream parameter", async () => {
      const res = await agent.get("/sync/snapshot").expect(400);
      expect(res.body.title).toMatch(/stream/);
    });

    it("400s for an unparseable stream key", async () => {
      await agent.get("/sync/snapshot?stream=notAStreamKey").expect(400);
    });

    it("404s for unknown collections", async () => {
      await agent.get(`/sync/snapshot?stream=${encodeURIComponent("nope|owner:x")}`).expect(404);
    });

    it("403s when the caller does not belong to the requested stream", async () => {
      // notAdmin's own owner stream is keyed by their id; someoneElse's is not theirs.
      await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent("routeStuff|owner:someoneElse")}`)
        .expect(403);
    });

    it("400s for invalid cursor and limit", async () => {
      const s = encodeURIComponent(ownerStream());
      await agent.get(`/sync/snapshot?stream=${s}&cursor=abc`).expect(400);
      await agent.get(`/sync/snapshot?stream=${s}&limit=-2`).expect(400);
      // Task 9.27(b): parseInt used to stop at the first non-digit, so these silently
      // became cursor 12 / limit 1 and the client paged on from the wrong seq.
      await agent.get(`/sync/snapshot?stream=${s}&cursor=12abc`).expect(400);
      await agent.get(`/sync/snapshot?stream=${s}&limit=1e9`).expect(400);
    });

    it("400s for an all-digit cursor that is not a safe integer", async () => {
      const s = encodeURIComponent(ownerStream());
      const res = await agent
        .get(`/sync/snapshot?stream=${s}&cursor=99999999999999999999`)
        .expect(400);
      expect(res.body.title).toMatch(/Invalid cursor/);
    });

    it("surfaces scope-move markers as tombstones on the old stream (C4)", async () => {
      const doc = await RouteStuffModel.create({name: "moving", ownerId: notAdminId});
      const initial = await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent(ownerStream())}`)
        .expect(200);
      expect(initial.body.entities.map((e: SnapshotEntity) => e.id)).toEqual([String(doc._id)]);

      doc.ownerId = "someoneElse";
      await doc.save();

      const res = await agent
        .get(
          `/sync/snapshot?stream=${encodeURIComponent(ownerStream())}&cursor=${initial.body.cursor}`
        )
        .expect(200);
      const tombstone = res.body.entities.find((e: SnapshotEntity) => e.id === String(doc._id));
      expect(tombstone).toBeDefined();
      expect(tombstone.deleted).toBe(true);
      expect(tombstone.data).toBeNull();
      expect(tombstone.seq).toBeGreaterThan(initial.body.cursor);
      expect(res.body.hasMore).toBe(false);
    });

    it("enforces the model's list permissions", async () => {
      clearSyncRegistry();
      registerSync({
        config: {scope: {type: "owner"}},
        model: RouteStuffModel as unknown as Model<unknown>,
        options: adminOnlyOptions,
        routePath: "/routeStuff",
      });
      // notAdmin is denied at the list-permission gate; admin's own owner stream is allowed.
      await agent.get(`/sync/snapshot?stream=${encodeURIComponent(ownerStream())}`).expect(403);
      const admin = await UserModel.findOne({email: "admin@example.com"});
      await adminAgent
        .get(
          `/sync/snapshot?stream=${encodeURIComponent(`routeStuff|owner:${String(admin?._id)}`)}`
        )
        .expect(200);
    });

    it("returns a full owner-scoped snapshot at cursor 0", async () => {
      await RouteStuffModel.create({name: "mine 1", ownerId: notAdminId});
      await RouteStuffModel.create({name: "mine 2", ownerId: notAdminId});
      await RouteStuffModel.create({name: "theirs", ownerId: "someoneElse"});

      const res = await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent(ownerStream())}`)
        .expect(200);
      expect(res.body.stream).toBe(ownerStream());
      expect(res.body.entities).toHaveLength(2);
      expect(res.body.entities.map((e: SnapshotEntity) => e.data.name)).toEqual([
        "mine 1",
        "mine 2",
      ]);
      expect(res.body.entities.map((e: SnapshotEntity) => e.seq)).toEqual([1, 2]);
      expect(res.body.cursor).toBe(2);
      expect(res.body.hasMore).toBe(false);
      // C1/C7 response fields present.
      expect(res.body.frontierSeq).toBe(2);
      expect(typeof res.body.oldestRetainedSeq).toBe("number");
    });

    it("returns incremental changes and tombstones past a cursor", async () => {
      const doc1 = await RouteStuffModel.create({name: "first", ownerId: notAdminId});
      const doc2 = await RouteStuffModel.create({name: "second", ownerId: notAdminId});

      const initial = await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent(ownerStream())}`)
        .expect(200);
      const cursor = initial.body.cursor;

      doc1.name = "first updated";
      await doc1.save();
      doc2.deleted = true;
      await doc2.save();

      const res = await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent(ownerStream())}&cursor=${cursor}`)
        .expect(200);
      expect(res.body.entities).toHaveLength(2);
      const updated = res.body.entities.find((e: SnapshotEntity) => e.id === String(doc1._id));
      const tombstone = res.body.entities.find((e: SnapshotEntity) => e.id === String(doc2._id));
      expect(updated.data.name).toBe("first updated");
      expect(updated.deleted).toBe(false);
      expect(tombstone.deleted).toBe(true);
      // C7: tombstones carry no data.
      expect(tombstone.data).toBeNull();
      expect(tombstone.seq).toBeGreaterThan(cursor);
    });

    it("paginates by seq with hasMore and a resumable cursor", async () => {
      for (let i = 1; i <= 5; i++) {
        await RouteStuffModel.create({name: `item ${i}`, ownerId: notAdminId});
      }
      const s = encodeURIComponent(ownerStream());
      const page1 = await agent.get(`/sync/snapshot?stream=${s}&limit=2`).expect(200);
      expect(page1.body.entities).toHaveLength(2);
      expect(page1.body.hasMore).toBe(true);

      const page2 = await agent
        .get(`/sync/snapshot?stream=${s}&limit=2&cursor=${page1.body.cursor}`)
        .expect(200);
      expect(page2.body.entities).toHaveLength(2);
      expect(page2.body.hasMore).toBe(true);

      const page3 = await agent
        .get(`/sync/snapshot?stream=${s}&limit=2&cursor=${page2.body.cursor}`)
        .expect(200);
      expect(page3.body.entities).toHaveLength(1);
      expect(page3.body.hasMore).toBe(false);

      const names = [...page1.body.entities, ...page2.body.entities, ...page3.body.entities].map(
        (e: SnapshotEntity) => e.data.name
      );
      expect(names).toEqual(["item 1", "item 2", "item 3", "item 4", "item 5"]);
    });

    it("never advances the returned cursor beyond the stable frontier (C1)", async () => {
      await RouteStuffModel.create({name: "committed 1", ownerId: notAdminId});
      await RouteStuffModel.create({name: "committed 2", ownerId: notAdminId});
      const res = await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent(ownerStream())}`)
        .expect(200);
      // With no in-flight writes, frontier == head and the cursor equals the frontier.
      expect(res.body.cursor).toBeLessThanOrEqual(res.body.frontierSeq);
    });

    it("scopes tenant collections to the requested tenant stream only", async () => {
      await RouteProjectModel.create({orgId: "org1", title: "visible"});
      await RouteProjectModel.create({orgId: "org2", title: "hidden"});

      const res = await agent
        .get("/sync/snapshot?stream=routeProjects%7Ctenant%3Aorg1")
        .expect(200);
      expect(res.body.entities).toHaveLength(1);
      expect(res.body.entities[0].data.title).toBe("visible");
    });

    it("500s for tenant collections when no getUserScopes resolver is configured", async () => {
      const bareApp = getBaseServer();
      setupAuth(bareApp, UserModel as unknown as AuthUserModel);
      addAuthRoutes(bareApp, UserModel as unknown as AuthUserModel);
      new SyncApp().register(bareApp);
      const bareAgent = await authAsUser(bareApp, "notAdmin");
      await bareAgent.get("/sync/snapshot?stream=routeProjects%7Ctenant%3Aorg1").expect(500);
    });

    it("uses the sync responseHandler to serialize entities", async () => {
      clearSyncRegistry();
      registerSync({
        config: {
          responseHandler: (doc) => ({redactedName: `x-${(doc as RouteStuff).name}`}),
          scope: {type: "owner"},
        },
        model: RouteStuffModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeStuff",
      });
      await RouteStuffModel.create({name: "secret", ownerId: notAdminId});
      const res = await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent(ownerStream())}`)
        .expect(200);
      expect(res.body.entities[0].data).toEqual({redactedName: "x-secret"});
    });
  });

  describe("POST /sync/snapshot/batch", () => {
    const ownerStream = (): string => `routeStuff|owner:${notAdminId}`;
    const tenantStream = "routeProjects|tenant:org1";

    it("requires authentication", async () => {
      await server
        .post("/sync/snapshot/batch")
        .send({streams: [{stream: "routeStuff|owner:x"}]})
        .expect(401);
    });

    it("returns one scoped page per stream, in request order", async () => {
      await RouteStuffModel.create({name: "mine", ownerId: notAdminId});
      await RouteStuffModel.create({name: "theirs", ownerId: "someoneElse"});
      await RouteProjectModel.create({orgId: "org1", title: "visible"});
      await RouteProjectModel.create({orgId: "org2", title: "hidden"});

      const res = await agent
        .post("/sync/snapshot/batch")
        .send({streams: [{stream: tenantStream}, {cursor: 0, stream: ownerStream()}]})
        .expect(200);

      expect(res.body.pages.map((page: {stream: string}) => page.stream)).toEqual([
        tenantStream,
        ownerStream(),
      ]);
      expect(res.body.pages[0].entities.map((e: SnapshotEntity) => e.data.title)).toEqual([
        "visible",
      ]);
      expect(res.body.pages[1].entities.map((e: SnapshotEntity) => e.data.name)).toEqual(["mine"]);
      expect(res.body.pages[1].hasMore).toBe(false);
      expect(res.body.pages[1].cursor).toBe(res.body.pages[1].frontierSeq);
    });

    it("splits the entity budget across streams and resumes from each stream's cursor", async () => {
      for (let i = 1; i <= 5; i++) {
        await RouteStuffModel.create({name: `item ${i}`, ownerId: notAdminId});
      }
      await RouteProjectModel.create({orgId: "org1", title: "project"});

      const first = await agent
        .post("/sync/snapshot/batch")
        .send({limit: 4, streams: [{stream: ownerStream()}, {stream: tenantStream}]})
        .expect(200);
      const [ownerPage, tenantPage] = first.body.pages;
      expect(ownerPage.entities).toHaveLength(2);
      expect(ownerPage.hasMore).toBe(true);
      expect(tenantPage.entities).toHaveLength(1);
      expect(tenantPage.hasMore).toBe(false);

      const second = await agent
        .post("/sync/snapshot/batch")
        .send({limit: 4, streams: [{cursor: ownerPage.cursor, stream: ownerStream()}]})
        .expect(200);
      expect(second.body.pages[0].entities.map((e: SnapshotEntity) => e.data.name)).toEqual([
        "item 3",
        "item 4",
        "item 5",
      ]);
      expect(second.body.pages[0].hasMore).toBe(false);
    });

    it("serves the same page as GET /sync/snapshot for the same stream and cursor", async () => {
      for (let i = 1; i <= 3; i++) {
        await RouteStuffModel.create({name: `item ${i}`, ownerId: notAdminId});
      }
      const single = await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent(ownerStream())}&limit=2&cursor=1`)
        .expect(200);
      const batch = await agent
        .post("/sync/snapshot/batch")
        .send({limit: 2, streams: [{cursor: 1, stream: ownerStream()}]})
        .expect(200);
      expect(batch.body.pages[0]).toEqual(single.body);
    });

    it("rejects the whole request when any stream is not the caller's", async () => {
      await agent
        .post("/sync/snapshot/batch")
        .send({streams: [{stream: ownerStream()}, {stream: "routeStuff|owner:someoneElse"}]})
        .expect(403);
    });

    it("rejects malformed bodies", async () => {
      const tooMany = Array.from({length: 501}, (_unused, index) => ({
        stream: `routeStuff|owner:u${index}`,
      }));
      const bodies: unknown[] = [
        {},
        {streams: []},
        {streams: "routeStuff"},
        {streams: tooMany},
        {streams: [{cursor: 0}]},
        {streams: [{stream: ownerStream()}, {stream: ownerStream()}]},
        {streams: [{cursor: -1, stream: ownerStream()}]},
        {streams: [{legacyCursor: 5, stream: ownerStream()}]},
        {limit: "lots", streams: [{stream: ownerStream()}]},
        {streams: [{stream: "notAStreamKey"}]},
      ];
      for (const body of bodies) {
        await agent
          .post("/sync/snapshot/batch")
          .send(body as object)
          .expect(400);
      }
    });
  });

  describe("buildSnapshotScopeFilter", () => {
    it("500s for a custom scope entry that has no snapshotFilter result", () => {
      // Registration rejects this shape up front, so build the entry directly.
      const entry: SyncRegistryEntry = {
        collectionName: "syncroutestuffs",
        collectionTag: "routeStuff",
        config: {scope: () => "custom"},
        modelName: RouteStuffModel.modelName,
        options: authedOptions,
        routePath: "/routeStuff",
      };
      expect(() => buildSnapshotScopeFilter({entry, scopeValue: "custom"})).toThrow(
        expect.objectContaining({status: 500, title: expect.stringMatching(/snapshotFilter/)})
      );
    });

    it("returns the snapshotFilter result for a custom scope", () => {
      clearSyncRegistry();
      registerSync({
        config: {
          scope: () => "custom",
          snapshotFilter: () => ({name: "keep"}),
        },
        model: RouteStuffModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeStuff",
      });
      const [entry] = getSyncRegistry();
      expect(
        buildSnapshotScopeFilter({
          entry,
          scopeValue: "custom",
          snapshotFilterResult: {name: "keep"},
        })
      ).toEqual({name: "keep"});
    });
  });

  describe("GET /sync/streams", () => {
    it("requires authentication", async () => {
      await server.get("/sync/streams").expect(401);
    });

    it("omits collections the caller is not allowed to list", async () => {
      registerSync({
        config: {scope: {type: "broadcast"}},
        model: RouteBannerModel as unknown as Model<unknown>,
        options: adminOnlyOptions,
        routePath: "/routeBanners",
      });

      const res = await agent.get("/sync/streams").expect(200);
      const collections = res.body.streams.map((s: StreamInfo) => s.collection);
      expect(collections).toContain("routeStuff");
      expect(collections).not.toContain("routeBanners");

      const adminRes = await adminAgent.get("/sync/streams").expect(200);
      expect(adminRes.body.streams).toContainEqual({
        collection: "routeBanners",
        stream: "routeBanners|all",
      });
    });

    it("500s when a tenant collection has no getUserScopes resolver", async () => {
      const bareApp = getBaseServer();
      setupAuth(bareApp, UserModel as unknown as AuthUserModel);
      addAuthRoutes(bareApp, UserModel as unknown as AuthUserModel);
      new SyncApp().register(bareApp);
      const bareAgent = await authAsUser(bareApp, "notAdmin");

      const res = await bareAgent.get("/sync/streams").expect(500);
      expect(res.body.title).toMatch(/Failed to resolve streams for routeProjects/);
    });
  });

  describe("GET /sync/entities", () => {
    it("requires authentication", async () => {
      await server.get("/sync/entities?collection=routeStuff&ids=abc").expect(401);
    });

    it("400s when the collection parameter is missing", async () => {
      const res = await agent.get("/sync/entities?ids=abc").expect(400);
      expect(res.body.title).toMatch(/collection/);
    });

    it("400s when no ids are supplied", async () => {
      const res = await agent.get("/sync/entities?collection=routeStuff&ids=,").expect(400);
      expect(res.body.title).toMatch(/ids/);
    });

    it("404s for an unknown collection", async () => {
      const res = await agent.get("/sync/entities?collection=nope&ids=abc").expect(404);
      expect(res.body.title).toMatch(/Unknown sync collection: nope/);
    });

    it("403s when the caller may not list the collection", async () => {
      registerSync({
        config: {scope: {type: "broadcast"}},
        model: RouteBannerModel as unknown as Model<unknown>,
        options: adminOnlyOptions,
        routePath: "/routeBanners",
      });
      const doc = await RouteBannerModel.create({name: "secret", ownerId: adminId});
      const res = await agent
        .get(`/sync/entities?collection=routeBanners&ids=${doc._id}`)
        .expect(403);
      expect(res.body.title).toMatch(/denied/);
    });

    it("passes string ids through uncast for models with string _ids", async () => {
      registerSync({
        config: {scope: {type: "owner"}},
        model: RouteNoteModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeNotes",
      });
      await RouteNoteModel.collection.deleteMany({});
      await RouteNoteModel.create({_id: "note-1", body: "hello", ownerId: notAdminId});

      const res = await agent
        .get("/sync/entities?collection=routeNotes&ids=note-1,not-an-object-id")
        .expect(200);
      expect(res.body.entities.map((e: SnapshotEntity) => e.id)).toEqual(["note-1"]);
    });
  });

  describe("POST /sync/mutate", () => {
    it("requires authentication", async () => {
      await server
        .post("/sync/mutate")
        .send({collection: "routeStuff", mutationId: "hm-1", operation: "create"})
        .expect(401);
    });

    it("returns 200 with an ack for a successful create", async () => {
      const res = await agent
        .post("/sync/mutate")
        .send({
          collection: "routeStuff",
          data: {name: "via http", ownerId: notAdminId},
          mutationId: "hm-create-1",
          operation: "create",
        })
        .expect(200);
      expect(res.body.ack.mutationId).toBe("hm-create-1");
      expect(res.body.ack.seq).toBe(1);
      const saved = await RouteStuffModel.findById(res.body.ack.id);
      expect(saved?.name).toBe("via http");
    });

    it("returns 200 with an ack for updates and deletes", async () => {
      const doc = await RouteStuffModel.create({name: "http original", ownerId: notAdminId});
      const updateRes = await agent
        .post("/sync/mutate")
        .send({
          baseVersion: 1,
          collection: "routeStuff",
          data: {name: "http updated"},
          id: String(doc._id),
          mutationId: "hm-update-1",
          operation: "update",
        })
        .expect(200);
      expect(updateRes.body.ack.seq).toBe(2);

      const deleteRes = await agent
        .post("/sync/mutate")
        .send({
          collection: "routeStuff",
          id: String(doc._id),
          mutationId: "hm-delete-1",
          operation: "delete",
        })
        .expect(200);
      expect(deleteRes.body.ack.seq).toBe(3);
      const tombstones = await RouteStuffModel.find({_id: doc._id, deleted: true});
      expect(tombstones).toHaveLength(1);
    });

    // Task 9.21: a create with no tenant value used to be written into a
    // `tenant:undefined` stream that no client can subscribe to — stored but unsyncable.
    it("rejects a tenant-scoped create whose scope field is absent", async () => {
      const res = await agent
        .post("/sync/mutate")
        .send({
          collection: "routeProjects",
          data: {title: "no org"},
          mutationId: "hm-tenant-missing",
          operation: "create",
        })
        .expect(422);
      expect(res.body.nack.code).toBe("validation");
      expect(res.body.nack.message).toMatch(/missing tenant scope field "orgId"/);
      expect(await RouteProjectModel.countDocuments({title: "no org"})).toBe(0);
    });

    // The write-path guard must not leak into reads: a legacy row predating the scope
    // field still has to be loadable, or the documents it was meant to protect become
    // unreadable instead of merely unwritable.
    it("still hydrates a tenant-scoped document that has no scope value", async () => {
      const legacyId = new Types.ObjectId();
      await RouteProjectModel.collection.insertOne({
        _id: legacyId,
        _syncSeq: 1,
        title: "legacy row",
      } as never);

      const loaded = await RouteProjectModel.findById(legacyId);
      expect(loaded?.title).toBe("legacy row");
      if (!loaded) {
        throw new Error("Expected legacy row to load");
      }

      // Writing it, however, is still refused until the tenant field is supplied.
      loaded.title = "renamed";
      await expect(loaded.save()).rejects.toThrow(/missing tenant scope field "orgId"/);
    });

    // A query-write can strip the tenant field off a document that already has one. The
    // effective new value must be read from the update, not coalesced back to the
    // document's current value — otherwise the guard sees the old org and passes, and the
    // write is stamped into a stream the document no longer belongs to.
    it("rejects a query-write that clears the tenant scope field", async () => {
      const created = await RouteProjectModel.create({orgId: "org1", title: "has an org"});

      await expect(
        RouteProjectModel.updateOne({_id: created._id}, {$set: {orgId: null}}).exec()
      ).rejects.toThrow(/missing tenant scope field "orgId"/);
      await expect(
        RouteProjectModel.updateOne({_id: created._id}, {$unset: {orgId: 1}}).exec()
      ).rejects.toThrow(/missing tenant scope field "orgId"/);

      // The document is untouched, and an update that leaves the scope field alone or
      // moves it to another tenant still works.
      const untouched = await RouteProjectModel.findById(created._id);
      expect(untouched?.orgId).toBe("org1");
      await RouteProjectModel.updateOne({_id: created._id}, {$set: {title: "renamed"}});
      await RouteProjectModel.updateOne({_id: created._id}, {$set: {orgId: "org2"}});
      const moved = await RouteProjectModel.findById(created._id);
      expect(moved?.orgId).toBe("org2");
      expect(moved?.title).toBe("renamed");
    });

    it("accepts a tenant-scoped create carrying a membership scope value", async () => {
      const res = await agent
        .post("/sync/mutate")
        .send({
          collection: "routeProjects",
          data: {orgId: "org1", title: "with org"},
          mutationId: "hm-tenant-present",
          operation: "create",
        })
        .expect(200);
      expect(res.body.ack.mutationId).toBe("hm-tenant-present");
    });

    it("returns the recorded ack for a duplicate delivery without re-applying", async () => {
      const body = {
        collection: "routeStuff",
        data: {name: "http once", ownerId: notAdminId},
        mutationId: "hm-dup-1",
        operation: "create",
      };
      const first = await agent.post("/sync/mutate").send(body).expect(200);
      const second = await agent.post("/sync/mutate").send(body).expect(200);
      expect(second.body.ack).toEqual(first.body.ack);
      expect(await RouteStuffModel.countDocuments({name: "http once"})).toBe(1);
    });

    it("returns 409 with the server doc on a stale baseVersion", async () => {
      const doc = await RouteStuffModel.create({name: "server v1", ownerId: notAdminId});
      doc.name = "server v2";
      await doc.save(); // seq 2

      const res = await agent
        .post("/sync/mutate")
        .send({
          baseVersion: 1,
          collection: "routeStuff",
          data: {name: "stale"},
          id: String(doc._id),
          mutationId: "hm-conflict-1",
          operation: "update",
        })
        .expect(409);
      expect(res.body.nack.code).toBe("conflict");
      expect(res.body.nack.serverSeq).toBe(2);
      expect(res.body.nack.serverDoc.name).toBe("server v2");
      const saved = await RouteStuffModel.findById(doc._id);
      expect(saved?.name).toBe("server v2");
    });

    it("returns 403 with an unauthorized nack for permission denials", async () => {
      clearSyncRegistry();
      registerSync({
        config: {scope: {type: "owner"}},
        model: RouteStuffModel as unknown as Model<unknown>,
        options: adminOnlyOptions,
        routePath: "/routeStuff",
      });
      // Each caller writes to their OWN owner scope (C6 rejects a foreign ownerId with a
      // separate scope-violation nack — exercised in the C6 tests, not here).
      const body = (mutationId: string, ownerId: string) => ({
        collection: "routeStuff",
        data: {name: "admin only", ownerId},
        mutationId,
        operation: "create",
      });
      const res = await agent.post("/sync/mutate").send(body("hm-perm-1", notAdminId)).expect(403);
      expect(res.body.nack.code).toBe("unauthorized");
      await adminAgent.post("/sync/mutate").send(body("hm-perm-2", adminId)).expect(200);
    });

    it("returns 422 with a validation nack for invalid mutations", async () => {
      const missingField = await agent
        .post("/sync/mutate")
        .send({
          collection: "routeStuff",
          data: {ownerId: notAdminId},
          mutationId: "hm-invalid-1",
          operation: "create",
        })
        .expect(422);
      expect(missingField.body.nack.code).toBe("validation");

      const unknownCollection = await agent
        .post("/sync/mutate")
        .send({
          collection: "nope",
          data: {name: "x"},
          mutationId: "hm-invalid-2",
          operation: "create",
        })
        .expect(422);
      expect(unknownCollection.body.nack.code).toBe("validation");

      const missingId = await agent
        .post("/sync/mutate")
        .send({
          collection: "routeStuff",
          data: {name: "x"},
          mutationId: "hm-invalid-3",
          operation: "update",
        })
        .expect(422);
      expect(missingId.body.nack.code).toBe("validation");
    });

    it("returns 500 with an error nack for unexpected failures", async () => {
      clearSyncRegistry();
      registerSync({
        config: {scope: {type: "owner"}},
        model: RouteStuffModel as unknown as Model<unknown>,
        options: {
          ...authedOptions,
          preCreate: () => {
            throw new APIError({status: 500, title: "database exploded"});
          },
        } as unknown as ModelRouterOptions<unknown>,
        routePath: "/routeStuff",
      });
      const res = await agent
        .post("/sync/mutate")
        .send({
          collection: "routeStuff",
          data: {name: "boom", ownerId: notAdminId},
          mutationId: "hm-error-1",
          operation: "create",
        })
        .expect(500);
      expect(res.body.nack.code).toBe("error");
    });

    it("returns 429 with a rate_limited nack carrying retryAfterMs once the per-second budget is exceeded (FIX 1)", async () => {
      // notAdminId is fresh per test (setupDb() runs in beforeEach), so this
      // user's rolling window starts empty here. Fire the budget-filling
      // requests CONCURRENTLY (not sequentially awaited) so 100 requests
      // cannot spread across the 1-second rolling window under machine load
      // (a sequential loop's wall-clock time is unbounded and would let the
      // window reset mid-flood, making the final request wrongly succeed).
      const body = (mutationId: string) => ({
        collection: "routeStuff",
        data: {name: "flood", ownerId: notAdminId},
        mutationId,
        operation: "create",
      });
      await Promise.all(
        Array.from({length: MAX_SYNC_HTTP_MUTATIONS_PER_SECOND}, (_v, i) =>
          agent
            .post("/sync/mutate")
            .send(body(`hm-flood-${i}`))
            .expect(200)
        )
      );
      const res = await agent.post("/sync/mutate").send(body("hm-flood-over")).expect(429);
      expect(res.body.nack.code).toBe("rate_limited");
      expect(typeof res.body.nack.retryAfterMs).toBe("number");
      expect(res.body.nack.retryAfterMs).toBeGreaterThan(0);
    });
  });

  describe("POST /sync/mutate/batch", () => {
    const create = (mutationId: string, name: string) => ({
      collection: "routeStuff",
      data: {name, ownerId: notAdminId},
      mutationId,
      operation: "create",
    });

    it("requires authentication", async () => {
      await server
        .post("/sync/mutate/batch")
        .send({mutations: [create("batch-http-noauth", "x")]})
        .expect(401);
    });

    it("applies mutations strictly in order and returns one ack per mutation", async () => {
      const mutations = Array.from({length: 5}, (_v, i) => create(`batch-http-${i}`, `item ${i}`));
      const res = await agent.post("/sync/mutate/batch").send({mutations}).expect(200);
      expect(res.body.results).toHaveLength(5);
      expect(res.body.results.every((r: MutationResult) => r.type === "ack")).toBe(true);
      const seqs = res.body.results.map((r: MutationResult) => r.ack.seq);
      expect(seqs).toEqual([1, 2, 3, 4, 5]);
    });

    it("stops at the first nack: results shorter than the request", async () => {
      const mutations = [
        create("batch-http-halt-1", "ok 1"),
        {
          collection: "routeStuff",
          data: {name: "bad"},
          mutationId: "batch-http-halt-2",
          operation: "update", // no id supplied -> validation nack
        },
        create("batch-http-halt-3", "never applied"),
      ];
      const res = await agent.post("/sync/mutate/batch").send({mutations}).expect(200);
      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0].type).toBe("ack");
      expect(res.body.results[1].type).toBe("nack");
      expect(res.body.results[1].nack.code).toBe("validation");
      expect(await RouteStuffModel.countDocuments({name: "never applied"})).toBe(0);
    });

    it("rejects an oversized batch with a 422 before processing anything", async () => {
      const mutations = Array.from({length: MAX_SYNC_MUTATIONS_PER_BATCH + 1}, (_v, i) =>
        create(`batch-http-oversized-${i}`, `item ${i}`)
      );
      const res = await agent.post("/sync/mutate/batch").send({mutations}).expect(422);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].nack.code).toBe("validation");
      expect(await RouteStuffModel.countDocuments({})).toBe(0);
    });

    it("rejects intra-batch duplicate mutationIds with a 422", async () => {
      const mutations = [create("batch-http-dup", "a"), create("batch-http-dup", "b")];
      const res = await agent.post("/sync/mutate/batch").send({mutations}).expect(422);
      expect(res.body.results[0].nack.code).toBe("validation");
      expect(await RouteStuffModel.countDocuments({})).toBe(0);
    });

    it("a whole-batch duplicate resend is idempotent", async () => {
      const mutations = [create("batch-http-idem-1", "once"), create("batch-http-idem-2", "twice")];
      const first = await agent.post("/sync/mutate/batch").send({mutations}).expect(200);
      const second = await agent.post("/sync/mutate/batch").send({mutations}).expect(200);
      expect(second.body).toEqual(first.body);
      expect(await RouteStuffModel.countDocuments({name: "once"})).toBe(1);
      expect(await RouteStuffModel.countDocuments({name: "twice"})).toBe(1);
    });

    it("returns 429 with a rate_limited nack carrying retryAfterMs once the shared per-second budget is exceeded (FIX 1)", async () => {
      // The batch route counts each mutation in the batch (not the batch
      // itself) against the same per-user window as POST /sync/mutate. Two
      // batches: the first (at the batch-size cap) nearly exhausts the
      // per-second budget, the second (small) tips it over — a single batch
      // over MAX_SYNC_HTTP_MUTATIONS_PER_SECOND would also exceed
      // MAX_SYNC_MUTATIONS_PER_BATCH and get rejected as oversized first.
      // A cheap validation nack (unknown collection, mirroring the sibling
      // sync:mutateBatch rate-limit test) — no DB writes — keeps the first
      // batch's wall-clock time well under the 1-second window even on a
      // loaded machine, so it can't spuriously reset before the second
      // request lands (100 real document creates would risk exactly that).
      // The batch route always returns 200 with a `results` array (the
      // client inspects each entry's type) — stop-on-first-nack means only
      // the first mutation's validation nack comes back, but the FULL
      // batch length (100) still counts against the rate-limit window
      // (consumed before any mutation is applied).
      const firstBatch = Array.from({length: MAX_SYNC_MUTATIONS_PER_BATCH}, (_v, i) => ({
        collection: "nope",
        mutationId: `batch-http-flood-a-${i}`,
        operation: "create",
      }));
      const firstRes = await agent
        .post("/sync/mutate/batch")
        .send({mutations: firstBatch})
        .expect(200);
      expect(firstRes.body.results[0].nack.code).toBe("validation");
      const secondBatch = [create("batch-http-flood-b-0", "over budget")];
      const res = await agent.post("/sync/mutate/batch").send({mutations: secondBatch}).expect(429);
      expect(res.body.results).toHaveLength(1);
      expect(res.body.results[0].nack.code).toBe("rate_limited");
      expect(typeof res.body.results[0].nack.retryAfterMs).toBe("number");
      expect(res.body.results[0].nack.retryAfterMs).toBeGreaterThan(0);
      expect(await RouteStuffModel.countDocuments({name: "over budget"})).toBe(0);
    });
  });

  // Task 9.27(b): bad caller input on the repair-fetch endpoint used to come back as a 500
  // (CastError) or, worse, a truncated 200 the client read as "those entities are gone".
  describe("GET /sync/entities input validation (Task 9.27)", () => {
    it("400s (not 500s) for ids that cannot be cast to the model's _id type", async () => {
      const doc = await RouteStuffModel.create({name: "real", ownerId: notAdminId});
      const res = await agent
        .get(`/sync/entities?collection=routeStuff&ids=${doc._id},not-an-object-id`)
        .expect(400);
      expect(res.body.title).toMatch(/not-an-object-id/);
    });

    it("400s instead of silently truncating an over-cap id list", async () => {
      const doc = await RouteStuffModel.create({name: "real", ownerId: notAdminId});
      const ids = [
        String(doc._id),
        ...Array.from({length: MAX_ENTITY_FETCH}, () => new Types.ObjectId().toString()),
      ];
      const res = await agent
        .get(`/sync/entities?collection=routeStuff&ids=${ids.join(",")}`)
        .expect(400);
      expect(res.body.title).toMatch(new RegExp(String(MAX_ENTITY_FETCH)));

      // The cap itself still serves a full page.
      const atCap = await agent
        .get(`/sync/entities?collection=routeStuff&ids=${ids.slice(0, MAX_ENTITY_FETCH).join(",")}`)
        .expect(200);
      expect(atCap.body.entities.map((e: SnapshotEntity) => e.id)).toEqual([String(doc._id)]);
    });
  });

  describe("GET /sync/entities admin window (Task 3.4)", () => {
    it("returns another owner's ids for an admin when adminBroadcast is true", async () => {
      clearSyncRegistry();
      registerSync({
        config: {adminBroadcast: true, scope: {type: "owner"}},
        model: RouteStuffModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeStuff",
      });
      const mine = await RouteStuffModel.create({name: "theirs", ownerId: notAdminId});
      const missingId = new Types.ObjectId().toString();

      const res = await adminAgent
        .get(`/sync/entities?collection=routeStuff&ids=${mine._id},${missingId}`)
        .expect(200);
      assert.equal(res.body.entities.length, 1);
      assert.equal(res.body.entities[0].id, String(mine._id));
    });

    it("still scopes a non-admin to streams they belong to when adminBroadcast is true", async () => {
      clearSyncRegistry();
      registerSync({
        config: {adminBroadcast: true, scope: {type: "owner"}},
        model: RouteStuffModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeStuff",
      });
      const theirs = await RouteStuffModel.create({name: "admin-owned", ownerId: adminId});

      const res = await agent
        .get(`/sync/entities?collection=routeStuff&ids=${theirs._id}`)
        .expect(200);
      assert.deepEqual(res.body.entities, []);
    });

    it("does not cross-owner hydrate when accessControl denies admin:access", async () => {
      clearSyncRegistry();
      registerSync({
        config: {adminBroadcast: true, scope: {type: "owner"}},
        model: RouteStuffModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeStuff",
      });
      const theirs = await RouteStuffModel.create({name: "flag-admin-owned", ownerId: notAdminId});
      const gatedApp = getBaseServer();
      setupAuth(gatedApp, UserModel as unknown as AuthUserModel);
      addAuthRoutes(gatedApp, UserModel as unknown as AuthUserModel);
      new SyncApp({
        accessControl: {
          can: async () => ({allowed: false}),
        } as never,
        getUserScopes: () => ["org1"],
      }).register(gatedApp);
      const gatedAdmin = await authAsUser(gatedApp, "admin");

      const res = await gatedAdmin
        .get(`/sync/entities?collection=routeStuff&ids=${theirs._id}`)
        .expect(200);
      assert.deepEqual(res.body.entities, []);
    });

    it("omits ids excluded by a registered AdminApp queryFilter", async () => {
      clearSyncRegistry();
      registerSync({
        config: {adminBroadcast: true, scope: {type: "owner"}},
        model: RouteStuffModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeStuff",
      });
      registerAdminBroadcastScope("SyncRouteStuff", {
        listPermissions: [() => true],
        queryFilter: () => ({ownerId: adminId}),
        readPermissions: [() => true],
      });
      const inScope = await RouteStuffModel.create({name: "in-tenant", ownerId: adminId});
      const outOfScope = await RouteStuffModel.create({name: "other-tenant", ownerId: notAdminId});

      const res = await adminAgent
        .get(`/sync/entities?collection=routeStuff&ids=${inScope._id},${outOfScope._id}`)
        .expect(200);
      assert.deepEqual(
        res.body.entities.map((entity: SnapshotEntity) => entity.id),
        [String(inScope._id)]
      );
    });

    it("returns no entities when AdminApp list permission is denied", async () => {
      clearSyncRegistry();
      registerSync({
        config: {adminBroadcast: true, scope: {type: "owner"}},
        model: RouteStuffModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeStuff",
      });
      registerAdminBroadcastScope("SyncRouteStuff", {
        listPermissions: [() => false],
        readPermissions: [() => true],
      });
      const theirs = await RouteStuffModel.create({name: "hidden-model", ownerId: notAdminId});

      const res = await adminAgent
        .get(`/sync/entities?collection=routeStuff&ids=${theirs._id}`)
        .expect(200);
      assert.deepEqual(res.body.entities, []);
    });
  });

  describe("GET /sync/key", () => {
    it("requires authentication", async () => {
      await server.get("/sync/key").expect(401);
    });

    it("returns stable 32-byte key material per user", async () => {
      const first = await agent.get("/sync/key").expect(200);
      const second = await agent.get("/sync/key").expect(200);
      expect(first.body.keyMaterial).toBe(second.body.keyMaterial);
      expect(Buffer.from(first.body.keyMaterial, "base64")).toHaveLength(32);
    });

    it("gives different users different material", async () => {
      const notAdminKey = await agent.get("/sync/key").expect(200);
      const adminKey = await adminAgent.get("/sync/key").expect(200);
      expect(notAdminKey.body.keyMaterial).not.toBe(adminKey.body.keyMaterial);
    });
  });

  // Task 9.19: a broadcast-scoped collection contributes no scope clause of its own, so
  // `queryFilter` is the ONLY thing standing between one user's rows and another's. These
  // tests pin sync's read paths to the same visible row set the REST list endpoint serves.
  describe("modelRouter queryFilter parity (Task 9.19)", () => {
    const bannerStream = "routeBanners|all";

    /** Register the banner model for sync + REST with the given queryFilter and re-auth. */
    const setupBanners = async (
      queryFilter: ModelRouterOptions<unknown>["queryFilter"]
    ): Promise<{bannerAgent: TestAgent}> => {
      const bannerOptions = {...authedOptions, queryFilter} as ModelRouterOptions<unknown>;
      clearSyncRegistry();
      registerSync({
        config: {scope: {type: "broadcast"}},
        model: RouteBannerModel as unknown as Model<unknown>,
        options: bannerOptions,
        routePath: "/routeBanners",
      });
      const bannerApp = getBaseServer();
      setupAuth(bannerApp, UserModel as unknown as AuthUserModel);
      addAuthRoutes(bannerApp, UserModel as unknown as AuthUserModel);
      bannerApp.use(
        "/routeBanners",
        modelRouter(RouteBannerModel as unknown as Model<unknown>, bannerOptions)
      );
      new SyncApp().register(bannerApp);
      return {bannerAgent: await authAsUser(bannerApp, "notAdmin")};
    };

    beforeEach(async () => {
      await RouteBannerModel.collection.deleteMany({});
    });

    it("serves the same rows through the snapshot as the REST list endpoint", async () => {
      const {bannerAgent} = await setupBanners(OwnerQueryFilter);
      const mine = await RouteBannerModel.create({name: "mine", ownerId: notAdminId});
      await RouteBannerModel.create({name: "theirs", ownerId: "someoneElse"});

      const rest = await bannerAgent.get("/routeBanners").expect(200);
      const restIds = rest.body.data.map((d: RouteBanner) => String(d._id));
      expect(restIds).toEqual([String(mine._id)]);

      const snapshot = await bannerAgent
        .get(`/sync/snapshot?stream=${encodeURIComponent(bannerStream)}`)
        .expect(200);
      expect(snapshot.body.entities.map((e: SnapshotEntity) => e.id)).toEqual(restIds);
    });

    it("filters GET /sync/entities by the queryFilter", async () => {
      const {bannerAgent} = await setupBanners(OwnerQueryFilter);
      const mine = await RouteBannerModel.create({name: "mine", ownerId: notAdminId});
      const theirs = await RouteBannerModel.create({name: "theirs", ownerId: "someoneElse"});

      const res = await bannerAgent
        .get(`/sync/entities?collection=routeBanners&ids=${mine._id},${theirs._id}`)
        .expect(200);
      expect(res.body.entities).toHaveLength(1);
      expect(res.body.entities[0].id).toBe(String(mine._id));
    });

    it("serves a terminal empty page when the queryFilter denies the caller", async () => {
      const {bannerAgent} = await setupBanners(() => null);
      const banner = await RouteBannerModel.create({name: "hidden", ownerId: notAdminId});

      const snapshot = await bannerAgent
        .get(`/sync/snapshot?stream=${encodeURIComponent(bannerStream)}`)
        .expect(200);
      expect(snapshot.body.entities).toEqual([]);
      expect(snapshot.body.hasMore).toBe(false);

      const entities = await bannerAgent
        .get(`/sync/entities?collection=routeBanners&ids=${banner._id}`)
        .expect(200);
      expect(entities.body.entities).toEqual([]);
    });

    it("denies the read (rather than serving everything) when the queryFilter throws", async () => {
      const {bannerAgent} = await setupBanners(() => {
        throw new Error("queryFilter exploded");
      });
      await RouteBannerModel.create({name: "hidden", ownerId: notAdminId});

      const snapshot = await bannerAgent
        .get(`/sync/snapshot?stream=${encodeURIComponent(bannerStream)}`)
        .expect(200);
      expect(snapshot.body.entities).toEqual([]);
    });

    it("composes a snapshotFilter with the scope clause instead of dropping it", async () => {
      clearSyncRegistry();
      registerSync({
        config: {
          scope: {type: "owner"},
          snapshotFilter: () => ({name: "keep"}),
        },
        model: RouteStuffModel as unknown as Model<unknown>,
        options: authedOptions,
        routePath: "/routeStuff",
      });
      await RouteStuffModel.create({name: "keep", ownerId: notAdminId});
      await RouteStuffModel.create({name: "drop", ownerId: notAdminId});

      const res = await agent
        .get(`/sync/snapshot?stream=${encodeURIComponent(`routeStuff|owner:${notAdminId}`)}`)
        .expect(200);
      expect(res.body.entities.map((e: SnapshotEntity) => e.data.name)).toEqual(["keep"]);
    });
  });
});
