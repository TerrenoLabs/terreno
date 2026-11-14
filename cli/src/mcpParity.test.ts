import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {existsSync} from "node:fs";
import {mkdtemp, readFile, rm, stat, utimes, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LOCAL_TOOL_NAMES} from "@terreno/mcp/local-tool-names";

import type {CliIo, ToolCallResult} from "./io";
import {runCli} from "./runCli";
import {
  ensureCliStateDir,
  findLiveSession,
  serveSession,
  startSession,
  stopSession,
  writePrivateJson,
} from "./session";

const FAKE_TOOL_NAMES = ["application_info", "browser", "read_logs", "syncdb_snapshot"];

/** Stands in for terreno-mcp-local: echoes each call so a test can assert the arguments. */
const fakeLocalTools: NonNullable<CliIo["localTools"]> = {
  call: async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => ({
    content: [{text: `${name}:${JSON.stringify(args)}`, type: "text"}],
  }),
  tools: FAKE_TOOL_NAMES.map((name) => ({
    description: `Describe ${name}. More detail.`,
    inputSchema: {properties: {}, type: "object"},
    name,
  })),
};

type TestIo = CliIo & {stderrLines: string[]; stdoutLines: string[]};

/** Bun's `typeof fetch` also carries `preconnect`; add a no-op so stubs satisfy it. */
const stubFetch = (
  handler: (...args: Parameters<typeof fetch>) => Promise<Response>
): typeof fetch => Object.assign(handler, {preconnect: (): void => {}});

const createIo = (cwd: string, fetchImpl: typeof fetch = globalThis.fetch): TestIo => {
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  return {
    cwd,
    env: {},
    fetch: fetchImpl,
    localTools: fakeLocalTools,
    stderr: (line: string): void => {
      stderrLines.push(line);
    },
    stderrLines,
    stdout: (line: string): void => {
      stdoutLines.push(line);
    },
    stdoutLines,
  };
};

interface TestSession {
  calls: Array<{args: Record<string, unknown>; name: string}>;
  port: number;
  stop: () => Promise<void>;
  token: string;
}

