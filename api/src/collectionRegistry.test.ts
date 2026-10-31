import {beforeEach, describe, expect, it} from "bun:test";
import {model, Schema} from "mongoose";
import {
  clearCollectionRegistry,
  getCollection,
  listCollections,
  registerCollection,
  replaceCollectionOptions,
} from "./collectionRegistry";
import {clearMCPRegistry, getMCPRegistry} from "./mcp/registry";
import {Permissions} from "./permissions";
import {createdUpdatedPlugin, type IsDeleted, isDeletedPlugin} from "./plugins";
import {trackSyncIndexCreation} from "./sync/registrationSideEffects";
import {clearSyncRegistry, getSyncRegistry, registerSync} from "./sync/registry";
import {syncPlugin} from "./sync/syncSeqPlugin";
import {FoodModel} from "./tests";

interface CatalogTodo extends IsDeleted {
  _id: string;
  ownerId: string;
  title: string;
  _syncSeq?: number;
}

const catalogTodoSchema = new Schema<CatalogTodo>({
  ownerId: {description: "The owner", type: String},
  title: {description: "The title", required: true, type: String},
});
catalogTodoSchema.plugin(isDeletedPlugin);
catalogTodoSchema.plugin(createdUpdatedPlugin);
catalogTodoSchema.plugin(syncPlugin);
const CatalogTodoModel = model<CatalogTodo>("CatalogTodo", catalogTodoSchema);

const syncOptions = {
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [Permissions.IsAuthenticated],
    list: [Permissions.IsAuthenticated],
    read: [Permissions.IsAuthenticated],
    update: [Permissions.IsAuthenticated],
  },
  sync: {scope: {type: "owner" as const}},
};

const baseOptions = {
  permissions: {
    create: [Permissions.IsAny],
    delete: [Permissions.IsAny],
    list: [Permissions.IsAny],
    read: [Permissions.IsAny],
    update: [Permissions.IsAny],
  },
};

describe("CollectionRegistry", () => {
  beforeEach(() => {
    clearCollectionRegistry();
  });

  it("stores one catalog record per route path on registerCollection", () => {
    registerCollection({
      model: FoodModel,
      options: baseOptions,
      routePath: "/food",
    });

    const record = getCollection("/food");
    expect(record?.routePath).toBe("/food");
    expect<unknown>(record?.model).toBe(FoodModel);
    expect(record?.options).toBe(baseOptions);
    expect(listCollections()).toHaveLength(1);
  });

  it("replaceCollectionOptions updates options for a registered path", () => {
    registerCollection({
      model: FoodModel,
      options: baseOptions,
      routePath: "/food",
    });
    const updatedOptions = {
      ...baseOptions,
      permissions: {...baseOptions.permissions, list: [Permissions.IsAuthenticated]},
    };
    replaceCollectionOptions("/food", updatedOptions);

    expect(getCollection("/food")?.options).toBe(updatedOptions);
  });

  it("replaceCollectionOptions no-ops when the route path is unknown", () => {
    registerCollection({
      model: FoodModel,
      options: baseOptions,
      routePath: "/food",
    });
    const originalOptions = getCollection("/food")?.options;
    replaceCollectionOptions("/missing", {
      permissions: {},
    } as never);

    expect(getCollection("/food")?.options).toBe(originalOptions);
  });

  it("replaceCollectionOptions updates MCP registry views with the same options object", () => {
    clearMCPRegistry();
    registerCollection({
      model: FoodModel,
      options: {...baseOptions, mcp: {methods: ["list"]}},
      routePath: "/food",
    });
    const updatedOptions = {
      ...baseOptions,
      mcp: {methods: ["read"]},
    } as typeof baseOptions & {mcp: {methods: ["read"]}};
    replaceCollectionOptions("/food", updatedOptions);

    expect(getCollection("/food")?.options).toBe(updatedOptions);
    expect(getMCPRegistry()[0]?.options).toBe(updatedOptions);
  });

  it("replaceCollectionOptions updates sync registry views with the same options object", () => {
    clearSyncRegistry();
    registerSync({
      config: {scope: {type: "owner"}},
      model: CatalogTodoModel,
      options: syncOptions,
      routePath: "/catalogTodos",
    });
    const updatedOptions = {
      ...syncOptions,
      permissions: {...syncOptions.permissions, list: [Permissions.IsAny]},
    };
    replaceCollectionOptions("/catalogTodos", updatedOptions);

    expect(getCollection("/catalogTodos")?.options).toBe(updatedOptions);
    expect(getSyncRegistry()[0]?.options).toBe(updatedOptions);
  });

  it("treats re-registering the same model at the same route path as a no-op", () => {
    clearSyncRegistry();
    registerSync({
      config: {scope: {type: "owner"}},
      model: CatalogTodoModel,
      options: syncOptions,
      routePath: "/catalogTodos",
    });
    registerSync({
      config: {scope: {type: "owner"}},
      model: CatalogTodoModel,
      options: syncOptions,
      routePath: "/catalogTodos",
    });
    expect(getSyncRegistry()).toHaveLength(1);
  });

  it("clearCollectionRegistry resets deferred sync index tasks", async () => {
    clearCollectionRegistry();
    trackSyncIndexCreation(async () => {
      throw new Error("should not run");
    });
    clearCollectionRegistry();
    const {ensureSyncIndexes} = await import("./sync/registrationSideEffects.js");
    await expect(ensureSyncIndexes()).resolves.toBeUndefined();
  });
});
