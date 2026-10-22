import {describe, expect, it} from "bun:test";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

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

const SPEC = {
  info: {title: "Demo", version: "1"},
  openapi: "3.0.0",
  paths: {
    "/todos": {get: {operationId: "todo_list", summary: "List"}},
  },
  servers: [{url: "https://x.test"}],
};

describe("additional command branches", () => {
  it("lists and calls without --json", async () => {
    const io = createIo();
    io.fetch = (async (url) => {
      if (String(url).includes("openapi.json")) {
        return new Response(JSON.stringify(SPEC), {status: 200});
      }
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }) as typeof fetch;
    expect(await runCli(["api", "list", "--schema", "https://x.test/openapi.json"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("todo_list");
    io.stdoutLines.length = 0;
    expect(
      await runCli(["api", "call", "todo_list", "--schema", "https://x.test/openapi.json"], io)
    ).toBe(0);
    expect(await runCli(["api", "call", "--schema", "https://x.test/openapi.json"], io)).toBe(1);
    expect(
      await runCli(["api", "call", "missing", "--schema", "https://x.test/openapi.json"], io)
    ).toBe(1);
    expect(
      await runCli(["api", "request", "GET", "--schema", "https://x.test/openapi.json"], io)
    ).toBe(1);
    expect(
      await runCli(
        ["api", "request", "POST", "/nope", "--schema", "https://x.test/openapi.json"],
        io
      )
    ).toBe(1);
    expect(
      await runCli(
        ["api", "request", "GET", "/todos", "--schema", "https://x.test/openapi.json"],
        io
      )
    ).toBe(0);
    expect(await runCli(["api", "nope", "--schema", "https://x.test/openapi.json"], io)).toBe(1);
  });

  it("bootstraps an app and rules as json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const io = createIo(dir);
    expect(
      await runCli(
        [
          "bootstrap",
          "app",
          "--name",
          "demo-app",
          "--display-name",
          "Demo",
          "--dir",
          join(dir, "app"),
          "--json",
        ],
        io
      )
    ).toBe(0);
    io.stdoutLines.length = 0;
    expect(
      await runCli(
        [
          "bootstrap",
          "rules",
          "--name",
          "demo-app",
          "--display-name",
          "Demo",
          "--dir",
          join(dir, "rules"),
          "--json",
        ],
        io
      )
    ).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("ok");
    expect(await runCli(["docs", "search", "router", "--json", "--token-limit", "500"], io)).toBe(
      0
    );
    await rm(dir, {force: true, recursive: true});
  });

  it("reads a JSON body file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const specPath = join(dir, "openapi.json");
    const bodyPath = join(dir, "body.json");
    await writeFile(specPath, JSON.stringify(SPEC), "utf8");
    await writeFile(bodyPath, JSON.stringify({title: "x"}), "utf8");
    const io = createIo(dir);
    io.fetch = (async () => new Response("{}", {status: 200})) as typeof fetch;
    const code = await runCli(
      ["api", "call", "todo_list", "--schema", specPath, "--body-file", "body.json", "--json"],
      io
    );
    expect(code).toBe(0);
    await rm(dir, {force: true, recursive: true});
  });

  it("prints json version and json errors", async () => {
    const io = createIo();
    expect(await runCli(["--version", "--json"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("version");
    io.stdoutLines.length = 0;
    expect(await runCli(["api", "list", "--schema", "/no/such/openapi.json", "--json"], io)).toBe(
      1
    );
    expect(io.stdoutLines.join("\n")).toContain("ok");
  });

  it("rejects a legacy RTK openapi-config for generate sdk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const io = createIo(dir);
    const code = await runCli(["generate", "sdk", "--config", "openapi-config.ts"], io);
    expect(code).not.toBe(0);
    expect(io.stderrLines.join("\n")).toContain("--schema <url|path> --out store/apiSdk.ts");
    await rm(dir, {force: true, recursive: true});
  });

  it("generates rest-cli json output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const specPath = join(dir, "openapi.json");
    await writeFile(specPath, JSON.stringify(SPEC), "utf8");
    const io = createIo(dir);
    const code = await runCli(
      [
        "generate",
        "rest-cli",
        "--schema",
        specPath,
        "--out",
        join(dir, "cli"),
        "--name",
        "demo",
        "--json",
      ],
      io
    );
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("ok");
    await rm(dir, {force: true, recursive: true});
  });
});
