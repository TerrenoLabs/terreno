import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildDatabaseUri, startMongoServer, stopMongoServer} from "@terreno/test";
import mongoose from "mongoose";

import {handleLocalToolCall} from "../local/localTools.js";

const DATABASE_NAME = "terrenoMcpDatabaseTools";
const MONGO_START_TIMEOUT_MS = 180_000;

const callText = async (name: string, args: Record<string, unknown>): Promise<string> => {
  const result = await handleLocalToolCall(name, args);
  return result.content[0]?.text ?? "";
};

// These tests load the real `mongoose` module through the tools' lazy import and talk to the
// in-memory MongoDB that backend packages use, so a broken import shape fails here.
describe("database tools against a live MongoDB", () => {
  let projectRoot: string;
  let previousMongoUri: string | undefined;
  let previousProjectRoot: string | undefined;

  beforeAll(async (): Promise<void> => {
    previousMongoUri = process.env.MONGO_URI;
    previousProjectRoot = process.env.TERRENO_PROJECT_ROOT;
    projectRoot = mkdtempSync(join(tmpdir(), "terreno-db-tools-"));
    process.env.TERRENO_PROJECT_ROOT = projectRoot;

    const serverUri = await startMongoServer();
    process.env.MONGO_URI = buildDatabaseUri({databaseName: DATABASE_NAME, uri: serverUri});

    const db = mongoose.connection.useDb(DATABASE_NAME).db;
    if (!db) {
      throw new Error("Seed connection has no db handle");
    }
    await db.dropDatabase();
    await db.collection("widgets").insertMany([
      {color: "red", name: "alpha", size: 1},
      {color: "blue", name: "beta", size: 2},
      {color: "red", name: "gamma", size: 3},
    ]);
    await db.collection("widgets").createIndex({name: 1});
    await db.collection("gadgets").insertOne({name: "omega"});
  }, MONGO_START_TIMEOUT_MS);

  afterAll(async (): Promise<void> => {
    await mongoose.connection
      .useDb(DATABASE_NAME)
      .db?.dropDatabase()
      .catch(() => undefined);
    await stopMongoServer();
    rmSync(projectRoot, {force: true, recursive: true});
    if (previousMongoUri === undefined) {
      Reflect.deleteProperty(process.env, "MONGO_URI");
    } else {
      process.env.MONGO_URI = previousMongoUri;
    }
    if (previousProjectRoot === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_PROJECT_ROOT");
    } else {
      process.env.TERRENO_PROJECT_ROOT = previousProjectRoot;
    }
  });

  test("database_schema lists live collections, counts, and indexes", async (): Promise<void> => {
    const text = await callText("database_schema", {summary: true});

    expect(text).toContain("## Live MongoDB");
    expect(text).toContain("### gadgets");
    expect(text).toContain("### widgets");
    expect(text).toContain("- **estimatedCount**: 3");
    expect(text).toContain('"name":"name_1"');
  });

  test("database_schema applies the collection filter", async (): Promise<void> => {
    const text = await callText("database_schema", {collectionFilter: "WIDG"});

    expect(text).toContain("### widgets");
    expect(text).not.toContain("### gadgets");
  });

  test("database_query find returns capped documents from the URI database", async (): Promise<void> => {
    const text = await callText("database_query", {
      collection: "widgets",
      filter: {color: "red"},
      limit: 1,
      operation: "find",
    });
    const parsed = JSON.parse(text) as {count: number; rows: Array<{color: string}>};

    expect(parsed.count).toBe(1);
    expect(parsed.rows[0]?.color).toBe("red");
  });

  test("database_query runs aggregate, countDocuments, and distinct", async (): Promise<void> => {
    const aggregate = JSON.parse(
      await callText("database_query", {
        collection: "widgets",
        operation: "aggregate",
        pipeline: [{$group: {_id: "$color", total: {$sum: "$size"}}}, {$sort: {_id: 1}}],
      })
    ) as {rows: Array<{_id: string; total: number}>};
    const count = JSON.parse(
      await callText("database_query", {
        collection: "widgets",
        filter: {color: "red"},
        operation: "countDocuments",
      })
    ) as {count: number};
    const distinct = JSON.parse(
      await callText("database_query", {
        collection: "widgets",
        field: "color",
        operation: "distinct",
      })
    ) as {truncated: boolean; values: string[]};

    expect(aggregate.rows).toEqual([
      {_id: "blue", total: 2},
      {_id: "red", total: 4},
    ]);
    expect(count.count).toBe(2);
    expect(distinct.values.sort()).toEqual(["blue", "red"]);
    expect(distinct.truncated).toBe(false);
  });

  test("concurrent calls succeed and leave the process's mongoose connection open", async (): Promise<void> => {
    const [schema, first, second] = await Promise.all([
      callText("database_schema", {summary: true}),
      callText("database_query", {collection: "widgets", operation: "countDocuments"}),
      callText("database_query", {collection: "gadgets", operation: "countDocuments"}),
    ]);

    expect(schema).toContain("### widgets");
    expect(JSON.parse(first)).toEqual({collection: "widgets", count: 3});
    expect(JSON.parse(second)).toEqual({collection: "gadgets", count: 1});
    expect(mongoose.connection.readyState).toBe(1);
  });
});
