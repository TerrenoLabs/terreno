import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import {modelRouter, validateModelRouterBody} from "./api";
import {AuditApp} from "./audit/auditApp";
import {flushAuditRecorderForTests, resetAuditRecorderForTests} from "./audit/record";
import {addAuthRoutes, setupAuth, type UserModel as UserMongooseModel} from "./auth";
import {toBulkItemError} from "./bulk";
import {apiUnauthorizedMiddleware, isAPIError} from "./errors";
import {configureOpenApiValidator, resetOpenApiValidatorConfig} from "./openApiValidator";
import {Permissions} from "./permissions";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "./plugins";
import {clearSyncRegistry, registerSync} from "./sync/registry";
import {syncPlugin} from "./sync/syncSeqPlugin";
import {TerrenoApp} from "./terrenoApp";
import {authAsUser, type Food, FoodModel, getBaseServer, setupDb, UserModel} from "./tests";

const allPermissions = {
  create: [Permissions.IsAuthenticated],
  delete: [Permissions.IsAuthenticated],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsAuthenticated],
  update: [Permissions.IsAuthenticated],
};

type RouterOptions = Parameters<typeof modelRouter<Food>>[1];

const volatileKeys = ["_id", "id", "created", "updated", "__v"];

const stripVolatile = (value: Record<string, unknown>): Record<string, unknown> => {
  const copy = {...value};
  for (const key of volatileKeys) {
    delete copy[key];
  }
  return copy;
};

const bulkFoodNames = async (): Promise<string[]> => {
  const docs = await FoodModel.find({name: /^bulk-/}).sort({name: 1});
  return docs.map((doc) => doc.name as string);
};

