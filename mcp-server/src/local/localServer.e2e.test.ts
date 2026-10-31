import {afterEach, beforeEach, describe, it} from "bun:test";
import {Client, InMemoryTransport} from "@modelcontextprotocol/client";
import {assert} from "chai";
import {fakeFetch} from "../__tests__/fakeFetch.js";
import {createLocalMcpServer} from "./localServer.js";
import {resetMetroDevSessionForTests} from "./metro/metroDevSession.js";
import {BrowserSession} from "./tools/browser.js";

interface FakeMessageEvent {
  data: string;
}

type FakeWebSocketListener = (event: FakeMessageEvent | Record<string, never>) => void;

class FakeWebSocket {
  static readonly OPEN = 1;

  readyState = 0;
  private readonly listeners = new Map<string, FakeWebSocketListener[]>();

  constructor(_url: string) {
    queueMicrotask((): void => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    });
  }

  addEventListener(name: string, listener: FakeWebSocketListener): void {
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
    const value =
      request.method === "Runtime.evaluate" ? {method: "navigate", ok: true} : undefined;
    queueMicrotask((): void => {
      this.emit("message", {
        data: JSON.stringify({id: request.id, result: {result: {value}}}),
      });
    });
  }

  private emit(name: string, event: FakeMessageEvent | Record<string, never>): void {
    for (const listener of this.listeners.get(name) ?? []) {
      listener(event);
    }
  }
}

class FakeWebView {
  static interactions: string[] = [];

  title = "Terreno web app";
  url = "about:blank";

  async back(): Promise<void> {}

  async click(selector: string): Promise<void> {
    FakeWebView.interactions.push(`click:${selector}`);
  }

  close(): void {}

  async evaluate<T>(_code: string): Promise<T> {
    return {
      elements: [{role: "button", selector: "#save", text: "Save"}],
      text: "Web form submitted",
      title: this.title,
      url: this.url,
    } as T;
  }

  async forward(): Promise<void> {}

  async navigate(url: string): Promise<void> {
    this.url = url;
    FakeWebView.interactions.push(`open:${url}`);
  }

  async press(key: string): Promise<void> {
    FakeWebView.interactions.push(`press:${key}`);
  }

  async reload(): Promise<void> {}

  async screenshot(): Promise<Blob> {
    return new Blob(["proof"]);
  }

  async scroll(x: number, y: number): Promise<void> {
    FakeWebView.interactions.push(`scroll:${x},${y}`);
  }

  async scrollTo(selector: string): Promise<void> {
    FakeWebView.interactions.push(`scrollTo:${selector}`);
  }

  async type(text: string): Promise<void> {
    FakeWebView.interactions.push(`type:${text}`);
  }
}

const textFromToolResult = (result: unknown): string => {
  const content = (result as {content?: Array<{text?: string}>}).content;
  return content?.[0]?.text ?? "";
};

describe("local MCP server end-to-end", () => {
  const originalFetch = globalThis.fetch;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach((): void => {
    FakeWebView.interactions = [];
    process.env.TERRENO_MCP_EVAL = "1";
    process.env.TERRENO_METRO_URL = "http://localhost:8082";
    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket;
    globalThis.fetch = fakeFetch(
      async (): Promise<Response> =>
        new Response(
          JSON.stringify([
            {
              title: "Terreno app",
              webSocketDebuggerUrl: "ws://localhost:8082/cdp",
            },
          ])
        )
    );
  });

  afterEach((): void => {
    resetMetroDevSessionForTests();
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWebSocket;
    Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    Reflect.deleteProperty(process.env, "TERRENO_METRO_URL");
  });

  it("drives app navigation and web interaction through the official MCP client", async (): Promise<void> => {
    const browserSession = new BrowserSession(() => new FakeWebView());
    const server = createLocalMcpServer({
      browserRunner: async (args): Promise<string> =>
        JSON.stringify(await browserSession.run(args), null, 2),
    });
    const client = new Client(
      {name: "terreno-local-e2e", version: "1.0.0"},
      {versionNegotiation: {mode: "auto"}}
    );
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
      const {tools} = await client.listTools();
      assert.includeMembers(
        tools.map((tool) => tool.name),
        ["navigate", "browser"]
      );

      const appResult = await client.callTool({
        arguments: {path: "/profile"},
        name: "navigate",
      });
      assert.include(textFromToolResult(appResult), '"ok": true');

      await client.callTool({
        arguments: {action: "open", url: "http://localhost:8082"},
        name: "browser",
      });
      await client.callTool({
        arguments: {action: "type", selector: "#name", text: "Ada"},
        name: "browser",
      });
      await client.callTool({
        arguments: {action: "press", key: "Enter", modifiers: ["Shift", "invalid"]},
        name: "browser",
      });
      await client.callTool({
        arguments: {action: "click", selector: "#save"},
        name: "browser",
      });
      const snapshotResult = await client.callTool({
        arguments: {action: "snapshot"},
        name: "browser",
      });

      assert.include(textFromToolResult(snapshotResult), "Web form submitted");
      assert.deepEqual(FakeWebView.interactions, [
        "open:http://localhost:8082",
        "click:#name",
        "type:Ada",
        "press:Enter",
        "click:#save",
      ]);
    } finally {
      await client.callTool({arguments: {action: "close"}, name: "browser"}).catch(() => undefined);
      browserSession.close();
      await client.close();
      await server.close();
    }
  });
});
