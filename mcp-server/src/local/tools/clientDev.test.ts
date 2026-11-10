import {afterEach, describe, expect, it, spyOn} from "bun:test";
import * as metroSession from "../metro/metroDevSession.js";
import {resetMetroDevSessionForTests} from "../metro/metroDevSession.js";
import {
  dispatchClientAction,
  invokeDevCommand,
  listDevCommands,
  readLocalStorage,
  writeLocalStorage,
} from "./clientDev.js";

describe("clientDev MCP tools", () => {
  afterEach((): void => {
    resetMetroDevSessionForTests();
    Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    const g = globalThis as typeof globalThis & {
      __TERRENO_DEV_COMMANDS__?: Record<string, unknown>;
      __TERRENO_DEV_STORAGE__?: unknown;
      __TERRENO_DEV_CLIENT_DISPATCH__?: {
        dispatch: (action: unknown) => unknown;
      };
    };
    delete g.__TERRENO_DEV_COMMANDS__;
    delete g.__TERRENO_DEV_STORAGE__;
    delete g.__TERRENO_DEV_CLIENT_DISPATCH__;
  });

  it("refuses dispatch without TERRENO_MCP_EVAL", async (): Promise<void> => {
    const text = await dispatchClientAction({type: "test/action"});
    expect(text).toContain("Refused");
  });

  it("dispatches through an in-process client bus when eval is enabled", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const actions: unknown[] = [];
    (
      globalThis as typeof globalThis & {__TERRENO_DEV_CLIENT_DISPATCH__?: unknown}
    ).__TERRENO_DEV_CLIENT_DISPATCH__ = {
      dispatch: (action: unknown) => {
        actions.push(action);
        return action;
      },
    };
    const text = await dispatchClientAction({payload: {x: 1}, type: "demo/ping"});
    expect(text).toContain('"ok": true');
    expect(actions).toEqual([{payload: {x: 1}, type: "demo/ping"}]);
  });

  it("dispatch returns when action type is blank after trim", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const text = await dispatchClientAction({type: "   "});
    expect(text).toBe("No action type provided.");
  });

  it("dispatch returns JSON error when in-process client bus throws", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    (
      globalThis as typeof globalThis & {__TERRENO_DEV_CLIENT_DISPATCH__?: unknown}
    ).__TERRENO_DEV_CLIENT_DISPATCH__ = {
      dispatch: () => {
        throw new Error("boom");
      },
    };
    const text = await dispatchClientAction({type: "a"});
    expect(text).toContain('"ok": false');
    expect(text).toContain("boom");
  });

  it("dispatch CDP path returns error JSON when Runtime.evaluate fails", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      error: "eval failed",
    });
    const statusSpy = spyOn(metroSession, "getCdpConnectionStatus").mockReturnValue("CDP: down");
    const text = await dispatchClientAction({type: "x"});
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    statusSpy.mockRestore();
    expect(text).toContain("eval failed");
    expect(text).toContain("CDP: down");
  });

  it("dispatch CDP path returns result and status when evaluate succeeds", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      value: {extra: 1, ok: true},
    });
    const statusSpy = spyOn(metroSession, "getCdpConnectionStatus").mockReturnValue("CDP: up");
    const text = await dispatchClientAction({payload: {z: 2}, type: "y"});
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    statusSpy.mockRestore();
    expect(text).toContain("extra");
    expect(text).toContain("CDP: up");
  });

  it("reads and writes local storage in-process", async (): Promise<void> => {
    const data = new Map<string, string>([["persist:root", "{}"]]);
    (
      globalThis as typeof globalThis & {__TERRENO_DEV_STORAGE__?: unknown}
    ).__TERRENO_DEV_STORAGE__ = {
      canWriteKey: (key: string) => key !== "readonly",
      get: async (key: string) => data.get(key) ?? null,
      listKeys: async () => [...data.keys()],
      set: async (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const refused = await writeLocalStorage({key: "demo", value: "1"});
    expect(refused).toContain("Refused");
    process.env.TERRENO_MCP_EVAL = "1";
    const longValue = "x".repeat(9000);
    expect(await writeLocalStorage({key: "long", value: longValue})).toContain('"ok": true');
    const readText = await readLocalStorage({prefix: "persist:"});
    expect(readText).toContain("persist:root");
    const listKeysOnly = await readLocalStorage({});
    expect(listKeysOnly).toContain("persist:root");
    const longRead = await readLocalStorage({keys: ["long"]});
    expect(longRead).toContain("…");
    expect(await writeLocalStorage({key: "readonly", value: "no"})).toContain("not writable");
    expect(await writeLocalStorage({key: "demo", value: "1"})).toContain('"ok": true');
    expect(data.get("demo")).toBe("1");
    (
      globalThis as typeof globalThis & {__TERRENO_DEV_STORAGE__?: unknown}
    ).__TERRENO_DEV_STORAGE__ = {
      canWriteKey: () => true,
      get: async () => null,
      listKeys: async () => [],
      set: async () => {
        throw new Error("persist failed");
      },
    };
    const persistErr = await writeLocalStorage({key: "fail", value: "v"});
    expect(persistErr).toContain("persist failed");
    expect(persistErr).toContain('"ok": false');
  });

  it("writeLocalStorage returns when key is blank after trim", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const text = await writeLocalStorage({key: "   ", value: "x"});
    expect(text).toBe("No key provided.");
  });

  it("lists and invokes dev commands in-process when eval is enabled", async (): Promise<void> => {
    (
      globalThis as typeof globalThis & {
        __TERRENO_DEV_COMMANDS__?: Record<
          string,
          {description: string; handler: (args: Record<string, unknown>) => unknown}
        >;
      }
    ).__TERRENO_DEV_COMMANDS__ = {
      ping: {
        description: "pong",
        handler: ({n}) => Number(n) + 1,
      },
    };
    const listed = JSON.parse(await listDevCommands()) as {commands: Array<{name: string}>};
    expect(listed.commands[0]?.name).toBe("ping");
    expect(await invokeDevCommand({name: "ping"})).toContain("Refused");
    process.env.TERRENO_MCP_EVAL = "1";
    const invoked = JSON.parse(await invokeDevCommand({arguments: {n: 2}, name: "ping"})) as {
      ok?: boolean;
      result?: number;
    };
    expect(invoked.ok).toBe(true);
    expect(invoked.result).toBe(3);
  });

  it("listDevCommands uses CDP when registry is empty", async (): Promise<void> => {
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      value: '[{"description":"d","name":"x"}]',
    });
    const text = await listDevCommands();
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    expect(text).toContain('"name": "x"');
  });

  it("listDevCommands CDP error returns empty commands and error payload", async (): Promise<void> => {
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      error: "list failed",
    });
    const statusSpy = spyOn(metroSession, "getCdpConnectionStatus").mockReturnValue("CDP: err");
    const text = await listDevCommands();
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    statusSpy.mockRestore();
    expect(text).toContain("list failed");
    expect(text).toContain('"commands": []');
    expect(text).toContain("CDP: err");
  });

  it("listDevCommands parses non-string evaluate result", async (): Promise<void> => {
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      value: [{description: "d", name: "parsed"}],
    });
    const text = await listDevCommands();
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    expect(text).toContain("parsed");
  });

  it("invokeDevCommand CDP path runs when registry empty and eval on", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      value: {ok: true, result: 7},
    });
    const text = await invokeDevCommand({arguments: {n: 1}, name: "z"});
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    expect(text).toContain("7");
  });

  it("invokeDevCommand in-process throws for unknown command name", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    (
      globalThis as typeof globalThis & {
        __TERRENO_DEV_COMMANDS__?: Record<
          string,
          {description: string; handler: (args: Record<string, unknown>) => unknown}
        >;
      }
    ).__TERRENO_DEV_COMMANDS__ = {only: {description: "x", handler: () => 1}};
    const text = await invokeDevCommand({name: "missing"});
    expect(text).toContain("Unknown dev command");
    expect(text).toContain('"ok": false');
  });

  it("invokeDevCommand in-process returns error when handler throws", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    (
      globalThis as typeof globalThis & {
        __TERRENO_DEV_COMMANDS__?: Record<
          string,
          {description: string; handler: (args: Record<string, unknown>) => unknown}
        >;
      }
    ).__TERRENO_DEV_COMMANDS__ = {
      bad: {
        description: "throws",
        handler: () => {
          throw new Error("handler boom");
        },
      },
    };
    const text = await invokeDevCommand({name: "bad"});
    expect(text).toContain("handler boom");
    expect(text).toContain('"ok": false');
  });

  it("invokeDevCommand CDP path returns error when evaluate fails", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      error: "invoke cdp err",
    });
    const statusSpy = spyOn(metroSession, "getCdpConnectionStatus").mockReturnValue("CDP: bad");
    const text = await invokeDevCommand({name: "n"});
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    statusSpy.mockRestore();
    expect(text).toContain("invoke cdp err");
    expect(text).toContain("CDP: bad");
  });

  it("invokeDevCommand returns when command name is blank after trim", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const text = await invokeDevCommand({name: "  "});
    expect(text).toBe("No command name provided.");
  });

  it("dispatch uses CDP when store is absent", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      value: {ok: true},
    });
    const text = await dispatchClientAction({type: "a/b"});
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    expect(text).toContain("true");
  });

  it("readLocalStorage CDP path succeeds when no in-process adapter", async (): Promise<void> => {
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      value: {count: 1, entries: {token: "secret"}},
    });
    const statusSpy = spyOn(metroSession, "getCdpConnectionStatus").mockReturnValue("CDP: storage");
    const text = await readLocalStorage({keys: ["token"]});
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    statusSpy.mockRestore();
    expect(text).toContain("secret");
    expect(text).toContain("CDP: storage");
  });

  it("readLocalStorage CDP path lists keys with optional prefix when keys omitted", async (): Promise<void> => {
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      value: {count: 1, entries: {"user:theme": "dark"}},
    });
    const text = await readLocalStorage({prefix: "user:"});
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    expect(text).toContain("user:theme");
  });

  it("writeLocalStorage CDP path succeeds when no in-process adapter", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const ensureSpy = spyOn(metroSession, "ensureCdpConnected").mockResolvedValue({
      detail: "ok",
      ok: true,
    });
    const evalSpy = spyOn(metroSession, "cdpRuntimeEvaluate").mockResolvedValue({
      value: {key: "session", ok: true},
    });
    const statusSpy = spyOn(metroSession, "getCdpConnectionStatus").mockReturnValue("CDP: write");
    const text = await writeLocalStorage({key: "session", value: "abc"});
    ensureSpy.mockRestore();
    evalSpy.mockRestore();
    statusSpy.mockRestore();
    expect(text).toContain("session");
    expect(text).toContain("CDP: write");
  });
});
