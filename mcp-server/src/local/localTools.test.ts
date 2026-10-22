import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";
import {DateTime} from "luxon";

import {handleLocalToolCall, localMcpTools} from "./localTools";
import {resolveTerrenoLogDirs} from "./logPaths";
import {resolveMetroHttpBase} from "./metro/metroDevSession";
import {lastError, readLogs} from "./tools/readLogs";
import {evaluate, navigate} from "./tools/runtime";

describe("local MCP runtime tools", () => {
  let projectRoot: string;
  let previousEval: string | undefined;
  let previousMetroUrl: string | undefined;
  let previousMongoUri: string | undefined;
  let previousProjectRoot: string | undefined;

  beforeEach((): void => {
    projectRoot = mkdtempSync(join(tmpdir(), "terreno-local-tools-"));
    previousEval = process.env.TERRENO_MCP_EVAL;
    previousMetroUrl = process.env.TERRENO_METRO_URL;
    previousMongoUri = process.env.MONGO_URI;
    previousProjectRoot = process.env.TERRENO_PROJECT_ROOT;
    process.env.TERRENO_PROJECT_ROOT = projectRoot;
    Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
    Reflect.deleteProperty(process.env, "MONGO_URI");
  });

  afterEach((): void => {
    rmSync(projectRoot, {force: true, recursive: true});
    if (previousEval === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    } else {
      process.env.TERRENO_MCP_EVAL = previousEval;
    }
    if (previousMetroUrl === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
    } else {
      process.env.TERRENO_METRO_URL = previousMetroUrl;
    }
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

  it("discovers bootstrap, example, and root log directories", (): void => {
    expect(resolveTerrenoLogDirs()).toEqual([
      join(projectRoot, "backend", ".terreno", "logs"),
      join(projectRoot, "example-backend", ".terreno", "logs"),
      join(projectRoot, ".terreno", "logs"),
    ]);
  });

  it("publishes browser automation for agent proof", async (): Promise<void> => {
    assert.isTrue(localMcpTools.some((tool) => tool.name === "browser"));
    assert.isTrue(localMcpTools.some((tool) => tool.name === "get_syncdb_state"));
    assert.isTrue(localMcpTools.some((tool) => tool.name === "syncdb_action"));
    assert.isTrue(localMcpTools.some((tool) => tool.name === "syncdb_snapshot"));
    assert.isFalse(localMcpTools.some((tool) => tool.name === "get_rtk_state"));
    const result = await handleLocalToolCall("browser", {action: "close"});
    assert.include(result.content[0]?.text ?? "", '"ok": true');
    try {
      await handleLocalToolCall("browser", {action: "invalid"});
      assert.fail("Expected invalid browser action to fail");
    } catch (error) {
      assert.include(String(error), "Unknown or missing browser action");
    }
  });

  it("routes local tool calls and returns static schema without Mongo", async (): Promise<void> => {
    const modelsDir = join(projectRoot, "backend", "src", "models");
    mkdirSync(modelsDir, {recursive: true});
    writeFileSync(
      join(projectRoot, "backend", ".env"),
      ["# no database configured", "INVALID_LINE", "OTHER=value"].join("\n")
    );
    writeFileSync(join(modelsDir, "todo.ts"), "export const todoSchema = {title: String};\n");
    writeFileSync(join(modelsDir, "index.ts"), "export * from './todo';\n");

    const application = await handleLocalToolCall("application_info", {});
    const schema = await handleLocalToolCall("database_schema", {summary: false});
    const query = await handleLocalToolCall("database_query", {operation: "invalid"});
    const logs = await handleLocalToolCall("read_logs", {sources: ["backend", 42]});
    const error = await handleLocalToolCall("last_error", {sources: ["browser", null]});
    const removedRtkState = await handleLocalToolCall("get_rtk_state", {slice: "rtk"});
    const evaluation = await handleLocalToolCall("evaluate", {code: 42});
    const unknown = await handleLocalToolCall("unknown", {});
    const syncdbMissing = await handleLocalToolCall("get_syncdb_state", {
      collection: "todos",
      entityId: "todo-1",
      includeDebugEvents: false,
      limit: 1,
      name: "app",
    });
    const syncdbAction = await handleLocalToolCall("syncdb_action", {
      action: "flush",
      collection: "todos",
      data: {title: "x"},
      deleted: false,
      entityId: "todo-1",
      id: "todo-1",
      maxAttempts: 1,
      mutationId: "m1",
      operation: "update",
      seq: 1,
      snapshotId: "snap",
      strategy: "keepLocal",
      stream: "todos",
    });
    const syncdbSnapshot = await handleLocalToolCall("syncdb_snapshot", {
      action: "list",
      collection: "todos",
      entityId: "todo-1",
      includeDebugEvents: true,
      limit: 10,
      name: "app",
      otherSnapshotId: "b",
      snapshotId: "a",
    });

    assert.include(application.content[0]?.text ?? "", "# Application info");
    assert.include(schema.content[0]?.text ?? "", "### todo.ts");
    assert.include(schema.content[0]?.text ?? "", "Live MongoDB");
    assert.include(query.content[0]?.text ?? "", "Unsupported operation");
    assert.include(logs.content[0]?.text ?? "", '"entries"');
    assert.include(error.content[0]?.text ?? "", "No recent error-level entries");
    assert.equal(removedRtkState.content[0]?.text, "Unknown tool: get_rtk_state");
    assert.include(evaluation.content[0]?.text ?? "", "Refused");
    assert.equal(unknown.content[0]?.text, "Unknown tool: unknown");
    assert.include(syncdbMissing.content[0]?.text ?? "", "CDP:");
    assert.include(syncdbAction.content[0]?.text ?? "", "Refused");
    assert.include(syncdbSnapshot.content[0]?.text ?? "", "[");

    const summary = await handleLocalToolCall("database_schema", {summary: true});
    assert.include(summary.content[0]?.text ?? "", "Found 1 model file(s)");
  });

  it("merges example-backend and browser JSONL logs", async (): Promise<void> => {
    const backendLogDir = join(projectRoot, "example-backend", ".terreno", "logs");
    mkdirSync(backendLogDir, {recursive: true});
    const timestamp = DateTime.utc().toISO();
    const browserTimestamp = DateTime.fromISO(timestamp).plus({milliseconds: 1}).toISO();
    writeFileSync(
      join(backendLogDir, "app.log"),
      `${JSON.stringify({level: "info", message: "backend ready", timestamp})}\n`
    );
    writeFileSync(
      join(backendLogDir, "browser.log"),
      `${JSON.stringify({level: "error", message: "client failed", timestamp: browserTimestamp})}\n`
    );

    const result = JSON.parse(await readLogs({entries: 10, sources: ["backend", "browser"]})) as {
      entries: Array<{message?: string}>;
    };
    expect(result.entries.map((entry) => entry.message)).toEqual([
      "backend ready",
      "client failed",
    ]);

    const latest = JSON.parse(await lastError({sources: ["browser"]})) as {message?: string};
    expect(latest.message).toBe("client failed");
  });

  it("keeps evaluate and navigate opt-in", async (): Promise<void> => {
    expect(await evaluate({code: "1 + 1"})).toContain("Refused");
    expect(await navigate({path: "/profile"})).toContain("Refused");

    process.env.TERRENO_MCP_EVAL = "1";
    expect(await evaluate({code: "  "})).toBe("No code provided.");
    expect(await navigate({path: "  "})).toBe("No path provided.");
  });

  it("filters durable logs by time and level and reports no error", async (): Promise<void> => {
    const rootLogDir = join(projectRoot, ".terreno", "logs");
    mkdirSync(rootLogDir, {recursive: true});
    const threshold = DateTime.utc();
    writeFileSync(
      join(rootLogDir, "app.log"),
      [
        JSON.stringify({
          level: "error",
          message: "old failure",
          timestamp: threshold.minus({minutes: 1}).toISO(),
        }),
        "plain line without timestamp",
        JSON.stringify({
          level: "info",
          message: "new info",
          timestamp: threshold.plus({milliseconds: 1}).toISO(),
        }),
      ].join("\n")
    );

    const filtered = JSON.parse(
      await readLogs({
        level: "info",
        since: threshold.toISO(),
        sources: ["backend"],
      })
    ) as {entries: Array<{message?: string}>};
    expect(filtered.entries).toHaveLength(1);
    expect(filtered.entries[0]?.message).toBe("new info");
    expect(await lastError({sources: ["backend"]})).toContain("old failure");
    expect(await lastError({sources: ["browser"]})).toContain("No recent error-level entries");
  });

  it("resolves Metro from explicit URL or frontend scripts", (): void => {
    process.env.TERRENO_METRO_URL = "https://metro.example.test/";
    expect(resolveMetroHttpBase()).toBe("https://metro.example.test");

    Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
    const frontendDir = join(projectRoot, "example-frontend");
    mkdirSync(frontendDir, {recursive: true});
    writeFileSync(
      join(frontendDir, "package.json"),
      JSON.stringify({scripts: {web: "expo start --web --port 9090"}})
    );
    expect(resolveMetroHttpBase()).toBe("http://localhost:9090");
  });
});
