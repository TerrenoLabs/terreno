import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import type {Router} from "express";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {type ModelRouterOptions, modelRouter, type OpenApiMiddleware} from "./api";
import type {UserModel as AuthUserModel} from "./auth";
import {
  createOpenApiMiddleware,
  deleteOpenApiMiddleware,
  getOpenApiMiddleware,
  listOpenApiMiddleware,
  patchOpenApiMiddleware,
  readOpenApiMiddleware,
} from "./openApi";
import {Permissions} from "./permissions";
import {TerrenoApp} from "./terrenoApp";
import {type Food, FoodModel, setupDb, UserModel} from "./tests";

const createPassThroughMiddleware = (): express.RequestHandler => (_req, _res, next) => next();

const createOpenApiStub = (
  path: OpenApiMiddleware["path"] = () => createPassThroughMiddleware()
): OpenApiMiddleware => {
  return Object.assign(createPassThroughMiddleware(), {
    component: () => undefined,
    document: {},
    path,
    schema: () => undefined,
  });
};

const asFoodOptions = (
  options?: Partial<ModelRouterOptions<unknown>>
): Partial<ModelRouterOptions<Food>> => {
  return options as unknown as Partial<ModelRouterOptions<Food>>;
};

function getMessageSummaryOpenApiMiddleware(
  options: Partial<ModelRouterOptions<unknown>>
): express.RequestHandler {
  if (!options.openApi) {
    throw new Error("Expected openApi to be configured for test routes");
  }

  return options.openApi.path({
    parameters: [
      {
        in: "query",
        name: "foodIds",
        schema: {
          type: "string",
        },
      },
    ],
    responses: {
      200: {
        content: {
          "application/json": {
            schema: {
              properties: {
                message: {
                  type: "string",
                },
              },
              type: "object",
            },
          },
        },
        description: "Success",
      },
    },
    tags: ["Food"],
  });
}

function addRoutes(router: Router, options?: Partial<ModelRouterOptions<unknown>>): void {
  router.use(
    "/food",
    modelRouter(FoodModel, {
      ...asFoodOptions(options),
      allowAnonymous: true,
      openApiExtraModelProperties: {
        foo: {
          type: "string",
        },
      },
      permissions: {
        create: [Permissions.IsAny],
        delete: [Permissions.IsAny],
        list: [Permissions.IsAny],
        read: [Permissions.IsAny],
        update: [Permissions.IsAny],
      },
      populatePaths: [{path: "ownerId"}, {path: "eatenBy"}],
      queryFields: ["calories"],
    })
  );
  router.use("/food/count", getMessageSummaryOpenApiMiddleware, async (_req, res) => {
    res.json({message: "count"});
  });
}

describe("openApi", () => {
  let server: TestAgent;
  let app: express.Application;

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
    process.env.ENABLE_SWAGGER = "true";

    app = new TerrenoApp({
      configureApp: addRoutes,
      skipListen: true,
      userModel: UserModel as unknown as AuthUserModel,
    }).build();
  });

  it("gets the openapi.json", async () => {
    server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    expect(res.body).toMatchSnapshot();
  });

  it("gets the openapi.json with ETag header", async () => {
    server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).toMatch(/^"[a-f0-9]{16}"$/);
  });

  it("returns 304 when If-None-Match matches ETag", async () => {
    server = supertest(app);

    // First request to get the ETag
    const firstRes = await server.get("/openapi.json").expect(200);
    const etag = firstRes.headers.etag;
    expect(etag).toBeDefined();

    // Second request with If-None-Match header
    const secondRes = await server.get("/openapi.json").set("If-None-Match", etag).expect(304);

    expect(secondRes.body).toEqual({});
    expect(secondRes.headers.etag).toBe(etag);
  });

  it("returns 200 when If-None-Match does not match ETag", async () => {
    server = supertest(app);

    // Request with a different ETag
    const res = await server
      .get("/openapi.json")
      .set("If-None-Match", '"different-etag"')
      .expect(200);

    expect(res.body).toBeDefined();
    expect(res.headers.etag).toBeDefined();
    expect(res.headers.etag).not.toBe('"different-etag"');
  });

  it("gets the swagger ui", async () => {
    server = supertest(app);
    await server.get("/swagger/").expect(200);
  });

  it("gets food with populated paths", async () => {
    server = supertest(app);
    const [_admin, notAdmin] = await setupDb();
    const food = await FoodModel.create({
      name: "test",
      ownerId: notAdmin._id,
    });
    const res = await server.get(`/food/${food._id}`).expect(200);
    expect(res.body.data.ownerId._id).toEqual(notAdmin._id.toString());
  });

  // create a test for a custom express endpoint that doesnt use modelRouter and manually adds it
  // to openapi
  it("gets the openapi.json with custom endpoint", async () => {
    server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    expect(res.body).toMatchSnapshot();
  });

  it("gets the openapi.json and has correct Number query fields", async () => {
    server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    const foodQuery = res.body.paths["/food/"].get.parameters.find((p) => p.name === "calories");

    // Ensure that a Number query field supports gt/gte/lt/lte and just a Number
    expect(foodQuery.schema).toEqual({
      oneOf: [
        {description: "Number of calories in the food", type: "number"},
        {
          properties: {
            $gt: {description: "Number of calories in the food", type: "number"},
            $gte: {description: "Number of calories in the food", type: "number"},
            $lt: {description: "Number of calories in the food", type: "number"},
            $lte: {description: "Number of calories in the food", type: "number"},
          },
          type: "object",
        },
      ],
    });
    expect(foodQuery).toMatchSnapshot();
  });
});

