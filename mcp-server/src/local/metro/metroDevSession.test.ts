import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {lastError, readLogs} from "../tools/readLogs";
import {getClientState, navigate} from "../tools/runtime";
import {
  cdpRuntimeEvaluate,
  ensureCdpConnected,
  ensureMetroEventsConnected,
  getCdpConnectionStatus,
  metroDebuggerOrigin,
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
    const evaluateValue = request.params?.expression?.includes("__TERRENO_STORE__")
      ? {
          ok: true,
          state: {
            betterAuth: {userId: "cdp-user"},
            "terreno-rtk": {mutations: {}, queries: {}},
          },
        }
      : 2;
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
    const state = JSON.parse(await getClientState({slice: "auth"})) as {
      layer?: string;
      rtk?: {auth?: {userId?: string}};
    };
    expect(state.layer).toBe("rtk");
    expect(state.rtk?.auth?.userId).toBe("cdp-user");
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

// A Bun server standing in for Metro's inspector proxy. Its upgrade check mirrors
// @react-native/dev-middleware 0.86 `verifyClient` (Origin required: the server origin or a loopback
// hostname) plus Expo's `isMatchingOrigin` (Origin host must equal serverBaseUrl's host, which Expo
// always builds as 127.0.0.1:<port>).
interface FakeInspectorProxy {
  baseUrl: string;
  kick: (code: number, reason: string) => void;
  origins: Array<string | null>;
  stop: () => void;
}

const LOOPBACK_ORIGIN_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::]"]);

const startFakeInspectorProxy = (): FakeInspectorProxy => {
  const origins: Array<string | null> = [];
  const sockets = new Set<Bun.ServerWebSocket<unknown>>();
  const server = Bun.serve({
    fetch: (req, srv): Response | undefined => {
      const url = new URL(req.url);
      const serverBaseUrl = `http://127.0.0.1:${srv.port}`;
      if (url.pathname === "/json/list") {
        return Response.json([
          {
            description: "React Native Bridgeless [C++ connection]",
            title: "com.terreno.example (sdk_gphone64_x86_64)",
            webSocketDebuggerUrl: `ws://localhost:${srv.port}/inspector/debug?device=d1&page=1`,
          },
        ]);
      }
      if (url.pathname !== "/inspector/debug") {
        return new Response("not found", {status: 404});
      }
      const origin = req.headers.get("origin");
      origins.push(origin);
      const passesVerifyClient =
        origin !== null &&
        (origin === serverBaseUrl ||
          (URL.canParse(origin) && LOOPBACK_ORIGIN_HOSTNAMES.has(new URL(origin).hostname)));
      if (!passesVerifyClient) {
        return new Response("Unauthorized", {status: 401});
      }
      if (new URL(origin).host !== new URL(serverBaseUrl).host) {
        // Expo terminates a socket whose Origin host is not serverBaseUrl's host.
        return new Response("Forbidden", {status: 403});
      }
      if (srv.upgrade(req, {data: undefined})) {
        return undefined;
      }
      return new Response("upgrade failed", {status: 500});
    },
    hostname: "localhost",
    port: 0,
    websocket: {
      close: (ws): void => {
        sockets.delete(ws);
      },
      message: (ws, raw): void => {
        const request = JSON.parse(String(raw)) as {id: number};
        ws.send(JSON.stringify({id: request.id, result: {}}));
      },
      open: (ws): void => {
        sockets.add(ws);
      },
    },
  });
  return {
    baseUrl: `http://localhost:${server.port}`,
    kick: (code, reason): void => {
      for (const ws of sockets) {
        ws.close(code, reason);
      }
    },
    origins,
    stop: (): void => {
      server.stop(true);
    },
  };
};

const waitForCdpStatus = async (fragment: string): Promise<string> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const status = getCdpConnectionStatus();
    if (status.includes(fragment)) {
      return status;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20);
    });
  }
  return getCdpConnectionStatus();
};

describe("Metro development session against an origin-checking inspector proxy", () => {
  let proxy: FakeInspectorProxy;

  beforeEach((): void => {
    resetMetroDevSessionForTests();
    proxy = startFakeInspectorProxy();
    process.env.TERRENO_METRO_URL = proxy.baseUrl;
  });

  afterEach((): void => {
    resetMetroDevSessionForTests();
    proxy.stop();
    Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
  });

  it("sends Metro's loopback Origin on the debugger socket", async (): Promise<void> => {
    const result = await ensureCdpConnected();
    expect(result).toEqual({
      detail: "connected to com.terreno.example (sdk_gphone64_x86_64)",
      ok: true,
    });
    const port = new URL(proxy.baseUrl).port;
    expect(proxy.origins).toEqual([`http://127.0.0.1:${port}`]);
  });

  it("names Metro's close code and reason when another debugger takes the session", async (): Promise<void> => {
    expect((await ensureCdpConnected()).ok).toBe(true);
    proxy.kick(1000, "[NEW_DEBUGGER_OPENED] New debugger opened for the same app instance");
    const status = await waitForCdpStatus("CDP disconnected");
    expect(status).toContain(
      "CDP disconnected (code 1000: [NEW_DEBUGGER_OPENED] New debugger opened for the same app instance)"
    );
  });

  it("reports a close without a reason by its code", async (): Promise<void> => {
    expect((await ensureCdpConnected()).ok).toBe(true);
    proxy.kick(1011, "");
    const status = await waitForCdpStatus("CDP disconnected");
    expect(status).toContain("CDP disconnected (code 1011)");
  });
});

describe("metroDebuggerOrigin", () => {
  it("maps the Metro base URL to the 127.0.0.1 origin on the same port", (): void => {
    expect(metroDebuggerOrigin("http://localhost:8082")).toBe("http://127.0.0.1:8082");
    expect(metroDebuggerOrigin("http://127.0.0.1:19000/")).toBe("http://127.0.0.1:19000");
    expect(metroDebuggerOrigin("http://192.168.1.20:8081")).toBe("http://127.0.0.1:8081");
    expect(metroDebuggerOrigin("http://localhost")).toBe("http://127.0.0.1");
    expect(metroDebuggerOrigin("https://localhost:8443")).toBe("https://127.0.0.1:8443");
  });
});
