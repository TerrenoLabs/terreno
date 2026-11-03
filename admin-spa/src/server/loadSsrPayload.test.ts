import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {adminRpcSeedKey} from "@terreno/admin-frontend";
import {logger} from "@terreno/api";
import express from "express";
import {loadSsrPayload} from "../../server/loadSsrPayload";
import {AdminSpaServeApp} from "../serve";
import {serializeForHtml} from "../serverContext";
import {removeStubSsrBuild, writeStubSsrBuild} from "../testing/ssrStubBuild";

interface SeenRequest {
  path: string;
  headers: Record<string, string>;
}

interface StubServer {
  origin: string;
  seen: SeenRequest[];
  /** Per-path response override; default is 200 `{path}` JSON. */
  respond: (handler: (path: string) => {status: number; body: unknown}) => void;
  /** Hold every response until `count` requests have arrived (proves parallel fetching). */
  barrier: (count: number) => void;
  stop: () => void;
}

const startStub = (): StubServer => {
  const seen: SeenRequest[] = [];
  let handler = (path: string): {status: number; body: unknown} => ({body: {path}, status: 200});
  let barrierCount = 0;
  let waiting: Array<() => void> = [];
  const server = Bun.serve({
    fetch: async (req) => {
      const url = new URL(req.url);
      const headers: Record<string, string> = {};
      req.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      seen.push({headers, path: `${url.pathname}${url.search}`});
      if (barrierCount > 0) {
        await new Promise<void>((resolve) => {
          waiting.push(resolve);
          if (waiting.length >= barrierCount) {
            for (const release of waiting) {
              release();
            }
            waiting = [];
          }
        });
      }
      const {status, body} = handler(`${url.pathname}${url.search}`);
      return new Response(JSON.stringify(body), {
        headers: {"content-type": "application/json"},
        status,
      });
    },
    port: 0,
  });
  return {
    barrier: (count: number): void => {
      barrierCount = count;
    },
    origin: `http://127.0.0.1:${server.port}`,
    respond: (next): void => {
      handler = next;
    },
    seen,
    stop: (): void => {
      server.stop(true);
    },
  };
};

let distDir: string;
let stub: StubServer;

beforeAll(() => {
  distDir = writeStubSsrBuild();
});

afterAll(() => {
  removeStubSsrBuild(distDir);
});

beforeEach(() => {
  stub = startStub();
});

afterEach(() => {
  stub.stop();
});

/** Registering the plugin publishes `{internalOrigin, ssrApiPrefixes}` on the process global. */
const publish = (opts: {internalOrigin?: string; ssrApiPrefixes?: string[]} = {}): void => {
  new AdminSpaServeApp({
    distDir,
    internalOrigin: opts.internalOrigin ?? stub.origin,
    ssrApiPrefixes: opts.ssrApiPrefixes,
  }).register(express());
};

const makeRequest = (headers: Record<string, string> = {Cookie: "a=1"}): Request =>
  new Request("http://public.example/console/User", {headers});

/** Run `loadSsrPayload` and collect what it warned, so tests can check what a log would show. */
const loadWithWarnings = async (
  ...args: Parameters<typeof loadSsrPayload>
): Promise<{payload: Awaited<ReturnType<typeof loadSsrPayload>>; warnings: string}> => {
  // The plugin publishes the host's `logger.warn`; console.warn is the fallback before that.
  const loggerWarn = spyOn(logger, "warn").mockImplementation((() => logger) as never);
  const consoleWarn = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const payload = await loadSsrPayload(...args);
    const calls = [...loggerWarn.mock.calls, ...consoleWarn.mock.calls] as unknown[][];
    return {payload, warnings: calls.map((call) => call.map(String).join(" ")).join("\n")};
  } finally {
    loggerWarn.mockRestore();
    consoleWarn.mockRestore();
  }
};

