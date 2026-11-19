/**
 * Atomic `POST /<route>/bulk` on a Mongo without transaction support. Isolated because
 * `useMongoTopology` swaps the default mongoose connection to an in-memory standalone server
 * for this process.
 */
import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {expectAPIError} from "@terreno/test";
import type express from "express";

import {modelRouter} from "../api";
import {addAuthRoutes, setupAuth, type UserModel as UserMongooseModel} from "../auth";
import {apiUnauthorizedMiddleware} from "../errors";
import {resetOpenApiValidatorConfig} from "../openApiValidator";
import {Permissions} from "../permissions";
import {authAsUser, type Food, FoodModel, getBaseServer, setupDb, UserModel} from "../tests";
import {useMongoTopology} from "../tests/mongoTopology";

useMongoTopology({topology: "standalone"});

const allPermissions = {
  create: [Permissions.IsAuthenticated],
  delete: [Permissions.IsAuthenticated],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsAuthenticated],
  update: [Permissions.IsAuthenticated],
};

type RouterOptions = Parameters<typeof modelRouter<Food>>[1];

const unsupportedDetail = /requires a replica set; send atomic:false for per-item writes/;

const bulkFoodNames = async (): Promise<string[]> => {
  const docs = await FoodModel.find({name: /^bulk-/}).sort({name: 1});
  return docs.map((doc) => doc.name as string);
};

describe("modelRouter bulk atomic mode (standalone Mongo)", () => {
  let app: express.Application;

  const mountFood = (options: Partial<RouterOptions> = {}): void => {
    app.use(
      "/food",
      modelRouter(FoodModel, {
        bulk: true,
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
  });

  afterEach(() => {
    resetOpenApiValidatorConfig();
  });

  it("returns 400 bulk-atomic-unsupported with nothing written, and atomic:false still works", async () => {
    let preCreateCalls = 0;
    mountFood({
      preCreate: (body: Partial<Food>) => {
        preCreateCalls += 1;
        return body as Food;
      },
    } as Partial<RouterOptions>);
    const agent = await authAsUser(app, "notAdmin");

    const res = await agent.post("/food/bulk").send({
      operations: [
        {body: {name: "bulk-a"}, method: "create"},
        {body: {name: "bulk-b"}, method: "create"},
      ],
    });

    expectAPIError(res, {code: "bulk-atomic-unsupported", detail: unsupportedDetail, status: 400});
    expect(await bulkFoodNames()).toEqual([]);
    // Detected before any write, so no item's hook ran.
    expect(preCreateCalls).toBe(0);

    const partial = await agent
      .post("/food/bulk")
      .send({
        atomic: false,
        operations: [
          {body: {name: "bulk-a"}, method: "create"},
          {body: {name: "bulk-b"}, method: "create"},
        ],
      })
      .expect(200);
    expect(partial.body.data.map((entry: {status: number}) => entry.status)).toEqual([201, 201]);
    expect(await bulkFoodNames()).toEqual(["bulk-a", "bulk-b"]);
  });

  it("returns 400 bulk-atomic-unsupported for an explicit atomic:true", async () => {
    mountFood();
    const agent = await authAsUser(app, "notAdmin");
    const res = await agent.post("/food/bulk").send({
      atomic: true,
      operations: [{body: {name: "bulk-a"}, method: "create"}],
    });
    expectAPIError(res, {code: "bulk-atomic-unsupported", detail: unsupportedDetail, status: 400});
    expect(await bulkFoodNames()).toEqual([]);
  });

  it("returns 400 bulk-atomic-unsupported without deleting or updating existing docs", async () => {
    mountFood();
    const agent = await authAsUser(app, "notAdmin");
    const keep = await FoodModel.create({calories: 1, likesIds: [], name: "bulk-keep"} as never);
    const edit = await FoodModel.create({calories: 1, likesIds: [], name: "bulk-edit"} as never);

    const res = await agent.post("/food/bulk").send({
      operations: [
        {id: keep.id, method: "delete"},
        {body: {calories: 9}, id: edit.id, method: "update"},
      ],
    });

    expectAPIError(res, {code: "bulk-atomic-unsupported", status: 400});
    expect(await bulkFoodNames()).toEqual(["bulk-edit", "bulk-keep"]);
    expect((await FoodModel.findById(edit.id))?.calories).toBe(1);
  });
});
