import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
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

  describe("atomic flag (until atomic mode lands)", () => {
    it("returns 501 bulk-atomic-not-implemented when atomic is absent and writes nothing", async () => {
      mountFoodRouter({bulk: true} as Partial<RouterOptions>);
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent
        .post("/food/bulk")
        .send({operations: [{body: {name: "bulk-a"}, method: "create"}]})
        .expect(501);
      expect(res.body.code).toBe("bulk-atomic-not-implemented");
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
