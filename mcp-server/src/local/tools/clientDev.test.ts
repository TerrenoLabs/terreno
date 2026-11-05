import {afterEach, describe, expect, it} from "bun:test";
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
      __TERRENO_STORE__?: {dispatch: (action: unknown) => unknown};
    };
    delete g.__TERRENO_DEV_COMMANDS__;
    delete g.__TERRENO_DEV_STORAGE__;
    delete g.__TERRENO_STORE__;
  });

  it("refuses dispatch without TERRENO_MCP_EVAL", async (): Promise<void> => {
    const text = await dispatchClientAction({type: "test/action"});
    expect(text).toContain("Refused");
  });

  it("dispatches through an in-process store when eval is enabled", async (): Promise<void> => {
    process.env.TERRENO_MCP_EVAL = "1";
    const actions: unknown[] = [];
    (globalThis as typeof globalThis & {__TERRENO_STORE__?: unknown}).__TERRENO_STORE__ = {
      dispatch: (action: unknown) => {
        actions.push(action);
        return action;
      },
    };
    const text = await dispatchClientAction({payload: {x: 1}, type: "demo/ping"});
    expect(text).toContain('"ok": true');
    expect(actions).toEqual([{payload: {x: 1}, type: "demo/ping"}]);
  });

  it("reads and writes local storage in-process", async (): Promise<void> => {
    const data = new Map<string, string>([["persist:root", "{}"]]);
    (
      globalThis as typeof globalThis & {__TERRENO_DEV_STORAGE__?: unknown}
    ).__TERRENO_DEV_STORAGE__ = {
      canWriteKey: () => true,
      get: async (key: string) => data.get(key) ?? null,
      listKeys: async () => [...data.keys()],
      set: async (key: string, value: string) => {
        data.set(key, value);
      },
    };
    const readText = await readLocalStorage({prefix: "persist:"});
    expect(readText).toContain("persist:root");
    const refused = await writeLocalStorage({key: "demo", value: "1"});
    expect(refused).toContain("Refused");
    process.env.TERRENO_MCP_EVAL = "1";
    expect(await writeLocalStorage({key: "demo", value: "1"})).toContain('"ok": true');
    expect(data.get("demo")).toBe("1");
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
});
