/**
 * Atomic (default) mode of `POST /<route>/bulk`. Isolated because atomic mode needs a Mongo
 * transaction, so `useMongoTopology` swaps the default mongoose connection to an in-memory
 * replica set for this process.
 */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {expectAPIError} from "@terreno/test";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import type TestAgent from "supertest/lib/agent";

import {modelRouter} from "../api";
import {AuditApp} from "../audit/auditApp";
import {flushAuditRecorderForTests, resetAuditRecorderForTests} from "../audit/record";
import {addAuthRoutes, setupAuth, type UserModel as UserMongooseModel} from "../auth";
import {apiUnauthorizedMiddleware} from "../errors";
import {Permissions} from "../permissions";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "../plugins";
import {SyncCounter, SyncMutation} from "../sync/models";
import {clearSyncRegistry, registerSync} from "../sync/registry";
import {SyncApp} from "../sync/syncApp";
import {syncPlugin} from "../sync/syncSeqPlugin";
import {TerrenoApp} from "../terrenoApp";
import {authAsUser, type Food, FoodModel, getBaseServer, setupDb, UserModel} from "../tests";
import {useMongoTopology} from "../tests/mongoTopology";

interface AtomicSynced extends IsDeleted {
  _id: string;
  _syncSeq?: number;
  name: string;
  ownerId: string;
}

const atomicSyncedSchema = new mongoose.Schema<AtomicSynced>({
  _id: {
    default: (): string => new mongoose.Types.ObjectId().toHexString(),
    description: "String id so the doc can be synced",
    type: String,
  },
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", required: true, type: String},
});
atomicSyncedSchema.plugin(isDeletedPlugin);
atomicSyncedSchema.plugin(createdUpdatedPlugin);
atomicSyncedSchema.plugin(syncPlugin);
const AtomicSyncedModel = mongoose.model<AtomicSynced>("AtomicSynced", atomicSyncedSchema);

useMongoTopology({topology: "replicaSet"});

const allPermissions = {
  create: [Permissions.IsAuthenticated],
  delete: [Permissions.IsAuthenticated],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsAuthenticated],
  update: [Permissions.IsAuthenticated],
};

type RouterOptions = Parameters<typeof modelRouter<Food>>[1];

interface BulkEntry {
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
  id?: string;
  index: number;
  method: string;
  status: number;
}

const bulkFoodNames = async (): Promise<string[]> => {
  const docs = await FoodModel.find({name: /^bulk-/}).sort({name: 1});
  return docs.map((doc) => doc.name as string);
};

/** Reads a food with the raw driver, outside any Mongoose transaction context. */
const readFoodOutsideTransaction = async (id: string): Promise<Record<string, unknown> | null> => {
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error("mongoose is not connected");
  }
  return db.collection("foods").findOne({_id: new mongoose.Types.ObjectId(id)});
};

const userIdFor = async (email: string): Promise<mongoose.Types.ObjectId> => {
  const user = await UserModel.findOne({email});
  return (user as unknown as {_id: mongoose.Types.ObjectId})._id;
};

const makeFood = async (
  fields: Partial<Food> & {created?: Date} = {}
): Promise<mongoose.HydratedDocument<Food>> =>
  FoodModel.create({calories: 1, likesIds: [], name: "bulk-old", ...fields} as never);

/** The single route's error body with the failing item's index added to `meta`. */
const withIndex = (body: Record<string, unknown>, index: number): Record<string, unknown> => ({
  ...body,
  meta: {...((body.meta as Record<string, unknown> | undefined) ?? {}), index},
});