function addRoutesStringQuery(
  router: Router,
  options?: Partial<ModelRouterOptions<unknown>>
): void {
  router.use(
    "/food",
    modelRouter(FoodModel, {
      ...asFoodOptions(options),
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
}

describe("openApi string query fields", () => {
  let server: TestAgent;
  let app: express.Application;

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
    process.env.ENABLE_SWAGGER = "true";

    app = new TerrenoApp({
      configureApp: addRoutesStringQuery,
      skipListen: true,
      userModel: UserModel as unknown as AuthUserModel,
    }).build();
  });

  it("builds an $in array query param for non-numeric query fields", async () => {
    server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    const nameQuery = res.body.paths["/food/"].get.parameters.find((p) => p.name === "name");

    // Non-number/non-datetime fields support equality and $in array matching.
    expect(nameQuery.schema).toEqual({
      oneOf: [
        {description: "The name of the food", type: "string"},
        {
          properties: {
            $in: {items: {type: "string"}, type: "array"},
          },
          type: "object",
        },
      ],
    });
  });
});

function addRoutesPopulate(router: Router, options?: Partial<ModelRouterOptions<unknown>>): void {
  options?.openApi?.component("schemas", "LimitedUser", {
    properties: {
      email: {
        description: "LimitedUser's email",
        type: "string",
      },
      name: {
        description: "LimitedUser's name",
        type: "string",
      },
    },
    type: "object",
  });

  router.use(
    "/food",
    modelRouter(FoodModel, {
      ...asFoodOptions(options),
      allowAnonymous: true,
      openApiExtraModelProperties: {
        foo: {
          type: "string",
        },
      },
      permissions: {
        create: [Permissions.IsAny],
        delete: [Permissions.IsAny],
        list: [Permissions.IsAny],
        read: [Permissions.IsAny],
        update: [Permissions.IsAny],
      },
      populatePaths: [
        {fields: ["name", "email"], path: "ownerId"},
        {
          fields: ["name", "email"],
          openApiComponent: "LimitedUser",
          path: "eatenBy",
        },
        {
          fields: ["name", "email"],
          openApiComponent: "LimitedUser",
          path: "likesIds.userId",
        },
      ],
    })
  );
}

describe("openApi without swagger", () => {
  let server: TestAgent;
  let app: express.Application;

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
    process.env.ENABLE_SWAGGER = "false";

    app = new TerrenoApp({
      configureApp: addRoutes,
      skipListen: true,
      userModel: UserModel as unknown as AuthUserModel,
    }).build();
  });

  it("does not have the swagger ui", async () => {
    server = supertest(app);
    await server.get("/swagger/").expect(404);
  });
});

