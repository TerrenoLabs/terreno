import {describe, expect, it} from "bun:test";
import {assert} from "chai";

import type {CliIo} from "./io";
import {runCli} from "./runCli";

/** Bun's `typeof fetch` also carries `preconnect`; add a no-op so stubs satisfy it. */
const stubFetch = (
  handler: (...args: Parameters<typeof fetch>) => Promise<Response>
): typeof fetch => Object.assign(handler, {preconnect: (): void => {}});

const createIo = (): CliIo & {stderrLines: string[]; stdoutLines: string[]} => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    cwd: "/tmp",
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

const SPEC = {
  info: {title: "Demo", version: "1"},
  openapi: "3.0.0",
  paths: {
    "/health": {get: {operationId: "health_get", summary: "Health"}},
    "/todos/{id}": {
      get: {
        operationId: "todo_read",
        parameters: [{in: "path", name: "id", required: true}],
      },
    },
  },
  servers: [{url: "https://x.test"}],
};

describe("runCli", () => {
  it("prints help", async () => {
    const io = createIo();
    const code = await runCli(["--help"], io);
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Usage: terreno");
  });

  it("prints command help", async () => {
    const io = createIo();
    const code = await runCli(["help", "api"], io);
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("terreno api");
  });

  it("prints Bun WebView command help", async () => {
    const io = createIo();
    const code = await runCli(["help", "web"], io);
    assert.equal(code, 0);
    assert.include(io.stdoutLines.join("\n"), "Bun.WebView");
    assert.include(io.stdoutLines.join("\n"), "--screenshot");
  });

  it("prints version", async () => {
    const io = createIo();
    const code = await runCli(["--version"], io);
    expect(code).toBe(0);
    expect(io.stdoutLines[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rejects unknown commands", async () => {
    const io = createIo();
    const code = await runCli(["nope"], io);
    expect(code).toBe(1);
    expect(io.stderrLines.join("\n")).toContain("Unknown command");
  });

  it("lists OpenAPI operations", async () => {
    const io = createIo();
    io.fetch = (async (url) => {
      if (String(url).includes("openapi.json")) {
        return new Response(JSON.stringify(SPEC), {status: 200});
      }
      return new Response("missing", {status: 404});
    }) as typeof fetch;
    const code = await runCli(
      ["api", "list", "--schema", "https://x.test/openapi.json", "--json"],
      io
    );
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("health_get");
  });

  it("calls an OpenAPI operation", async () => {
    const io = createIo();
    io.fetch = (async (url, init) => {
      if (String(url).includes("openapi.json")) {
        return new Response(JSON.stringify(SPEC), {status: 200});
      }
      expect(String(url)).toBe("https://x.test/todos/abc");
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(headers.authorization).toBe("Bearer tok");
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }) as typeof fetch;
    const code = await runCli(
      [
        "api",
        "call",
        "todo_read",
        "--schema",
        "https://x.test/openapi.json",
        "--param",
        "id=abc",
        "--token",
        "tok",
        "--json",
      ],
      io
    );
    expect(code).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain('"ok": true');
  });

  it("requests by method and path", async () => {
    const io = createIo();
    io.fetch = (async (url) => {
      if (String(url).includes("openapi.json")) {
        return new Response(JSON.stringify(SPEC), {status: 200});
      }
      return new Response(JSON.stringify({ok: true}), {status: 200});
    }) as typeof fetch;
    const code = await runCli(
      [
        "api",
        "request",
        "GET",
        "/todos/{id}",
        "--schema",
        "https://x.test/openapi.json",
        "--param",
        "id=abc",
        "--json",
      ],
      io
    );
    expect(code).toBe(0);
  });
});
