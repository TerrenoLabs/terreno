import {mock} from "bun:test";

mock.module("@terreno/mcp/local-tools", () => ({
  handleLocalToolCall: async (name: string, args: Record<string, unknown>) => {
    if (name === "browser") {
      return {content: [{text: JSON.stringify({ok: true, ...args}), type: "text"}]};
    }
    return {content: [{text: `${name}:${JSON.stringify(args)}`, type: "text"}]};
  },
}));

mock.module("@terreno/syncdb/codegen", () => ({
  generateApiSdk: async () => "export const useGetAuthMeQuery = () => undefined;",
  generateSyncDbSdk: async () => "export const sdk = {};",
  loadConfigFile: async () => undefined,
  parseCollectionsFlag: (value?: string) => (value ? value.split(",") : undefined),
}));

import {describe, expect, it} from "bun:test";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import type {CliIo} from "./io";
import {runCli} from "./runCli";

const createIo = (cwd = "/tmp"): CliIo & {stderrLines: string[]; stdoutLines: string[]} => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    cwd,
    env: {},
    fetch: (async () => new Response()) as typeof fetch,
    stderr: (line: string) => {
      stderrLines.push(line);
    },
    stderrLines,
    stdout: (line: string) => {
      stdoutLines.push(line);
    },
    stdoutLines,
  };
};

describe("mocked local tools and syncdb", () => {
  it("prints info, logs, and db output", async () => {
    const io = createIo();
    expect(await runCli(["info"], io)).toBe(0);
    expect(await runCli(["info", "--json"], io)).toBe(0);
    expect(await runCli(["logs", "--sources", "backend,metro"], io)).toBe(0);
    expect(await runCli(["logs", "last-error", "--json"], io)).toBe(0);
    expect(
      await runCli(["state", "--collection", "todos", "--entity-id", "t1", "--limit", "5"], io)
    ).toBe(0);
    expect(await runCli(["state", "--name", "app", "--no-events"], io)).toBe(0);
    expect(await runCli(["eval", "--code", "1 + 1", "--json"], io)).toBe(0);
    expect(await runCli(["navigate", "/profile", "--json"], io)).toBe(0);
    expect(await runCli(["db", "schema", "--json"], io)).toBe(0);
    expect(
      await runCli(
        [
          "db",
          "query",
          "--collection",
          "todos",
          "--operation",
          "find",
          "--filter",
          "{}",
          "--pipeline",
          "[]",
          "--field",
          "title",
          "--limit",
          "3",
          "--json",
        ],
        io
      )
    ).toBe(0);
    const output = io.stdoutLines.join("\n");
    expect(output).toContain('"sources":["backend","metro"]');
    expect(output).toContain('get_syncdb_state:{"collection":"todos","entityId":"t1","limit":5}');
    expect(output).toContain('get_syncdb_state:{"includeDebugEvents":false,"name":"app"}');
    expect(output).not.toContain("get_rtk_state");
    expect(output).not.toContain("get_client_state");
    expect(output).toContain("evaluate");
    expect(output).toContain("navigate");
    expect(output).toContain("database_query");
  });

  it("rejects removed Redux state flags and invalid limits", async (): Promise<void> => {
    const io = createIo();
    assert.equal(await runCli(["state", "--slice", "rtk"], io), 1);
    assert.include(io.stderrLines.join("\n"), "removed in Terreno 58");
    assert.equal(await runCli(["state", "--limit", "0"], io), 1);
    assert.include(io.stderrLines.join("\n"), "--limit must be a positive integer");
  });

  it("generates an API sdk with the syncdb codegen", async (): Promise<void> => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-api-sdk-"));
    const io = createIo(dir);
    assert.equal(
      await runCli(
        [
          "generate",
          "sdk",
          "--schema",
          "http://localhost:4000/openapi.json",
          "--out",
          "store/apiSdk.ts",
          "--json",
        ],
        io
      ),
      0
    );
    assert.include(io.stdoutLines.join("\n"), "store/apiSdk.ts");
    assert.equal(
      await runCli(["generate", "sdk", "--schema", "openapi.json", "--out", "apiSdk.ts"], io),
      0
    );
    assert.include(io.stdoutLines.join("\n"), "Wrote apiSdk.ts");
    assert.equal(await runCli(["generate", "sdk", "--config", "openapi-config.ts"], io), 1);
    assert.include(io.stderrLines.join("\n"), "removed in Terreno 58");
    assert.equal(await runCli(["generate", "sdk", "--schema", "openapi.json"], io), 1);
    assert.include(io.stderrLines.join("\n"), "Usage: terreno generate sdk");
    await rm(dir, {force: true, recursive: true});
  });

  it("generates a syncdb sdk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const io = createIo(dir);
    const code = await runCli(
      [
        "generate",
        "syncdb",
        "--schema",
        join(dir, "openapi.json"),
        "--out",
        "sdk.ts",
        "--collections",
        "todos",
        "--json",
      ],
      io
    );
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("ok");
    await rm(dir, {force: true, recursive: true});
  });

  it("runs ordered WebView actions and captures proof", async (): Promise<void> => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-web-"));
    await writeFile(
      join(dir, "actions.json"),
      JSON.stringify([{action: "press", key: "Enter"}]),
      "utf8"
    );
    const io = createIo(dir);

    const code = await runCli(
      [
        "web",
        "http://localhost:8082",
        "--wait",
        "0",
        "--action",
        '{"action":"click","selector":"#save"}',
        "--actions-file",
        "actions.json",
        "--snapshot",
        "--screenshot",
        "proof.png",
        "--json",
      ],
      io
    );

    assert.equal(code, 0);
    const output = JSON.parse(io.stdoutLines.join("\n")) as {
      results: Array<{action?: string}>;
    };
    assert.deepEqual(
      output.results.map((result) => result.action),
      ["open", "wait", "click", "press", "snapshot", "screenshot"]
    );
    await rm(dir, {force: true, recursive: true});
  });

  it("validates WebView action files and numeric options", async (): Promise<void> => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-web-errors-"));
    await writeFile(join(dir, "not-actions.json"), JSON.stringify({action: "click"}), "utf8");
    const io = createIo(dir);

    assert.equal(await runCli(["web", "--width", "0"], io), 1);
    assert.equal(await runCli(["web", "--wait=-1"], io), 1);
    assert.equal(await runCli(["web", "--action", "[]"], io), 1);
    assert.equal(await runCli(["web", "--action", "{}"], io), 1);
    assert.equal(await runCli(["web", "--actions-file", "not-actions.json"], io), 1);

    io.stdoutLines.length = 0;
    assert.equal(await runCli(["web"], io), 0);
    assert.include(io.stdoutLines.join("\n"), '"ok": true');

    await rm(dir, {force: true, recursive: true});
  });
});
