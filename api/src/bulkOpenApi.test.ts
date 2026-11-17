import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import supertest from "supertest";
import {type ModelRouterOptions, modelRouter} from "./api";
import type {UserModel as AuthUserModel} from "./auth";
import {Permissions} from "./permissions";
import {TerrenoApp} from "./terrenoApp";
import {type Food, FoodModel, UserModel} from "./tests";

// OpenAPI documents are read as plain JSON; `at` walks a path of keys and yields unknown.
type Json = unknown;

const at = (node: Json, ...path: string[]): Json =>
  path.reduce<Json>(
    (acc, key) =>
      acc !== null && typeof acc === "object" ? (acc as Record<string, Json>)[key] : undefined,
    node
  );

const keysOf = (node: Json): string[] =>
  node !== null && typeof node === "object" ? Object.keys(node) : [];

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
  const ref = at(node, "$ref");
  if (typeof ref === "string") {
    return resolve(spec, at(spec, ...ref.replace(/^#\//, "").split("/")), depth + 1);
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, resolve(spec, value, depth + 1)])
  );
};

const bulkPost = (spec: Json): Json => at(spec, "paths", "/food/bulk", "post");
const requestSchema = (spec: Json): Json =>
  resolve(spec, at(bulkPost(spec), "requestBody", "content", "application/json", "schema"));
const okSchema = (spec: Json): Json =>
  resolve(spec, at(bulkPost(spec), "responses", "200", "content", "application/json", "schema"));
const operationsItem = (spec: Json): Json =>
  at(requestSchema(spec), "properties", "operations", "items");

describe("bulk OpenAPI", () => {
  let spec: Json;

  describe("bulk: true", () => {
    beforeEach(async () => {
      spec = await buildSpec(true);
    });

    it("documents POST /food/bulk with the {tag}_bulk operationId", () => {
      expect(bulkPost(spec)).toBeDefined();
      // Tag is the collection name ("foods"), as for actions (`${tag}_${actionName}`).
      expect(at(bulkPost(spec), "tags")).toEqual(["foods"]);
      expect(at(bulkPost(spec), "operationId")).toBe("foods_bulk");
    });

    it("lists create, update, delete in the method enum", () => {
      expect(at(operationsItem(spec), "properties", "method", "enum")).toEqual([
        "create",
        "update",
        "delete",
      ]);
    });

    it("documents the request envelope", () => {
      const schema = requestSchema(spec);
      expect(at(schema, "properties", "atomic", "type")).toBe("boolean");
      expect(at(schema, "properties", "operations", "type")).toBe("array");
      expect(at(schema, "required")).toContain("operations");
      expect(at(schema, "required") ?? []).not.toContain("atomic");
      const item = at(schema, "properties", "operations", "items");
      expect(at(item, "required")).toContain("method");
      expect(keysOf(at(item, "properties"))).toEqual(
        expect.arrayContaining(["method", "id", "body"])
      );
    });

    it("item body carries the model's writable fields", () => {
      const body = at(operationsItem(spec), "properties", "body");
      expect(JSON.stringify(body)).toContain('"calories"');
      expect(JSON.stringify(body)).toContain('"name"');
    });

    it("documents maxItems as the default 100", () => {
      expect(at(requestSchema(spec), "properties", "operations", "maxItems")).toBe(100);
    });

    it("200 is {data: result[]} with data typed as the model response", () => {
      const schema = okSchema(spec);
      expect(at(schema, "properties", "data", "type")).toBe("array");
      const entry = at(schema, "properties", "data", "items");
      expect(keysOf(at(entry, "properties"))).toEqual(
        expect.arrayContaining(["index", "method", "id", "status", "data"])
      );
      expect(JSON.stringify(at(entry, "properties", "data"))).toContain('"calories"');
    });

    it("400 and 401 use the standard APIError schema", () => {
      const responses = at(bulkPost(spec), "responses");
      expect(at(responses, "400")).toBeDefined();
      expect(at(responses, "401")).toBeDefined();
      expect(at(responses, "400", "content", "application/json", "schema", "$ref")).toBe(
        "#/components/schemas/APIError"
      );
      expect(at(responses, "401", "content", "application/json", "schema", "$ref")).toBe(
        "#/components/schemas/APIError"
      );
    });
  });

  it("bulk: {methods: ['update']} narrows the enum to update", async () => {
    spec = await buildSpec({methods: ["update"]});
    expect(at(operationsItem(spec), "properties", "method", "enum")).toEqual(["update"]);
  });

  it("bulk: {methods: ['create','delete']} omits update", async () => {
    spec = await buildSpec({methods: ["create", "delete"]});
    expect(at(operationsItem(spec), "properties", "method", "enum")).toEqual(["create", "delete"]);
  });

  it("bulk: {maxItems: 5} documents maxItems 5", async () => {
    spec = await buildSpec({maxItems: 5});
    expect(at(requestSchema(spec), "properties", "operations", "maxItems")).toBe(5);
  });

  it("without bulk there is no /food/bulk path", async () => {
    spec = await buildSpec();
    expect(at(spec, "paths", "/food/bulk")).toBeUndefined();
    expect(JSON.stringify(spec)).not.toContain("_bulk");
  });

  it("bulk: false documents no /food/bulk path", async () => {
    spec = await buildSpec(false);
    expect(at(spec, "paths", "/food/bulk")).toBeUndefined();
  });
});