describe("modelRouter bulk", () => {
  let app: express.Application;
  let server: TestAgent;

  const mountFoodRouter = (options: Partial<RouterOptions>): void => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        permissions: allPermissions,
        ...options,
      } as RouterOptions)
    );
    app.use(apiUnauthorizedMiddleware);
    // Terminal handler so an unmatched route answers 404 instead of hanging.
    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({title: "Not Found"});
    });
  };

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
    await setupDb();
    await FoodModel.deleteMany({});
    app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserMongooseModel);
    addAuthRoutes(app, UserModel as unknown as UserMongooseModel);
    server = supertest(app);
  });

  afterEach(() => {
    resetOpenApiValidatorConfig();
  });

  describe("mounting", () => {
    it("does not mount POST /food/bulk when bulk is not enabled", async () => {
      mountFoodRouter({});
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({atomic: false, operations: [{body: {name: "bulk-a"}, method: "create"}]});
      expect(res.status).toBe(404);
      expect(await bulkFoodNames()).toEqual([]);
    });

    it("does not mount POST /food/bulk when bulk is false", async () => {
      mountFoodRouter({bulk: false} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({atomic: false, operations: [{body: {name: "bulk-a"}, method: "create"}]});
      expect(res.status).toBe(404);
    });

    it("throws at registration when bulk is enabled and collectionActions.bulk exists", () => {
      expect(() =>
        modelRouter(FoodModel, {
          bulk: true,
          collectionActions: {
            bulk: {
              handler: async () => ({count: 1}),
              method: "POST",
              permissions: [Permissions.IsAny],
            },
          },
          permissions: allPermissions,
        } as RouterOptions)
      ).toThrow("collectionAction 'bulk' collides with the bulk endpoint on /bulk");
    });

    it("still allows a bulk collection action when bulk is not enabled", async () => {
      mountFoodRouter({
        allowAnonymous: true,
        collectionActions: {
          bulk: {
            handler: async () => ({count: 1}),
            method: "POST",
            permissions: [Permissions.IsAny],
          },
        },
      });
      const res = await server.post("/food/bulk").send({}).expect(200);
      expect(res.body.data).toEqual({count: 1});
    });

    it("returns 401 without a token on a non-anonymous router", async () => {
      mountFoodRouter({bulk: true} as Partial<RouterOptions>);
      await server
        .post("/food/bulk")
        .send({atomic: false, operations: [{body: {name: "bulk-a"}, method: "create"}]})
        .expect(401);
      expect(await bulkFoodNames()).toEqual([]);
    });
  });

  describe("partial-mode create", () => {
    it("creates each item, returns 201 entries in order, and matches POST /food data", async () => {
      mountFoodRouter({bulk: true} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {calories: 5, name: "bulk-a"}, method: "create"},
            {body: {calories: 6, name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.map((entry: {status: number}) => entry.status)).toEqual([201, 201]);
      expect(res.body.data.map((entry: {index: number}) => entry.index)).toEqual([0, 1]);
      expect(res.body.data.map((entry: {method: string}) => entry.method)).toEqual([
        "create",
        "create",
      ]);
      expect(await bulkFoodNames()).toEqual(["bulk-a", "bulk-b"]);
      expect(res.body.data[0].id).toBe(res.body.data[0].data._id);

      // Test fix (Pick): Food derives `description` from `name`, so compare against a single
      // POST with the same body instead of renaming a differently named doc.
      const single = await agent.post("/food").send({calories: 5, name: "bulk-a"}).expect(201);
      expect(stripVolatile(res.body.data[0].data)).toEqual(stripVolatile(single.body.data));
    });

    it("runs preCreate for every item", async () => {
      mountFoodRouter({
        bulk: true,
        preCreate: (body: Partial<Food>) => ({...body, calories: 14}),
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {calories: 1, name: "bulk-a"}, method: "create"},
            {body: {calories: 2, name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      const docs = await FoodModel.find({name: /^bulk-/});
      expect(docs).toHaveLength(2);
      expect(docs.map((doc) => doc.calories)).toEqual([14, 14]);
    });

    it("reports 403 'Create not allowed' for an item whose preCreate returns null", async () => {
      mountFoodRouter({
        bulk: true,
        preCreate: (body: Partial<Food>) => (body.name === "bulk-b" ? null : body),
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      expect(res.body.data[0].status).toBe(201);
      expect(res.body.data[1].status).toBe(403);
      expect(res.body.data[1].index).toBe(1);
      expect(res.body.data[1].error.title).toBe("Create not allowed");
      expect(await bulkFoodNames()).toEqual(["bulk-a"]);
    });

    it("reports 405 for every item when the user fails the create permission", async () => {
      mountFoodRouter({
        bulk: true,
        permissions: {...allPermissions, create: [Permissions.IsAdmin]},
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      expect(res.body.data.map((entry: {status: number}) => entry.status)).toEqual([405, 405]);
      expect(await bulkFoodNames()).toEqual([]);
    });

    it("reports 405, not a validation 400, for an unpermitted item with a bad body", async () => {
      configureOpenApiValidator({});
      mountFoodRouter({
        bulk: true,
        permissions: {...allPermissions, create: [Permissions.IsAdmin]},
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const single = await agent.post("/food").send({calories: "lots", name: "bulk-a"});
      expect(single.status).toBe(405);
      const res = await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [{body: {calories: "lots", name: "bulk-a"}, method: "create"}],
        })
        .expect(200);
      expect(res.body.data[0].status).toBe(405);
    });

    it("allows an admin to create when create requires IsAdmin", async () => {
      mountFoodRouter({
        bulk: true,
        permissions: {...allPermissions, create: [Permissions.IsAdmin]},
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "admin");
      const res = await agent
        .post("/food/bulk")
        .send({atomic: false, operations: [{body: {name: "bulk-a"}, method: "create"}]})
        .expect(200);
      expect(res.body.data[0].status).toBe(201);
    });

    it("runs postCreate once per created doc in input order", async () => {
      const seen: string[] = [];
      mountFoodRouter({
        bulk: true,
        postCreate: (doc: Food) => {
          seen.push(doc.name as string);
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
            {body: {name: "bulk-c"}, method: "create"},
          ],
        })
        .expect(200);
      expect(seen).toEqual(["bulk-a", "bulk-b", "bulk-c"]);
    });

    it("turns a throwing postCreate into a 400 post-create-hook-error and keeps the write", async () => {
      const failing = {
        bulk: true,
        postCreate: (doc: Food) => {
          if (doc.name === "bulk-b") {
            throw new Error("boom");
          }
        },
      } as Partial<RouterOptions>;
      mountFoodRouter(failing);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      expect(res.body.data[0].status).toBe(201);
      expect(res.body.data[1].status).toBe(400);
      expect(res.body.data[1].error.code).toBe("post-create-hook-error");
      expect(await bulkFoodNames()).toEqual(["bulk-a", "bulk-b"]);

      const single = await agent.post("/food").send({name: "bulk-b"}).expect(400);
      expect(res.body.data[1].error).toEqual(single.body);
    });

    it("matches the single route for a preCreate that throws a plain Error", async () => {
      mountFoodRouter({
        bulk: true,
        preCreate: () => {
          throw new Error("x");
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const single = await agent.post("/food").send({name: "bulk-a"});
      expect(single.status).toBe(400);
      expect(single.body.code).toBe("pre-create-hook-error");
      const res = await agent
        .post("/food/bulk")
        .send({atomic: false, operations: [{body: {name: "bulk-a"}, method: "create"}]})
        .expect(200);
      expect(res.body.data[0].status).toBe(400);
      expect(res.body.data[0].error).toEqual(single.body);
    });

    it("maps a non-APIError thrown past the executor to a 500 entry", async () => {
      mountFoodRouter({
        bulk: true,
        responseHandler: () => {
          throw new Error("serializer exploded");
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({atomic: false, operations: [{body: {name: "bulk-a"}, method: "create"}]})
        .expect(200);
      expect(res.body.data[0].status).toBe(500);
      expect(res.body.data[0].index).toBe(0);
      expect(typeof res.body.data[0].error.title).toBe("string");
    });

    it("reports a Mongoose ValidationError as 400 with meta.fields, matching POST /food", async () => {
      mountFoodRouter({bulk: true} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const single = await agent
        .post("/food")
        .send({eatenBy: ["not-an-object-id"], name: "bulk-a"})
        .expect(400);
      const res = await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {name: "bulk-ok"}, method: "create"},
            {body: {eatenBy: ["not-an-object-id"], name: "bulk-a"}, method: "create"},
          ],
        })
        .expect(200);
      expect(res.body.data[0].status).toBe(201);
      expect(res.body.data[1].status).toBe(400);
      expect(res.body.data[1].error.meta?.fields).toBeDefined();
      expect(res.body.data[1].error).toEqual(single.body);
    });

    it("validates each create body when the OpenAPI validator is configured", async () => {
      configureOpenApiValidator({});
      mountFoodRouter({bulk: true} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      // Test fix (Pick): Food's schema requires `likesIds`, so a valid body must send it.
      const single = await agent
        .post("/food")
        .send({calories: "lots", likesIds: [], name: "bulk-a"});
      expect(single.status).toBe(400);
      const res = await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {calories: 3, likesIds: [], name: "bulk-ok"}, method: "create"},
            {body: {calories: "lots", likesIds: [], name: "bulk-a"}, method: "create"},
          ],
        })
        .expect(200);
      expect(res.body.data[0].status).toBe(201);
      expect(res.body.data[1].status).toBe(400);
      expect(res.body.data[1].error).toEqual(single.body);
      expect(await bulkFoodNames()).toEqual(["bulk-ok"]);
    });
  });

  describe("envelope errors (whole-request 400, nothing written)", () => {
    const post = async (
      options: Partial<RouterOptions>,
      payload: unknown
    ): Promise<supertest.Response> => {
      mountFoodRouter({bulk: true, ...options} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/food/bulk").send(payload as object);
      if (res.status === 400) {
        expect(res.body.code).toBe("bulk-invalid-request");
      }
      return res;
    };

    const createItem = (name: string): {body: {name: string}; method: string} => ({
      body: {name},
      method: "create",
    });

    it("rejects a create item when bulk.methods excludes create", async () => {
      const res = await post({bulk: {methods: ["update"]}} as Partial<RouterOptions>, {
        atomic: false,
        operations: [createItem("bulk-a")],
      });
      expect(res.status).toBe(400);
      expect(await bulkFoodNames()).toEqual([]);
    });

    it("rejects more operations than bulk.maxItems", async () => {
      const res = await post({bulk: {maxItems: 2}} as Partial<RouterOptions>, {
        atomic: false,
        operations: [createItem("bulk-a"), createItem("bulk-b"), createItem("bulk-c")],
      });
      expect(res.status).toBe(400);
      expect(await bulkFoodNames()).toEqual([]);
    });

    it("accepts exactly bulk.maxItems operations", async () => {
      const res = await post({bulk: {maxItems: 2}} as Partial<RouterOptions>, {
        atomic: false,
        operations: [createItem("bulk-a"), createItem("bulk-b")],
      });
      expect(res.status).toBe(200);
      expect(await bulkFoodNames()).toEqual(["bulk-a", "bulk-b"]);
    });

    it("rejects more than 100 operations when bulk is true", async () => {
      const operations = Array.from({length: 101}, (_, i) => createItem(`bulk-${i}`));
      const res = await post({}, {atomic: false, operations});
      expect(res.status).toBe(400);
      expect(await FoodModel.countDocuments({name: /^bulk-/})).toBe(0);
    });

    it("rejects an empty operations array", async () => {
      const res = await post({}, {atomic: false, operations: []});
      expect(res.status).toBe(400);
    });

    it("rejects a missing operations key", async () => {
      const res = await post({}, {atomic: false});
      expect(res.status).toBe(400);
    });

    it("rejects a non-array operations value", async () => {
      const res = await post({}, {atomic: false, operations: {method: "create"}});
      expect(res.status).toBe(400);
    });

    it("rejects an unknown method", async () => {
      const res = await post(
        {},
        {
          atomic: false,
          operations: [{body: {name: "bulk-a"}, method: "upsert"}],
        }
      );
      expect(res.status).toBe(400);
      expect(await bulkFoodNames()).toEqual([]);
    });

    it("rejects update and delete items without an id", async () => {
      const update = await post(
        {},
        {
          atomic: false,
          operations: [{body: {name: "bulk-a"}, method: "update"}],
        }
      );
      expect(update.status).toBe(400);
      const remove = await supertest(app)
        .post("/food/bulk")
        .set("Authorization", `Bearer ${(await login()).token}`)
        .send({atomic: false, operations: [{method: "delete"}]});
      expect(remove.status).toBe(400);
    });

    it("rejects a create item without an object body", async () => {
      const missing = await post({}, {atomic: false, operations: [{method: "create"}]});
      expect(missing.status).toBe(400);
      const notObject = await supertest(app)
        .post("/food/bulk")
        .set("Authorization", `Bearer ${(await login()).token}`)
        .send({atomic: false, operations: [{body: "nope", method: "create"}]});
      expect(notObject.status).toBe(400);
    });

    it("rejects a non-boolean atomic flag", async () => {
      const res = await post({}, {atomic: "false", operations: [createItem("bulk-a")]});
      expect(res.status).toBe(400);
      expect(await bulkFoodNames()).toEqual([]);
    });

    it("does not write earlier valid items when a later item has an envelope error", async () => {
      const res = await post(
        {},
        {
          atomic: false,
          operations: [createItem("bulk-a"), {body: {name: "bulk-b"}, method: "upsert"}],
        }
      );
      expect(res.status).toBe(400);
      expect(await bulkFoodNames()).toEqual([]);
    });

    const login = async (): Promise<{token: string}> => {
      const res = await supertest(app)
        .post("/auth/login")
        .send({email: "notAdmin@example.com", password: "password"})
        .expect(200);
      return {token: res.body.data.token};
    };
  });

  describe("audit", () => {
    afterEach(() => {
      resetAuditRecorderForTests();
      if (mongoose.connection.models.TerrenoAuditEvent) {
        mongoose.connection.deleteModel("TerrenoAuditEvent");
      }
    });

    it("writes one AuditEvent per created doc", async () => {
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
      const agent = await authAsUser(auditApp, "notAdmin");
      await agent
        .post("/food/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {name: "bulk-a"}, method: "create"},
            {body: {name: "bulk-b"}, method: "create"},
          ],
        })
        .expect(200);
      await flushAuditRecorderForTests();
      const adminAgent = await authAsUser(auditApp, "admin");
      const list = await adminAgent.get("/audit-events?verb=created").expect(200);
      expect(list.body.data).toHaveLength(2);
      const labels = list.body.data.map((event: {after: {name: string}}) => event.after.name);
      expect(labels.sort()).toEqual(["bulk-a", "bulk-b"]);
    });
  });
});

describe("validateModelRouterBody", () => {
  beforeEach(() => {
    configureOpenApiValidator({});
  });

  afterEach(() => {
    resetOpenApiValidatorConfig();
  });

  it("returns the body for a valid create", () => {
    // Test fix (Pick): Food's schema requires `likesIds`, so a valid body must send it.
    const cleaned = validateModelRouterBody({
      body: {calories: 3, likesIds: [], name: "bulk-a"},
      method: "create",
      model: FoodModel,
      options: {permissions: allPermissions} as RouterOptions,
    });
    expect(cleaned.name).toBe("bulk-a");
    expect(cleaned.calories).toBe(3);
  });

  it("throws a 400 APIError for a wrong-typed create field", () => {
    let thrown: unknown;
    try {
      // Test fix (Pick): send the required `likesIds` so the 400 comes from `calories`.
      validateModelRouterBody({
        body: {calories: "lots", likesIds: [], name: "bulk-a"},
        method: "create",
        model: FoodModel,
        options: {permissions: allPermissions} as RouterOptions,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isAPIError(thrown)).toBe(true);
    expect((thrown as {status: number}).status).toBe(400);
    expect(JSON.stringify((thrown as {meta?: unknown}).meta)).toContain("calories");
  });

  it("allows a partial body for update", () => {
    const cleaned = validateModelRouterBody({
      body: {calories: 9},
      method: "update",
      model: FoodModel,
      options: {permissions: allPermissions} as RouterOptions,
    });
    expect(cleaned.calories).toBe(9);
  });

  it("returns the body unchanged when validation is disabled for the router", () => {
    const body = {calories: "lots", name: "bulk-a"};
    const cleaned = validateModelRouterBody({
      body,
      method: "create",
      model: FoodModel,
      options: {permissions: allPermissions, validation: false} as RouterOptions,
    });
    expect(cleaned).toEqual(body);
  });
});

describe("toBulkItemError", () => {
  it("maps a non-APIError to the fallthrough 500 body without leaking its message", () => {
    const {body, status} = toBulkItemError(new Error("secret internal detail"));
    expect(status).toBe(500);
    expect(body).toEqual({status: 500, title: "Internal server error"});
  });

  it("maps a Mongoose CastError the way the error middleware does", () => {
    const castError = new mongoose.Error.CastError("ObjectId", "nope", "eatenBy");
    const {status} = toBulkItemError(castError);
    expect(status).toBe(400);
  });
});

interface BulkSoft extends IsDeleted {
  _id: mongoose.Types.ObjectId;
  calories?: number;
  created: Date;
  name: string;
  ownerId?: mongoose.Types.ObjectId;
  updated?: Date;
}

const bulkSoftSchema = new mongoose.Schema<BulkSoft>({
  calories: {description: "Number of calories", type: Number},
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", ref: "User", type: "ObjectId"},
});
bulkSoftSchema.plugin(isDeletedPlugin);
bulkSoftSchema.plugin(createdUpdatedPlugin);
const BulkSoftModel = mongoose.model<BulkSoft>("BulkSoft", bulkSoftSchema);

interface BulkSynced extends IsDeleted {
  _id: string;
  _syncSeq?: number;
  name: string;
  ownerId: string;
}

const bulkSyncedSchema = new mongoose.Schema<BulkSynced>({
  _id: {
    default: (): string => new mongoose.Types.ObjectId().toHexString(),
    description: "String id so the doc can be synced",
    type: String,
  },
  name: {description: "The name of the item", required: true, type: String},
  ownerId: {description: "The user who owns this item", required: true, type: String},
});
bulkSyncedSchema.plugin(isDeletedPlugin);
bulkSyncedSchema.plugin(createdUpdatedPlugin);
bulkSyncedSchema.plugin(syncPlugin);
const BulkSyncedModel = mongoose.model<BulkSynced>("BulkSynced", bulkSyncedSchema);

interface BulkEntry {
  data?: Record<string, unknown>;
  error?: Record<string, unknown>;
  id?: string;
  index: number;
  method: string;
  status: number;
}

describe("partial-mode update and delete", () => {
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
    app.use((_req: express.Request, res: express.Response) => {
      res.status(404).json({title: "Not Found"});
    });
  };

  const mountFood = (options: Partial<RouterOptions> = {}): void => {
    mountRouter("/food", FoodModel as never, options as Record<string, unknown>);
  };

  const userId = async (email: string): Promise<mongoose.Types.ObjectId> => {
    const user = await UserModel.findOne({email});
    return (user as unknown as {_id: mongoose.Types.ObjectId})._id;
  };

  const bulk = async (
    agent: TestAgent,
    path: string,
    operations: unknown[]
  ): Promise<BulkEntry[]> => {
    const res = await agent.post(`${path}/bulk`).send({atomic: false, operations}).expect(200);
    return res.body.data as BulkEntry[];
  };

  const makeFood = async (
    fields: Partial<Food> & {created?: Date} = {}
  ): Promise<mongoose.HydratedDocument<Food>> =>
    FoodModel.create({calories: 1, likesIds: [], name: "bulk-old", ...fields} as never);

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
    await setupDb();
    await Promise.all([
      FoodModel.deleteMany({}),
      BulkSoftModel.deleteMany({}),
      BulkSyncedModel.deleteMany({}),
    ]);
    clearSyncRegistry();
    app = getBaseServer();
    setupAuth(app, UserModel as unknown as UserMongooseModel);
    addAuthRoutes(app, UserModel as unknown as UserMongooseModel);
  });

  afterEach(() => {
    resetOpenApiValidatorConfig();
    clearSyncRegistry();
  });

  describe("update", () => {
    it("updates two docs, runs preUpdate/postUpdate per item, and passes prevValue", async () => {
      const preCalls: string[] = [];
      const postCalls: {calories: number | undefined; prevCalories: number | undefined}[] = [];
      mountFood({
        postUpdate: (doc: Food, _body: Partial<Food>, _req: express.Request, prev: Food) => {
          postCalls.push({calories: doc.calories, prevCalories: prev.calories});
        },
        preUpdate: (body: Partial<Food>) => {
          preCalls.push(String(body.calories));
          return body as Food;
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userId("notAdmin@example.com");
      const a = await makeFood({calories: 1, name: "bulk-a", ownerId: owner} as never);
      const b = await makeFood({calories: 2, name: "bulk-b", ownerId: owner} as never);

      const entries = await bulk(agent, "/food", [
        {body: {calories: 10}, id: a.id, method: "update"},
        {body: {calories: 20}, id: b.id, method: "update"},
      ]);

      expect(entries.map((entry) => entry.status)).toEqual([200, 200]);
      expect(entries.map((entry) => entry.index)).toEqual([0, 1]);
      expect(entries.map((entry) => entry.id)).toEqual([a.id, b.id]);
      expect(entries.map((entry) => entry.method)).toEqual(["update", "update"]);
      expect((await FoodModel.findById(a.id))?.calories).toBe(10);
      expect((await FoodModel.findById(b.id))?.calories).toBe(20);
      expect(preCalls).toEqual(["10", "20"]);
      expect(postCalls).toEqual([
        {calories: 10, prevCalories: 1},
        {calories: 20, prevCalories: 2},
      ]);
    });

    it("returns the same data a PATCH /food/:id returns for the same body", async () => {
      mountFood();
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userId("notAdmin@example.com");
      const doc = await makeFood({name: "bulk-a", ownerId: owner} as never);
      const entries = await bulk(agent, "/food", [
        {body: {calories: 77}, id: doc.id, method: "update"},
      ]);
      const single = await agent.patch(`/food/${doc.id}`).send({calories: 77}).expect(200);
      expect(entries[0].status).toBe(200);
      expect(stripVolatile(entries[0].data as Record<string, unknown>)).toEqual(
        stripVolatile(single.body.data)
      );
    });

    it("reports 403 for an item targeting another user's doc and 200 for the owner's", async () => {
      mountFood({
        permissions: {...allPermissions, update: [Permissions.IsOwner]},
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const mine = await makeFood({
        calories: 1,
        name: "bulk-mine",
        ownerId: await userId("notAdmin@example.com"),
      } as never);
      const theirs = await makeFood({
        calories: 1,
        name: "bulk-theirs",
        ownerId: await userId("admin@example.com"),
      } as never);
      const entries = await bulk(agent, "/food", [
        {body: {calories: 5}, id: theirs.id, method: "update"},
        {body: {calories: 5}, id: mine.id, method: "update"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([403, 200]);
      expect((await FoodModel.findById(theirs.id))?.calories).toBe(1);
      expect((await FoodModel.findById(mine.id))?.calories).toBe(5);
    });

    it("reports 404 for a nonexistent id", async () => {
      mountFood();
      const agent = await authAsUser(app, "notAdmin");
      const missing = new mongoose.Types.ObjectId().toString();
      const single = await agent.patch(`/food/${missing}`).send({calories: 1});
      expect(single.status).toBe(404);
      const entries = await bulk(agent, "/food", [
        {body: {calories: 1}, id: missing, method: "update"},
      ]);
      expect(entries[0].status).toBe(404);
      expect(entries[0].index).toBe(0);
    });

    it("reports the same status as PATCH for a malformed id", async () => {
      mountFood();
      const agent = await authAsUser(app, "notAdmin");
      const single = await agent.patch("/food/not-an-object-id").send({calories: 1});
      const entries = await bulk(agent, "/food", [
        {body: {calories: 1}, id: "not-an-object-id", method: "update"},
      ]);
      expect(entries[0].status).toBe(single.status);
    });

    it("reports 405, not 404, for a nonexistent id when update permission is []", async () => {
      mountFood({permissions: {...allPermissions, update: []}} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const missing = new mongoose.Types.ObjectId().toString();
      const single = await agent.patch(`/food/${missing}`).send({calories: 1});
      expect(single.status).toBe(405);
      const entries = await bulk(agent, "/food", [
        {body: {calories: 1}, id: missing, method: "update"},
      ]);
      expect(entries[0].status).toBe(405);
    });

    it("reports 409 with the PATCH conflict body for a stale _updatedAt, and 200 for a newer one", async () => {
      mountFood();
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userId("notAdmin@example.com");
      const created = DateTime.fromISO("2024-06-01T12:00:00.000Z").toJSDate();
      const doc = await makeFood({calories: 1, created, name: "bulk-a", ownerId: owner} as never);
      const stale = "2024-01-01T00:00:00.000Z";
      const newer = "2025-01-01T00:00:00.000Z";

      const single = await agent
        .patch(`/food/${doc.id}`)
        .send({_updatedAt: stale, calories: 2})
        .expect(409);
      const entries = await bulk(agent, "/food", [
        {body: {_updatedAt: stale, calories: 2}, id: doc.id, method: "update"},
        {body: {_updatedAt: newer, calories: 3}, id: doc.id, method: "update"},
      ]);

      expect(entries[0].status).toBe(409);
      expect(entries[0].error).toEqual(single.body);
      expect(entries[0].error?.error).toBe("Conflict");
      expect(entries[0].error?.message).toBe("Document was modified since your last read");
      expect(entries[1].status).toBe(200);
      expect((await FoodModel.findById(doc.id))?.calories).toBe(3);
    });

    it("reports 400 for an unparseable _updatedAt, matching PATCH", async () => {
      mountFood();
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userId("notAdmin@example.com");
      const doc = await makeFood({name: "bulk-a", ownerId: owner} as never);
      const single = await agent
        .patch(`/food/${doc.id}`)
        .send({_updatedAt: "not-a-date", calories: 2});
      expect(single.status).toBe(400);
      const entries = await bulk(agent, "/food", [
        {body: {_updatedAt: "not-a-date", calories: 2}, id: doc.id, method: "update"},
      ]);
      expect(entries[0].status).toBe(400);
      expect(entries[0].error).toEqual(single.body);
    });

    it("reports 400 with the PATCH body for a wrong-typed field when validation is on", async () => {
      configureOpenApiValidator({});
      mountFood();
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userId("notAdmin@example.com");
      const doc = await makeFood({calories: 1, name: "bulk-a", ownerId: owner} as never);
      const single = await agent.patch(`/food/${doc.id}`).send({calories: "lots"});
      expect(single.status).toBe(400);
      const entries = await bulk(agent, "/food", [
        {body: {calories: "lots"}, id: doc.id, method: "update"},
        {body: {calories: 9}, id: doc.id, method: "update"},
      ]);
      expect(entries[0].status).toBe(400);
      expect(entries[0].error).toEqual(single.body);
      expect(entries[1].status).toBe(200);
      expect((await FoodModel.findById(doc.id))?.calories).toBe(9);
    });

    it("strips deleted:true from an update body on a soft-delete model, as PATCH does", async () => {
      mountRouter("/soft", BulkSoftModel as never, {});
      const agent = await authAsUser(app, "notAdmin");
      const viaPatch = await BulkSoftModel.create({name: "bulk-patch"});
      const viaBulk = await BulkSoftModel.create({name: "bulk-bulk"});
      await agent.patch(`/soft/${viaPatch.id}`).send({deleted: true, name: "bulk-patched"});
      const entries = await bulk(agent, "/soft", [
        {body: {deleted: true, name: "bulk-bulked"}, id: viaBulk.id, method: "update"},
      ]);
      expect(entries[0].status).toBe(200);
      const patched = await BulkSoftModel.findById(viaPatch.id);
      const bulked = await BulkSoftModel.findById(viaBulk.id);
      expect(patched?.deleted).not.toBe(true);
      expect(bulked?.deleted).not.toBe(true);
      expect(bulked?.name).toBe("bulk-bulked");
    });

    it("applies repeated updates to the same id in input order", async () => {
      mountFood();
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userId("notAdmin@example.com");
      const doc = await makeFood({calories: 1, name: "bulk-a", ownerId: owner} as never);
      const entries = await bulk(agent, "/food", [
        {body: {calories: 2}, id: doc.id, method: "update"},
        {body: {calories: 3}, id: doc.id, method: "update"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([200, 200]);
      expect((await FoodModel.findById(doc.id))?.calories).toBe(3);
    });

    it("turns a throwing postUpdate into a 400 post-update-hook-error and keeps the write", async () => {
      mountFood({
        postUpdate: () => {
          throw new Error("boom");
        },
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userId("notAdmin@example.com");
      const doc = await makeFood({calories: 1, name: "bulk-a", ownerId: owner} as never);
      const entries = await bulk(agent, "/food", [
        {body: {calories: 8}, id: doc.id, method: "update"},
      ]);
      expect(entries[0].status).toBe(400);
      expect(entries[0].error?.code).toBe("post-update-hook-error");
      expect((await FoodModel.findById(doc.id))?.calories).toBe(8);
    });

    it("reports 403 'Update not allowed' for an item whose preUpdate returns null", async () => {
      mountFood({
        preUpdate: (body: Partial<Food>) => (body.calories === 99 ? null : (body as Food)),
      } as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const owner = await userId("notAdmin@example.com");
      const doc = await makeFood({calories: 1, name: "bulk-a", ownerId: owner} as never);
      const entries = await bulk(agent, "/food", [
        {body: {calories: 99}, id: doc.id, method: "update"},
        {body: {calories: 5}, id: doc.id, method: "update"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([403, 200]);
      expect((await FoodModel.findById(doc.id))?.calories).toBe(5);
    });
  });

  describe("delete", () => {
    it("soft deletes two docs, returns 204 entries with no data, and runs delete hooks per item", async () => {
      const preCalls: string[] = [];
      const postCalls: string[] = [];
      mountRouter("/soft", BulkSoftModel as never, {
        postDelete: (_req: express.Request, doc: BulkSoft) => {
          postCalls.push(doc.name);
        },
        preDelete: (doc: BulkSoft) => {
          preCalls.push(doc.name);
          return doc;
        },
      });
      const agent = await authAsUser(app, "notAdmin");
      const a = await BulkSoftModel.create({name: "bulk-a"});
      const b = await BulkSoftModel.create({name: "bulk-b"});
      const entries = await bulk(agent, "/soft", [
        {id: a.id, method: "delete"},
        {id: b.id, method: "delete"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([204, 204]);
      expect(entries.map((entry) => entry.id)).toEqual([a.id, b.id]);
      expect(entries.map((entry) => entry.index)).toEqual([0, 1]);
      expect(entries[0].data).toBeUndefined();
      expect(entries[0].error).toBeUndefined();
      expect((await BulkSoftModel.findOne({_id: a.id, deleted: true}))?.deleted).toBe(true);
      expect(await BulkSoftModel.countDocuments({deleted: true})).toBe(2);
      expect(preCalls).toEqual(["bulk-a", "bulk-b"]);
      expect(postCalls).toEqual(["bulk-a", "bulk-b"]);
    });

    it("reports an already soft-deleted doc as the 404 DELETE /:id returns, without rerunning postDelete", async () => {
      const postCalls: string[] = [];
      mountRouter("/soft", BulkSoftModel as never, {
        postDelete: (_req: express.Request, doc: BulkSoft) => {
          postCalls.push(doc.name);
        },
      });
      const agent = await authAsUser(app, "notAdmin");
      const a = await BulkSoftModel.create({name: "bulk-a"});
      const gone = await BulkSoftModel.create({name: "bulk-gone"});
      await agent.delete(`/soft/${gone.id}`).expect(204);
      const single = await agent.delete(`/soft/${gone.id}`);
      expect(single.status).toBe(404);
      postCalls.length = 0;

      const entries = await bulk(agent, "/soft", [
        {id: a.id, method: "delete"},
        {id: a.id, method: "delete"},
        {id: gone.id, method: "delete"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([204, 404, 404]);
      expect(entries[2].error).toEqual(single.body);
      expect(postCalls).toEqual(["bulk-a"]);
    });

    it("reports 405 for every item when delete permission is []", async () => {
      mountRouter("/soft", BulkSoftModel as never, {
        permissions: {...allPermissions, delete: []},
      });
      const agent = await authAsUser(app, "notAdmin");
      const a = await BulkSoftModel.create({name: "bulk-a"});
      const entries = await bulk(agent, "/soft", [{id: a.id, method: "delete"}]);
      expect(entries[0].status).toBe(405);
      expect(await BulkSoftModel.countDocuments({deleted: true})).toBe(0);
    });

    it("reports 403 for another user's doc under IsOwner and 204 for the owner's", async () => {
      mountRouter("/soft", BulkSoftModel as never, {
        permissions: {...allPermissions, delete: [Permissions.IsOwner]},
      });
      const agent = await authAsUser(app, "notAdmin");
      const mine = await BulkSoftModel.create({
        name: "bulk-mine",
        ownerId: await userId("notAdmin@example.com"),
      });
      const theirs = await BulkSoftModel.create({
        name: "bulk-theirs",
        ownerId: await userId("admin@example.com"),
      });
      const entries = await bulk(agent, "/soft", [
        {id: theirs.id, method: "delete"},
        {id: mine.id, method: "delete"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([403, 204]);
      expect(await BulkSoftModel.countDocuments({deleted: true})).toBe(1);
    });

    it("reports 404 for a nonexistent id, matching DELETE", async () => {
      mountRouter("/soft", BulkSoftModel as never, {});
      const agent = await authAsUser(app, "notAdmin");
      const missing = new mongoose.Types.ObjectId().toString();
      const single = await agent.delete(`/soft/${missing}`);
      expect(single.status).toBe(404);
      const entries = await bulk(agent, "/soft", [{id: missing, method: "delete"}]);
      expect(entries[0].status).toBe(404);
    });

    it("reports 403 'Delete not allowed' for an item whose preDelete returns null", async () => {
      mountRouter("/soft", BulkSoftModel as never, {
        preDelete: (doc: BulkSoft) => (doc.name === "bulk-keep" ? null : doc),
      });
      const agent = await authAsUser(app, "notAdmin");
      const keep = await BulkSoftModel.create({name: "bulk-keep"});
      const drop = await BulkSoftModel.create({name: "bulk-drop"});
      const entries = await bulk(agent, "/soft", [
        {id: keep.id, method: "delete"},
        {id: drop.id, method: "delete"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([403, 204]);
      expect(await BulkSoftModel.countDocuments({deleted: true})).toBe(1);
    });

    it("hard deletes on a model without soft delete", async () => {
      mountFood();
      const agent = await authAsUser(app, "notAdmin");
      const doc = await makeFood({name: "bulk-a"});
      const entries = await bulk(agent, "/food", [{id: doc.id, method: "delete"}]);
      expect(entries[0].status).toBe(204);
      expect(await FoodModel.findById(doc.id)).toBeNull();
    });
  });

  describe("mixed", () => {
    it("runs create, update, and delete in one request and returns 201/200/204 in order", async () => {
      mountRouter("/soft", BulkSoftModel as never, {});
      const agent = await authAsUser(app, "notAdmin");
      const toUpdate = await BulkSoftModel.create({name: "bulk-old"});
      const toDelete = await BulkSoftModel.create({name: "bulk-gone"});
      const entries = await bulk(agent, "/soft", [
        {body: {name: "bulk-new"}, method: "create"},
        {body: {name: "bulk-updated"}, id: toUpdate.id, method: "update"},
        {id: toDelete.id, method: "delete"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([201, 200, 204]);
      expect(entries.map((entry) => entry.method)).toEqual(["create", "update", "delete"]);
      expect(entries.map((entry) => entry.index)).toEqual([0, 1, 2]);
      expect((await BulkSoftModel.findById(toUpdate.id))?.name).toBe("bulk-updated");
      expect(await BulkSoftModel.countDocuments({name: "bulk-new"})).toBe(1);
      expect(await BulkSoftModel.countDocuments({deleted: true})).toBe(1);
    });

    it("an update then a delete of the same id both succeed in input order", async () => {
      mountRouter("/soft", BulkSoftModel as never, {});
      const agent = await authAsUser(app, "notAdmin");
      const doc = await BulkSoftModel.create({name: "bulk-a"});
      const entries = await bulk(agent, "/soft", [
        {body: {name: "bulk-b"}, id: doc.id, method: "update"},
        {id: doc.id, method: "delete"},
      ]);
      expect(entries.map((entry) => entry.status)).toEqual([200, 204]);
    });
  });

  describe("audit", () => {
    it("writes one AuditEvent per update and delete item with before/after", async () => {
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
        "/soft",
        modelRouter(
          BulkSoftModel as never,
          {
            audit: true,
            bulk: true,
            permissions: allPermissions,
          } as never
        )
      );
      const agent = await authAsUser(auditApp, "notAdmin");
      const toUpdate = await BulkSoftModel.create({name: "audit-old"});
      const toDelete = await BulkSoftModel.create({name: "audit-gone"});
      await agent
        .post("/soft/bulk")
        .send({
          atomic: false,
          operations: [
            {body: {name: "audit-new"}, id: toUpdate.id, method: "update"},
            {id: toDelete.id, method: "delete"},
          ],
        })
        .expect(200);
      await flushAuditRecorderForTests();
      const adminAgent = await authAsUser(auditApp, "admin");
      const list = await adminAgent.get("/audit-events").expect(200);
      const events = list.body.data as {
        after?: {name?: string};
        before?: {name?: string};
        operation: string;
        recordId: string;
      }[];
      const updated = events.filter((event) => event.operation === "update");
      const deleted = events.filter((event) => event.operation === "delete");
      expect(updated).toHaveLength(1);
      expect(deleted).toHaveLength(1);
      expect(updated[0].recordId).toBe(toUpdate.id);
      expect(updated[0].before?.name).toBe("audit-old");
      expect(updated[0].after?.name).toBe("audit-new");
      expect(deleted[0].recordId).toBe(toDelete.id);
      expect(deleted[0].before?.name).toBe("audit-gone");

      resetAuditRecorderForTests();
      if (mongoose.connection.models.TerrenoAuditEvent) {
        mongoose.connection.deleteModel("TerrenoAuditEvent");
      }
    });
  });

  describe("synced model", () => {
    it("advances _syncSeq on a bulk update and soft-deletes on a bulk delete", async () => {
      const options = {permissions: allPermissions, sync: {scope: {type: "owner"}}};
      registerSync({
        config: {scope: {type: "owner"}},
        model: BulkSyncedModel as never,
        options: options as never,
        routePath: "/synced",
      });
      mountRouter("/synced", BulkSyncedModel as never, options);
      const agent = await authAsUser(app, "notAdmin");
      const owner = (await userId("notAdmin@example.com")).toString();
      const doc = await BulkSyncedModel.create({name: "bulk-a", ownerId: owner});
      const before = (await BulkSyncedModel.findById(doc.id))?._syncSeq;
      expect(typeof before).toBe("number");

      const entries = await bulk(agent, "/synced", [
        {body: {name: "bulk-b"}, id: doc.id, method: "update"},
      ]);
      expect(entries[0].status).toBe(200);
      const afterUpdate = (await BulkSyncedModel.findById(doc.id))?._syncSeq as number;
      expect(afterUpdate).toBeGreaterThan(before as number);

      const deletes = await bulk(agent, "/synced", [{id: doc.id, method: "delete"}]);
      expect(deletes[0].status).toBe(204);
      const tombstone = await BulkSyncedModel.findOne({_id: doc.id, deleted: true});
      expect(tombstone?.deleted).toBe(true);
      expect(tombstone?._syncSeq as number).toBeGreaterThan(afterUpdate);
    });
  });
});
