import {describe, expect, it} from "bun:test";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import type {CliIo} from "./io";
import {runCli} from "./runCli";
import {readCliVersion} from "./version";

/** Bun's `typeof fetch` also carries `preconnect`; add a no-op so stubs satisfy it. */
const stubFetch = (
  handler: (...args: Parameters<typeof fetch>) => Promise<Response>
): typeof fetch => Object.assign(handler, {preconnect: (): void => {}});

const createIo = (cwd: string): CliIo & {stderrLines: string[]; stdoutLines: string[]} => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    cwd,
    env: {},
    fetch: stubFetch(async () => new Response()),
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

describe("generate and validate commands", () => {
  it("prints a mongoose model", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const io = createIo(dir);
    const code = await runCli(
      ["generate", "model", "--name", "Todo", "--field", "title:String:required", "--json"],
      io
    );
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Todo");
    expect(io.stdoutLines.join("\n")).toContain("title");
    await rm(dir, {force: true, recursive: true});
  });

  it("writes a rest-cli package", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const specPath = join(dir, "openapi.json");
    await writeFile(
      specPath,
      JSON.stringify({
        info: {title: "Shop", version: "1"},
        openapi: "3.0.0",
        paths: {"/ping": {get: {operationId: "ping"}}},
        servers: [{url: "https://shop.test"}],
      }),
      "utf8"
    );
    const io = createIo(dir);
    const out = join(dir, "shop-cli");
    const code = await runCli(
      ["generate", "rest-cli", "--schema", specPath, "--out", out, "--name", "shop"],
      io
    );
    expect(code).toBe(0);
    const cliSource = await readFile(join(out, "src/cli.ts"), "utf8");
    expect(cliSource).toContain("runAppRestCli");
    const packageJson = JSON.parse(await readFile(join(out, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    assert.equal(packageJson.dependencies["@terreno/cli"], `^${await readCliVersion()}`);
    await rm(dir, {force: true, recursive: true});
  });

  it("validates a schema file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const file = join(dir, "schema.ts");
    await writeFile(file, "const schema = new Schema({}, {strict: true});", "utf8");
    const io = createIo(dir);
    const code = await runCli(["validate", "schema", "--file", file], io);
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n").toLowerCase()).toContain("strict");
    await rm(dir, {force: true, recursive: true});
  });

  it("generates route, screen, form, and admin snippets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const io = createIo(dir);
    expect(
      await runCli(
        ["generate", "route", "--model-name", "Todo", "--route-path", "/todos", "--owner-filtered"],
        io
      )
    ).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Todo");
    io.stdoutLines.length = 0;
    expect(
      await runCli(
        ["generate", "screen", "--name", "TodoList", "--type", "list", "--model-name", "Todo"],
        io
      )
    ).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("TodoList");
    io.stdoutLines.length = 0;
    expect(
      await runCli(["generate", "form", "--field", "title:text:required:label=Title"], io)
    ).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("title");
    io.stdoutLines.length = 0;
    expect(
      await runCli(["generate", "admin", "--model", "Todo:/todos:Todos:title,completed"], io)
    ).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Todo");
    await rm(dir, {force: true, recursive: true});
  });

  it("searches docs", async () => {
    const io = createIo("/tmp");
    const code = await runCli(["docs", "search", "modelRouter", "--packages", "api"], io);
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n").length).toBeGreaterThan(10);
  }, 15_000);

  it("bootstraps AI rules into a directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const io = createIo(dir);
    const out = join(dir, "rules-app");
    const code = await runCli(
      [
        "bootstrap",
        "rules",
        "--name",
        "rules-app",
        "--display-name",
        "Rules App",
        "--dir",
        out,
        "--packages",
        "api,ui",
      ],
      io
    );
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Wrote");
    await rm(dir, {force: true, recursive: true});
  });

  it("bootstraps default rules into a relative directory", async (): Promise<void> => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const io = createIo(dir);

    const code = await runCli(
      ["bootstrap", "rules", "--name", "rules-app", "--dir", "rules", "--packages", " , "],
      io
    );

    assert.equal(code, 0);
    assert.include(io.stdoutLines.join("\n"), join(dir, "rules"));
    await rm(dir, {force: true, recursive: true});
  });

  it("prints usage errors for incomplete commands", async () => {
    const io = createIo("/tmp");
    expect(await runCli(["generate", "nope"], io)).toBe(1);
    expect(await runCli(["generate", "model"], io)).toBe(1);
    expect(await runCli(["generate", "route"], io)).toBe(1);
    expect(await runCli(["generate", "screen"], io)).toBe(1);
    expect(await runCli(["generate", "form"], io)).toBe(1);
    expect(await runCli(["generate", "admin"], io)).toBe(1);
    expect(await runCli(["generate", "syncdb"], io)).toBe(1);
    expect(await runCli(["generate", "sdk"], io)).toBe(1);
    expect(await runCli(["generate", "rest-cli"], io)).toBe(1);
    expect(await runCli(["validate"], io)).toBe(1);
    expect(await runCli(["validate", "schema"], io)).toBe(1);
    expect(await runCli(["docs"], io)).toBe(1);
    expect(await runCli(["docs", "search"], io)).toBe(1);
    expect(await runCli(["docs", "component"], io)).toBe(1);
    expect(await runCli(["docs", "upgrade"], io)).toBe(1);
    expect(await runCli(["bootstrap"], io)).toBe(1);
    expect(await runCli(["bootstrap", "app"], io)).toBe(1);
    expect(await runCli(["eval"], io)).toBe(1);
    expect(await runCli(["navigate"], io)).toBe(1);
    expect(await runCli(["api", "list"], io)).toBe(1);
    expect(await runCli(["api"], io)).toBe(1);
    expect(await runCli(["db"], io)).toBe(1);
    expect(await runCli(["db", "query"], io)).toBe(1);
  });

  it("prints component docs and upgrade notes", async () => {
    const io = createIo("/tmp");
    expect(await runCli(["docs", "component", "Button", "--json"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Button");
    io.stdoutLines.length = 0;
    expect(await runCli(["docs", "upgrade", "--from", "57.0.0", "--to", "57.1.0"], io)).toBe(0);
    expect(io.stdoutLines.join("\n").length).toBeGreaterThan(1);
  });

  it("writes generated model output to a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "terreno-cli-"));
    const io = createIo(dir);
    const out = join(dir, "todo.ts");
    const code = await runCli(
      ["generate", "model", "--name", "Todo", "--field", "title:String:required", "--out", out],
      io
    );
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Wrote");
    await rm(dir, {force: true, recursive: true});
  });
});
