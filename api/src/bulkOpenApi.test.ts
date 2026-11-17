import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import supertest from "supertest";
import {type ModelRouterOptions, modelRouter} from "./api";
import type {UserModel as AuthUserModel} from "./auth";
import {Permissions} from "./permissions";
import {TerrenoApp} from "./terrenoApp";
import {type Food, FoodModel, UserModel} from "./tests";

// biome-ignore lint/suspicious/noExplicitAny: OpenAPI documents are traversed dynamically
type Json = any;

const allowAll = {
  create: [Permissions.IsAny],
  delete: [Permissions.IsAny],
  list: [Permissions.IsAny],
  read: [Permissions.IsAny],
  update: [Permissions.IsAny],
};

const buildSpec = async (bulk?: ModelRouterOptions<Food>["bulk"]): Promise<Json> => {
  process.env.REFRESH_TOKEN_SECRET = "testsecret1234";
  process.env.ENABLE_SWAGGER = "true";
  const app = new TerrenoApp({
    configureApp: (router, appOptions) => {
      router.use(
        "/food",
        modelRouter(FoodModel, {
          ...(appOptions as Partial<ModelRouterOptions<Food>>),
          allowAnonymous: true,
          ...(bulk === undefined ? {} : {bulk}),
          permissions: allowAll,
        } as Partial<ModelRouterOptions<Food>> as ModelRouterOptions<Food>)
      );
    },
    skipListen: true,
    userModel: UserModel as unknown as AuthUserModel,
  }).build() as express.Application;
  const res = await supertest(app).get("/openapi.json").expect(200);
  return res.body;
};

// Resolves local $refs so assertions do not depend on whether a schema is inlined or shared.
const resolve = (spec: Json, node: Json, depth = 0): Json => {
  if (depth > 12 || node === null || typeof node !== "object") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map((item) => resolve(spec, item, depth + 1));
  }
  if (typeof node.$ref === "string") {
    const target = node.$ref
      .replace(/^#\//, "")
      .split("/")
      .reduce((acc: Json, key: string) => acc?.[key], spec);
    return resolve(spec, target, depth + 1);
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, resolve(spec, value, depth + 1)])
  );
};

const bulkPost = (spec: Json): Json => spec.paths["/food/bulk"].post;
const requestSchema = (spec: Json): Json =>
  resolve(spec, bulkPost(spec).requestBody.content["application/json"].schema);
const okSchema = (spec: Json): Json =>
  resolve(spec, bulkPost(spec).responses["200"].content["application/json"].schema);

describe("bulk OpenAPI", () => {
  let spec: Json;

  describe("bulk: true", () => {
    beforeEach(async () => {
      spec = await buildSpec(true);
    });

    it("documents POST /food/bulk with the {tag}_bulk operationId", () => {
      expect(spec.paths["/food/bulk"].post).toBeDefined();
      // Tag is the collection name ("foods"), as for actions (`${tag}_${actionName}`).
      expect(bulkPost(spec).tags).toEqual(["foods"]);
      expect(bulkPost(spec).operationId).toBe("foods_bulk");
    });

    it("lists create, update, delete in the method enum", () => {
      const method = requestSchema(spec).properties.operations.items.properties.method;
      expect(method.enum).toEqual(["create", "update", "delete"]);
    });

    it("documents the request envelope", () => {
      const schema = requestSchema(spec);
      expect(schema.properties.atomic.type).toBe("boolean");
      expect(schema.properties.operations.type).toBe("array");
      expect(schema.required).toContain("operations");
      expect(schema.required ?? []).not.toContain("atomic");
      const item = schema.properties.operations.items;
      expect(item.required).toContain("method");
      expect(Object.keys(item.properties)).toEqual(
        expect.arrayContaining(["method", "id", "body"])
      );
    });

    it("item body carries the model's writable fields", () => {
      const body = requestSchema(spec).properties.operations.items.properties.body;
      expect(JSON.stringify(body)).toContain('"calories"');
      expect(JSON.stringify(body)).toContain('"name"');
    });

    it("documents maxItems as the default 100", () => {
      expect(requestSchema(spec).properties.operations.maxItems).toBe(100);
    });

    it("200 is {data: result[]} with data typed as the model response", () => {
      const schema = okSchema(spec);
      expect(schema.properties.data.type).toBe("array");
      const entry = schema.properties.data.items;
      expect(Object.keys(entry.properties)).toEqual(
        expect.arrayContaining(["index", "method", "id", "status", "data"])
      );
      expect(JSON.stringify(entry.properties.data)).toContain('"calories"');
    });

    it("400 and 401 use the standard APIError schema", () => {
      const responses = bulkPost(spec).responses;
      expect(responses["400"]).toBeDefined();
      expect(responses["401"]).toBeDefined();
      expect(responses["400"].content["application/json"].schema.$ref).toBe(
        "#/components/schemas/APIError"
      );
      expect(responses["401"].content["application/json"].schema.$ref).toBe(
        "#/components/schemas/APIError"
      );
    });
  });

  it("bulk: {methods: ['update']} narrows the enum to update", async () => {
    spec = await buildSpec({methods: ["update"]});
    const method = requestSchema(spec).properties.operations.items.properties.method;
    expect(method.enum).toEqual(["update"]);
  });

  it("bulk: {methods: ['create','delete']} omits update", async () => {
    spec = await buildSpec({methods: ["create", "delete"]});
    const method = requestSchema(spec).properties.operations.items.properties.method;
    expect(method.enum).toEqual(["create", "delete"]);
  });

  it("bulk: {maxItems: 5} documents maxItems 5", async () => {
    spec = await buildSpec({maxItems: 5});
    expect(requestSchema(spec).properties.operations.maxItems).toBe(5);
  });

  it("without bulk there is no /food/bulk path", async () => {
    spec = await buildSpec();
    expect(spec.paths["/food/bulk"]).toBeUndefined();
    expect(JSON.stringify(spec)).not.toContain("_bulk");
  });

  it("bulk: false documents no /food/bulk path", async () => {
    spec = await buildSpec(false);
    expect(spec.paths["/food/bulk"]).toBeUndefined();
  });
});
