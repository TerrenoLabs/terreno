import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import type {Document, HydratedDocument, ObjectId} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import type {ModelRouterOptions} from "./api";
import {modelRouter} from "./api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "./auth";
import {APIError} from "./errors";
import {Permissions} from "./permissions";
import {
  authAsUser,
  type Food,
  FoodModel,
  getBaseServer,
  setupTestData,
  type User,
  UserModel,
} from "./tests";
import {AdminOwnerTransformer, defaultResponseHandler, transform} from "./transformers";

describe("query and transform", () => {
  let notAdmin: HydratedDocument<User>;
  let admin: HydratedDocument<User>;
  let server: TestAgent;
  let app: express.Application;

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";

    const testData = await setupTestData();
    admin = testData.users.admin;
    notAdmin = testData.users.notAdmin;
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
        queryFilter: (user?: {_id: ObjectId | string; admin: boolean}) => {
          if (!user?.admin) {
            return {hidden: {$ne: true}};
          }
          return {};
        },
        transformer: AdminOwnerTransformer<Food>({
          adminReadFields: ["name", "calories", "created", "ownerId"],
          adminWriteFields: ["name", "calories", "created", "ownerId"],
          anonReadFields: ["name"],
          anonWriteFields: [],
          authReadFields: ["name", "calories", "created"],
          authWriteFields: ["name", "calories"],
          ownerReadFields: ["name", "calories", "created", "ownerId"],
          ownerWriteFields: ["name", "calories", "created"],
        }),
      })
    );
    server = supertest(app);
  });

  it("filters list for non-admin", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const foodRes = await agent.get("/food").expect(200);
    expect(foodRes.body.data).toHaveLength(3);
  });

  it("does not filter list for admin", async () => {
    const agent = await authAsUser(app, "admin");
    const foodRes = await agent.get("/food").expect(200);
    expect(foodRes.body.data).toHaveLength(4);
  });

  it("admin read transform", async () => {
    const agent = await authAsUser(app, "admin");
    const foodRes = await agent.get("/food").expect(200);
    expect(foodRes.body.data).toHaveLength(4);
    const spinach = foodRes.body.data.find((food: Food) => food.name === "Spinach");
    expect(spinach.created).toBeDefined();
    expect(spinach.id).toBeDefined();
    expect(spinach.ownerId).toBeDefined();
    expect(spinach.name).toBe("Spinach");
    expect(spinach.calories).toBe(1);
    expect(spinach.hidden).toBeUndefined();
  });

  it("admin write transform", async () => {
    const agent = await authAsUser(app, "admin");
    const foodRes = await agent.get("/food").expect(200);
    const spinach = foodRes.body.data.find((food: Food) => food.name === "Spinach");
    const spinachRes = await agent.patch(`/food/${spinach.id}`).send({name: "Lettuce"}).expect(200);
    expect(spinachRes.body.data.name).toBe("Lettuce");
  });

  it("owner read transform", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const foodRes = await agent.get("/food").expect(200);
    expect(foodRes.body.data).toHaveLength(3);
    const spinach = foodRes.body.data.find((food: Food) => food.name === "Spinach");
    expect(spinach.id).toBeDefined();
    expect(spinach.name).toBe("Spinach");
    expect(spinach.calories).toBe(1);
    expect(spinach.created).toBeDefined();
    expect(spinach.ownerId).toBeDefined();
    expect(spinach.hidden).toBeUndefined();
  });

  it("owner write transform", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const foodRes = await agent.get("/food").expect(200);
    const spinach = foodRes.body.data.find((food: Food) => food.name === "Spinach");
    await agent.patch(`/food/${spinach.id}`).send({ownerId: admin.id}).expect(403);
  });

  it("owner write transform fails", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const foodRes = await agent.get("/food").expect(200);
    const spinach = foodRes.body.data.find((food: Food) => food.name === "Spinach");
    const spinachRes = await agent
      .patch(`/food/${spinach.id}`)
      .send({ownerId: notAdmin.id})
      .expect(403);
    expect(spinachRes.body.title.includes("User of type owner cannot write fields: ownerId")).toBe(
      true
    );
  });

  it("auth read transform", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const foodRes = await agent.get("/food").expect(200);
    expect(foodRes.body.data).toHaveLength(3);
    const spinach = foodRes.body.data.find((food: Food) => food.name === "Spinach");
    expect(spinach.id).toBeDefined();
    expect(spinach.name).toBe("Spinach");
    expect(spinach.calories).toBe(1);
    expect(spinach.created).toBeDefined();
    // Owner, so this is defined.
    expect(spinach.ownerId).toBeDefined();
    expect(spinach.hidden).toBeUndefined();

    const carrots = foodRes.body.data.find((food: Food) => food.name === "Carrots");
    expect(carrots.id).toBeDefined();
    expect(carrots.name).toBe("Carrots");
    expect(carrots.calories).toBe(100);
    expect(carrots.created).toBeDefined();
    // Not owner, so undefined.
    expect(carrots.ownerId).toBeUndefined();
    expect(spinach.hidden).toBeUndefined();
  });

  it("auth write transform", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const foodRes = await agent.get("/food");
    const carrots = foodRes.body.data.find((food: Food) => food.name === "Carrots");
    const carrotRes = await agent.patch(`/food/${carrots.id}`).send({calories: 2000}).expect(200);
    expect(carrotRes.body.data.calories).toBe(2000);
  });

  it("auth write transform fail", async () => {
    const agent = await authAsUser(app, "notAdmin");
    const foodRes = await agent.get("/food");
    const carrots = foodRes.body.data.find((food: Food) => food.name === "Carrots");
    const writeRes = await agent
      .patch(`/food/${carrots.id}`)
      .send({created: "2020-01-01T00:00:00Z"})
      .expect(403);
    expect(writeRes.body.title.includes("User of type auth cannot write fields: created")).toBe(
      true
    );
  });

  it("anon read transform", async () => {
    const res = await server.get("/food");
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.find((f: Food) => f.name === "Spinach")).toBeDefined();
    expect(res.body.data.find((f: Food) => f.name === "Carrots")).toBeDefined();
    expect(res.body.data.find((f: Food) => f.name === "Pizza")).toBeDefined();
  });

  it("anon write transform fails", async () => {
    const foodRes = await server.get("/food");
    const carrots = foodRes.body.data.find((food: Food) => food.name === "Carrots");
    await server.patch(`/food/${carrots.id}`).send({calories: 10}).expect(403);
  });
});

