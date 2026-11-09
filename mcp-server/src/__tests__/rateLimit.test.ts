import {afterEach, describe, expect, test} from "bun:test";
import type {Server} from "node:http";
import type {AddressInfo} from "node:net";

import {createMcpHttpApp} from "../httpApp.js";
import {resolveMcpRateLimitConfig, resolveTrustProxyHops} from "../rateLimit.js";

interface JsonRpcErrorBody {
  error: {
    code: number;
    data: {limit: number; retryAfterSeconds: number; windowMs: number};
    message: string;
  };
  id: number | string | null;
  jsonrpc: string;
}

const initializeRequest = (id: number | string): Record<string, unknown> => ({
  id,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: {name: "rate-limit-test", version: "1.0.0"},
    protocolVersion: "2025-06-18",
  },
});

const servers: Server[] = [];

const startApp = async (
  options: Parameters<typeof createMcpHttpApp>[0]
): Promise<{baseUrl: string}> => {
  const app = createMcpHttpApp(options);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  servers.push(server);
  const {port} = server.address() as AddressInfo;
  return {baseUrl: `http://127.0.0.1:${port}`};
};

const postJsonRpc = async (
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> => {
  return fetch(url, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    method: "POST",
  });
};

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    )
  );
});

describe("resolveMcpRateLimitConfig", () => {
  test("uses defaults when the environment is empty", () => {
    expect(resolveMcpRateLimitConfig({})).toEqual({
      max: 120,
      windowMs: 60_000,
    });
  });

  test("reads max and window from environment variables", () => {
    expect(
      resolveMcpRateLimitConfig({
        TERRENO_MCP_RATE_LIMIT_MAX: "30",
        TERRENO_MCP_RATE_LIMIT_WINDOW_MS: "10000",
      })
    ).toEqual({max: 30, windowMs: 10_000});
  });

  test("max of 0 disables the limit", () => {
    expect(resolveMcpRateLimitConfig({TERRENO_MCP_RATE_LIMIT_MAX: "0"})).toEqual({
      max: 0,
      windowMs: 60_000,
    });
  });

  test("rejects invalid values instead of silently running unlimited", () => {
    expect(() => resolveMcpRateLimitConfig({TERRENO_MCP_RATE_LIMIT_MAX: "lots"})).toThrow(
      "TERRENO_MCP_RATE_LIMIT_MAX"
    );
    expect(() => resolveMcpRateLimitConfig({TERRENO_MCP_RATE_LIMIT_MAX: "-1"})).toThrow(
      "TERRENO_MCP_RATE_LIMIT_MAX"
    );
    expect(() => resolveMcpRateLimitConfig({TERRENO_MCP_RATE_LIMIT_WINDOW_MS: "0"})).toThrow(
      "TERRENO_MCP_RATE_LIMIT_WINDOW_MS"
    );
  });
});

describe("resolveTrustProxyHops", () => {
  test("trusts no proxy outside Cloud Run", () => {
    expect(resolveTrustProxyHops({})).toBe(0);
  });

  test("trusts one hop on Cloud Run (K_SERVICE is set)", () => {
    expect(resolveTrustProxyHops({K_SERVICE: "terreno-mcp"})).toBe(1);
  });

  test("explicit TERRENO_MCP_TRUST_PROXY_HOPS wins", () => {
    expect(
      resolveTrustProxyHops({K_SERVICE: "terreno-mcp", TERRENO_MCP_TRUST_PROXY_HOPS: "2"})
    ).toBe(2);
    expect(
      resolveTrustProxyHops({K_SERVICE: "terreno-mcp", TERRENO_MCP_TRUST_PROXY_HOPS: "0"})
    ).toBe(0);
    expect(() => resolveTrustProxyHops({TERRENO_MCP_TRUST_PROXY_HOPS: "x"})).toThrow(
      "TERRENO_MCP_TRUST_PROXY_HOPS"
    );
  });
});