describe("modelRouter bulk atomic mode (replica set)", () => {
  let app: express.Application;

  const mountRouter = (
    path: string,
    model: mongoose.Model<never>,
    options: Record<string, unknown>
  ): void => {
    app.use(
      path,
      modelRouter(model, {
        bulk: true,
        permissions: allPermissions,
        ...options,
      } as never)
    );
    app.use(apiUnauthorizedMiddleware);
    // Terminal handler so an unmatched route answers 404 instead of hanging.
    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({title: "Not Found"});
    });
  };

  const mountFood = (options: Partial<RouterOptions> = {}): void => {
    mountRouter("/food", FoodModel as never, options as Record<string, unknown>);
  };

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
    await setupDb();
    await Promise.all([
      FoodModel.deleteMany({}),
      AtomicSyncedModel.deleteMany({}),
      SyncCounter.deleteMany({}),
      SyncMutation.deleteMany({}),
    ]);
    clearSyncRegistry();
    app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserMongooseModel);
    addAuthRoutes(app, UserModel as unknown as UserMongooseModel);
  });

  afterEach(() => {
    clearSyncRegistry();
  });

  it("turns on transactionAsyncLocalStorage on the model's Mongoose instance when bulk is enabled", () => {
    modelRouter(FoodModel, {bulk: true, permissions: allPermissions} as RouterOptions);
    expect(FoodModel.base.get("transactionAsyncLocalStorage")).toBe(true);
  });

  describe("success", () => {
    it("commits 3 creates when the atomic key is absent", async () => {
      mountFood({bulk: true} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
            {body: {name: "bulk-c"}, method: "create"},
          ],
        })
        .expect(200);
      const entries = res.body.data as BulkEntry[];
      expect(entries.map((entry) => entry.status)).toEqual([201, 201, 201]);
      expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2]);
      expect(await bulkFoodNames()).toEqual(["bulk-a", "bulk-b", "bulk-c"]);
    });

    it("treats an explicit atomic:true the same as the default", async () => {
      mountFood({bulk: true} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          atomic: true,
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      expect((res.body.data as BulkEntry[]).map((entry) => entry.status)).toEqual([201, 201]);
      expect(await bulkFoodNames()).toEqual(["bulk-a", "bulk-b"]);
    });

    it("runs postCreate, postUpdate, and postDelete once per item, after the commit", async () => {
      const seenCreate: (string | undefined)[] = [];
      const seenUpdate: (number | undefined)[] = [];
      const seenDelete: (string | null)[] = [];
      mountFood({
        bulk: true,
        postCreate: async (doc: Food) => {
          const committed = await readFoodOutsideTransaction(String(doc._id));
          seenCreate.push(committed?.name as string | undefined);
        },
        postDelete: async (_req: express.Request, doc: Food) => {
          const committed = await readFoodOutsideTransaction(String(doc._id));
          seenDelete.push(committed === null ? null : "still-there");
        },
        postUpdate: async (doc: Food) => {
          const committed = await readFoodOutsideTransaction(String(doc._id));
          seenUpdate.push(committed?.calories as number | undefined);
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userIdFor("notAdmin@example.com");
      const toUpdate = await makeFood({calories: 1, name: "bulk-update", ownerId: owner});
      const toDelete = await makeFood({name: "bulk-delete", ownerId: owner});

      const res = await agent
        .post("/food/bulk")
        .send({
          operations: [
            {body: {name: "bulk-new"}, method: "create"},
            {body: {calories: 42}, id: toUpdate.id, method: "update"},
            {id: toDelete.id, method: "delete"},
          ],
        })
        .expect(200);

      expect((res.body.data as BulkEntry[]).map((entry) => entry.status)).toEqual([201, 200, 204]);
      // Each hook read the raw collection outside the transaction and saw the committed write.
      expect(seenCreate).toEqual(["bulk-new"]);
      expect(seenUpdate).toEqual([42]);
      expect(seenDelete).toEqual([null]);
    });

    it("lets a later item's preCreate see an earlier item's uncommitted create", async () => {
      let foundFromHook: string | null | undefined;
      mountFood({
        bulk: true,
        preCreate: async (body: Partial<Food>) => {
          if (body.name === "bulk-b") {
            const earlier = await FoodModel.findOne({name: "bulk-a"});
            foundFromHook = earlier ? String(earlier._id) : null;
          }
          return body as Food;
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      const entries = res.body.data as BulkEntry[];
      expect(entries.map((entry) => entry.status)).toEqual([201, 201]);
      expect(foundFromHook).toBe(entries[0].id);
    });

    it("keeps both creates and reports post-create-hook-error on the item whose postCreate throws", async () => {
      mountFood({
        bulk: true,
        postCreate: (doc: Food) => {
          if (doc.name === "bulk-b") {
            throw new Error("boom");
          }
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      const entries = res.body.data as BulkEntry[];
      expect(entries[0].status).toBe(201);
      expect(entries[1].status).toBe(400);
      expect(entries[1].error?.code).toBe("post-create-hook-error");
      expect(await bulkFoodNames()).toEqual(["bulk-a", "bulk-b"]);

      const single = await agent.post("/food").send({name: "bulk-b"}).expect(400);
      expect(entries[1].error).toEqual(single.body);
    });
    it("keeps reporting later items when one item's responseHandler throws after the commit", async () => {
      const postCreated: string[] = [];
      mountFood({
        bulk: true,
        postCreate: (doc: Food) => {
          postCreated.push(doc.name as string);
        },
        responseHandler: async (value: unknown) => {
          const doc = value as {name?: string; toJSON: () => Record<string, unknown>};
          if (doc.name === "bulk-a") {
            throw new Error("serializer exploded");
          }
          return doc.toJSON() as never;
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      const entries = res.body.data as BulkEntry[];
      const single = await agent.post("/food").send({name: "bulk-a"});
      expect(entries[0].status).toBe(single.status);
      expect(entries[0].error).toEqual(single.body);
      expect(entries[1].status).toBe(201);
      expect(postCreated).toEqual(["bulk-a", "bulk-b", "bulk-a"]);
      expect(await bulkFoodNames()).toEqual(["bulk-a", "bulk-a", "bulk-b"]);
    });
  });

  describe("abort", () => {
    it("returns 403 with meta.index 1 when preCreate returns null on item 2, and writes nothing", async () => {
      let postCreateCalls = 0;
      mountFood({
        bulk: true,
        postCreate: () => {
          postCreateCalls += 1;
        },
        preCreate: (body: Partial<Food>) => (body.name === "bulk-b" ? null : (body as Food)),
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/food/bulk").send({
        operations: [
          {body: {name: "bulk-a"}, method: "create"},
          {body: {name: "bulk-b"}, method: "create"},
          {body: {name: "bulk-c"}, method: "create"},
        ],
      });

      expectAPIError(res, {status: 403});
      expect(res.body.meta?.index).toBe(1);
      expect(res.body.data).toBeUndefined();
      expect(await bulkFoodNames()).toEqual([]);
      expect(postCreateCalls).toBe(0);

      // The failing item's body is the single route's body plus meta.index.
      const single = await agent.post("/food").send({name: "bulk-b"}).expect(403);
      expect(res.body).toEqual(withIndex(single.body, 1));
    });

    it("records no AuditEvents for an aborted batch", async () => {
      resetAuditRecorderForTests();
      if (mongoose.connection.models.TerrenoAuditEvent) {
        mongoose.connection.deleteModel("TerrenoAuditEvent");
      }
      await mongoose.connection.collection("auditevents").deleteMany({});
      const auditApp = new TerrenoApp({
        skipListen: true,
        userModel: UserModel as unknown as UserMongooseModel,
      })
        .register(new AuditApp())
        .build();
      auditApp.use(
        "/food",
        modelRouter(FoodModel, {
          audit: true,
          bulk: true,
          permissions: allPermissions,
          preCreate: (body: Partial<Food>) => (body.name === "bulk-b" ? null : (body as Food)),
        } as RouterOptions)
      );
      try {
        const agent = await authAsUser(auditApp, "notAdmin");
        const res = await agent.post("/food/bulk").send({
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
            {body: {name: "bulk-c"}, method: "create"},
          ],
        });
        expectAPIError(res, {status: 403});
        expect(res.body.meta?.index).toBe(1);

        await flushAuditRecorderForTests();
        const adminAgent = await authAsUser(auditApp, "admin");
        const list = await adminAgent.get("/audit-events").expect(200);
        expect(list.body.data).toHaveLength(0);
      } finally {
        resetAuditRecorderForTests();
        if (mongoose.connection.models.TerrenoAuditEvent) {
          mongoose.connection.deleteModel("TerrenoAuditEvent");
        }
      }
    });

    it("records one AuditEvent per item only after a committed batch", async () => {
      resetAuditRecorderForTests();
      if (mongoose.connection.models.TerrenoAuditEvent) {
        mongoose.connection.deleteModel("TerrenoAuditEvent");
      }
      await mongoose.connection.collection("auditevents").deleteMany({});
      const auditApp = new TerrenoApp({
        skipListen: true,
        userModel: UserModel as unknown as UserMongooseModel,
      })
        .register(new AuditApp())
        .build();
      auditApp.use(
        "/food",
        modelRouter(FoodModel, {
          audit: true,
          bulk: true,
          permissions: allPermissions,
        } as RouterOptions)
      );
      try {
        const agent = await authAsUser(auditApp, "notAdmin");
        await agent
          .post("/food/bulk")
          .send({
            operations: [
              {body: {name: "bulk-a"}, method: "create"},
              {body: {name: "bulk-b"}, method: "create"},
            ],
          })
          .expect(200);

        await flushAuditRecorderForTests();
        const adminAgent = await authAsUser(auditApp, "admin");
        const list = await adminAgent.get("/audit-events?verb=created").expect(200);
        const names = list.body.data.map((event: {after: {name: string}}) => event.after.name);
        expect(names.sort()).toEqual(["bulk-a", "bulk-b"]);
      } finally {
        resetAuditRecorderForTests();
        if (mongoose.connection.models.TerrenoAuditEvent) {
          mongoose.connection.deleteModel("TerrenoAuditEvent");
        }
      }
    });

    it("returns 403 with meta.index 1 when update B is forbidden, and leaves update A unapplied", async () => {
      mountFood({
        bulk: true,
        permissions: {...allPermissions, update: [Permissions.IsOwner]},
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userIdFor("notAdmin@example.com");
      const other = await userIdFor("admin@example.com");
      const mine = await makeFood({calories: 1, name: "bulk-mine", ownerId: owner});
      const theirs = await makeFood({calories: 1, name: "bulk-theirs", ownerId: other});

      const res = await agent.post("/food/bulk").send({
        operations: [
          {body: {calories: 2}, id: mine.id, method: "update"},
          {body: {calories: 2}, id: theirs.id, method: "update"},
        ],
      });

      expectAPIError(res, {status: 403});
      expect(res.body.meta?.index).toBe(1);
      expect(res.body.data).toBeUndefined();
      expect((await FoodModel.findById(mine.id))?.calories).toBe(1);
      expect((await FoodModel.findById(theirs.id))?.calories).toBe(1);
    });

    it("returns 400 with meta.index 1 for an invalid create after a delete, and keeps the deleted doc", async () => {
      mountFood({bulk: true} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userIdFor("notAdmin@example.com");
      const doomed = await makeFood({name: "bulk-doomed", ownerId: owner});

      const res = await agent.post("/food/bulk").send({
        operations: [
          {id: doomed.id, method: "delete"},
          {body: {eatenBy: ["not-an-object-id"], name: "bulk-invalid"}, method: "create"},
        ],
      });

      expectAPIError(res, {status: 400});
      expect(res.body.meta?.index).toBe(1);
      expect(res.body.meta?.fields).toBeDefined();
      expect(await readFoodOutsideTransaction(doomed.id)).not.toBeNull();
      expect(await bulkFoodNames()).toEqual(["bulk-doomed"]);
    });

    it("rolls back a write a preCreate hook made to another model when a later item aborts", async () => {
      mountFood({
        bulk: true,
        preCreate: async (body: Partial<Food>) => {
          if (body.name === "bulk-a") {
            await UserModel.updateOne(
              {email: "notAdmin@example.com"},
              {$set: {name: "written-by-hook"}}
            );
            return body as Food;
          }
          return null;
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const before = await UserModel.findOne({email: "notAdmin@example.com"});

      const res = await agent.post("/food/bulk").send({
        operations: [
          {body: {name: "bulk-a"}, method: "create"},
          {body: {name: "bulk-b"}, method: "create"},
        ],
      });

      expectAPIError(res, {status: 403});
      expect(res.body.meta?.index).toBe(1);
      const after = await UserModel.findOne({email: "notAdmin@example.com"});
      expect(after?.name).toBe(before?.name as string);
      expect(after?.name).not.toBe("written-by-hook");
      expect(await bulkFoodNames()).toEqual([]);
    });

    it("returns the PATCH 409 body plus meta.index for a stale _updatedAt, and applies no other item", async () => {
      mountFood({bulk: true} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userIdFor("notAdmin@example.com");
      const created = DateTime.fromISO("2024-06-01T12:00:00.000Z").toJSDate();
      const fresh = await makeFood({calories: 1, name: "bulk-fresh", ownerId: owner});
      const stale = await makeFood({
        calories: 1,
        created,
        name: "bulk-stale",
        ownerId: owner,
      } as never);
      const staleAt = "2024-01-01T00:00:00.000Z";

      const single = await agent
        .patch(`/food/${stale.id}`)
        .send({_updatedAt: staleAt, calories: 2})
        .expect(409);

      const res = await agent.post("/food/bulk").send({
        operations: [
          {body: {calories: 5}, id: fresh.id, method: "update"},
          {body: {_updatedAt: staleAt, calories: 2}, id: stale.id, method: "update"},
          {body: {name: "bulk-new"}, method: "create"},
        ],
      });

      expect(res.status).toBe(409);
      expect(res.body).toEqual(withIndex(single.body, 1));
      expect((await FoodModel.findById(fresh.id))?.calories).toBe(1);
      expect((await FoodModel.findById(stale.id))?.calories).toBe(1);
      expect(await FoodModel.countDocuments({name: "bulk-new"})).toBe(0);
    });

    it("returns 409 bulk-transaction-conflict on a transient write conflict, without retrying hooks", async () => {
      let preUpdateCalls = 0;
      mountFood({
        bulk: true,
        preUpdate: async (body: Partial<Food>, req: express.Request) => {
          preUpdateCalls += 1;
          // Write the same doc outside the transaction after its snapshot began, so the
          // transaction's own write to it hits a WriteConflict (TransientTransactionError).
          const db = mongoose.connection.db;
          if (!db) {
            throw new Error("mongoose is not connected");
          }
          await db
            .collection("foods")
            .updateOne(
              {_id: new mongoose.Types.ObjectId(String(req.params.id))},
              {$set: {calories: 99}}
            );
          return body as Food;
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userIdFor("notAdmin@example.com");
      const target = await makeFood({calories: 1, name: "bulk-target", ownerId: owner});

      const res = await agent.post("/food/bulk").send({
        operations: [
          {body: {name: "bulk-new"}, method: "create"},
          {body: {calories: 2}, id: target.id, method: "update"},
        ],
      });

      expectAPIError(res, {code: "bulk-transaction-conflict", status: 409});
      expect(preUpdateCalls).toBe(1);
      expect(await FoodModel.countDocuments({name: "bulk-new"})).toBe(0);
      // Only the hook's out-of-transaction write landed.
      expect((await readFoodOutsideTransaction(target.id))?.calories).toBe(99);
    });
  });

  describe("synced model", () => {
    it("an aborted batch does not stall the sync stream for a later PATCH", async () => {
      const options = {permissions: allPermissions, sync: {scope: {type: "owner"}}};
      registerSync({
        config: {scope: {type: "owner"}},
        model: AtomicSyncedModel as never,
        options: options as never,
        routePath: "/synced",
      });
      new SyncApp().register(app);
      mountRouter("/synced", AtomicSyncedModel as never, options);
      const agent: TestAgent = await authAsUser(app, "notAdmin");
      const owner = (await userIdFor("notAdmin@example.com")).toString();
      const doc = await AtomicSyncedModel.create({name: "synced-a", ownerId: owner});
      const stream = encodeURIComponent(`synced|owner:${owner}`);

      const initial = await agent.get(`/sync/snapshot?stream=${stream}`).expect(200);
      const cursor = initial.body.cursor as number;

      const aborted = await agent.post("/synced/bulk").send({
        operations: [
          {body: {name: "synced-in-batch"}, id: doc.id, method: "update"},
          {body: {ownerId: owner}, method: "create"},
        ],
      });
      expectAPIError(aborted, {status: 400});
      expect(aborted.body.meta?.index).toBe(1);
      expect((await AtomicSyncedModel.findById(doc.id))?.name).toBe("synced-a");

      await agent.patch(`/synced/${doc.id}`).send({name: "synced-patched"}).expect(200);

      const delta = await agent.get(`/sync/snapshot?stream=${stream}&cursor=${cursor}`).expect(200);
      const entity = (delta.body.entities as {data: {name: string} | null; id: string}[]).find(
        (candidate) => candidate.id === doc.id
      );
      expect(entity?.data?.name).toBe("synced-patched");
    });
  });
});