/** Serves a session in this process, the way `terreno session serve` does in its own. */
const startTestSession = async (io: CliIo): Promise<TestSession> => {
  const calls: Array<{args: Record<string, unknown>; name: string}> = [];
  let serving: Promise<void> = Promise.resolve();
  const {state} = await startSession({
    io,
    spawnServe: (): void => {
      serving = serveSession({
        handle: async (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => {
          if (name === "explode") {
            throw new Error("tool blew up");
          }
          calls.push({args, name});
          return {content: [{text: JSON.stringify({args, name, via: "session"}), type: "text"}]};
        },
        idleMinutes: 0,
        io,
      });
    },
  });
  return {
    calls,
    port: state.port,
    stop: async (): Promise<void> => {
      await stopSession(io);
      await serving;
    },
    token: state.token,
  };
};

describe("MCP parity commands", () => {
  let dir = "";
  let previousRoot: string | undefined;

  beforeEach(async (): Promise<void> => {
    dir = await mkdtemp(join(tmpdir(), "terreno-cli-parity-"));
    previousRoot = process.env.TERRENO_PROJECT_ROOT;
    process.env.TERRENO_PROJECT_ROOT = dir;
  });

  afterEach(async (): Promise<void> => {
    if (previousRoot === undefined) {
      delete process.env.TERRENO_PROJECT_ROOT;
    } else {
      process.env.TERRENO_PROJECT_ROOT = previousRoot;
    }
    await rm(dir, {force: true, recursive: true});
  });

  it("maps syncdb action flags onto syncdb_action", async (): Promise<void> => {
    const io = createIo(dir);
    expect(
      await runCli(
        [
          "syncdb",
          "action",
          "mutate",
          "--collection",
          "todos",
          "--operation",
          "update",
          "--id",
          "t1",
          "--data",
          '{"title":"x"}',
          "--seq",
          "4",
          "--deleted",
        ],
        io
      )
    ).toBe(0);
    expect(io.stdoutLines.join("\n")).toBe(
      'syncdb_action:{"action":"mutate","collection":"todos","data":{"title":"x"},"deleted":true,"id":"t1","operation":"update","seq":4}'
    );
    expect(await runCli(["syncdb", "action", "flush", "--json"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain('syncdb_action:{\\"action\\":\\"flush\\"}');
  });

  it("rejects unknown syncdb usage and bad values", async (): Promise<void> => {
    const io = createIo(dir);
    expect(await runCli(["syncdb"], io)).toBe(1);
    expect(await runCli(["syncdb", "action", "explode"], io)).toBe(1);
    expect(await runCli(["syncdb", "snapshot", "nope"], io)).toBe(1);
    expect(await runCli(["syncdb", "action", "mutate", "--data", "[1]"], io)).toBe(1);
    expect(await runCli(["syncdb", "action", "mutate", "--seq", "abc"], io)).toBe(1);
    const errors = io.stderrLines.join("\n");
    expect(errors).toContain("Usage: terreno syncdb <state|action|snapshot>");
    expect(errors).toContain("--data must be a JSON object.");
    expect(errors).toContain("--seq must be a number.");
  });

  it("reads syncdb state through the syncdb group", async (): Promise<void> => {
    const io = createIo(dir);
    expect(await runCli(["syncdb", "state", "--collection", "todos", "--no-events"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toBe(
      'get_syncdb_state:{"collection":"todos","includeDebugEvents":false}'
    );
  });

  it("covers storage, dev commands, and dispatch", async (): Promise<void> => {
    const io = createIo(dir);
    expect(await runCli(["storage", "read", "--keys", "a, b", "--prefix", "auth"], io)).toBe(0);
    expect(await runCli(["storage", "write", "--key", "k", "--value", "v"], io)).toBe(0);
    expect(await runCli(["dev", "list"], io)).toBe(0);
    expect(await runCli(["dev", "run", "seedTodos", "--args", '{"count":3}'], io)).toBe(0);
    expect(await runCli(["dispatch", "todos/reset", "--payload", '{"hard":true}'], io)).toBe(0);
    const output = io.stdoutLines.join("\n");
    expect(output).toContain('read_local_storage:{"keys":["a","b"],"prefix":"auth"}');
    expect(output).toContain('write_local_storage:{"key":"k","value":"v"}');
    expect(output).toContain("list_dev_commands:{}");
    expect(output).toContain('invoke_dev_command:{"arguments":{"count":3},"name":"seedTodos"}');
    expect(output).toContain(
      'dispatch_client_action:{"payload":{"hard":true},"type":"todos/reset"}'
    );

    expect(await runCli(["storage"], io)).toBe(1);
    expect(await runCli(["storage", "write", "--key", "k"], io)).toBe(1);
    expect(await runCli(["dev"], io)).toBe(1);
    expect(await runCli(["dev", "run"], io)).toBe(1);
    expect(await runCli(["dispatch"], io)).toBe(1);
  });

  it("lists, describes, and calls tools by MCP name", async (): Promise<void> => {
    const io = createIo(dir);
    expect(await runCli(["tool", "list"], io)).toBe(0);
    const listing = io.stdoutLines.join("\n");
    expect(listing).toContain("read_logs");
    expect(listing).toContain("Describe read_logs.");
    expect(listing).not.toContain("More detail.");
    expect(listing).toContain("terreno_search_docs");

    const localIo = createIo(dir);
    expect(await runCli(["tool", "list", "--local", "--json"], localIo)).toBe(0);
    const rows = JSON.parse(localIo.stdoutLines.join("\n")) as Array<{name: string}>;
    expect(rows.map((row) => row.name)).toEqual(FAKE_TOOL_NAMES);

    const hostedIo = createIo(dir);
    expect(await runCli(["tool", "list", "--hosted", "--json"], hostedIo)).toBe(0);
    expect(hostedIo.stdoutLines.join("\n")).not.toContain('"read_logs"');

    const schemaIo = createIo(dir);
    expect(await runCli(["tool", "schema", "read_logs"], schemaIo)).toBe(0);
    expect(schemaIo.stdoutLines.join("\n")).toContain('"server": "local"');

    const callIo = createIo(dir);
    expect(await runCli(["tool", "call", "read_logs", "--args", '{"level":"error"}'], callIo)).toBe(
      0
    );
    expect(callIo.stdoutLines.join("\n")).toBe('read_logs:{"level":"error"}');

    await writeFile(join(dir, "args.json"), '{"entries":5}');
    expect(await runCli(["tool", "call", "read_logs", "--args-file", "args.json"], callIo)).toBe(0);
    expect(callIo.stdoutLines.join("\n")).toContain('read_logs:{"entries":5}');

    expect(await runCli(["tool", "call", "nope"], callIo)).toBe(1);
    expect(await runCli(["tool", "schema", "nope"], callIo)).toBe(1);
    expect(await runCli(["tool", "call", "read_logs", "--args", "[]"], callIo)).toBe(1);
    expect(await runCli(["tool"], callIo)).toBe(1);
    expect(callIo.stderrLines.join("\n")).toContain("--args must be a JSON object.");
  });

  it("calls a hosted tool in process", async (): Promise<void> => {
    const io = createIo(dir);
    expect(
      await runCli(
        ["tool", "call", "terreno_get_update_note", "--args", '{"id":"upgrade:58.0.3"}', "--json"],
        io
      )
    ).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain('"id": "upgrade:58.0.3"');
  });

  it("searches, reads, and asks about update notes", async (): Promise<void> => {
    const io = createIo(dir);
    expect(await runCli(["docs", "notes", "search", "syncdb", "--limit", "1", "--json"], io)).toBe(
      0
    );
    expect(io.stdoutLines.join("\n")).toContain('"hits"');
    expect(await runCli(["docs", "notes", "get", "upgrade:58.0.3"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Terreno 58.0.3 upgrade notes");
    expect(await runCli(["docs", "notes", "ask", "what", "changed", "in", "syncdb"], io)).toBe(0);
    expect(await runCli(["docs", "notes", "search"], io)).toBe(1);
    expect(await runCli(["docs", "notes", "bogus", "x"], io)).toBe(1);
    expect(io.stderrLines.join("\n")).toContain("Usage: terreno docs notes");
  });

  it("validates a block document and fails on an invalid one", async (): Promise<void> => {
    const io = createIo(dir);
    await writeFile(
      join(dir, "reply.yaml"),
      "v: 1\nblocks:\n  - type: text\n    markdown: hello\n"
    );
    expect(await runCli(["validate", "blocks", "--file", "reply.yaml", "--json"], io)).toBe(0);
    expect(JSON.parse(io.stdoutLines.join("\n"))).toEqual({ok: true, result: ""});

    await writeFile(join(dir, "bad.yaml"), "v: 1\nblocks:\n  - type: text\n    text: hello\n");
    const badIo = createIo(dir);
    expect(await runCli(["validate", "blocks", "--file", "bad.yaml"], badIo)).toBe(1);
    expect(badIo.stdoutLines.join("\n")).toContain("blocks[0].markdown  MISSING_REQUIRED");
    const badJsonIo = createIo(dir);
    expect(await runCli(["validate", "blocks", "--file", "bad.yaml", "--json"], badJsonIo)).toBe(1);
    expect(badJsonIo.stdoutLines.join("\n")).toContain('"ok": false');

    expect(await runCli(["validate", "nope", "--file", "reply.yaml"], io)).toBe(1);
    expect(await runCli(["validate", "blocks"], io)).toBe(1);
    expect(io.stderrLines.join("\n")).toContain("Usage: terreno validate <schema|blocks>");
  });

  it("routes local commands through a running session", async (): Promise<void> => {
    const io = createIo(dir);
    const session = await startTestSession(io);
    const {calls} = session;
    try {
      expect(await runCli(["browser", "open", "http://localhost:8082", "--width", "800"], io)).toBe(
        0
      );
      expect(await runCli(["browser", "click", "--selector", "#go", "--json"], io)).toBe(0);
      expect(
        await runCli(["browser", "press", "--key", "Enter", "--modifiers", "Shift,Meta"], io)
      ).toBe(0);
      expect(await runCli(["syncdb", "snapshot", "capture", "--collection", "todos"], io)).toBe(0);
      expect(await runCli(["syncdb", "snapshot", "get", "snap-1"], io)).toBe(0);
      expect(await runCli(["logs", "--level", "error"], io)).toBe(0);
      expect(calls).toEqual([
        {args: {action: "open", url: "http://localhost:8082", width: 800}, name: "browser"},
        {args: {action: "click", selector: "#go"}, name: "browser"},
        {args: {action: "press", key: "Enter", modifiers: ["Shift", "Meta"]}, name: "browser"},
        {args: {action: "capture", collection: "todos"}, name: "syncdb_snapshot"},
        {args: {action: "get", snapshotId: "snap-1"}, name: "syncdb_snapshot"},
        {args: {level: "error", sources: []}, name: "read_logs"},
      ]);
      expect(io.stdoutLines.join("\n")).toContain('"via": "session"');
      expect(io.stderrLines).toEqual([]);

      expect(await runCli(["tool", "call", "browser", "--args", '{"action":"close"}'], io)).toBe(0);
      expect(calls.at(-1)).toEqual({args: {action: "close"}, name: "browser"});

      expect(await runCli(["session", "status", "--json"], io)).toBe(0);
      expect(io.stdoutLines.join("\n")).toContain('"running": true');
      expect(await runCli(["session", "status"], io)).toBe(0);
      expect(await runCli(["session", "start"], io)).toBe(0);
      expect(io.stdoutLines.join("\n")).toContain("Already running");
    } finally {
      await session.stop();
    }
  });

  it("defaults browser open to the web app URL and rejects unknown actions", async (): Promise<void> => {
    const io = createIo(dir);
    const session = await startTestSession(io);
    const {calls} = session;
    try {
      expect(await runCli(["browser", "open"], io)).toBe(0);
      expect(calls[0]?.args).toEqual({action: "open", url: "http://localhost:8082"});
      expect(await runCli(["browser", "dance"], io)).toBe(1);
      expect(io.stderrLines.join("\n")).toContain("Usage: terreno browser <open|click");
    } finally {
      await session.stop();
    }
  });

  it("reports session tool failures and refuses a wrong token", async (): Promise<void> => {
    const io = createIo(dir);
    const session = await startTestSession(io);
    try {
      expect(await runCli(["tool", "call", "read_logs", "--args", "{}"], io)).toBe(0);
      const denied = await fetch(`http://127.0.0.1:${String(session.port)}/call`, {
        body: JSON.stringify({name: "read_logs"}),
        headers: {authorization: "Bearer wrong"},
        method: "POST",
      });
      expect(denied.status).toBe(401);
      const headers = {authorization: `Bearer ${session.token}`};
      const base = `http://127.0.0.1:${String(session.port)}`;
      expect((await fetch(`${base}/nope`, {headers, method: "POST"})).status).toBe(404);
      const missing = await fetch(`${base}/call`, {body: "{}", headers, method: "POST"});
      expect(missing.status).toBe(400);
      const failed = await fetch(`${base}/call`, {
        body: JSON.stringify({name: "explode"}),
        headers,
        method: "POST",
      });
      expect(failed.status).toBe(500);
      expect(((await failed.json()) as {error: string}).error).toBe("tool blew up");
    } finally {
      await session.stop();
    }
  });

  it("stops a session and clears stale state", async (): Promise<void> => {
    const io = createIo(dir);
    const session = await startTestSession(io);
    expect(await runCli(["session", "stop"], io)).toBe(0);
    await session.stop();
    expect(io.stdoutLines.join("\n")).toContain("Stopped the CLI session.");
    expect(await runCli(["session", "stop", "--json"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain('"wasRunning": false');

    // A state file whose process is gone is dropped, and stateless tools run in process.
    const stateDir = await ensureCliStateDir(io);
    const exited = Bun.spawn(["true"]);
    await exited.exited;
    await writePrivateJson(join(stateDir, "session.json"), {
      pid: exited.pid,
      port: 1,
      token: "gone",
    });
    expect(await findLiveSession(io)).toBeUndefined();
    expect(existsSync(join(stateDir, "session.json"))).toBe(false);
    expect(await runCli(["session", "status"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("No CLI session is running.");
    expect(await runCli(["session", "bogus"], io)).toBe(1);
    expect(await runCli(["session", "start", "--idle-minutes"], io)).toBe(1);
    expect(await runCli(["session", "start", "--idle-minutes=-1"], io)).toBe(1);
  });

  it("serves a session that a start call can find and stop", async (): Promise<void> => {
    const io = createIo(dir);
    let serving: Promise<void> | undefined;
    const {isNew, state} = await startSession({
      io,
      spawnServe: (): void => {
        serving = serveSession({
          handle: async (name: string): Promise<ToolCallResult> => ({
            content: [{text: `served ${name}`, type: "text"}],
          }),
          idleMinutes: 0,
          io,
        });
      },
    });
    expect(isNew).toBe(true);
    const stateDir = await ensureCliStateDir(io);
    expect((await stat(join(stateDir, "session.json"))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(stateDir, ".gitignore"), "utf8")).toBe("*\n");
    expect(state.port).toBeGreaterThan(0);

    expect(await runCli(["info"], io)).toBe(0);
    expect(io.stdoutLines.join("\n")).toBe("served application_info");
    expect(await runCli(["session", "stop"], io)).toBe(0);
    await serving;
    expect(existsSync(join(stateDir, "session.json"))).toBe(false);
  });

  it("starts a detached session on demand for a stateful command", async (): Promise<void> => {
    // The session process runs the CLI entry point; under `bun test` argv[1] is not it.
    const previousEntry = process.argv[1];
    process.argv[1] = join(import.meta.dir, "bin.ts");
    const io = createIo(dir);
    try {
      expect(await runCli(["syncdb", "snapshot", "list", "--json"], io)).toBe(0);
      expect(io.stdoutLines.join("\n")).toBe("[]");
      expect(io.stderrLines.join("\n")).toContain("Started a terreno CLI session");
      expect(await runCli(["session", "start", "--idle-minutes", "5", "--json"], io)).toBe(0);
      expect(io.stdoutLines.join("\n")).toContain('"isNew": false');
    } finally {
      process.argv[1] = previousEntry ?? "";
      expect(await runCli(["session", "stop"], io)).toBe(0);
    }
  }, 20000);

  it("applies each command's own eval opt-in inside a shared session", async (): Promise<void> => {
    const io = createIo(dir);
    let serving: Promise<void> = Promise.resolve();
    await startSession({
      io,
      spawnServe: (): void => {
        serving = serveSession({
          handle: async (): Promise<ToolCallResult> => ({
            content: [{text: `eval=${process.env.TERRENO_MCP_EVAL ?? "off"}`, type: "text"}],
          }),
          idleMinutes: 0,
          io,
        });
      },
    });
    const previous = process.env.TERRENO_MCP_EVAL;
    try {
      // The session process itself has the gate open; a caller without it still gets it closed.
      process.env.TERRENO_MCP_EVAL = "1";
      expect(await runCli(["navigate", "/profile"], io)).toBe(0);
      expect(io.stdoutLines.at(-1)).toBe("eval=off");
      io.env.TERRENO_MCP_EVAL = "1";
      expect(await runCli(["navigate", "/profile"], io)).toBe(0);
      expect(io.stdoutLines.at(-1)).toBe("eval=1");
      expect(process.env.TERRENO_MCP_EVAL).toBe("1");

      // And the reverse: a session without the gate honors a caller that opts in.
      delete process.env.TERRENO_MCP_EVAL;
      expect(await runCli(["navigate", "/profile"], io)).toBe(0);
      expect(io.stdoutLines.at(-1)).toBe("eval=1");
      expect(process.env.TERRENO_MCP_EVAL).toBeUndefined();
    } finally {
      if (previous === undefined) {
        delete process.env.TERRENO_MCP_EVAL;
      } else {
        process.env.TERRENO_MCP_EVAL = previous;
      }
      await stopSession(io);
      await serving;
    }
  });

  it("starts one session when two commands start at once", async (): Promise<void> => {
    const io = createIo(dir);
    let spawns = 0;
    let serving: Promise<void> = Promise.resolve();
    const spawnServe = (): void => {
      spawns += 1;
      serving = serveSession({handle: fakeLocalTools.call, idleMinutes: 0, io});
    };
    const [first, second] = await Promise.all([
      startSession({io, spawnServe}),
      startSession({io, spawnServe}),
    ]);
    expect(spawns).toBe(1);
    expect(first.state.token).toBe(second.state.token);
    expect([first.isNew, second.isNew].sort()).toEqual([false, true]);
    expect(existsSync(join(dir, ".terreno", "cli", "session.lock"))).toBe(false);

    // A second server never replaces one that is answering.
    await serveSession({handle: fakeLocalTools.call, idleMinutes: 0, io});
    expect((await findLiveSession(io))?.token).toBe(first.state.token);

    // `tool call` routes a stateful tool the same way the dedicated command does.
    expect(
      await runCli(["tool", "call", "syncdb_snapshot", "--args", '{"action":"list"}'], io)
    ).toBe(0);
    expect(io.stdoutLines.at(-1)).toBe('syncdb_snapshot:{"action":"list"}');

    await stopSession(io);
    await serving;
  });

  it("ends a session process that is alive but not answering", async (): Promise<void> => {
    const io = createIo(dir);
    const child = Bun.spawn(["sleep", "30"]);
    const stateDir = await ensureCliStateDir(io);
    await writePrivateJson(join(stateDir, "session.json"), {pid: child.pid, port: 1, token: "x"});
    // Unanswering but alive: the state file stays so stop can still reach the process.
    expect(await findLiveSession(io)).toBeUndefined();
    expect(existsSync(join(stateDir, "session.json"))).toBe(true);
    expect(await stopSession(io)).toBe(true);
    await child.exited;
    expect(existsSync(join(stateDir, "session.json"))).toBe(false);

    // A lock left by a command that died while starting is taken over.
    await writeFile(join(stateDir, "session.lock"), "1");
    const old = new Date(Date.now() - 60000);
    await utimes(join(stateDir, "session.lock"), old, old);
    let serving: Promise<void> = Promise.resolve();
    const {isNew} = await startSession({
      io,
      spawnServe: (): void => {
        serving = serveSession({handle: fakeLocalTools.call, idleMinutes: 0, io});
      },
    });
    expect(isNew).toBe(true);
    await stopSession(io);
    await serving;
  });

  it("idles out, and reports a session that never starts", async (): Promise<void> => {
    const io = createIo(dir);
    await serveSession({
      handle: fakeLocalTools.call,
      idleMinutes: 0.001,
      io,
    });
    expect(await findLiveSession(io)).toBeUndefined();

    let message = "";
    try {
      await startSession({io, spawnServe: (): void => {}, timeoutMs: 150});
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("The CLI session did not start. See ");
  });

  it("logs in with Better Auth, saves the token, and sends it from terreno api", async (): Promise<void> => {
    const requests: Array<{authorization: string | null; url: string}> = [];
    const spec = {
      openapi: "3.0.0",
      paths: {"/todos": {get: {operationId: "todo_list"}}},
      servers: [{url: "http://api.test"}],
    };
    await writeFile(join(dir, "openapi.json"), JSON.stringify(spec));
    const io = createIo(
      dir,
      stubFetch(async (input, init) => {
        const url = String(input);
        requests.push({authorization: new Headers(init?.headers).get("authorization"), url});
        if (url.endsWith("/api/auth/sign-in/email")) {
          return new Response("{}", {headers: {"set-auth-token": "ba-token"}});
        }
        return Response.json({data: []});
      })
    );
    expect(
      await runCli(
        ["login", "--email", "a@b.co", "--password", "pw", "--base-url", "http://api.test/"],
        io
      )
    ).toBe(0);
    expect(io.stdoutLines.join("\n")).toContain("Logged in to http://api.test (better-auth)");
    expect(io.stdoutLines.join("\n")).not.toContain("ba-token");
    const authPath = join(dir, ".terreno", "cli", "auth.json");
    expect((await stat(authPath)).mode & 0o777).toBe(0o600);

    expect(await runCli(["api", "call", "todo_list", "--schema", "openapi.json"], io)).toBe(0);
    expect(requests.at(-1)).toEqual({
      authorization: "Bearer ba-token",
      url: "http://api.test/todos",
    });

    // An explicit token wins, and a different API origin never gets the saved token.
    await runCli(["api", "call", "todo_list", "--schema", "openapi.json", "--token", "mine"], io);
    expect(requests.at(-1)?.authorization).toBe("Bearer mine");
    await runCli(
      ["api", "call", "todo_list", "--schema", "openapi.json", "--base-url", "http://other.test"],
      io
    );
    expect(requests.at(-1)).toEqual({authorization: null, url: "http://other.test/todos"});

    // A spec fetched from the API that lists no servers uses the schema URL's origin.
    const servedIo = createIo(
      dir,
      stubFetch(async (input, init) => {
        const url = String(input);
        requests.push({authorization: new Headers(init?.headers).get("authorization"), url});
        return Response.json(url.endsWith("/openapi.json") ? {...spec, servers: undefined} : {});
      })
    );
    expect(
      await runCli(
        ["api", "call", "todo_list", "--schema", "http://api.test/openapi.json"],
        servedIo
      )
    ).toBe(0);
    expect(requests.at(-1)).toEqual({
      authorization: "Bearer ba-token",
      url: "http://api.test/todos",
    });

    expect(await runCli(["logout"], io)).toBe(0);
    expect(existsSync(authPath)).toBe(false);
    await runCli(["api", "call", "todo_list", "--schema", "openapi.json"], io);
    expect(requests.at(-1)?.authorization).toBeNull();
    expect(await runCli(["logout", "--json"], io)).toBe(0);
  });

  it("falls back to JWT login and can print without saving", async (): Promise<void> => {
    const io = createIo(
      dir,
      stubFetch(async (input) => {
        if (String(input).endsWith("/auth/login")) {
          return Response.json({data: {token: "jwt-token", userId: "u1"}});
        }
        return new Response("not found", {status: 404});
      })
    );
    io.env.TERRENO_EMAIL = "a@b.co";
    io.env.TERRENO_PASSWORD = "pw";
    expect(await runCli(["login", "--print-token", "--no-save"], io)).toBe(0);
    expect(io.stdoutLines).toEqual(["jwt-token"]);
    expect(existsSync(join(dir, ".terreno", "cli", "auth.json"))).toBe(false);

    const jsonIo = createIo(dir, io.fetch);
    expect(
      await runCli(
        ["login", "--email", "a@b.co", "--password", "pw", "--json", "--no-save"],
        jsonIo
      )
    ).toBe(0);
    expect(JSON.parse(jsonIo.stdoutLines.join("\n"))).toEqual({
      baseUrl: "http://localhost:4000",
      kind: "jwt",
      ok: true,
    });
  });

  it("fails login clearly", async (): Promise<void> => {
    const io = createIo(
      dir,
      stubFetch(async () => new Response("nope", {status: 401}))
    );
    expect(await runCli(["login"], io)).toBe(1);
    expect(io.stderrLines.join("\n")).toContain("Usage: terreno login");
    expect(await runCli(["login", "--email", "a@b.co", "--password", "bad"], io)).toBe(1);
    expect(io.stderrLines.join("\n")).toContain(
      "Login failed (/api/auth/sign-in/email -> HTTP 401; /auth/login -> HTTP 401)."
    );
  });
});

describe("CLI coverage of terreno-mcp-local", () => {
  /** The dedicated command for each local tool; `terreno tool call` reaches all of them too. */
  const COMMAND_FOR_TOOL: Record<string, string> = {
    application_info: "info",
    browser: "browser",
    database_query: "db",
    database_schema: "db",
    dispatch_client_action: "dispatch",
    evaluate: "eval",
    get_syncdb_state: "state",
    invoke_dev_command: "dev",
    last_error: "logs",
    list_dev_commands: "dev",
    navigate: "navigate",
    read_local_storage: "storage",
    read_logs: "logs",
    syncdb_action: "syncdb",
    syncdb_snapshot: "syncdb",
    write_local_storage: "storage",
  };

  it("has a dedicated command for every local tool the server defines", async (): Promise<void> => {
    expect(LOCAL_TOOL_NAMES.length).toBeGreaterThan(10);
    expect(LOCAL_TOOL_NAMES.filter((name) => !COMMAND_FOR_TOOL[name])).toEqual([]);

    const io = createIo(tmpdir());
    for (const command of new Set(Object.values(COMMAND_FOR_TOOL))) {
      expect(await runCli(["help", command], io)).toBe(0);
      expect(io.stdoutLines.at(-1)).toContain(`Usage: terreno ${command}`);
    }
  });
});