describe("hosted JSON-RPC rate limit", () => {
  const max = 3;
  const windowMs = 60_000;
  const fixedNow = 1_700_000_000_000;

  test("requests under the limit succeed", async () => {
    const {baseUrl} = await startApp({
      host: "127.0.0.1",
      now: () => fixedNow,
      rateLimit: {max, windowMs},
    });
    for (let index = 1; index < max; index += 1) {
      const response = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(index));
      expect(response.status).toBe(200);
      await response.text();
    }
  });

  test("the request that reaches the limit still succeeds", async () => {
    const {baseUrl} = await startApp({
      host: "127.0.0.1",
      now: () => fixedNow,
      rateLimit: {max, windowMs},
    });
    const statuses: number[] = [];
    for (let index = 1; index <= max; index += 1) {
      const response = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(index));
      statuses.push(response.status);
      await response.text();
    }
    expect(statuses).toEqual([200, 200, 200]);
  });

  test("the request over the limit gets a structured JSON-RPC 429", async () => {
    let now = fixedNow;
    const {baseUrl} = await startApp({
      host: "127.0.0.1",
      now: () => now,
      rateLimit: {max, windowMs},
    });
    for (let index = 1; index <= max; index += 1) {
      const response = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(index));
      expect(response.status).toBe(200);
      await response.text();
    }

    now = fixedNow + 15_000;
    const response = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest("over-limit"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("45");
    expect(response.headers.get("ratelimit")).toBe("limit=3, remaining=0, reset=45");
    expect(response.headers.get("ratelimit-policy")).toBe("3;w=60");
    const body = (await response.json()) as JsonRpcErrorBody;
    expect(body.jsonrpc).toBe("2.0");
    expect(body.id).toBe("over-limit");
    expect(body.error.code).toBe(-32029);
    expect(body.error.message).toBe(
      "Rate limit exceeded: 3 requests per 60 seconds per client IP. Retry after 45s."
    );
    expect(body.error.data).toEqual({limit: 3, retryAfterSeconds: 45, windowMs: 60_000});

    now = fixedNow + windowMs;
    const afterWindow = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest("next-window"));
    expect(afterWindow.status).toBe(200);
    await afterWindow.text();
  });

  test("POST / shares the /mcp bucket and the health check is never limited", async () => {
    const {baseUrl} = await startApp({host: "127.0.0.1", rateLimit: {max: 1, windowMs}});
    const first = await postJsonRpc(`${baseUrl}/`, initializeRequest(1));
    expect(first.status).toBe(200);
    await first.text();

    const second = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(2));
    expect(second.status).toBe(429);
    await second.text();

    const rootAgain = await postJsonRpc(`${baseUrl}/`, initializeRequest(3));
    expect(rootAgain.status).toBe(429);
    await rootAgain.text();

    for (let index = 0; index < 3; index += 1) {
      const health = await fetch(`${baseUrl}/`);
      expect(health.status).toBe(200);
      expect(await health.json()).toMatchObject({service: "terreno-mcp", status: "ok"});
    }
  });

  test("uses a null id when the body is a batch or has no usable id", async () => {
    const {baseUrl} = await startApp({host: "127.0.0.1", rateLimit: {max: 1, windowMs}});
    const first = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(1));
    await first.text();

    const batch = await postJsonRpc(`${baseUrl}/mcp`, [initializeRequest(2)]);
    expect(batch.status).toBe(429);
    expect(((await batch.json()) as JsonRpcErrorBody).id).toBeNull();

    const noId = await postJsonRpc(`${baseUrl}/mcp`, {jsonrpc: "2.0", method: "ping"});
    expect(noId.status).toBe(429);
    expect(((await noId.json()) as JsonRpcErrorBody).id).toBeNull();

    const objectId = await postJsonRpc(`${baseUrl}/mcp`, {id: {}, jsonrpc: "2.0", method: "ping"});
    expect(((await objectId.json()) as JsonRpcErrorBody).id).toBeNull();
  });

  test("names a window that is not whole seconds in milliseconds", async () => {
    const {baseUrl} = await startApp({
      host: "127.0.0.1",
      now: () => fixedNow,
      rateLimit: {max: 1, windowMs: 1500},
    });
    await (await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(1))).text();
    const response = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(2));
    expect(response.status).toBe(429);
    const body = (await response.json()) as JsonRpcErrorBody;
    expect(body.error.message).toBe(
      "Rate limit exceeded: 1 requests per 1500 ms per client IP. Retry after 2s."
    );
    expect(body.error.data).toEqual({limit: 1, retryAfterSeconds: 2, windowMs: 1500});
  });

  test("max of 0 leaves the endpoint unlimited", async () => {
    const {baseUrl} = await startApp({host: "127.0.0.1", rateLimit: {max: 0, windowMs}});
    for (let index = 1; index <= 5; index += 1) {
      const response = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(index));
      expect(response.status).toBe(200);
      await response.text();
    }
  });

  test("behind one trusted proxy, client-supplied X-Forwarded-For entries cannot rotate buckets", async () => {
    const {baseUrl} = await startApp({
      host: "127.0.0.1",
      rateLimit: {max: 1, windowMs},
      trustProxyHops: 1,
    });
    const first = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(1), {
      "x-forwarded-for": "198.51.100.1, 203.0.113.9",
    });
    expect(first.status).toBe(200);
    await first.text();

    // Same real client (the entry the trusted proxy appended), spoofed leftmost entry.
    const spoofed = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(2), {
      "x-forwarded-for": "198.51.100.77, 203.0.113.9",
    });
    expect(spoofed.status).toBe(429);
    await spoofed.text();

    // A different real client gets its own bucket.
    const otherClient = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(3), {
      "x-forwarded-for": "203.0.113.10",
    });
    expect(otherClient.status).toBe(200);
    await otherClient.text();
  });

  test("without a trusted proxy, X-Forwarded-For is ignored", async () => {
    const {baseUrl} = await startApp({host: "127.0.0.1", rateLimit: {max: 1, windowMs}});
    const first = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(1), {
      "x-forwarded-for": "203.0.113.1",
    });
    expect(first.status).toBe(200);
    await first.text();

    const rotated = await postJsonRpc(`${baseUrl}/mcp`, initializeRequest(2), {
      "x-forwarded-for": "203.0.113.2",
    });
    expect(rotated.status).toBe(429);
    await rotated.text();
  });
});