describe("openApi populate", () => {
  let server: TestAgent;
  let app: express.Application;

  beforeEach(async () => {
    process.env.REFRESH_TOKEN_SECRET = "testsecret1234";

    app = new TerrenoApp({
      configureApp: addRoutesPopulate,
      skipListen: true,
      userModel: UserModel as unknown as AuthUserModel,
    }).build();
  });

  it("gets the openapi.json with populate", async () => {
    server = supertest(app);
    const res = await server.get("/openapi.json").expect(200);
    const properties =
      res.body.paths["/food/{id}"].get.responses["200"].content["application/json"].schema
        .properties;

    // There's no component here, so we automatically generate the limited properties.
    expect(properties.ownerId).toEqual({
      properties: {
        email: {
          type: "string",
        },
        name: {
          description: "The user's display name",
          type: "string",
        },
      },
      type: "object",
    });

    // We only reference the component here, rather than listing each field each time.
    expect(properties.eatenBy).toEqual({
      items: {
        $ref: "#/components/schemas/LimitedUser",
      },
      type: "array",
    });

    expect(properties.likesIds).toEqual({
      description: "User likes for this food",
      items: {
        properties: {
          _id: {
            type: "string",
          },
          likes: {
            description: "Whether the user liked the item",
            type: "boolean",
          },
          userId: {
            $ref: "#/components/schemas/LimitedUser",
          },
        },
        type: "object",
      },
      type: "array",
    });

    // Ensure the component is registered and used.
    expect(res.body.components.schemas.LimitedUser).toEqual({
      properties: {
        email: {
          description: "LimitedUser's email",
          type: "string",
        },
        name: {
          description: "LimitedUser's name",
          type: "string",
        },
      },
      type: "object",
    });

    expect(res.body).toMatchSnapshot();
  });
});

