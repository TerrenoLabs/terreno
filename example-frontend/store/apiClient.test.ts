import {afterEach, beforeEach, describe, it} from "bun:test";
import assert from "node:assert";
import {ApiError} from "@terreno/syncdb/api";
import {baseUrl} from "@terreno/syncdb/config";

import {apiClient} from "./apiClient";

interface RecordedFetch {
  credentials?: RequestCredentials;
  headers: Headers;
  method: string;
  url: string;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

describe("apiClient", () => {
  const originalFetch = globalThis.fetch;
  let calls: RecordedFetch[] = [];

  beforeEach(() => {
    calls = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        credentials: init?.credentials,
        headers: new Headers(init?.headers),
        method: (init?.method ?? "GET").toUpperCase(),
        url,
      });
      // The shared auth provider asks Better Auth for a session before each request.
      if (url.includes("/get-session")) {
        return json(null);
      }
      if (url.endsWith("/todos/missing")) {
        return json({title: "Document not found"}, 404);
      }
      return json({data: {email: "user@example.com", id: "u1"}});
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    apiClient.reset();
  });

  it("sends non-synced requests to the configured backend with cookies and app headers", async () => {
    assert.strictEqual(apiClient.baseUrl, baseUrl);

    // The `{data}` envelope is unwrapped by default.
    const result = await apiClient.request<{id: string}>({url: "/auth/me"});

    assert.strictEqual(result.id, "u1");
    const request = calls.find((call) => call.url.endsWith("/auth/me"));
    assert.ok(request, "expected a GET /auth/me");
    assert.strictEqual(request.url, `${baseUrl}/auth/me`);
    assert.strictEqual(request.method, "GET");
    assert.strictEqual(request.credentials, "include");
    assert.ok(request.headers.get("App-Platform"), "expected the App-Platform header");
  });

  it("rejects with an ApiError carrying the server's status and title", async () => {
    await assert.rejects(apiClient.request({url: "/todos/missing"}), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.strictEqual(error.status, 404);
      assert.strictEqual(error.data.title, "Document not found");
      return true;
    });
  });
});
