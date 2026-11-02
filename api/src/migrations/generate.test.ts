/**
 * Tests for writing a timestamped migration from a Mongoose schema diff.
 */
import {describe, expect, it} from "bun:test";
import {mkdtemp, readFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import {generateMigration, lastSchemaAfter} from "./generate";
import {checkMigrationFiles} from "./load";

const fixtures = (...parts: string[]): string => {
  return join(__dirname, "fixtures", ...parts);
};

const register = (name: string, schema: mongoose.Schema): mongoose.Model<mongoose.Document> => {
  if (mongoose.models[name]) {
    mongoose.deleteModel(name);
  }
  return mongoose.model<mongoose.Document>(name, schema);
};

const makeModels = ({
  notes,
  requiredTitle,
}: {
  notes?: boolean;
  requiredTitle?: boolean;
}): mongoose.Model<mongoose.Document>[] => {
  const schema = new mongoose.Schema(
    {
      title: {description: "Title", required: requiredTitle !== false, type: String},
      ...(notes ? {notes: {description: "Notes", type: String}} : {}),
    },
    {collection: "gen_todos"}
  );
  schema.index({title: 1});
  return [register("GenTodo", schema)];
};

describe("lastSchemaAfter", () => {
  it("returns the last object snapshot and skips missing entries", () => {
    expect(lastSchemaAfter([])).toBeUndefined();
    expect(lastSchemaAfter([{schemaAfter: "nope"}, {schemaAfter: {models: {}}}])).toEqual({
      models: {},
    });
  });
});

describe("generateMigration", () => {
  it("writes the first file from an empty snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-gen-"));
    try {
      const result = await generateMigration({
        dir,
        models: makeModels({notes: true}),
        name: "init",
        now: () => DateTime.fromISO("2026-09-10T12:00:00.000Z"),
      });
      expect(result.noop).toBe(false);
      expect(result.path).toContain("20260910120000-init.ts");
      const source = await readFile(result.path as string, "utf8");
      expect(source).toContain("schemaAfter");
      expect(source).toContain("gen_todos");
      const loaded = await checkMigrationFiles({dir});
      expect(loaded).toHaveLength(1);
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("exits as a no-op when the catalog matches the last schemaAfter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-gen-"));
    try {
      const models = makeModels({notes: true});
      await generateMigration({
        dir,
        models,
        name: "init",
        now: () => DateTime.fromISO("2026-09-10T12:00:00.000Z"),
      });
      const second = await generateMigration({
        dir,
        models,
        name: "again",
        now: () => DateTime.fromISO("2026-09-10T12:01:00.000Z"),
      });
      expect(second.noop).toBe(true);
      expect(second.path).toBeNull();
      expect(await checkMigrationFiles({dir})).toHaveLength(1);
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("emits a required-field stub that throws in dry-run and wet", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-gen-"));
    try {
      const firstModels = makeModels({notes: false, requiredTitle: false});
      await generateMigration({
        dir,
        models: firstModels,
        name: "base",
        now: () => DateTime.fromISO("2026-09-10T12:00:00.000Z"),
      });
      const required = new mongoose.Schema(
        {
          title: {description: "Title", required: true, type: String},
        },
        {collection: "gen_todos"}
      );
      required.index({title: 1});
      const result = await generateMigration({
        dir,
        models: [register("GenTodo", required)],
        name: "require-title",
        now: () => DateTime.fromISO("2026-09-10T12:02:00.000Z"),
      });
      expect(result.noop).toBe(false);
      const loaded = await checkMigrationFiles({dir});
      const stub = loaded[loaded.length - 1];
      await expect(
        stub.up({
          dryRun: true,
          logger: {
            debug: () => undefined,
            error: () => undefined,
            info: () => undefined,
            warn: () => undefined,
          },
          mongoose,
        })
      ).rejects.toThrow("Unsafe");
      await expect(
        stub.up({
          dryRun: false,
          logger: {
            debug: () => undefined,
            error: () => undefined,
            info: () => undefined,
            warn: () => undefined,
          },
          mongoose,
        })
      ).rejects.toThrow("Unsafe");
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("skips createIndex when a generated safe up runs with dryRun", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-gen-"));
    try {
      const schema = new mongoose.Schema(
        {title: {description: "Title", type: String}},
        {collection: "gen_todos"}
      );
      await generateMigration({
        dir,
        models: [register("GenTodo", schema)],
        name: "base",
        now: () => DateTime.fromISO("2026-09-10T12:00:00.000Z"),
      });
      const indexed = new mongoose.Schema(
        {title: {description: "Title", type: String}},
        {collection: "gen_todos"}
      );
      indexed.index({title: 1});
      const result = await generateMigration({
        dir,
        models: [register("GenTodo", indexed)],
        name: "title-index",
        now: () => DateTime.fromISO("2026-09-10T12:03:00.000Z"),
      });
      expect(result.noop).toBe(false);
      const source = await readFile(result.path as string, "utf8");
      expect(source).toContain("if (ctx.dryRun)");
      expect(source).toContain("createIndex");
      const loaded = await checkMigrationFiles({dir});
      const generated = loaded[loaded.length - 1];
      await generated.up({
        dryRun: true,
        logger: {
          debug: () => undefined,
          error: () => undefined,
          info: () => undefined,
          warn: () => undefined,
        },
        mongoose,
      });
      expect(source).toContain("dropIndex");
      expect(source).toContain("title_1");
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("emits dropIndex when a generated safe down reverses an index add", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-gen-"));
    try {
      const schema = new mongoose.Schema(
        {title: {description: "Title", type: String}},
        {collection: "gen_todos"}
      );
      schema.index({title: 1});
      await generateMigration({
        dir,
        models: [register("GenTodo", schema)],
        name: "with-index",
        now: () => DateTime.fromISO("2026-09-10T12:00:00.000Z"),
      });
      const plain = new mongoose.Schema(
        {title: {description: "Title", type: String}},
        {collection: "gen_todos"}
      );
      const result = await generateMigration({
        dir,
        models: [register("GenTodo", plain)],
        name: "drop-title-index",
        now: () => DateTime.fromISO("2026-09-10T12:06:00.000Z"),
      });
      expect(result.noop).toBe(false);
      const source = await readFile(result.path as string, "utf8");
      expect(source).toContain("dropIndex");
      expect(source).toContain("createIndex");
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("keeps safe index calls as comments when any op is unsafe", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-gen-"));
    try {
      const result = await generateMigration({
        dir,
        models: makeModels({}),
        name: "init",
        now: () => DateTime.fromISO("2026-09-10T12:00:00.000Z"),
      });
      expect(result.noop).toBe(false);
      const source = await readFile(result.path as string, "utf8");
      expect(source).toContain("throw new Error(");
      expect(source).toContain("Keep these safe index operations when replacing the stub");
      expect(source).toContain("createIndex");
      expect(source).toContain("addIndex");
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("emits a unique-index stub that is valid JavaScript", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-gen-"));
    try {
      const base = new mongoose.Schema(
        {title: {description: "Title", type: String}},
        {collection: "gen_todos"}
      );
      await generateMigration({
        dir,
        models: [register("GenTodo", base)],
        name: "base",
        now: () => DateTime.fromISO("2026-09-10T12:00:00.000Z"),
      });
      const unique = new mongoose.Schema(
        {title: {description: "Title", type: String}},
        {collection: "gen_todos"}
      );
      unique.index({title: 1}, {unique: true});
      const result = await generateMigration({
        dir,
        models: [register("GenTodo", unique)],
        name: "unique-title",
        now: () => DateTime.fromISO("2026-09-10T12:05:00.000Z"),
      });
      expect(result.noop).toBe(false);
      const source = await readFile(result.path as string, "utf8");
      expect(source).toContain("throw new Error(");
      expect(source).not.toMatch(/throw new Error\("[^"]*\{"/);
      const loaded = await checkMigrationFiles({dir});
      const stub = loaded[loaded.length - 1];
      await expect(
        stub.up({
          dryRun: true,
          logger: {
            debug: () => undefined,
            error: () => undefined,
            info: () => undefined,
            warn: () => undefined,
          },
          mongoose,
        })
      ).rejects.toThrow("Unsafe migration stub");
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });

  it("rethrows migration load errors other than a missing directory", async () => {
    await expect(
      generateMigration({
        dir: fixtures("bad-name"),
        models: makeModels({notes: true}),
        name: "oops",
        now: () => DateTime.fromISO("2026-09-10T12:07:00.000Z"),
      })
    ).rejects.toThrow("Invalid migration filename");
  });

  it("fails closed when generate is called with no models", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrate-gen-"));
    try {
      await generateMigration({
        dir,
        models: makeModels({notes: true}),
        name: "init",
        now: () => DateTime.fromISO("2026-09-10T12:00:00.000Z"),
      });
      await expect(
        generateMigration({
          dir,
          models: [],
          name: "oops",
          now: () => DateTime.fromISO("2026-09-10T12:04:00.000Z"),
        })
      ).rejects.toThrow("No Mongoose models found");
      expect(await checkMigrationFiles({dir})).toHaveLength(1);
    } finally {
      await rm(dir, {force: true, recursive: true});
    }
  });
});
