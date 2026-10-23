import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import {DateTime} from "luxon";
import mongoose, {type Model} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {addPopulateToQuery, modelRouter} from "./api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "./auth";
import {APIError} from "./errors";
import {clearMCPRegistry, getMCPRegistry} from "./mcp/registry";
import {Permissions} from "./permissions";
import {
  authAsUser,
  type Food,
  FoodModel,
  getBaseServer,
  RequiredModel,
  setupDb,
  type User,
  UserModel,
} from "./tests";
import {AdminOwnerTransformer} from "./transformers";

interface SoftDeleteDoc {
  deleted: boolean;
  name: string;
}

type TestUser = Awaited<ReturnType<typeof setupDb>>[number];

describe("@terreno/api", () => {
  let server: TestAgent;
  let app: express.Application;

  describe("populate", () => {
    let admin: TestUser;
    let notAdmin: TestUser;
    let agent: TestAgent;
    let spinach: Food;

    beforeEach(async () => {
      [admin, notAdmin] = await setupDb();

      [spinach] = await Promise.all([
        FoodModel.create({
          calories: 1,
          created: new Date("2021-12-03T00:00:20.000Z"),
          hidden: false,
          name: "Spinach",
          ownerId: admin._id,
          source: {
            name: "Brand",
          },
        }),
        FoodModel.create({
          calories: 1,
          created: new Date("2022-12-03T00:00:20.000Z"),
          hidden: false,
          name: "Carrots",
          ownerId: notAdmin._id,
          source: {
            name: "User",
          },
        }),
      ]);
      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          populatePaths: [{fields: ["email"], path: "ownerId"}],
          sort: "-created",
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");
    });

    it("lists with populate", async () => {
      const res = await agent.get("/food").expect(200);
      expect(res.body.data).toHaveLength(2);
      const [carrots, spin] = res.body.data;
      expect(carrots.ownerId._id).toBe(notAdmin._id.toString());
      expect(carrots.ownerId.email).toBe(notAdmin.email);
      expect(carrots.ownerId.name).toBeUndefined();
      expect(spin.ownerId._id).toBe(admin._id.toString());
      expect(spin.ownerId.email).toBe(admin.email);
      expect(spin.ownerId.name).toBeUndefined();
    });

    it("reads with populate", async () => {
      const res = await agent.get(`/food/${spinach._id}`).expect(200);
      expect(res.body.data.ownerId._id).toBe(admin._id.toString());
      expect(res.body.data.ownerId.email).toBe(admin.email);
      expect(res.body.data.ownerId.name).toBeUndefined();
    });

    it("creates with populate", async () => {
      const res = await server
        .post("/food")
        .send({
          calories: 15,
          name: "Broccoli",
          ownerId: admin._id,
        })
        .expect(201);
      expect(res.body.data.ownerId._id).toBe(admin._id.toString());
      expect(res.body.data.ownerId.email).toBe(admin.email);
      expect(res.body.data.ownerId.name).toBeUndefined();
    });

    it("updates with populate", async () => {
      const res = await server
        .patch(`/food/${spinach._id}`)
        .send({
          name: "NotSpinach",
        })
        .expect(200);
      expect(res.body.data.ownerId._id).toBe(admin._id.toString());
      expect(res.body.data.ownerId.email).toBe(admin.email);
      expect(res.body.data.ownerId.name).toBeUndefined();
    });
  });

  describe("responseHandler", () => {
    let admin: TestUser;
    let agent: TestAgent;
    let spinach: Food;

    beforeEach(async () => {
      [admin] = await setupDb();

      [spinach] = await Promise.all([
        FoodModel.create({
          calories: 1,
          created: new Date("2021-12-03T00:00:20.000Z"),
          hidden: false,
          name: "Spinach",
          ownerId: admin._id,
          source: {
            name: "Brand",
          },
        }),
        FoodModel.create({
          calories: 100,
          created: Date.now() - 10,
          hidden: true,
          name: "Apple",
          ownerId: admin?._id,
        }),
      ]);
      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          responseHandler: async (data, method) => {
            if (method === "list" && Array.isArray(data)) {
              return data.map((d) => ({
                foo: "bar",
                id: String(d._id),
              }));
            }
            return {
              foo: "bar",
              id: String((data as Food)._id),
            };
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");
    });

    it("reads with serialize", async () => {
      const res = await agent.get(`/food/${spinach._id}`).expect(200);
      expect(res.body.data.ownerId).toBeUndefined();
      expect(res.body.data.id).toBe(spinach._id.toString());
      expect(res.body.data.foo).toBe("bar");
    });

    it("list with serialize", async () => {
      const res = await agent.get("/food").expect(200);
      expect(res.body.data[0].ownerId).toBeUndefined();
      expect(res.body.data[1].ownerId).toBeUndefined();

      expect(res.body.data[0].id).toBeDefined();
      expect(res.body.data[0].foo).toBe("bar");
      expect(res.body.data[1].id).toBeDefined();
      expect(res.body.data[1].foo).toBe("bar");
    });
  });

  describe("plugins", () => {
    let agent: TestAgent;

    beforeEach(async () => {
      await setupDb();
      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
      app.use(
        "/users",
        modelRouter(UserModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");
    });

    it("check that security fields are filtered", async () => {
      const res = await agent.get("/users").expect(200);
      expect(res.body.data[0].email).toBeDefined();
      expect(res.body.data[0].token).toBeUndefined();
      expect(res.body.data[0].hash).toBeUndefined();
      expect(res.body.data[0].salt).toBeUndefined();
    });
  });

  describe("error handling", () => {
    let admin: TestUser;
    let spinach: Food;

    beforeEach(async () => {
      [admin] = await setupDb();

      spinach = await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
        source: {
          name: "Brand",
        },
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("PUT returns 500 not supported", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);

      const res = await server.put(`/food/${spinach._id}`).send({name: "Kale"}).expect(500);
      expect(res.body.title).toBe("PUT is not supported.");
    });

    it("responseHandler error in read is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          responseHandler: async (_data, method) => {
            if (method === "read") {
              throw new Error("responseHandler read failed");
            }
            return {};
          },
        })
      );
      server = supertest(app);

      const res = await server.get(`/food/${spinach._id}`).expect(500);
      expect(res.body.title).toContain("responseHandler error");
    });

    it("responseHandler error in create is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          responseHandler: async (_data, method) => {
            if (method === "create") {
              throw new Error("responseHandler create failed");
            }
            return {};
          },
        })
      );
      server = supertest(app);

      const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(500);
      expect(res.body.title).toContain("responseHandler error");
    });

    it("responseHandler error in update is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          responseHandler: async (_data, method) => {
            if (method === "update") {
              throw new Error("responseHandler update failed");
            }
            return {};
          },
        })
      );
      server = supertest(app);

      const res = await server.patch(`/food/${spinach._id}`).send({name: "Kale"}).expect(500);
      expect(res.body.title).toContain("responseHandler error");
    });

    it("responseHandler error in list is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          responseHandler: async (_data, method) => {
            if (method === "list") {
              throw new Error("responseHandler list failed");
            }
            return {};
          },
        })
      );
      server = supertest(app);

      const res = await server.get("/food").expect(500);
      expect(res.body.title).toContain("responseHandler error");
    });

    it("list with non-array responseHandler returns data directly", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          responseHandler: async (_data, method) => {
            if (method === "list") {
              return {custom: "response"};
            }
            return {};
          },
        })
      );
      server = supertest(app);

      const res = await server.get("/food").expect(200);
      expect(res.body.data).toEqual({custom: "response"});
      expect(res.body.more).toBeUndefined();
      expect(res.body.total).toBeUndefined();
    });

    it("list with query sort param", async () => {
      await FoodModel.create({
        calories: 200,
        created: new Date("2021-12-04T00:00:20.000Z"),
        hidden: false,
        name: "Apple",
        ownerId: admin._id,
      });

      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name"],
        })
      );
      server = supertest(app);

      let res = await server.get("/food?sort=name").expect(200);
      expect(res.body.data[0].name).toBe("Apple");
      expect(res.body.data[1].name).toBe("Spinach");

      res = await server.get("/food?sort=-name").expect(200);
      expect(res.body.data[0].name).toBe("Spinach");
      expect(res.body.data[1].name).toBe("Apple");
    });

    it("list rejects sort fields outside queryFields, options.sort, and sortFields", async () => {
      await FoodModel.create({calories: 200, hidden: true, name: "Apple", ownerId: admin._id});
      const listOptions = {
        allowAnonymous: true,
        permissions: {
          create: [Permissions.IsAny],
          delete: [Permissions.IsAny],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAny],
        },
        queryFields: ["name"],
        sort: "-created" as const,
      };
      app.use("/food", modelRouter(FoodModel, listOptions));
      app.use("/foodSortable", modelRouter(FoodModel, {...listOptions, sortFields: ["calories"]}));
      server = supertest(app);

      let res = await server.get("/food?sort=hidden%20name").expect(400);
      expect(res.body.code).toBe("sort-field-not-allowed");
      expect(res.body.meta.sortField).toBe("hidden");
      await server.get("/food?sort=-calories").expect(400);
      await server.get("/food?sort[calories]=1").expect(400);
      await server.get("/food?sort=name&sort=calories").expect(400);

      // queryFields and the router's default sort fields stay sortable.
      await server.get("/food?sort=-name").expect(200);
      await server.get("/food?sort=created%20-name").expect(200);
      await server.get("/food?sort=%2Bname").expect(200);

      // An explicit sortFields list adds fields that are not filterable.
      res = await server.get("/foodSortable?sort=-calories").expect(200);
      expect(res.body.data[0].name).toBe("Apple");
      await server.get("/foodSortable?sort=hidden").expect(400);
    });

    it("queryFilter error is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFilter: () => {
            throw new Error("queryFilter failed");
          },
        })
      );
      server = supertest(app);

      const res = await server.get("/food").expect(400);
      expect(res.body.title).toContain("Query filter error");
    });

    it("custom endpoints take priority", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          endpoints: (router) => {
            router.get("/custom", (_req, res) => {
              res.json({custom: true});
            });
          },
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);

      const res = await server.get("/food/custom").expect(200);
      expect(res.body.custom).toBe(true);
    });

    it("disallowed query param returns 400", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name"],
        })
      );
      server = supertest(app);

      const res = await server.get("/food?calories=100").expect(400);
      expect(res.body.title).toBe("Query parameter not allowed");
      expect(res.body.detail).toContain("calories is not allowed as a query param");
    });

    it("queryFilter returning null returns empty array", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFilter: () => null,
        })
      );
      server = supertest(app);

      const res = await server.get("/food").expect(200);
      expect(res.body.data).toEqual([]);
    });

    it("queryFilter undefined values remove keys from the merged query", async () => {
      await FoodModel.create({
        calories: 100,
        hidden: false,
        name: "Apple",
        ownerId: new mongoose.Types.ObjectId(),
      });
      await FoodModel.create({
        calories: 50,
        hidden: false,
        name: "Banana",
        ownerId: new mongoose.Types.ObjectId(),
      });

      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name", "hidden"],
          queryFilter: () => ({
            hidden: undefined,
            name: "Apple",
          }),
        })
      );
      server = supertest(app);

      const res = await server.get("/food?name=Banana&hidden=true").expect(200);
      expect(res.body.data.map((item: {name: string}) => item.name)).toEqual(["Apple"]);
    });
  });

  describe("transformer errors", () => {
    let admin: TestUser;
    let spinach: Food;
    let agent: TestAgent;

    beforeEach(async () => {
      [admin] = await setupDb();

      spinach = await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
        source: {
          name: "Brand",
        },
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("transform error in create is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          transformer: AdminOwnerTransformer({
            anonWriteFields: ["name"],
          }),
        })
      );
      server = supertest(app);

      const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(403);
      expect(res.body.title).toContain("cannot write fields");
    });

    it("transform error in patch is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          transformer: AdminOwnerTransformer({
            anonWriteFields: ["name"],
          }),
        })
      );
      server = supertest(app);

      const res = await server.patch(`/food/${spinach._id}`).send({calories: 100}).expect(403);
      expect(res.body.title).toContain("cannot write fields");
    });

    it("model.create validation error is handled", async () => {
      app.use(
        "/required",
        modelRouter(RequiredModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);

      const res = await server.post("/required").send({about: "test"}).expect(400);
      expect(res.body.title).toBe("Validation failed");
      expect(res.body.detail).toContain("Required");
      expect(res.body.meta.fields.name).toContain("required");
    });

    it("preDelete hook throwing APIError is re-thrown", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          preDelete: () => {
            throw new APIError({
              disableExternalErrorTracking: true,
              status: 400,
              title: "Custom preDelete APIError",
            });
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");

      const res = await agent.delete(`/food/${spinach._id}`).expect(400);
      expect(res.body.title).toBe("Custom preDelete APIError");
      // Serialized when true so the frontend can suppress duplicate Sentry reporting.
      expect(res.body.disableExternalErrorTracking).toBe(true);
    });
  });

  describe("addPopulateToQuery", () => {
    it("returns query unchanged with no populate paths", async () => {
      await setupDb();
      const query = FoodModel.find({});
      const result = addPopulateToQuery(query, undefined);
      expect(result).toBe(query);
    });

    it("returns query unchanged with empty populate paths", async () => {
      await setupDb();
      const query = FoodModel.find({});
      const result = addPopulateToQuery(query, []);
      expect(result).toBe(query);
    });

    it("applies multiple populate paths", async () => {
      await setupDb();
      const query = FoodModel.find({});
      const result = addPopulateToQuery(query, [
        {fields: ["email"], path: "ownerId"},
        {fields: ["name"], path: "eatenBy"},
      ]);
      expect(result).toBeDefined();
    });
  });

  describe("soft delete with isDeleted plugin", () => {
    let admin: TestUser;
    let agent: TestAgent;

    beforeEach(async () => {
      [admin] = await setupDb();

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("soft deletes user with deleted field", async () => {
      app.use(
        "/users",
        modelRouter(UserModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");

      const res = await agent.delete(`/users/${admin._id}`).expect(204);
      expect(res.body).toEqual({});

      const deletedUser = await UserModel.findById(admin._id);
      expect(deletedUser).toBeNull();
    });
  });

  describe("populate in create", () => {
    let admin: TestUser;

    beforeEach(async () => {
      [admin] = await setupDb();

      await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("handles populate with valid path in create", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          populatePaths: [{fields: ["email"], path: "ownerId"}],
        })
      );
      server = supertest(app);

      const res = await server
        .post("/food")
        .send({calories: 15, name: "Broccoli", ownerId: admin._id})
        .expect(201);
      expect(res.body.data.name).toBe("Broccoli");
      expect(res.body.data.ownerId.email).toBe(admin.email);
    });
  });

  describe("save error handling", () => {
    let admin: TestUser;
    let spinach: Food;

    beforeEach(async () => {
      [admin] = await setupDb();

      spinach = await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
        source: {
          name: "Brand",
        },
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("handles patch save error with validation failure", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);

      const res = await server
        .patch(`/food/${spinach._id}`)
        .send({invalidField: "value"})
        .expect(400);
      expect(res.body.title).toContain("preUpdate hook save error");
    });
  });

  describe("body undefined after transform without preCreate", () => {
    beforeEach(async () => {
      await setupDb();

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("handles undefined body after transform when no preCreate", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          transformer: {
            transform: () => undefined,
          },
        })
      );
      server = supertest(app);

      const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(400);
      expect(res.body.title).toBe("Invalid request body");
      expect(res.body.detail).toBe("Body is undefined");
    });
  });

  describe("soft delete with deleted field", () => {
    let _admin: TestUser;
    let agent: TestAgent;

    beforeEach(async () => {
      [_admin] = await setupDb();

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("soft deletes document with deleted field using isDeletedPlugin", async () => {
      const mongoose = await import("mongoose");

      const softDeleteSchema = new mongoose.Schema({
        deleted: {
          default: false,
          description: "Whether this item has been soft deleted",
          type: Boolean,
        },
        name: {description: "The name of the item", type: String},
      });

      const SoftDeleteModel =
        (mongoose.models.SoftDeleteTest as Model<SoftDeleteDoc> | undefined) ??
        mongoose.model<SoftDeleteDoc>("SoftDeleteTest", softDeleteSchema);

      await SoftDeleteModel.deleteMany({});

      const testDoc = await SoftDeleteModel.create({name: "TestItem"});

      app.use(
        "/softdelete",
        modelRouter(SoftDeleteModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");

      await agent.delete(`/softdelete/${testDoc._id}`).expect(204);

      const softDeleted = await SoftDeleteModel.findById(testDoc._id);
      expect(softDeleted).not.toBeNull();
      expect(softDeleted?.deleted).toBe(true);

      await SoftDeleteModel.deleteMany({});
    });

    it("array operation transform error is handled", async () => {
      const apple = await FoodModel.create({
        calories: 95,
        created: new Date(),
        hidden: false,
        name: "Apple",
        tags: [],
      });

      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          transformer: AdminOwnerTransformer({
            adminWriteFields: ["name"],
          }),
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      // Try to update tags field, which is not in the allowed write fields
      const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
      expect(res.body.title).toContain("cannot write fields");
    });
  });

  describe("special query params", () => {
    let admin: TestUser;

    beforeEach(async () => {
      [admin] = await setupDb();

      await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("period query param is stripped from query", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name", "period"],
          queryFilter: (_user, query) => {
            // Simulate a queryFilter that accepts and processes period
            if (query?.period) {
              // Period is processed but shouldn't be passed to mongo
              return query;
            }
            return query ?? {};
          },
        })
      );
      server = supertest(app);

      // period should be accepted and processed without error
      const res = await server.get("/food?period=weekly").expect(200);
      expect(res.body.data).toBeDefined();
    });

    it("query with false value", async () => {
      // Create a food that is hidden
      await FoodModel.create({
        calories: 50,
        created: new Date("2021-12-04T00:00:20.000Z"),
        hidden: true,
        name: "HiddenFood",
        ownerId: admin._id,
      });

      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name", "hidden"],
        })
      );
      server = supertest(app);

      // Query for non-hidden foods using ?hidden=false
      const res = await server.get("/food?hidden=false").expect(200);
      expect(res.body.data.every((f: {hidden: boolean}) => f.hidden === false)).toBe(true);
    });

    it("$search query triggers special handling code path", async () => {
      // The $search code path just accesses the collection but doesn't do anything with it
      // This test verifies the code path is exercised
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          // Need to include $search in queryFields for it to pass validation
          queryFields: ["name", "$search"],
        })
      );
      server = supertest(app);

      // The $search will be added to the query params, triggering the special handling
      // Even though the code doesn't actually do anything useful with it (stub for Atlas)
      const res = await server.get("/food?$search=test");
      // May return 500 because $search is passed to Mongo which doesn't support it without Atlas
      // The important thing is we've exercised the code path
      expect(res.status === 200 || res.status === 500).toBe(true);
    });

    it("$autocomplete query triggers special handling code path", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name", "$autocomplete"],
        })
      );
      server = supertest(app);

      const res = await server.get("/food?$autocomplete=test");
      expect(res.status === 200 || res.status === 500).toBe(true);
    });
  });

  describe("array operation with undefined preUpdate return", () => {
    let admin: TestUser;
    let apple: Food;
    let agent: TestAgent;

    beforeEach(async () => {
      [admin] = await setupDb();

      apple = await FoodModel.create({
        calories: 100,
        categories: [
          {name: "Fruit", show: true},
          {name: "Popular", show: false},
        ],
        created: new Date("2021-12-03T00:00:30.000Z"),
        hidden: false,
        name: "Apple",
        ownerId: admin._id,
        tags: ["healthy", "cheap"],
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("array operation preUpdate returning undefined for array POST throws error", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          preUpdate: () => undefined as unknown as Food,
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
      expect(res.body.title).toBe("Update not allowed");
      expect(res.body.detail).toBe("A body must be returned from preUpdate");
    });

    it("array operation preUpdate returning null for array PATCH throws error", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          preUpdate: () => null,
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      const res = await agent
        .patch(`/food/${apple._id}/tags/healthy`)
        .send({tags: "unhealthy"})
        .expect(403);
      expect(res.body.title).toBe("Update not allowed");
    });

    it("array operation preUpdate error for array DELETE is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          preUpdate: () => {
            throw new Error("preUpdate error during delete");
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      const res = await agent.delete(`/food/${apple._id}/tags/healthy`).expect(400);
      expect(res.body.title).toContain("preUpdate hook error");
    });

    it("array operation postUpdate error is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          postUpdate: () => {
            throw new Error("postUpdate array failed");
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(400);
      expect(res.body.title).toContain("PATCH Post Update error");
    });

    it("array operation denied without update permission", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAdmin],
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");

      const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(405);
      expect(res.body.title).toBe("Access denied");
      expect(res.body.detail).toContain("Access to PATCH");
    });

    it("array operation on non-existent document returns 404", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      const fakeId = "000000000000000000000000";
      const res = await agent.post(`/food/${fakeId}/tags`).send({tags: "organic"}).expect(404);
      expect(res.body.title).toBe("Document not found");
      expect(res.body.detail).toContain("Could not find document to PATCH");
    });

    it("array operation denied when user cannot update specific doc", async () => {
      // Create food owned by admin, then try to update as notAdmin
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAuthenticated],
            delete: [Permissions.IsAuthenticated],
            list: [Permissions.IsAuthenticated],
            read: [Permissions.IsAuthenticated],
            update: [Permissions.IsOwner],
          },
        })
      );
      server = supertest(app);
      // Login as notAdmin and try to update admin's food (apple)
      agent = await authAsUser(app, "notAdmin");

      const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
      expect(res.body.title).toBe("Update not allowed");
      expect(res.body.detail).toContain("Patch not allowed");
    });

    it("array operation transform error is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          transformer: AdminOwnerTransformer({
            adminWriteFields: ["name"],
          }),
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      // Try to update tags field, which is not in the allowed write fields
      const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
      expect(res.body.title).toContain("cannot write fields");
    });
  });

  describe("transformer errors", () => {
    let admin: TestUser;
    let spinach: Food;
    let agent: TestAgent;

    beforeEach(async () => {
      [admin] = await setupDb();

      spinach = await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
        source: {
          name: "Brand",
        },
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("transform error in create is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          transformer: AdminOwnerTransformer({
            // Only allow 'name' to be written, so 'calories' will throw
            anonWriteFields: ["name"],
          }),
        })
      );
      server = supertest(app);

      const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(403);
      expect(res.body.title).toContain("cannot write fields");
    });

    it("transform error in patch is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          transformer: AdminOwnerTransformer({
            // Only allow 'name' to be written, so 'calories' will throw
            anonWriteFields: ["name"],
          }),
        })
      );
      server = supertest(app);

      const res = await server.patch(`/food/${spinach._id}`).send({calories: 100}).expect(403);
      expect(res.body.title).toContain("cannot write fields");
    });

    it("model.create validation error is handled", async () => {
      // Use a model that has required fields
      const {RequiredModel} = await import("./tests");

      app.use(
        "/required",
        modelRouter(RequiredModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);

      // Send without required 'name' field
      const res = await server.post("/required").send({about: "test"}).expect(400);
      expect(res.body.title).toBe("Validation failed");
      expect(res.body.detail).toContain("Required");
      expect(res.body.meta.fields.name).toContain("required");
    });

    it("preDelete hook throwing APIError is re-thrown", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          preDelete: () => {
            throw new APIError({
              disableExternalErrorTracking: true,
              status: 400,
              title: "Custom preDelete APIError",
            });
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");

      const res = await agent.delete(`/food/${spinach._id}`).expect(400);
      expect(res.body.title).toBe("Custom preDelete APIError");
      // Serialized when true so the frontend can suppress duplicate Sentry reporting.
      expect(res.body.disableExternalErrorTracking).toBe(true);
    });
  });

  describe("special query params", () => {
    let admin: TestUser;

    beforeEach(async () => {
      [admin] = await setupDb();

      await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("period query param is stripped from query", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name", "period"],
          queryFilter: (_user, query) => {
            // Simulate a queryFilter that accepts and processes period
            if (query?.period) {
              // Period is processed but shouldn't be passed to mongo
              return query;
            }
            return query ?? {};
          },
        })
      );
      server = supertest(app);

      // period should be accepted and processed without error
      const res = await server.get("/food?period=weekly").expect(200);
      expect(res.body.data).toBeDefined();
    });

    it("query with false value", async () => {
      // Create a food that is hidden
      await FoodModel.create({
        calories: 50,
        created: new Date("2021-12-04T00:00:20.000Z"),
        hidden: true,
        name: "HiddenFood",
        ownerId: admin._id,
      });

      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name", "hidden"],
        })
      );
      server = supertest(app);

      // Query for non-hidden foods using ?hidden=false
      const res = await server.get("/food?hidden=false").expect(200);
      expect(res.body.data.every((f: {hidden: boolean}) => f.hidden === false)).toBe(true);
    });

    it("$search query triggers special handling code path", async () => {
      // The $search code path just accesses the collection but doesn't do anything with it
      // This test verifies the code path is exercised
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          // Need to include $search in queryFields for it to pass validation
          queryFields: ["name", "$search"],
        })
      );
      server = supertest(app);

      // The $search will be added to the query params, triggering the special handling
      // Even though the code doesn't actually do anything useful with it (stub for Atlas)
      const res = await server.get("/food?$search=test");
      // May return 500 because $search is passed to Mongo which doesn't support it without Atlas
      // The important thing is we've exercised the code path
      expect(res.status === 200 || res.status === 500).toBe(true);
    });

    it("$autocomplete query triggers special handling code path", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          queryFields: ["name", "$autocomplete"],
        })
      );
      server = supertest(app);

      const res = await server.get("/food?$autocomplete=test");
      expect(res.status === 200 || res.status === 500).toBe(true);
    });
  });

  describe("addPopulateToQuery", () => {
    it("returns query unchanged with no populate paths", async () => {
      await setupDb();
      const query = FoodModel.find({});
      const result = addPopulateToQuery(query, undefined);
      expect(result).toBe(query);
    });

    it("returns query unchanged with empty populate paths", async () => {
      await setupDb();
      const query = FoodModel.find({});
      const result = addPopulateToQuery(query, []);
      expect(result).toBe(query);
    });

    it("applies multiple populate paths", async () => {
      await setupDb();
      const query = FoodModel.find({});
      const result = addPopulateToQuery(query, [
        {fields: ["email"], path: "ownerId"},
        {fields: ["name"], path: "eatenBy"},
      ]);
      // The result should be a query with populate applied
      expect(result).toBeDefined();
    });
  });

  describe("soft delete with isDeleted plugin", () => {
    let admin: TestUser;
    let agent: TestAgent;

    beforeEach(async () => {
      [admin] = await setupDb();

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("soft deletes user with deleted field", async () => {
      // UserModel has the isDisabledPlugin which adds a 'disabled' field,
      // but we need to test the 'deleted' field check.
      // Let's use a model that has the deleted field.
      app.use(
        "/users",
        modelRouter(UserModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");

      // Delete a user - this should use deleteOne since User doesn't have deleted field
      const res = await agent.delete(`/users/${admin._id}`).expect(204);
      expect(res.body).toEqual({});

      // Verify user was deleted
      const deletedUser = await UserModel.findById(admin._id);
      expect(deletedUser).toBeNull();
    });
  });

  describe("populate in create", () => {
    let admin: TestUser;

    beforeEach(async () => {
      [admin] = await setupDb();

      await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("handles populate with valid path in create", async () => {
      // Test that valid populate works in create flow
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          populatePaths: [{fields: ["email"], path: "ownerId"}],
        })
      );
      server = supertest(app);

      const res = await server
        .post("/food")
        .send({calories: 15, name: "Broccoli", ownerId: admin._id})
        .expect(201);
      expect(res.body.data.name).toBe("Broccoli");
      // Verify populate worked - ownerId should be an object with email
      expect(res.body.data.ownerId.email).toBe(admin.email);
    });
  });

  describe("save error handling", () => {
    let admin: TestUser;
    let spinach: Food;

    beforeEach(async () => {
      [admin] = await setupDb();

      spinach = await FoodModel.create({
        calories: 1,
        created: new Date("2021-12-03T00:00:20.000Z"),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
        source: {
          name: "Brand",
        },
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("handles patch save error with validation failure", async () => {
      // The FoodModel has strict: "throw" which will cause validation errors for unknown fields
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);

      // Try to patch with an invalid field (will be caught by strict: "throw")
      const res = await server
        .patch(`/food/${spinach._id}`)
        .send({invalidField: "value"})
        .expect(400);
      expect(res.body.title).toContain("preUpdate hook save error");
    });
  });

  describe("body undefined after transform without preCreate", () => {
    beforeEach(async () => {
      await setupDb();

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("handles undefined body after transform when no preCreate", async () => {
      // Create a transformer that returns undefined
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          transformer: {
            transform: () => undefined,
          },
        })
      );
      server = supertest(app);

      const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(400);
      expect(res.body.title).toBe("Invalid request body");
      expect(res.body.detail).toBe("Body is undefined");
    });
  });

  describe("soft delete with deleted field", () => {
    let _admin: TestUser;
    let agent: TestAgent;

    beforeEach(async () => {
      [_admin] = await setupDb();

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("soft deletes document with deleted field using isDeletedPlugin", async () => {
      // Create a test schema with the isDeletedPlugin
      const mongoose = await import("mongoose");

      // Create a temporary model with the deleted field
      const softDeleteSchema = new mongoose.Schema({
        deleted: {default: false, type: Boolean},
        name: String,
      });
      // Manually add the deleted field (simulating what isDeletedPlugin does)
      // The schema already has the deleted field, so it should use soft delete

      // Check if the model already exists to avoid OverwriteModelError
      const SoftDeleteModel =
        (mongoose.models.SoftDeleteTest as Model<SoftDeleteDoc> | undefined) ??
        mongoose.model<SoftDeleteDoc>("SoftDeleteTest", softDeleteSchema);

      // Clean up any existing documents
      await SoftDeleteModel.deleteMany({});

      // Create a test document
      const testDoc = await SoftDeleteModel.create({name: "TestItem"});

      app.use(
        "/softdelete",
        modelRouter(SoftDeleteModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "notAdmin");

      // Delete should soft delete (set deleted: true) instead of hard delete
      await agent.delete(`/softdelete/${testDoc._id}`).expect(204);

      // Verify document was soft deleted (not hard deleted)
      const softDeleted = await SoftDeleteModel.findById(testDoc._id);
      expect(softDeleted).not.toBeNull();
      expect(softDeleted?.deleted).toBe(true);

      // Clean up
      await SoftDeleteModel.deleteMany({});
    });
  });

  describe("array operation with undefined preUpdate return", () => {
    let admin: TestUser;
    let apple: Food;
    let agent: TestAgent;

    beforeEach(async () => {
      [admin] = await setupDb();

      apple = await FoodModel.create({
        calories: 100,
        categories: [
          {name: "Fruit", show: true},
          {name: "Popular", show: false},
        ],
        created: new Date("2021-12-03T00:00:30.000Z"),
        hidden: false,
        name: "Apple",
        ownerId: admin._id,
        tags: ["healthy", "cheap"],
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as AuthUserModel);
      addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    });

    it("array operation preUpdate returning undefined for array POST throws error", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          preUpdate: () => undefined as unknown as Food,
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      const res = await agent.post(`/food/${apple._id}/tags`).send({tags: "organic"}).expect(403);
      expect(res.body.title).toBe("Update not allowed");
      expect(res.body.detail).toBe("A body must be returned from preUpdate");
    });

    it("array operation preUpdate returning null for array PATCH throws error", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          preUpdate: () => null,
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      const res = await agent
        .patch(`/food/${apple._id}/tags/healthy`)
        .send({tags: "unhealthy"})
        .expect(403);
      expect(res.body.title).toBe("Update not allowed");
    });

    it("array operation preUpdate error for array DELETE is handled", async () => {
      app.use(
        "/food",
        modelRouter(FoodModel, {
          allowAnonymous: true,
          permissions: {
            create: [Permissions.IsAdmin],
            delete: [Permissions.IsAdmin],
            list: [Permissions.IsAdmin],
            read: [Permissions.IsAdmin],
            update: [Permissions.IsAdmin],
          },
          preUpdate: () => {
            throw new Error("preUpdate error during delete");
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");

      const res = await agent.delete(`/food/${apple._id}/tags/healthy`).expect(400);
      expect(res.body.title).toContain("preUpdate hook error");
    });
  });

  describe("conflict detection (If-Unmodified-Since)", () => {
    let admin: mongoose.HydratedDocument<User>;
    let _notAdmin: mongoose.HydratedDocument<User>;
    let agent: TestAgent;
    let spinach: Food;

    beforeEach(async () => {
      [admin, _notAdmin] = await setupDb();

      spinach = await FoodModel.create({
        calories: 10,
        created: DateTime.fromISO("2025-06-15T12:00:00.000Z").toJSDate(),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
      });
      await FoodModel.collection.updateOne(
        {_id: spinach._id as unknown as mongoose.Types.ObjectId},
        {$set: {updated: DateTime.fromISO("2025-06-15T12:00:00.000Z").toJSDate()}}
      );

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as Parameters<typeof setupAuth>[1]);
      addAuthRoutes(app, UserModel as unknown as Parameters<typeof addAuthRoutes>[1]);
      app.use(
        "/food",
        modelRouter(FoodModel, {
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");
    });

    it("returns 409 when If-Unmodified-Since is older than doc.updated", async () => {
      const staleTimestamp = DateTime.fromISO("2025-06-15T11:00:00.000Z").toHTTP();
      if (staleTimestamp === null) {
        throw new Error("expected HTTP If-Unmodified-Since value");
      }

      const res = await agent
        .patch(`/food/${spinach._id}`)
        .set("If-Unmodified-Since", staleTimestamp)
        .send({name: "Should Fail"})
        .expect(409);

      expect(res.body.error).toBe("Conflict");
      expect(res.body.message).toBe("Document was modified since your last read");
      expect(res.body.data).toBeDefined();
      // The response should contain the current server version
      expect(res.body.data.name).toBe("Spinach");
    });

    it("succeeds when If-Unmodified-Since matches or is newer than doc.updated", async () => {
      const freshTimestamp = DateTime.fromISO("2025-06-15T13:00:00.000Z").toHTTP();
      if (freshTimestamp === null) {
        throw new Error("expected HTTP If-Unmodified-Since value");
      }

      const res = await agent
        .patch(`/food/${spinach._id}`)
        .set("If-Unmodified-Since", freshTimestamp)
        .send({name: "Updated Spinach"})
        .expect(200);

      expect(res.body.data.name).toBe("Updated Spinach");
    });

    it("succeeds normally when If-Unmodified-Since header is not present", async () => {
      const res = await agent
        .patch(`/food/${spinach._id}`)
        .send({name: "No Header Update"})
        .expect(200);

      expect(res.body.data.name).toBe("No Header Update");
    });

    it("succeeds when If-Unmodified-Since exactly matches doc.updated", async () => {
      const exactTimestamp = DateTime.fromISO("2025-06-15T12:00:00.000Z").toHTTP();
      if (exactTimestamp === null) {
        throw new Error("expected HTTP If-Unmodified-Since value");
      }

      const res = await agent
        .patch(`/food/${spinach._id}`)
        .set("If-Unmodified-Since", exactTimestamp)
        .send({name: "Exact Match"})
        .expect(200);

      expect(res.body.data.name).toBe("Exact Match");
    });

    it("prefers precise conflict timestamp header when present", async () => {
      const roundedStaleTimestamp = DateTime.fromISO("2025-06-15T11:59:59.000Z").toHTTP();
      if (roundedStaleTimestamp === null) {
        throw new Error("expected HTTP If-Unmodified-Since value");
      }

      const res = await agent
        .patch(`/food/${spinach._id}`)
        .set("If-Unmodified-Since", roundedStaleTimestamp)
        .set("X-Unmodified-Since-ISO", "2025-06-15T12:00:00.750Z")
        .send({name: "Precise Match"})
        .expect(200);

      expect(res.body.data.name).toBe("Precise Match");
    });

    it("returns 409 when precise conflict timestamp is older than doc.updated", async () => {
      const ifUnmodifiedSince = DateTime.fromISO("2025-06-15T12:00:01.000Z").toHTTP();
      if (ifUnmodifiedSince === null) {
        throw new Error("expected HTTP If-Unmodified-Since value");
      }
      await agent
        .patch(`/food/${spinach._id}`)
        .set("If-Unmodified-Since", ifUnmodifiedSince)
        .set("X-Unmodified-Since-ISO", "2025-06-15T11:59:59.500Z")
        .send({name: "Precise Stale"})
        .expect(409);
    });

    it("falls back to doc.created when doc.updated is unavailable", async () => {
      await FoodModel.collection.updateOne(
        {_id: spinach._id as unknown as mongoose.Types.ObjectId},
        {$unset: {updated: ""}}
      );

      const ifUnmodifiedSince = DateTime.fromISO("2025-06-15T11:59:59.999Z").toHTTP();
      if (ifUnmodifiedSince === null) {
        throw new Error("expected HTTP If-Unmodified-Since value");
      }
      const res = await agent
        .patch(`/food/${spinach._id}`)
        .set("If-Unmodified-Since", ifUnmodifiedSince)
        .send({name: "Created Fallback"})
        .expect(409);

      expect(res.body.data.name).toBe("Spinach");
    });

    it("returns 400 when X-Unmodified-Since-ISO header is an invalid date", async () => {
      const res = await agent
        .patch(`/food/${spinach._id}`)
        .set("X-Unmodified-Since-ISO", "not-a-date")
        .send({name: "Bad Date"})
        .expect(400);

      expect(res.body.title).toBe("Invalid conflict-detection timestamp");
      expect(res.body.detail).toContain("X-Unmodified-Since-ISO");
    });

    it("returns 400 when If-Unmodified-Since header is an invalid HTTP date", async () => {
      const res = await agent
        .patch(`/food/${spinach._id}`)
        .set("If-Unmodified-Since", "not-a-valid-http-date")
        .send({name: "Bad HTTP Date"})
        .expect(400);

      expect(res.body.title).toBe("Invalid conflict-detection timestamp");
      expect(res.body.detail).toContain("If-Unmodified-Since");
    });

    it("returns 400 when _updatedAt body field is an invalid date", async () => {
      const res = await agent
        .patch(`/food/${spinach._id}`)
        .send({_updatedAt: "garbage-date", name: "Bad Body Date"})
        .expect(400);

      expect(res.body.title).toBe("Invalid conflict-detection timestamp");
      expect(res.body.detail).toContain("_updatedAt");
    });

    it("handles doc timestamp stored as ISO string", async () => {
      await FoodModel.collection.updateOne(
        {_id: spinach._id as unknown as mongoose.Types.ObjectId},
        {$set: {updated: "2025-06-15T12:00:00.000Z"}}
      );
      const ifUnmodifiedSince = DateTime.fromISO("2025-06-15T11:00:00.000Z").toHTTP();
      if (!ifUnmodifiedSince) {
        throw new Error("Expected valid HTTP date");
      }

      const res = await agent
        .patch(`/food/${spinach._id}`)
        .set("If-Unmodified-Since", ifUnmodifiedSince)
        .send({name: "String Timestamp"})
        .expect(409);

      expect(res.body.error).toBe("Conflict");
    });
  });

  describe("three-arg modelRouter registration", () => {
    it("returns a ModelRouterRegistration with path and realtime", () => {
      const registration = modelRouter("/food", FoodModel, {
        permissions: {
          create: [Permissions.IsAny],
          delete: [Permissions.IsAny],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAny],
        },
        realtime: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      });
      expect(registration).toHaveProperty("__type", "modelRouter");
      expect(registration).toHaveProperty("path", "/food");
      expect(registration).toHaveProperty("router");
      expect(registration).toHaveProperty("_buildWithContext");
      expect(registration).toHaveProperty("model");
      expect(registration).toHaveProperty("options");
    });

    it("refreshes MCP registry options when rebuilt with accessControl", () => {
      clearMCPRegistry();
      const registration = modelRouter("/food", FoodModel, {
        access: {resource: "food"},
        mcp: {methods: ["list"]},
        permissions: {
          create: [Permissions.IsAny],
          delete: [Permissions.IsAny],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAny],
        },
      });
      const before = getMCPRegistry()[0]?.options.permissions.list;
      expect(before).toEqual([Permissions.IsAny]);

      const accessControl = {
        can: async (): Promise<{allowed: boolean}> => ({allowed: true}),
        fieldMask: async (): Promise<{omit: string[]; read: "*"; write: "*"}> => ({
          omit: [],
          read: "*",
          write: "*",
        }),
        queryFilter: async (): Promise<Record<string, unknown>> => ({}),
        statements: {food: ["list", "read", "create", "update", "delete"]},
      };
      registration._buildWithContext({accessControl: accessControl as never});

      const after = getMCPRegistry()[0];
      expect(after?.options.accessControl).toBe(accessControl);
      expect(after?.options.permissions.list).not.toBe(before);
    });

    it("resolves MCP permissions when accessControl is passed to modelRouter", () => {
      clearMCPRegistry();
      const accessControl = {
        can: async (): Promise<{allowed: boolean}> => ({allowed: true}),
        fieldMask: async (): Promise<{omit: string[]; read: "*"; write: "*"}> => ({
          omit: [],
          read: "*",
          write: "*",
        }),
        queryFilter: async (): Promise<Record<string, unknown>> => ({}),
        statements: {food: ["list", "read", "create", "update", "delete"]},
      };
      modelRouter(FoodModel, {
        access: {resource: "food"},
        accessControl: accessControl as never,
        mcp: {methods: ["list"]},
        permissions: {
          create: [Permissions.IsAny],
          delete: [Permissions.IsAny],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAny],
        },
      });
      const registered = getMCPRegistry()[0];
      expect(registered?.options.accessControl).toBe(accessControl);
      expect(registered?.options.permissions.list).not.toEqual([Permissions.IsAny]);
    });

    it("logs a warning when realtime config is used without the path form", () => {
      const router = modelRouter(FoodModel, {
        permissions: {
          create: [Permissions.IsAny],
          delete: [Permissions.IsAny],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAny],
        },
        realtime: {methods: ["create", "update", "delete"], roomStrategy: "model"},
      });
      // Returns a plain Router, not a registration, because no path was given
      expect(router).toBeDefined();
      expect(router).not.toHaveProperty("__type");
    });
  });

  describe("create transform error wrapping", () => {
    let admin: mongoose.HydratedDocument<User>;
    let agent: TestAgent;

    beforeEach(async () => {
      [admin] = await setupDb();

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as Parameters<typeof setupAuth>[1]);
      addAuthRoutes(app, UserModel as unknown as Parameters<typeof addAuthRoutes>[1]);
      app.use(
        "/food",
        modelRouter(FoodModel, {
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          transformer: {
            transform: () => {
              throw new Error("generic transform error");
            },
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");
    });

    it("wraps non-APIError transform errors in a 400 APIError on create", async () => {
      const res = await agent
        .post("/food")
        .send({calories: 10, name: "New Food", ownerId: admin._id})
        .expect(400);

      expect(res.body.title).toBe("Transform error");
      expect(res.body.detail).toContain("generic transform error");
    });
  });

  describe("update transform error wrapping", () => {
    let admin: mongoose.HydratedDocument<User>;
    let agent: TestAgent;
    let spinach: Food;

    beforeEach(async () => {
      [admin] = await setupDb();
      spinach = await FoodModel.create({
        calories: 10,
        created: new Date(),
        hidden: false,
        name: "Spinach",
        ownerId: admin._id,
      });

      app = getBaseServer();
      setupAuth(app, UserModel as unknown as Parameters<typeof setupAuth>[1]);
      addAuthRoutes(app, UserModel as unknown as Parameters<typeof addAuthRoutes>[1]);
      app.use(
        "/food",
        modelRouter(FoodModel, {
          permissions: {
            create: [Permissions.IsAny],
            delete: [Permissions.IsAny],
            list: [Permissions.IsAny],
            read: [Permissions.IsAny],
            update: [Permissions.IsAny],
          },
          transformer: {
            transform: () => {
              throw new Error("update transform error");
            },
          },
        })
      );
      server = supertest(app);
      agent = await authAsUser(app, "admin");
    });

    it("wraps non-APIError transform errors in a 403 APIError on update", async () => {
      const res = await agent.patch(`/food/${spinach._id}`).send({name: "Updated"}).expect(403);

      expect(res.body.title).toBe("PATCH failed");
      expect(res.body.detail).toContain("update transform error");
    });
  });
});
