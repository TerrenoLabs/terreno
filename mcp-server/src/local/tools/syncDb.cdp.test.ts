import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import {fakeFetch} from "../../__tests__/fakeFetch.js";
import {resetMetroDevSessionForTests} from "../metro/metroDevSession.js";
import {getSyncDbState, syncDbAction} from "./syncDb.js";

interface FakeMessageEvent {
  data: string;
}

type FakeListener = (event: FakeMessageEvent | Record<string, never>) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static evaluateValue: unknown = {
    name: "app",
    ok: true,
    result: {status: {queuedCount: 2}},
  };

  readyState = 0;
  private readonly listeners = new Map<string, FakeListener[]>();

  constructor(_url: string) {
    queueMicrotask((): void => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    });
  }

  addEventListener(name: string, listener: FakeListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }

  send(raw: string): void {
    const request = JSON.parse(raw) as {id: number; method: string};
    const result =
      request.method === "Runtime.evaluate"
        ? {result: {result: {value: FakeWebSocket.evaluateValue}}}
        : {result: {}};
    queueMicrotask((): void => {
      this.emit("message", {data: JSON.stringify({id: request.id, ...result})});
    });
  }

  private emit(name: string, event: FakeMessageEvent | Record<string, never>): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(event);
    }
  }
}

describe("SyncDB local MCP CDP fallback", () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;
  let previousEval: string | undefined;

  beforeEach((): void => {
    previousEval = process.env.TERRENO_MCP_EVAL;
    process.env.TERRENO_MCP_EVAL = "1";
    process.env.TERRENO_METRO_URL = "http://localhost:8082";
    Reflect.deleteProperty(globalThis, "__TERRENO_SYNCDB__");
    resetMetroDevSessionForTests();
    FakeWebSocket.evaluateValue = {
      name: "app",
      ok: true,
      result: {status: {queuedCount: 2}},
    };
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = fakeFetch(
      async (): Promise<Response> =>
        new Response(
          JSON.stringify([
            {
              title: "Hermes app",
              webSocketDebuggerUrl: "ws://localhost:8082/cdp",
            },
          ]),
          {status: 200}
        )
    );
  });

  afterEach((): void => {
    resetMetroDevSessionForTests();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    Reflect.deleteProperty(globalThis, "__TERRENO_SYNCDB__");
    if (previousEval === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    } else {
      process.env.TERRENO_MCP_EVAL = previousEval;
    }
    Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
  });

  it("surfaces CDP evaluation errors", async (): Promise<void> => {
    globalThis.fetch = fakeFetch(
      async (): Promise<Response> => new Response("unavailable", {status: 503})
    );
    const message = await getSyncDbState({});
    assert.include(message, "503");
    assert.include(message, "CDP:");
  });

  it("returns CDP payload errors and successful inspect results", async (): Promise<void> => {
    FakeWebSocket.evaluateValue = {
      available: [],
      error: "unknown SyncDB client",
      ok: false,
    };
    assert.include(await getSyncDbState({name: "missing"}), "unknown SyncDB client");

    FakeWebSocket.evaluateValue = {
      name: "app",
      ok: true,
      result: {status: {queuedCount: 2}},
    };
    const state = JSON.parse(await getSyncDbState({})) as {status: {queuedCount: number}};
    assert.equal(state.status.queuedCount, 2);

    const action = JSON.parse(await syncDbAction({action: "flush"})) as {
      client: string;
      result: unknown;
    };
    assert.equal(action.client, "app");
  });
});