describe("transform (deprecated helper)", () => {
  const mockTransformFn = (obj: Partial<Food>, _method: "create" | "update") => ({
    ...obj,
    name: `${obj.name}_transformed`,
  });

  it("returns data unchanged when no transformer is configured", () => {
    const options = {permissions: {}} as ModelRouterOptions<Food>;
    const data = {name: "Apple"} as Partial<Food>;
    expect(transform(options, data, "create")).toEqual(data);
  });

  it("transforms a single object", () => {
    const options = {
      transformer: {transform: mockTransformFn},
    } as unknown as ModelRouterOptions<Food>;
    const result = transform(options, {name: "Apple"} as Partial<Food>, "create");
    expect((result as Partial<Food>).name).toBe("Apple_transformed");
  });

  it("transforms an array of objects", () => {
    const options = {
      transformer: {transform: mockTransformFn},
    } as unknown as ModelRouterOptions<Food>;
    const data = [{name: "Apple"}, {name: "Banana"}] as Partial<Food>[];
    const result = transform(options, data, "update") as Partial<Food>[];
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("Apple_transformed");
    expect(result[1].name).toBe("Banana_transformed");
  });
});

describe("defaultResponseHandler", () => {
  it("serializes change-stream BSON documents that have no toObject", async () => {
    const options = {permissions: {}} as ModelRouterOptions<Food>;
    const req = {} as express.Request;
    const bsonDoc = {_id: "abc", name: "Pear"} as unknown as Document<unknown, unknown, unknown> &
      Food;
    const result = (await defaultResponseHandler(bsonDoc, "read", req, options)) as Food & {
      id: string;
    };
    expect(result.name).toBe("Pear");
    expect(result.id).toBe("abc");
  });

  it("returns null when doc is null", async () => {
    const options = {permissions: {}} as ModelRouterOptions<Food>;
    const req = {} as express.Request;
    const result = await defaultResponseHandler<Food>(null, "read", req, options);
    expect(result).toBeNull();
  });

  it("throws APIError when serialize throws", async () => {
    const options = {
      transformer: {
        serialize: () => {
          throw new Error("serialize boom");
        },
      },
    } as unknown as ModelRouterOptions<Food>;
    const fakeDoc = {
      _id: "abc",
      toObject: () => ({name: "Apple"}),
    } as unknown as Document<unknown, unknown, unknown> & Food;
    const req = {} as express.Request;

    try {
      await defaultResponseHandler(fakeDoc, "read", req, options);
      expect(true).toBe(false);
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(APIError);
      expect((err as APIError).status).toBe(400);
      expect((err as APIError).title).toContain("Error serializing read response");
    }
  });
});
