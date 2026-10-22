import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {lastError, readLogs} from "../tools/readLogs";
import {navigate} from "../tools/runtime";
import {
  cdpRuntimeEvaluate,
  ensureCdpConnected,
  ensureMetroEventsConnected,
  resetMetroDevSessionForTests,
  snapshotCdpConsoleRing,
  snapshotMetroEventsRing,
} from "./metroDevSession";

interface FakeMessageEvent {
  data: string;
}

type FakeListener = (event: FakeMessageEvent | {message?: string}) => void;

class FakeWebSocket {
  static readonly OPEN = 1;
  static autoRespond = true;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = 0;
  private readonly listeners = new Map<string, FakeListener[]>();

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
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
    const request = JSON.parse(raw) as {
      id: number;
      method: string;
      params?: {expression?: string};
    };
    const evaluateValue = 2;
    const result =
      request.method === "Runtime.evaluate"
        ? {result: {result: {value: evaluateValue}}}
        : {result: {}};
    if (FakeWebSocket.autoRespond) {
      queueMicrotask((): void => {
        this.emit("message", {data: JSON.stringify({id: request.id, ...result})});
      });
    }
  }

  emit(name: string, event: FakeMessageEvent | {message?: string}): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(event);
    }
  }
}

describe("Metro development session", () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach((): void => {
    resetMetroDevSessionForTests();
    FakeWebSocket.autoRespond = true;
    FakeWebSocket.instances = [];
    process.env.TERRENO_METRO_URL = "http://localhost:8082";
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(
        JSON.stringify([
          {
            title: "Hermes app",
            webSocketDebuggerUrl: "ws://localhost:8082/cdp",
          },
        ]),
        {status: 200}
      )) as typeof fetch;
  });

  afterEach((): void => {
    resetMetroDevSessionForTests();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
  });

  it("shares concurrent Metro connections and captures event messages", async (): Promise<void> => {
    const [first, second] = await Promise.all([
      ensureMetroEventsConnected(),
      ensureMetroEventsConnected(),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1);

    FakeWebSocket.instances[0]?.emit("message", {
      data: JSON.stringify({message: "Syntax error", type: "bundle_failed"}),
    });
    const event = JSON.parse(snapshotMetroEventsRing()[0]?.raw ?? "{}") as {
      level?: string;
      source?: string;
    };
    expect(event).toMatchObject({level: "error", source: "metro"});
    const logs = JSON.parse(await readLogs({sources: ["metro"]})) as {
      entries: Array<{level?: string}>;
    };
    expect(logs.entries[0]?.level).toBe("error");
    expect(await lastError({sources: ["metro"]})).toContain("bundle_failed");
  });

  it("connects to Hermes, captures console calls, and evaluates expressions", async (): Promise<void> => {
    const connection = await ensureCdpConnected();
    expect(connection.ok).toBe(true);
    const socket = FakeWebSocket.instances[0];
    socket?.emit("message", {
      data: JSON.stringify({
        method: "Runtime.consoleAPICalled",
        params: {args: [{value: "hello"}], type: "warning"},
      }),
    });
    const entry = JSON.parse(snapshotCdpConsoleRing()[0]?.raw ?? "{}") as {
      level?: string;
      message?: string;
      source?: string;
    };
    expect(entry).toMatchObject({level: "warn", message: "hello", source: "app"});

    expect(await cdpRuntimeEvaluate("1 + 1", true)).toEqual({value: 2});
    const logs = JSON.parse(await readLogs({sources: ["app"]})) as {
      entries: Array<{message?: string}>;
    };
    expect(logs.entries[0]?.message).toBe("hello");

    process.env.TERRENO_MCP_EVAL = "1";
    expect(await navigate({path: "/profile"})).toContain('"result": 2');
  });

  it("reports an unreachable Metro target", async (): Promise<void> => {
    globalThis.fetch = (async (): Promise<Response> =>
      new Response("unavailable", {status: 503})) as typeof fetch;
    const result = await ensureCdpConnected();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("503");
  });

  it("rejects pending evaluations when CDP disconnects", async (): Promise<void> => {
    expect((await ensureCdpConnected()).ok).toBe(true);
    FakeWebSocket.autoRespond = false;
    const evaluation = cdpRuntimeEvaluate("slow()", true);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    FakeWebSocket.instances[0]?.close();
    expect((await evaluation).error).toContain("CDP disconnected");
  });
});
