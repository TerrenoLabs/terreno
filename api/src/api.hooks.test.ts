import {beforeEach, describe, expect, it, type mock} from "bun:test";
import * as Sentry from "@sentry/bun";
import type express from "express";
import type {HydratedDocument} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {modelRouter} from "./api";
import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "./auth";
import {APIError} from "./errors";
import {Permissions} from "./permissions";
import {
  authAsUser,
  type Food,
  FoodModel,
  getBaseServer,
  setupDb,
  type User,
  UserModel,
} from "./tests";

const captureExceptionMock = Sentry.captureException as unknown as ReturnType<typeof mock>;

describe("pre and post hooks", () => {
  let server: TestAgent;
  let app: express.Application;
  let agent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    app = getBaseServer();
    setupAuth(app, UserModel as unknown as AuthUserModel);
    addAuthRoutes(app, UserModel as unknown as AuthUserModel);
    agent = await authAsUser(app, "notAdmin");
    captureExceptionMock.mockClear?.();
  });

  it("pre hooks change data", async () => {
    let deleteCalled = false;
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
        preCreate: (data) => {
          const food = data as Partial<Food>;
          food.calories = 14;
          return food as Food;
        },
        preDelete: (data) => {
          deleteCalled = true;
          return data;
        },
        preUpdate: (data) => {
          data.calories = 15;
          return data as Food;
        },
      })
    );
    server = supertest(app);

    let res = await server
      .post("/food")
      .send({
        calories: 15,
        name: "Broccoli",
      })
      .expect(201);
    const broccoli = await FoodModel.findById(res.body.data._id);
    if (!broccoli) {
      throw new Error("Broccoli was not created");
    }
    expect(broccoli.name).toBe("Broccoli");
    // Overwritten by the pre create hook
    expect(broccoli.calories).toBe(14);

    res = await server
      .patch(`/food/${broccoli._id}`)
      .send({
        name: "Broccoli2",
      })
      .expect(200);
    expect(res.body.data.name).toBe("Broccoli2");
    // Updated by the pre update hook
    expect(res.body.data.calories).toBe(15);

    await agent.delete(`/food/${broccoli._id}`).expect(204);
    expect(deleteCalled).toBe(true);
  });

  it("pre hooks return null", async () => {
    const notAdmin = await UserModel.findOne({
      email: "notAdmin@example.com",
    });
    const spinach = await FoodModel.create({
      calories: 1,
      created: new Date("2021-12-03T00:00:20.000Z"),
      hidden: false,
      name: "Spinach",
      ownerId: notAdmin?._id,
      source: {
        name: "Brand",
      },
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
        preCreate: () => null,
        preDelete: () => null,
        preUpdate: () => null,
      })
    );
    server = supertest(app);

    const res = await server
      .post("/food")
      .send({
        calories: 15,
        name: "Broccoli",
      })
      .expect(403);
    const broccoli = await FoodModel.findById(res.body._id);
    expect(broccoli).toBeNull();

    await server
      .patch(`/food/${spinach._id}`)
      .send({
        name: "Broccoli",
      })
      .expect(403);
    await server.delete(`/food/${spinach._id}`).expect(403);
  });

  it("post hooks succeed", async () => {
    let deleteCalled = false;
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
        postCreate: async (data) => {
          const food = data as HydratedDocument<Food>;
          food.calories = 14;
          await food.save();
        },
        postDelete: () => {
          deleteCalled = true;
        },
        postUpdate: async (data) => {
          const food = data as HydratedDocument<Food>;
          food.calories = 15;
          await food.save();
        },
      })
    );
    server = supertest(app);

    let res = await server
      .post("/food")
      .send({
        calories: 15,
        name: "Broccoli",
      })
      .expect(201);
    let broccoli = await FoodModel.findById(res.body.data._id);
    if (!broccoli) {
      throw new Error("Broccoli was not created");
    }
    expect(broccoli.name).toBe("Broccoli");
    // Overwritten by the pre create hook
    expect(broccoli.calories).toBe(14);

    res = await server
      .patch(`/food/${broccoli._id}`)
      .send({
        name: "Broccoli2",
      })
      .expect(200);
    broccoli = await FoodModel.findById(res.body.data._id);
    if (!broccoli) {
      throw new Error("Broccoli was not update");
    }
    expect(broccoli.name).toBe("Broccoli2");
    // Updated by the post update hook
    expect(broccoli.calories).toBe(15);

    await agent.delete(`/food/${broccoli._id}`).expect(204);
    expect(deleteCalled).toBe(true);
  });

  it("preCreate hook preserves disableExternalErrorTracking on APIError", async () => {
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
        preCreate: () => {
          throw new APIError({
            disableExternalErrorTracking: true,
            status: 400,
            title: "Custom preCreate error",
          });
        },
      })
    );
    server = supertest(app);

    const res = await server
      .post("/food")
      .send({
        calories: 15,
        name: "Broccoli",
      })
      .expect(400);

    expect(res.body.title).toBe("Custom preCreate error");
    // Serialized when true so the frontend can suppress duplicate Sentry reporting; also
    // suppresses Sentry capture in apiErrorMiddleware.
    expect(res.body.disableExternalErrorTracking).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("preCreate hook preserves disableExternalErrorTracking on non-APIError", async () => {
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
        preCreate: () => {
          const error = Object.assign(new Error("Some custom error"), {
            disableExternalErrorTracking: true,
          });
          throw error;
        },
      })
    );
    server = supertest(app);

    const res = await server
      .post("/food")
      .send({
        calories: 15,
        name: "Broccoli",
      })
      .expect(400);

    expect(res.body.title).toContain("preCreate hook error");
    // Serialized when true so the frontend can suppress duplicate Sentry reporting; also
    // suppresses Sentry capture in apiErrorMiddleware.
    expect(res.body.disableExternalErrorTracking).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("preUpdate hook preserves disableExternalErrorTracking on APIError", async () => {
    const notAdmin = await UserModel.findOne({
      email: "notAdmin@example.com",
    });
    const spinach = await FoodModel.create({
      calories: 1,
      created: new Date("2021-12-03T00:00:20.000Z"),
      hidden: false,
      name: "Spinach",
      ownerId: notAdmin?._id,
      source: {
        name: "Brand",
      },
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
        preUpdate: () => {
          throw new APIError({
            disableExternalErrorTracking: true,
            status: 400,
            title: "Custom preUpdate error",
          });
        },
      })
    );
    server = supertest(app);

    const res = await server
      .patch(`/food/${spinach._id}`)
      .send({
        name: "Broccoli",
      })
      .expect(400);

    expect(res.body.title).toBe("Custom preUpdate error");
    // Serialized when true so the frontend can suppress duplicate Sentry reporting; also
    // suppresses Sentry capture in apiErrorMiddleware.
    expect(res.body.disableExternalErrorTracking).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("preUpdate hook preserves disableExternalErrorTracking on non-APIError", async () => {
    const notAdmin = await UserModel.findOne({
      email: "notAdmin@example.com",
    });
    const spinach = await FoodModel.create({
      calories: 1,
      created: new Date("2021-12-03T00:00:20.000Z"),
      hidden: false,
      name: "Spinach",
      ownerId: notAdmin?._id,
      source: {
        name: "Brand",
      },
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
        preUpdate: () => {
          const error = Object.assign(new Error("Some custom error"), {
            disableExternalErrorTracking: true,
          });
          throw error;
        },
      })
    );
    server = supertest(app);

    const res = await server
      .patch(`/food/${spinach._id}`)
      .send({
        name: "Broccoli",
      })
      .expect(400);

    expect(res.body.title).toContain("preUpdate hook error");
    // Serialized when true so the frontend can suppress duplicate Sentry reporting; also
    // suppresses Sentry capture in apiErrorMiddleware.
    expect(res.body.disableExternalErrorTracking).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it("preDelete hook preserves disableExternalErrorTracking on non-APIError", async () => {
    const notAdmin = await UserModel.findOne({
      email: "notAdmin@example.com",
    });
    const spinach = await FoodModel.create({
      calories: 1,
      created: new Date("2021-12-03T00:00:20.000Z"),
      hidden: false,
      name: "Spinach",
      ownerId: notAdmin?._id,
      source: {
        name: "Brand",
      },
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
        preDelete: () => {
          const error = Object.assign(new Error("Some custom error"), {
            disableExternalErrorTracking: true,
          });
          throw error;
        },
      })
    );
    server = supertest(app);

    const res = await agent.delete(`/food/${spinach._id}`).expect(403);

    expect(res.body.title).toContain("preDelete hook error");
    // Serialized when true so the frontend can suppress duplicate Sentry reporting; also
    // suppresses Sentry capture in apiErrorMiddleware.
    expect(res.body.disableExternalErrorTracking).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});

describe("hook error handling", () => {
  let server: TestAgent;
  let app: express.Application;
  let admin: User;
  let agent: TestAgent;
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
    captureExceptionMock.mockClear?.();
  });

  it("preCreate returning undefined throws error", async () => {
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
        preCreate: () => undefined as unknown as Food,
      })
    );
    server = supertest(app);

    const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(403);
    expect(res.body.title).toBe("Create not allowed");
    expect(res.body.detail).toBe("A body must be returned from preCreate");
  });

  it("preUpdate returning undefined throws error", async () => {
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
        preUpdate: () => undefined as unknown as Food,
      })
    );
    server = supertest(app);

    const res = await server.patch(`/food/${spinach._id}`).send({name: "Kale"}).expect(403);
    expect(res.body.title).toBe("Update not allowed");
    expect(res.body.detail).toBe("A body must be returned from preUpdate");
  });

  it("preDelete returning undefined throws error", async () => {
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
        preDelete: () => undefined as unknown as Food,
      })
    );
    server = supertest(app);
    agent = await authAsUser(app, "notAdmin");

    const res = await agent.delete(`/food/${spinach._id}`).expect(403);
    expect(res.body.title).toBe("Delete not allowed");
    expect(res.body.detail).toBe("A body must be returned from preDelete");
  });

  it("postCreate hook error is handled", async () => {
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
        postCreate: () => {
          throw new Error("postCreate failed");
        },
      })
    );
    server = supertest(app);

    const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(400);
    expect(res.body.title).toContain("postCreate hook error");
  });

  it("postUpdate hook error is handled", async () => {
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
        postUpdate: () => {
          throw new Error("postUpdate failed");
        },
      })
    );
    server = supertest(app);

    const res = await server.patch(`/food/${spinach._id}`).send({name: "Kale"}).expect(400);
    expect(res.body.title).toContain("postUpdate hook error");
  });

  it("postDelete hook error is handled", async () => {
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
        postDelete: () => {
          throw new Error("postDelete failed");
        },
      })
    );
    server = supertest(app);
    agent = await authAsUser(app, "notAdmin");

    const res = await agent.delete(`/food/${spinach._id}`).expect(400);
    expect(res.body.title).toContain("postDelete hook error");
  });

  it("preUpdate returning null throws error", async () => {
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
        preUpdate: () => null,
      })
    );
    server = supertest(app);

    const res = await server.patch(`/food/${spinach._id}`).send({name: "Kale"}).expect(403);
    expect(res.body.title).toBe("Update not allowed");
  });

  it("preDelete returning null throws error", async () => {
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
        preDelete: () => null,
      })
    );
    server = supertest(app);
    agent = await authAsUser(app, "notAdmin");

    const res = await agent.delete(`/food/${spinach._id}`).expect(403);
    expect(res.body.title).toBe("Delete not allowed");
  });

  it("preCreate returning null throws error", async () => {
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
        preCreate: () => null,
      })
    );
    server = supertest(app);

    const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(403);
    expect(res.body.title).toBe("Create not allowed");
  });

  it("preCreate error is handled", async () => {
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
        preCreate: () => {
          throw new Error("preCreate failed");
        },
      })
    );
    server = supertest(app);

    const res = await server.post("/food").send({calories: 15, name: "Broccoli"}).expect(400);
    expect(res.body.title).toContain("preCreate hook error");
  });

  it("preUpdate error is handled", async () => {
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
        preUpdate: () => {
          throw new Error("preUpdate failed");
        },
      })
    );
    server = supertest(app);

    const res = await server.patch(`/food/${spinach._id}`).send({name: "Kale"}).expect(400);
    expect(res.body.title).toContain("preUpdate hook error");
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
    // Serialized when true so the frontend can suppress duplicate Sentry reporting; also
    // suppresses Sentry capture in apiErrorMiddleware.
    expect(res.body.disableExternalErrorTracking).toBe(true);
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });
});
