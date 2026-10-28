import {describe, expect, it} from "bun:test";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {discoverCollections} from "./discoverCollections";
import {emitSdk} from "./emitSdk";
import {emitInterface} from "./emitTypes";
import {generateSyncDbSdk, loadConfigFile, parseCollectionsFlag} from "./generate";
import {friendlyHookNames} from "./hookNames";
import {loadSpec} from "./loadSpec";

const fixturePath = join(import.meta.dir, "fixtures", "openapi.example.json");

describe("friendlyHookNames", () => {
  it("uses entity-centric names for todos", () => {
    expect(friendlyHookNames({collection: "todos", entityName: "Todo"})).toEqual({
      create: "useCreateTodo",
      list: "useTodos",
      read: "useTodo",
      remove: "useDeleteTodo",
      update: "useUpdateTodo",
      window: "useTodosWindow",
    });
  });
});

describe("emitInterface", () => {
  it("maps Mongoose ObjectId schemas to strings", () => {
    expect(
      emitInterface({
        name: "Owned",
        schema: {
          properties: {ownerId: {type: "schemaobjectid"}},
          required: ["ownerId"],
          type: "object",
        },
      })
    ).toContain("ownerId: string;");
  });

  it("emits enums, arrays, empty objects, numbers, booleans, and unknown types", () => {
    expect(
      emitInterface({
        name: "Mixed",
        schema: {
          properties: {
            flags: {items: {type: "boolean"}, type: "array"},
            kind: {enum: ["a", "b"]},
            n: {type: "integer"},
            nested: {type: "object"},
            on: {type: "boolean"},
            other: {},
          },
          type: "object",
        },
      })
    ).toContain('kind?: "a" | "b";');
    expect(
      emitInterface({
        name: "Alias",
        schema: {type: "string"},
      })
    ).toBe("export type Alias = string;");
  });
});

describe("discoverCollections", () => {
  it("reads x-terreno-sync from the fixture spec", async () => {
    const spec = await loadSpec(fixturePath);
    const discovered = discoverCollections({spec});
    expect(discovered.map((entry) => entry.collection)).toEqual(["todos"]);
    expect(discovered[0]?.entityName).toBe("Todo");
    expect(discovered[0]?.createName).toBe("CreateTodoBody");
    expect(discovered[0]?.updateName).toBe("UpdateTodoBody");
  });

  it("finds item routes when the collection path has a trailing slash", async () => {
    const spec = await loadSpec(fixturePath);
    const todoPath = spec.paths?.["/todos"];
    const todoItemPath = spec.paths?.["/todos/{id}"];
    spec.paths = {"/todos/": todoPath ?? {}};
    spec.paths["/todos/{id}/complete"] = {patch: {}};
    spec.paths["/todos/{id}"] = todoItemPath ?? {};

    const [discovered] = discoverCollections({spec});

    expect(discovered?.updateName).toBe("UpdateTodoBody");
    expect(discovered?.updateSchema.properties?.title?.type).toBe("string");
  });

  it("filters with --collections", async () => {
    const spec = await loadSpec(fixturePath);
    expect(() => discoverCollections({collections: ["notes"], spec})).toThrow(/matched/);
  });

  it("errors when the spec has no extensions and no --collections", () => {
    expect(() => discoverCollections({spec: {paths: {"/health": {get: {}}}}})).toThrow(
      /No synced collections found/
    );
  });

  it("reads list/create/patch schemas from /{name} when --collections is the fallback", async () => {
    const spec = await loadSpec(fixturePath);
    if (spec.paths?.["/todos"]?.get) {
      delete spec.paths["/todos"].get["x-terreno-sync"];
    }
    const [discovered] = discoverCollections({collections: ["todos"], spec});
    expect(discovered?.entityName).toBe("Todo");
    expect(discovered?.createName).toBe("CreateTodoBody");
    expect(discovered?.updateSchema.properties?.title?.type).toBe("string");
  });

  it("errors when --collections names a path that is missing", () => {
    expect(() =>
      discoverCollections({
        collections: ["notes"],
        spec: {paths: {"/health": {get: {}}}},
      })
    ).toThrow(/No OpenAPI path for collection "notes"/);
  });

  it("does not fail on a broken sibling collection when --collections allowlists a valid one", () => {
    const spec = {
      paths: {
        "/notes": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {
                      properties: {page: {type: "number"}},
                      type: "object",
                    },
                  },
                },
              },
            },
            "x-terreno-sync": {collection: "notes", scope: "owner"},
          },
        },
        "/todos": {
          get: {
            responses: {
              "200": {
                content: {
                  "application/json": {
                    schema: {
                      properties: {
                        data: {
                          items: {
                            properties: {title: {type: "string"}},
                            type: "object",
                          },
                          type: "array",
                        },
                      },
                      type: "object",
                    },
                  },
                },
              },
            },
            "x-terreno-sync": {collection: "todos", scope: "owner"},
          },
        },
      },
    };
    expect(() => discoverCollections({spec})).toThrow(/data.items schema/);
    const discovered = discoverCollections({collections: ["todos"], spec});
    expect(discovered).toHaveLength(1);
    expect(discovered[0]?.collection).toBe("todos");
  });

  it("does not path-fallback --collections when the spec already has x-terreno-sync", async () => {
    const spec = await loadSpec(fixturePath);
    expect(() => discoverCollections({collections: ["notes"], spec})).toThrow(/matched/);
  });
});