describe("loadSsrPayload", () => {
  it("forwards the Cookie to internalOrigin and never builds an origin from Host", async () => {
    publish();
    await loadSsrPayload(
      makeRequest({
        Cookie: "a=1",
        Host: "evil.example",
        "X-Forwarded-Host": "evil.example",
        "X-Forwarded-Proto": "https",
      }),
      {requests: [{url: "/admin/users"}]}
    );
    expect(stub.seen).toHaveLength(1);
    expect(stub.seen[0].headers.cookie).toBe("a=1");
    expect(stub.seen[0].headers.host).not.toContain("evil.example");
  });

  it("forwards only Cookie from the incoming request, not other credentials or headers", async () => {
    publish();
    await loadSsrPayload(
      makeRequest({Authorization: "Bearer leak", Cookie: "a=1", "X-Custom": "nope"}),
      {requests: [{url: "/admin/users"}]}
    );
    expect(stub.seen[0].headers.authorization).toBeUndefined();
    expect(stub.seen[0].headers["x-custom"]).toBeUndefined();
  });

  it("returns the body under the seed key with its status", async () => {
    stub.respond(() => ({body: {data: [{email: "a@b.c"}]}, status: 200}));
    publish();
    const result = await loadSsrPayload(makeRequest(), {
      requests: [{url: "/admin/users?limit=20"}],
    });
    const key = adminRpcSeedKey("/admin/users?limit=20");
    expect(result.rpc[key]).toEqual({data: [{email: "a@b.c"}]});
    expect(result.status[key]).toBe(200);
    expect(stub.seen[0].path).toBe("/admin/users?limit=20");
  });

  it("forwards an allowlisted X-Organization-Id and keys it apart from the header-less key", async () => {
    publish();
    const result = await loadSsrPayload(makeRequest(), {
      requests: [{headers: {"X-Organization-Id": "o1"}, url: "/orgs/o1/members"}],
    });
    expect(stub.seen[0].headers["x-organization-id"]).toBe("o1");
    const withHeader = adminRpcSeedKey("/orgs/o1/members", {"X-Organization-Id": "o1"});
    const without = adminRpcSeedKey("/orgs/o1/members");
    expect(withHeader).not.toBe(without);
    expect(Object.keys(result.rpc)).toEqual([withHeader]);
  });

  it("rejects a non-allowlisted header with 'SSR header not allowed' and sends nothing", async () => {
    publish();
    await expect(
      loadSsrPayload(makeRequest(), {
        requests: [{headers: {Authorization: "x"}, url: "/admin/users"}],
      })
    ).rejects.toThrow("SSR header not allowed");
    expect(stub.seen).toHaveLength(0);
  });

  it("sends nothing at all when any one request in the list is rejected", async () => {
    publish();
    await expect(
      loadSsrPayload(makeRequest(), {
        requests: [{url: "/admin/users"}, {headers: {Authorization: "x"}, url: "/admin/roles"}],
      })
    ).rejects.toThrow("SSR header not allowed");
    expect(stub.seen).toHaveLength(0);
  });

  it("reports a 404 as status 404 with no rpc entry", async () => {
    stub.respond(() => ({body: {title: "Not found"}, status: 404}));
    publish();
    const result = await loadSsrPayload(makeRequest(), {requests: [{url: "/admin/users/missing"}]});
    const key = adminRpcSeedKey("/admin/users/missing");
    expect(key in result.rpc).toBe(false);
    expect(result.status[key]).toBe(404);
  });

  it("reports a 500 as status 500 with no rpc entry", async () => {
    stub.respond(() => ({body: {title: "boom"}, status: 500}));
    publish();
    const result = await loadSsrPayload(makeRequest(), {requests: [{url: "/admin/users"}]});
    const key = adminRpcSeedKey("/admin/users");
    expect(key in result.rpc).toBe(false);
    expect(result.status[key]).toBe(500);
  });

  it("keeps an encoded traversal segment encoded and never reaches /admin/config", async () => {
    publish();
    await loadSsrPayload(makeRequest(), {requests: [{url: "/admin/users/..%2Fconfig"}]});
    expect(stub.seen).toHaveLength(1);
    expect(stub.seen[0].path).toBe("/admin/users/..%2Fconfig");
    expect(stub.seen[0].path).not.toBe("/admin/config");
  });

  it("allows /comms/stats and /rbac/roles under the default prefixes", async () => {
    publish();
    const result = await loadSsrPayload(makeRequest(), {
      requests: [{url: "/comms/stats"}, {url: "/rbac/roles"}],
    });
    expect(result.status[adminRpcSeedKey("/comms/stats")]).toBe(200);
    expect(result.status[adminRpcSeedKey("/rbac/roles")]).toBe(200);
  });

  it("allows every default prefix", async () => {
    publish();
    const urls = [
      "/admin/config",
      "/auth/me",
      "/orgs",
      "/jobs",
      "/comms",
      "/configuration",
      "/rbac",
    ];
    const result = await loadSsrPayload(makeRequest(), {requests: urls.map((url) => ({url}))});
    expect(Object.keys(result.status)).toHaveLength(urls.length);
  });

  it("rejects /comms/stats with 'SSR path not allowed' when ssrApiPrefixes is [\"/admin\"]", async () => {
    publish({ssrApiPrefixes: ["/admin"]});
    await expect(
      loadSsrPayload(makeRequest(), {requests: [{url: "/comms/stats"}]})
    ).rejects.toThrow("SSR path not allowed");
    expect(stub.seen).toHaveLength(0);
  });

  it("rejects a path that normalizes out of the allowlist (/auth/../internal/audit-events)", async () => {
    publish();
    await expect(
      loadSsrPayload(makeRequest(), {requests: [{url: "/auth/../internal/audit-events"}]})
    ).rejects.toThrow("SSR path not allowed");
    expect(stub.seen).toHaveLength(0);
  });

  it.each(["/admin/../internal/audit-events", "/auth/me/../../internal/audit-events"])(
    "rejects %s, which starts inside a default prefix but normalizes out of it",
    async (url) => {
      publish();
      await expect(loadSsrPayload(makeRequest(), {requests: [{url}]})).rejects.toThrow(
        "SSR path not allowed"
      );
      expect(stub.seen).toHaveLength(0);
    }
  );

  it("rejects duplicate header names that differ only by case, and sends nothing", async () => {
    publish();
    await expect(
      loadSsrPayload(makeRequest(), {
        requests: [
          {
            headers: {"X-Organization-Id": "o1", "x-organization-id": "o2"},
            url: "/orgs/o1/members",
          },
        ],
      })
    ).rejects.toThrow("SSR header not allowed");
    expect(stub.seen).toHaveLength(0);
  });

  it("leaves out a read whose body is not JSON, warning with the path but never the body", async () => {
    const plain = Bun.serve({
      fetch: () =>
        new Response("PHISENTINEL not json", {
          headers: {"content-type": "text/plain"},
          status: 200,
        }),
      port: 0,
    });
    try {
      publish({internalOrigin: `http://127.0.0.1:${plain.port}`});
      const {payload, warnings} = await loadWithWarnings(makeRequest(), {
        requests: [{url: "/admin/users"}],
      });
      expect(payload).toEqual({rpc: {}, status: {}});
      expect(warnings).toContain("/admin/users");
      expect(warnings).not.toContain("PHISENTINEL");
    } finally {
      plain.stop(true);
    }
  });

  it("rejects an absolute URL and a protocol-relative URL", async () => {
    publish();
    await expect(
      loadSsrPayload(makeRequest(), {requests: [{url: "http://evil.example/admin/users"}]})
    ).rejects.toThrow("SSR path not allowed");
    await expect(
      loadSsrPayload(makeRequest(), {requests: [{url: "//evil.example/admin/users"}]})
    ).rejects.toThrow("SSR path not allowed");
    expect(stub.seen).toHaveLength(0);
  });

  it("rejects a prefix lookalike such as /administrator", async () => {
    publish();
    await expect(
      loadSsrPayload(makeRequest(), {requests: [{url: "/administrator/users"}]})
    ).rejects.toThrow("SSR path not allowed");
    expect(stub.seen).toHaveLength(0);
  });

  it("leaves out a read whose fetch fails, warning with the path but not the cookie value", async () => {
    const dead = startStub();
    const deadOrigin = dead.origin;
    dead.stop();
    publish({internalOrigin: deadOrigin});
    const {payload, warnings} = await loadWithWarnings(
      makeRequest({Cookie: "session=SECRET-COOKIE-VALUE"}),
      {requests: [{url: "/admin/users"}]}
    );
    expect(payload).toEqual({rpc: {}, status: {}});
    expect(warnings).toContain("/admin/users");
    expect(warnings).not.toContain("SECRET-COOKIE-VALUE");
  });

  it("keeps the sibling seeds when one read fails", async () => {
    const mixed = Bun.serve({
      fetch: (req) =>
        new URL(req.url).pathname === "/admin/roles"
          ? new Response("not json", {headers: {"content-type": "text/plain"}, status: 200})
          : Response.json({ok: true}),
      port: 0,
    });
    try {
      publish({internalOrigin: `http://127.0.0.1:${mixed.port}`});
      const {payload} = await loadWithWarnings(makeRequest(), {
        requests: [{url: "/admin/users"}, {url: "/admin/roles"}],
      });
      expect(payload.rpc[adminRpcSeedKey("/admin/users")]).toEqual({ok: true});
      expect(payload.rpc[adminRpcSeedKey("/admin/roles")]).toBeUndefined();
    } finally {
      mixed.stop(true);
    }
  });

  it("gives up on a read that does not answer within timeoutMs", async () => {
    const hung = Bun.serve({fetch: () => new Promise<Response>(() => {}), port: 0});
    try {
      publish({internalOrigin: `http://127.0.0.1:${hung.port}`});
      const startedAt = performance.now();
      const {payload, warnings} = await loadWithWarnings(makeRequest(), {
        requests: [{url: "/admin/users"}],
        timeoutMs: 50,
      });
      expect(performance.now() - startedAt).toBeLessThan(2000);
      expect(payload).toEqual({rpc: {}, status: {}});
      expect(warnings).toContain("SSR fetch failed for /admin/users: TimeoutError");
    } finally {
      hung.stop(true);
    }
  });

  it("makes zero loopback fetches when the request has no Cookie", async () => {
    publish();
    await loadSsrPayload(makeRequest({}), {requests: [{url: "/admin/users"}]});
    expect(stub.seen).toHaveLength(0);
  });

  it("fetches all requests in parallel", async () => {
    stub.barrier(2);
    publish();
    const result = await Promise.race([
      loadSsrPayload(makeRequest(), {requests: [{url: "/admin/users"}, {url: "/admin/roles"}]}),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("requests were not fetched in parallel")), 3000);
      }),
    ]);
    expect(Object.keys(result.rpc)).toHaveLength(2);
  });
});

