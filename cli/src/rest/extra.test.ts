import {describe, expect, it} from "bun:test";

import {parseHeaderFlags, parseJsonValue, parseNameValuePairs} from "./flagValues";
import {invokeRestOperation} from "./invoke";
import {defaultBaseUrl, loadOpenApiDocument, parseOpenApiDocument} from "./loadSpec";
import {findRestOperation, listRestOperations} from "./operations";
import {runAppRestCli} from "./runAppRestCli";

/** Bun's `typeof fetch` also carries `preconnect`; add a no-op so stubs satisfy it. */
const stubFetch = (
  handler: (...args: Parameters<typeof fetch>) => Promise<Response>
): typeof fetch => Object.assign(handler, {preconnect: (): void => {}});

const specText = `{
  "openapi": "3.0.0",
  "info": {"title": "Demo", "version": "1"},
  "servers": [{"url": "https://demo.test"}],
  "paths": {
    "/items": {"get": {"operationId": "item_list", "summary": "List"}},
    "/items/{id}": {
      "get": {
        "operationId": "item_read",
        "parameters": [
          {"name": "id", "in": "path", "required": true},
          {"name": "X-Trace", "in": "header"}
        ]
      }
    }
  }
}`;

describe("loadSpec and invoke edges", () => {
  it("rejects empty documents and failed HTTP fetches", async () => {
    expect(() => parseOpenApiDocument("")).toThrow("empty");
    await expect(
      loadOpenApiDocument(
        "https://x.test/missing.json",
        stubFetch(async () => new Response("no", {status: 404}))
      )
    ).rejects.toThrow("HTTP 404");
    const spec = parseOpenApiDocument(specText);
    expect(defaultBaseUrl(spec, "https://override.test/")).toBe("https://override.test");
    expect(defaultBaseUrl({openapi: "3.0.0"})).toBe("");
  });

  it("sends header params and string bodies", async () => {
    const spec = parseOpenApiDocument(specText);
    const operation = findRestOperation(listRestOperations(spec), {id: "item_read"});
    if (!operation) {
      throw new Error("missing item_read");
    }
    const result = await invokeRestOperation({
      baseUrl: "https://demo.test",
      body: "raw",
      fetch: (async (_url, init) => {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(headers["X-Trace"]).toBe("t1");
        return new Response("not-json", {status: 201});
      }) as typeof fetch,
      operation,
      params: {id: "9", "X-Trace": "t1"},
    });
    expect(result.ok).toBe(true);
    expect(result.parsed).toBe("not-json");
  });

  it("requires a base URL", async () => {
    const spec = parseOpenApiDocument(specText);
    const operation = findRestOperation(listRestOperations(spec), {id: "item_list"});
    if (!operation) {
      throw new Error("missing item_list");
    }
    await expect(
      invokeRestOperation({
        baseUrl: "",
        fetch: stubFetch(async () => new Response()),
        operation,
      })
    ).rejects.toThrow("base URL");
  });
});

describe("runAppRestCli call/request", () => {
  it("calls and requests operations", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch(
      async () => new Response(JSON.stringify({ok: true}), {status: 200})
    );
    const originalInfo = console.info;
    const logs: string[] = [];
    console.info = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      expect(
        await runAppRestCli({
          argv: ["call", "item_list", "--json"],
          binName: "demo",
          specText,
          title: "Demo",
        })
      ).toBe(0);
      expect(
        await runAppRestCli({
          argv: ["request", "GET", "/items/{id}", "--param", "id=1"],
          binName: "demo",
          specText,
          title: "Demo",
        })
      ).toBe(0);
      expect(await runAppRestCli({argv: ["call"], binName: "demo", specText, title: "Demo"})).toBe(
        1
      );
      expect(
        await runAppRestCli({argv: ["call", "missing"], binName: "demo", specText, title: "Demo"})
      ).toBe(1);
      expect(
        await runAppRestCli({argv: ["request", "GET"], binName: "demo", specText, title: "Demo"})
      ).toBe(1);
      expect(
        await runAppRestCli({
          argv: ["request", "POST", "/nope"],
          binName: "demo",
          specText,
          title: "Demo",
        })
      ).toBe(1);
      expect(
        await runAppRestCli({argv: ["list", "--json"], binName: "demo", specText, title: "Demo"})
      ).toBe(0);
      expect(await runAppRestCli({argv: ["nope"], binName: "demo", specText, title: "Demo"})).toBe(
        1
      );
    } finally {
      globalThis.fetch = originalFetch;
      console.info = originalInfo;
    }
  });
});

describe("flagValues errors", () => {
  it("rejects malformed pairs", () => {
    expect(() => parseNameValuePairs(["nope"])).toThrow("name=value");
    expect(() => parseHeaderFlags(["nope"])).toThrow("Name:");
    expect(parseJsonValue(undefined)).toBeUndefined();
  });
});