describe("generateSyncDbSdk", () => {
  it("emits SYNC_COLLECTIONS and friendly hooks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "syncdb-codegen-"));
    const out = join(dir, "syncDbSdk.ts");
    try {
      const source = await generateSyncDbSdk({
        format: false,
        out,
        schema: fixturePath,
      });
      expect(source).toContain('export const SYNC_COLLECTIONS = ["todos"] as const;');
      expect(source).toContain("useListQuery: useTodos");
      expect(source).toContain("useReadQuery: useTodo");
      expect(source).toContain("useCreateMutation: useCreateTodo");
      expect(source).toContain("useUpdateMutation: useUpdateTodo");
      expect(source).toContain("useDeleteMutation: useDeleteTodo");
      expect(source).toContain("useWindowQuery: useTodosWindow");
      expect(source).toContain("export interface Todo");
      expect(source).toContain("title?: string;");
      expect(await readFile(out, "utf8")).toBe(source);
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("applies retries: false from config overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "syncdb-codegen-"));
    const out = join(dir, "syncDbSdk.ts");
    try {
      const source = await generateSyncDbSdk({
        config: {overrides: {todos: {retries: false}}},
        format: false,
        out,
        schema: fixturePath,
      });
      expect(source).toContain(
        'createCollectionHooks<Todo, CreateTodoBody, UpdateTodoBody>({collection: "todos", retries: false})'
      );
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("applies retries: true and numeric overrides", async () => {
    const dir = await mkdtemp(join(tmpdir(), "syncdb-codegen-"));
    const out = join(dir, "syncDbSdk.ts");
    try {
      const enabled = await generateSyncDbSdk({
        config: {overrides: {todos: {retries: true}}},
        format: false,
        out,
        schema: fixturePath,
      });
      expect(enabled).toContain("retries: true");
      const numbered = await generateSyncDbSdk({
        config: {overrides: {todos: {retries: 4}}},
        format: false,
        out,
        schema: fixturePath,
      });
      expect(numbered).toContain("retries: 4");
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("formats the generated file when format is true", async () => {
    const dir = await mkdtemp(join(tmpdir(), "syncdb-codegen-"));
    const out = join(dir, "syncDbSdk.ts");
    try {
      const source = await generateSyncDbSdk({
        format: true,
        out,
        schema: fixturePath,
      });
      expect(source).toContain("export const SYNC_COLLECTIONS");
      expect(await readFile(out, "utf8")).toBe(source);
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("rejects unsafe sync collection names", async () => {
    const spec = await loadSpec(fixturePath);
    const discovered = discoverCollections({spec});
    const first = discovered[0];
    if (!first) {
      throw new Error("expected todos fixture collection");
    }
    expect(() =>
      emitSdk({
        collections: [
          {
            ...first,
            collection: 'todos"; process.exit(1); //',
          },
        ],
      })
    ).toThrow(/not a valid sync collection name/);
  });

  it("rejects invalid retries overrides", async () => {
    const spec = await loadSpec(fixturePath);
    const first = discoverCollections({spec})[0];
    expect(() =>
      emitSdk({
        collections: [{...first, retries: Number.NaN}],
      })
    ).toThrow(/Invalid retries/);
  });
});

describe("parseCollectionsFlag", () => {
  it("returns undefined for missing or empty values", () => {
    expect(parseCollectionsFlag()).toBeUndefined();
    expect(parseCollectionsFlag("  ,  ")).toBeUndefined();
  });

  it("splits and trims collection names", () => {
    expect(parseCollectionsFlag("todos, notes")).toEqual(["todos", "notes"]);
  });
});

describe("loadConfigFile", () => {
  it("returns undefined when no path is provided", async () => {
    expect(await loadConfigFile()).toBeUndefined();
  });

  it("parses a JSON config file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "syncdb-codegen-"));
    const path = join(dir, "config.json");
    try {
      await writeFile(path, JSON.stringify({overrides: {todos: {retries: false}}}), "utf8");
      const config = await loadConfigFile(path);
      expect(config?.overrides?.todos).toEqual({retries: false});
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });
});

describe("loadSpec", () => {
  it("rejects an empty schema argument", async () => {
    await expect(loadSpec("")).rejects.toThrow(/Missing --schema/);
  });

  it("fetches an HTTP spec and rejects non-OK responses", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", {status: 500})) as unknown as typeof fetch;
    try {
      await expect(loadSpec("https://example.test/openapi.json")).rejects.toThrow(
        /Failed to fetch OpenAPI spec/
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parses a fetched HTTP spec", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({paths: {}}), {status: 200})) as unknown as typeof fetch;
    try {
      const spec = await loadSpec("http://localhost/openapi.json");
      expect(spec.paths).toEqual({});
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