describe("loadSsrPayload keeps the API query string out of its warnings", () => {
  const PHI_URL = "/admin/users?search=PHI-SENTINEL";

  it("warns with /admin/users but never the query string when the fetch fails", async () => {
    const dead = startStub();
    const deadOrigin = dead.origin;
    dead.stop();
    publish({internalOrigin: deadOrigin});
    const {warnings} = await loadWithWarnings(makeRequest(), {requests: [{url: PHI_URL}]});
    expect(warnings).toContain("/admin/users");
    expect(warnings).not.toContain("PHI-SENTINEL");
  });

  it("warns with /admin/users but never the query string when the body is not JSON", async () => {
    const plain = Bun.serve({
      fetch: () => new Response("not json", {headers: {"content-type": "text/plain"}, status: 200}),
      port: 0,
    });
    try {
      publish({internalOrigin: `http://127.0.0.1:${plain.port}`});
      const {warnings} = await loadWithWarnings(makeRequest(), {requests: [{url: PHI_URL}]});
      expect(warnings).toContain("/admin/users");
      expect(warnings).not.toContain("PHI-SENTINEL");
    } finally {
      plain.stop(true);
    }
  });
});

describe("serializeForHtml", () => {
  it("leaves no literal </script> in the output", () => {
    const out = serializeForHtml({brandName: "</script><script>x()"});
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
  });

  it("escapes <, >, &, U+2028 and U+2029", () => {
    const out = serializeForHtml({v: "<>&  "});
    for (const raw of ["<", ">", "&", " ", " "]) {
      expect(out).not.toContain(raw);
    }
  });

  it("round-trips through JSON.parse to the original value", () => {
    const value = {n: 1, nested: [{a: "</script><!--&"}, "  "], ok: true, z: null};
    expect(JSON.parse(serializeForHtml(value))).toEqual(value);
  });
});
