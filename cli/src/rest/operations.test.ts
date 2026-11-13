import {describe, expect, it} from "bun:test";

import {invokeRestOperation} from "./invoke";
import {parseOpenApiDocument} from "./loadSpec";
import {findRestOperation, listRestOperations} from "./operations";

/** Bun's `typeof fetch` also carries `preconnect`; add a no-op so stubs satisfy it. */
const stubFetch = (
  handler: (...args: Parameters<typeof fetch>) => Promise<Response>
): typeof fetch => Object.assign(handler, {preconnect: (): void => {}});

const spec = parseOpenApiDocument(`{
  "openapi": "3.0.0",
  "info": {"title": "Todos", "version": "1"},
  "servers": [{"url": "https://api.example.test"}],
  "paths": {
    "/todos": {
      "get": {"operationId": "todo_list", "summary": "List todos"},
      "post": {
        "operationId": "todo_create",
        "requestBody": {"required": true, "content": {"application/json": {"schema": {"type": "object"}}}}
      }
    },
    "/todos/{id}": {
      "get": {
        "operationId": "todo_read",
        "parameters": [{"name": "id", "in": "path", "required": true}]
      }
    }
  }
}`);

describe("OpenAPI operations", () => {
  it("lists operations with stable ids", () => {
    const ops = listRestOperations(spec);
    expect(ops.map((op) => op.id)).toEqual(["todo_create", "todo_list", "todo_read"]);
    expect(findRestOperation(ops, {id: "todo_list"})?.method).toBe("get");
    expect(findRestOperation(ops, {method: "GET", path: "/todos/{id}"})?.id).toBe("todo_read");
  });

  it("invokes an operation with path and query params", async () => {
    const calls: Array<{init?: RequestInit; url: string}> = [];
    const fetchImpl = stubFetch(async (url, init) => {
      calls.push({init, url: String(url)});
      return new Response(JSON.stringify({ok: true}), {
        headers: {"content-type": "application/json"},
        status: 200,
      });
    });
    const operation = findRestOperation(listRestOperations(spec), {id: "todo_read"});
    if (!operation) {
      throw new Error("missing todo_read");
    }
    const result = await invokeRestOperation({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
      operation,
      params: {extra: "1", id: "abc"},
      token: "tok",
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    const first = calls[0];
    if (!first) {
      throw new Error("missing fetch");
    }
    expect(first.url).toBe("https://api.example.test/todos/abc?extra=1");
    const headers = (first.init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe("Bearer tok");
  });

  it("parses YAML specs", () => {
    const yamlSpec = parseOpenApiDocument(`openapi: 3.0.0
info:
  title: Yaml
  version: "1"
paths:
  /ping:
    get:
      operationId: ping
`);
    expect(listRestOperations(yamlSpec).map((op) => op.id)).toEqual(["ping"]);
  });
});