describe("openApi middleware no-op paths", () => {
  it("getOpenApiMiddleware returns noop when openApi not configured", () => {
    const mw = getOpenApiMiddleware(FoodModel, {});
    expect(typeof mw).toBe("function");
    expect(mw.length).toBe(3);
  });

  it("getOpenApiMiddleware returns noop when read permissions are empty", () => {
    const mw = getOpenApiMiddleware(FoodModel, {
      openApi: createOpenApiStub(),
      permissions: {
        create: [],
        delete: [],
        list: [],
        read: [],
        update: [],
      },
    });
    expect(typeof mw).toBe("function");
    expect(mw.length).toBe(3);
  });

  it("listOpenApiMiddleware returns noop when openApi not configured", () => {
    const mw = listOpenApiMiddleware(FoodModel, {});
    expect(mw.length).toBe(3);
  });

  it("listOpenApiMiddleware returns noop when list permissions are empty", () => {
    const mw = listOpenApiMiddleware(FoodModel, {
      openApi: createOpenApiStub(),
      permissions: {
        create: [],
        delete: [],
        list: [],
        read: [],
        update: [],
      },
    });
    expect(mw.length).toBe(3);
  });

  it("listOpenApiMiddleware emits x-terreno-sync when sync is configured", () => {
    let captured: Record<string, unknown> | undefined;
    listOpenApiMiddleware(
      FoodModel,
      {
        openApi: createOpenApiStub((spec?: Record<string, unknown>) => {
          captured = spec;
          return createPassThroughMiddleware();
        }),
        permissions: {
          create: [Permissions.IsAny],
          delete: [Permissions.IsAny],
          list: [Permissions.IsAny],
          read: [Permissions.IsAny],
          update: [Permissions.IsAny],
        },
        sync: {scope: {type: "owner"}},
      },
      "/food"
    );
    expect(captured?.["x-terreno-sync"]).toEqual({collection: "food", scope: "owner"});
  });

  it("listOpenApiMiddleware omits x-terreno-sync when sync is not configured", () => {
    let captured: Record<string, unknown> | undefined;
    listOpenApiMiddleware(FoodModel, {
      openApi: createOpenApiStub((spec?: Record<string, unknown>) => {
        captured = spec;
        return createPassThroughMiddleware();
      }),
      permissions: {
        create: [Permissions.IsAny],
        delete: [Permissions.IsAny],
        list: [Permissions.IsAny],
        read: [Permissions.IsAny],
        update: [Permissions.IsAny],
      },
    });
    expect(captured?.["x-terreno-sync"]).toBeUndefined();
  });

  it("listOpenApiMiddleware falls back to the model collection name without routePath", () => {
    let captured: Record<string, unknown> | undefined;
    listOpenApiMiddleware(FoodModel, {
      openApi: createOpenApiStub((spec?: Record<string, unknown>) => {
        captured = spec;
        return createPassThroughMiddleware();
      }),
      permissions: {
        create: [Permissions.IsAny],
        delete: [Permissions.IsAny],
        list: [Permissions.IsAny],
        read: [Permissions.IsAny],
        update: [Permissions.IsAny],
      },
      sync: {scope: {type: "owner"}},
    });
    expect(captured?.["x-terreno-sync"]).toEqual({
      collection: FoodModel.collection.collectionName,
      scope: "owner",
    });
  });

  it("listOpenApiMiddleware maps tenant and custom sync scopes", () => {
    let captured: Record<string, unknown> | undefined;
    const capturePath = (spec?: Record<string, unknown>): express.RequestHandler => {
      captured = spec;
      return createPassThroughMiddleware();
    };
    const baseOptions: Partial<ModelRouterOptions<Food>> = {
      openApi: createOpenApiStub(capturePath),
      permissions: {
        create: [Permissions.IsAny],
        delete: [Permissions.IsAny],
        list: [Permissions.IsAny],
        read: [Permissions.IsAny],
        update: [Permissions.IsAny],
      },
    };

    listOpenApiMiddleware(
      FoodModel,
      {
        ...baseOptions,
        sync: {scope: {field: "organizationId", type: "tenant"}},
      },
      "/projects"
    );
    expect(captured?.["x-terreno-sync"]).toEqual({collection: "projects", scope: "tenant"});

    listOpenApiMiddleware(
      FoodModel,
      {
        ...baseOptions,
        sync: {scope: () => "workspace"},
      },
      "/notes"
    );
    expect(captured?.["x-terreno-sync"]).toEqual({collection: "notes", scope: "custom"});
  });

  it("createOpenApiMiddleware returns noop when openApi not configured", () => {
    const mw = createOpenApiMiddleware(FoodModel, {});
    expect(mw.length).toBe(3);
  });

  it("createOpenApiMiddleware returns noop when create permissions are empty", () => {
    const mw = createOpenApiMiddleware(FoodModel, {
      openApi: createOpenApiStub(),
      permissions: {
        create: [],
        delete: [],
        list: [],
        read: [],
        update: [],
      },
    });
    expect(mw.length).toBe(3);
  });

  it("patchOpenApiMiddleware returns noop when openApi not configured", () => {
    const mw = patchOpenApiMiddleware(FoodModel, {});
    expect(mw.length).toBe(3);
  });

  it("patchOpenApiMiddleware returns noop when update permissions are empty", () => {
    const mw = patchOpenApiMiddleware(FoodModel, {
      openApi: createOpenApiStub(),
      permissions: {
        create: [],
        delete: [],
        list: [],
        read: [],
        update: [],
      },
    });
    expect(mw.length).toBe(3);
  });

  it("deleteOpenApiMiddleware returns noop when openApi not configured", () => {
    const mw = deleteOpenApiMiddleware(FoodModel, {});
    expect(mw.length).toBe(3);
  });

  it("deleteOpenApiMiddleware returns noop when delete permissions are empty", () => {
    const mw = deleteOpenApiMiddleware(FoodModel, {
      openApi: createOpenApiStub(),
      permissions: {
        create: [],
        delete: [],
        list: [],
        read: [],
        update: [],
      },
    });
    expect(mw.length).toBe(3);
  });

  it("readOpenApiMiddleware returns noop when openApi not configured", () => {
    const mw = readOpenApiMiddleware({}, {}, [], []);
    expect(mw.length).toBe(3);
  });

  it("readOpenApiMiddleware returns noop when read permissions are empty", () => {
    const mw = readOpenApiMiddleware(
      {
        openApi: createOpenApiStub(),
        permissions: {
          create: [],
          delete: [],
          list: [],
          read: [],
          update: [],
        },
      },
      {id: {type: "string"}},
      ["id"],
      []
    );
    expect(mw.length).toBe(3);
  });

  it("readOpenApiMiddleware returns middleware when configured with permissions", () => {
    const pathFn: OpenApiMiddleware["path"] = () => createPassThroughMiddleware();
    const mw = readOpenApiMiddleware(
      {
        openApi: createOpenApiStub(pathFn),
        permissions: {
          create: [],
          delete: [],
          list: [],
          read: [Permissions.IsAny],
          update: [],
        },
      },
      {name: {type: "string"}},
      ["name"],
      [{in: "query", name: "search", schema: {type: "string"}}]
    );
    expect(typeof mw).toBe("function");
  });
});
