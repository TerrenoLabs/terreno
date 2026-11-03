import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import fs from "node:fs";
import http from "node:http";
import type {AddressInfo} from "node:net";
import path from "node:path";
import express from "express";
import request from "supertest";
import {DEFAULT_APP_CONFIG} from "./appConfig";
import {AdminSpaServeApp} from "./serve";
import {getAdminSpaRequest} from "./serverContext";
import {
  removeStubSsrBuild,
  STUB_ASSET_CONTENT,
  STUB_ASSET_PATH,
  writeStubSsrBuild,
} from "./testing/ssrStubBuild";

const BASE_PATH = "/console";
const COOKIE = "__Secure-better-auth.session_token=tok123; other=1";

const ADMIN_USER = {email: "admin@example.com", id: "ba1", name: "Admin"};
const CONFIG_BODY = {models: [{displayName: "Todos", name: "Todo"}]};
const SESSION_BODY = {session: {id: "s1", userId: "ba1"}, user: ADMIN_USER};
const PROFILE_BODY = {_id: "u1", admin: true, email: "admin@example.com"};

type StubPath = "/admin/config" | "/api/auth/get-session" | "/auth/me";

interface StubState {
  /** Requests seen per path since the last reset. */
  counts: Record<string, number>;
  /** Cookie header of each request, per path. */
  cookies: Record<string, Array<string | null>>;
  /** Paths that never answer. */
  hang: Set<string>;
  /** Response status per path (default 200). */
  status: Record<string, number>;
}

const BODIES: Record<StubPath, unknown> = {
  "/admin/config": CONFIG_BODY,
  "/api/auth/get-session": SESSION_BODY,
  "/auth/me": PROFILE_BODY,
};

const stub: StubState = {cookies: {}, counts: {}, hang: new Set(), status: {}};
let internal: ReturnType<typeof Bun.serve>;

const resetStub = (): void => {
  stub.counts = {};
  stub.cookies = {};
  stub.hang = new Set();
  stub.status = {};
};

beforeAll(() => {
  internal = Bun.serve({
    fetch: async (req) => {
      const url = new URL(req.url);
      stub.counts[url.pathname] = (stub.counts[url.pathname] ?? 0) + 1;
      stub.cookies[url.pathname] = [
        ...(stub.cookies[url.pathname] ?? []),
        req.headers.get("cookie"),
      ];
      if (stub.hang.has(url.pathname)) {
        await new Promise<void>(() => {});
      }
      const body = BODIES[url.pathname as StubPath];
      if (body === undefined) {
        return new Response("not found", {status: 404});
      }
      const status = stub.status[url.pathname] ?? 200;
      return Response.json(status === 200 ? body : {title: "stub"}, {status});
    },
    port: 0,
  });
});

afterAll(() => {
  internal.stop(true);
});

beforeEach(resetStub);

/** Sets `req.user` when the test request carries `x-test-user`, like the session middleware. */
const setTestUser: express.RequestHandler = (req, _res, next) => {
  if (req.headers["x-test-user"]) {
    (req as unknown as {user: unknown}).user = {_id: "u1", admin: true};
  }
  next();
};

interface EchoApp {
  app: express.Application;
  handlerCalls: () => number;
  /** `req.url` the handler last saw, or null when it never ran. */
  lastUrl: () => string | null;
}

/** The gate mounted at the root with a handler that echoes the request scope it runs in. */
const makeGateApp = async (): Promise<EchoApp> => {
  // Loaded lazily so each case fails on its own assertion while ./gate does not exist yet.
  const {createAdminSpaGate} = await import("./gate");
  let calls = 0;
  let seen: string | null = null;
  const handler: express.RequestHandler = (req, res) => {
    calls += 1;
    seen = req.url;
    res.json({scope: getAdminSpaRequest() ?? null});
  };
  const app = express();
  app.use(setTestUser);
  app.use(
    createAdminSpaGate({
      adminApiBasePath: "/admin",
      appConfig: DEFAULT_APP_CONFIG,
      basePath: BASE_PATH,
      handler,
      internalOrigin: `http://127.0.0.1:${internal.port}`,
    })
  );
  app.use((_req, res) => res.status(404).send("fell through"));
  return {app, handlerCalls: () => calls, lastUrl: () => seen};
};

const asUser = (req: request.Test): request.Test =>
  req.set("x-test-user", "1").set("Cookie", COOKIE);

describe("createAdminSpaGate anonymous visitors", () => {
  it("redirects a protected page to login with an encoded returnTo", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).get("/console/Todo").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/login?returnTo=%2FTodo");
    expect(handlerCalls()).toBe(0);
  });

  it("encodes a nested path into returnTo", async () => {
    const {app} = await makeGateApp();
    const res = await request(app).get("/console/User/abc123").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/login?returnTo=%2FUser%2Fabc123");
  });

  it("renders /login with a null session and admin config, without calling the stub", async () => {
    const {app} = await makeGateApp();
    const res = await request(app).get("/console/login");
    expect(res.status).toBe(200);
    expect(res.body.scope.session).toBeNull();
    expect(res.body.scope.adminConfig).toBeNull();
    expect(res.body.scope.basePath).toBe("/console");
    expect(stub.counts["/admin/config"] ?? 0).toBe(0);
    expect(stub.counts["/api/auth/get-session"] ?? 0).toBe(0);
    expect(stub.counts["/auth/me"] ?? 0).toBe(0);
  });

  it("answers 401 JSON to a loader request under the base path", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).get("/console/_expo/loaders/Todo");
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(handlerCalls()).toBe(0);
  });

  it("answers 401 JSON to a loader request at the site root", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).get("/_expo/loaders/Todo");
    expect(res.status).toBe(401);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(handlerCalls()).toBe(0);
  });

  it("lets the login loader through at the site root", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).get("/_expo/loaders/login");
    expect(res.status).toBe(200);
    expect(handlerCalls()).toBe(1);
  });

  it("falls through on a static asset path without rendering it", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).get("/console/_expo/static/x.js").redirects(0);
    expect(res.status).toBe(404);
    expect(res.text).toBe("fell through");
    expect(handlerCalls()).toBe(0);
  });

  it("falls through on /assets and app-config.json paths without rendering them", async () => {
    const {app, handlerCalls} = await makeGateApp();
    for (const target of [
      "/console/assets/logo.png",
      "/console/assets/Todo",
      "/console/app-config.json",
      "/console/app-config.json/x",
    ]) {
      const res = await request(app).get(target).redirects(0);
      expect(res.status).toBe(404);
      expect(res.text).toBe("fell through");
    }
    expect(handlerCalls()).toBe(0);
  });

  it("falls through on a static path for a HEAD request without rendering it", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).head("/console/assets/Todo").redirects(0);
    expect(res.status).toBe(404);
    expect(handlerCalls()).toBe(0);
  });

  it("falls through on a static path for a signed-in non-admin without rendering it", async () => {
    stub.status["/admin/config"] = 403;
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/assets/Todo").redirects(0));
    expect(res.status).toBe(404);
    expect(res.text).toBe("fell through");
    expect(handlerCalls()).toBe(0);
  });

  it("does not gate a non-GET request", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).post("/console/Todo").redirects(0);
    expect(res.status).not.toBe(302);
    expect(handlerCalls()).toBe(1);
  });

  it("does not claim paths outside the base path", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).get("/elsewhere").redirects(0);
    expect(res.status).toBe(404);
    expect(handlerCalls()).toBe(0);
  });
});

describe("createAdminSpaGate signed-in non-admins", () => {
  it("answers 403 JSON to a loader request", async () => {
    stub.status["/admin/config"] = 403;
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/_expo/loaders/Todo"));
    expect(res.status).toBe(403);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(handlerCalls()).toBe(0);
  });

  it("redirects a page to /forbidden", async () => {
    stub.status["/admin/config"] = 403;
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console").redirects(0));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/forbidden");
  });

  it("renders /forbidden itself with a null admin config", async () => {
    stub.status["/admin/config"] = 403;
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console/forbidden"));
    expect(res.status).toBe(200);
    expect(res.body.scope.adminConfig).toBeNull();
    expect(res.body.scope.adminConfigStatus).toBe(403);
  });

  it("renders the signed-in-only /oauth/consent page with its query", async () => {
    stub.status["/admin/config"] = 403;
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/oauth/consent?client_id=abc").redirects(0));
    expect(res.status).toBe(200);
    expect(res.body.scope.adminConfigStatus).toBe(403);
    expect(handlerCalls()).toBe(1);
  });

  it("lets a forbidden user load the /oauth/consent loader", async () => {
    stub.status["/admin/config"] = 403;
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/_expo/loaders/oauth/consent"));
    expect(res.status).toBe(200);
  });

  it("still redirects a nested path under /oauth to /forbidden", async () => {
    stub.status["/admin/config"] = 403;
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console/oauth/other").redirects(0));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/forbidden");
  });

  it("lets a forbidden user load the login loader", async () => {
    stub.status["/admin/config"] = 403;
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console/_expo/loaders/login"));
    expect(res.status).toBe(200);
  });
});

describe("createAdminSpaGate redirect caching", () => {
  it("marks the anonymous redirect no-store, private", async () => {
    const {app} = await makeGateApp();
    const res = await request(app).get("/console/User").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers["cache-control"]).toBe("no-store, private");
  });

  it("marks the forbidden redirect no-store, private", async () => {
    stub.status["/admin/config"] = 403;
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console/User").redirects(0));
    expect(res.status).toBe(302);
    expect(res.headers["cache-control"]).toBe("no-store, private");
  });
});

describe("createAdminSpaGate signed-in-only routes for anonymous visitors", () => {
  it("redirects /oauth/consent to login with its returnTo", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).get("/console/oauth/consent?client_id=abc").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `/console/login?returnTo=${encodeURIComponent("/oauth/consent?client_id=abc")}`
    );
    expect(handlerCalls()).toBe(0);
  });

  it("answers 401 to the /oauth/consent loader", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await request(app).get("/_expo/loaders/oauth/consent");
    expect(res.status).toBe(401);
    expect(handlerCalls()).toBe(0);
  });
});

describe("createAdminSpaGate admins", () => {
  it("renders a page with the shell payload and fetches each upstream exactly once", async () => {
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console/User"));
    expect(res.status).toBe(200);
    expect(res.body.scope.adminConfig).toEqual(CONFIG_BODY);
    expect(res.body.scope.adminConfigStatus).toBe(200);
    expect(res.body.scope.profile).toEqual(PROFILE_BODY);
    expect(res.body.scope.session).toEqual({user: ADMIN_USER, userId: "ba1"});
    expect(res.body.scope.basePath).toBe("/console");
    expect(res.body.scope.appConfig.brandName).toBe(DEFAULT_APP_CONFIG.brandName);
    expect(stub.counts["/admin/config"]).toBe(1);
    expect(stub.counts["/api/auth/get-session"]).toBe(1);
    expect(stub.counts["/auth/me"]).toBe(1);
  });

  it("runs a loader request with the same shell payload", async () => {
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/_expo/loaders/User"));
    expect(res.status).toBe(200);
    expect(res.body.scope.adminConfig).toEqual(CONFIG_BODY);
    expect(stub.counts["/admin/config"]).toBe(1);
  });

  it("forwards the cookie unchanged, including a __Secure- cookie over plain HTTP", async () => {
    const {app} = await makeGateApp();
    await asUser(request(app).get("/console/User"));
    expect(stub.cookies["/api/auth/get-session"]).toEqual([COOKIE]);
    expect(stub.cookies["/admin/config"]).toEqual([COOKIE]);
    expect(stub.cookies["/auth/me"]).toEqual([COOKIE]);
  });

  it("redirects /login to a valid returnTo", async () => {
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console/login?returnTo=%2FTodo").redirects(0));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/Todo");
  });

  it("redirects /login to the root for an absolute returnTo", async () => {
    const {app} = await makeGateApp();
    const res = await asUser(
      request(app).get("/console/login?returnTo=https%3A%2F%2Fevil.example").redirects(0)
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/");
  });

  it("redirects /login to the root for a protocol-relative returnTo", async () => {
    const {app} = await makeGateApp();
    const res = await asUser(
      request(app).get("/console/login?returnTo=%2F%2Fevil.example").redirects(0)
    );
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/");
  });

  it("redirects /login without returnTo to the root", async () => {
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console/login").redirects(0));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/");
  });
});

describe("createAdminSpaGate fails closed", () => {
  it("answers 503 when /admin/config returns 500, without running the handler", async () => {
    stub.status["/admin/config"] = 500;
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/User").redirects(0));
    expect(res.status).toBe(503);
    expect(handlerCalls()).toBe(0);
  });

  it("answers 503 to a loader request when /admin/config returns 500", async () => {
    stub.status["/admin/config"] = 500;
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/_expo/loaders/User"));
    expect(res.status).toBe(503);
    expect(handlerCalls()).toBe(0);
  });

  it("answers 503 when get-session returns 500", async () => {
    stub.status["/api/auth/get-session"] = 500;
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/User").redirects(0));
    expect(res.status).toBe(503);
    expect(handlerCalls()).toBe(0);
  });

  it("answers 503 when /auth/me returns 500", async () => {
    stub.status["/auth/me"] = 500;
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/User").redirects(0));
    expect(res.status).toBe(503);
    expect(handlerCalls()).toBe(0);
  });

  it("answers 503 on a network error", async () => {
    const {createAdminSpaGate} = await import("./gate");
    const closed = Bun.serve({fetch: () => new Response("x"), port: 0});
    const deadOrigin = `http://127.0.0.1:${closed.port}`;
    closed.stop(true);
    let calls = 0;
    const app = express();
    app.use(setTestUser);
    app.use(
      createAdminSpaGate({
        adminApiBasePath: "/admin",
        appConfig: DEFAULT_APP_CONFIG,
        basePath: BASE_PATH,
        handler: (_req, res) => {
          calls += 1;
          res.send("rendered");
        },
        internalOrigin: deadOrigin,
      })
    );
    const res = await asUser(request(app).get("/console/User").redirects(0));
    expect(res.status).toBe(503);
    expect(calls).toBe(0);
  });

  it("treats a 401 from /admin/config as anonymous", async () => {
    stub.status["/admin/config"] = 401;
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/User").redirects(0));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/login?returnTo=%2FUser");
    expect(handlerCalls()).toBe(0);
  });

  it("answers 503 after the 5 s timeout when /admin/config never answers", async () => {
    // Bun's fake timers do not drive fetch's native abort timer, so this waits out the real
    // 5 s timeout against a hanging stub. The test timeout is raised to cover it.
    stub.hang.add("/admin/config");
    const {app, handlerCalls} = await makeGateApp();
    const startedAt = performance.now();
    const res = await asUser(request(app).get("/console/User").redirects(0));
    const elapsedMs = performance.now() - startedAt;
    expect(res.status).toBe(503);
    expect(elapsedMs).toBeGreaterThanOrEqual(4500);
    expect(elapsedMs).toBeLessThan(9000);
    expect(handlerCalls()).toBe(0);
  }, 15_000);
});

/**
 * Appends a two-segment dynamic page route, like the real export's `[model]/[id]`, so a
 * non-file path such as `/assets/Todo` matches a page and would render if the gate let it.
 */
const addCatchAllRoute = (distDir: string): void => {
  const routesPath = path.join(distDir, "server", "_expo", "routes.json");
  const routes = JSON.parse(fs.readFileSync(routesPath, "utf8")) as {
    htmlRoutes: Array<Record<string, unknown>>;
  };
  routes.htmlRoutes.push({
    file: "[model]/[id].js",
    namedRegex: "^/(?<model>[^/]+?)/(?<id>.+?)(?:/)?$",
    page: "/[model]/[id]",
    routeKeys: {id: "id", model: "model"},
  });
  fs.writeFileSync(routesPath, JSON.stringify(routes));
};

describe("AdminSpaServeApp wires the gate before the Expo handler", () => {
  const SERVER_MODULES = {
    loadSsrPayload: path.resolve(import.meta.dir, "../server/loadSsrPayload.ts"),
    serverContext: path.resolve(import.meta.dir, "./serverContext.ts"),
  };
  let ssrDir: string;

  beforeAll(() => {
    ssrDir = writeStubSsrBuild({
      extraRoutes: [
        {loaderSource: "exports.loader = () => ({ok: true});", path: "/Todo"},
        {loaderSource: "exports.loader = () => ({ok: true});", path: "/User"},
      ],
      ssrModules: SERVER_MODULES,
    });
    addCatchAllRoute(ssrDir);
  });

  afterAll(() => {
    removeStubSsrBuild(ssrDir);
  });

  afterEach(resetStub);

  const makeServedApp = (): express.Application => {
    const app = express();
    app.use(setTestUser);
    new AdminSpaServeApp({
      distDir: ssrDir,
      internalOrigin: `http://127.0.0.1:${internal.port}`,
    }).register(app);
    app.use((_req, res) => res.status(404).send("not found"));
    return app;
  };

  const scopeOf = (html: string): Record<string, unknown> => {
    const match = html.match(/data-scope=("(?:[^"\\]|\\.)*")/);
    expect(match).not.toBeNull();
    return JSON.parse(JSON.parse(match?.[1] ?? '""') as string) as Record<string, unknown>;
  };

  it("redirects an anonymous protected page before rendering", async () => {
    const res = await request(makeServedApp()).get("/console/Todo").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/login?returnTo=%2FTodo");
  });

  it("renders /login for an anonymous visitor with a null session", async () => {
    const res = await request(makeServedApp()).get("/console/login");
    expect(res.status).toBe(200);
    const scope = scopeOf(res.text);
    expect(scope.session).toBeNull();
    expect(scope.adminConfig).toBeNull();
    expect(res.headers["cache-control"]).toBe("no-store, private");
  });

  it("answers 401 to an anonymous loader request at both loader paths", async () => {
    const app = makeServedApp();
    expect((await request(app).get("/console/_expo/loaders/Todo")).status).toBe(401);
    expect((await request(app).get("/_expo/loaders/Todo")).status).toBe(401);
    expect((await request(app).get("/_expo/loaders/login")).status).toBe(200);
  });

  it("renders an admin page inside the shell payload scope", async () => {
    const res = await asUser(request(makeServedApp()).get("/console/User"));
    expect(res.status).toBe(200);
    const scope = scopeOf(res.text);
    expect(scope.adminConfig).toEqual(CONFIG_BODY);
    expect(scope.profile).toEqual(PROFILE_BODY);
    expect(scope.session).toEqual({user: ADMIN_USER, userId: "ba1"});
    expect(stub.counts["/admin/config"]).toBe(1);
  });

  it("answers 503 and does not render when /admin/config fails", async () => {
    stub.status["/admin/config"] = 500;
    const res = await asUser(request(makeServedApp()).get("/console/User"));
    expect(res.status).toBe(503);
    expect(res.text).not.toContain("data-scope");
  });

  it("still serves a hashed static asset to an anonymous visitor", async () => {
    const res = await request(makeServedApp()).get("/console/_expo/static/js/web/foo.abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  const NOT_FILES = [
    "/console/assets/Todo",
    "/console/app-config.json/x",
    "/console/_expo/static/nope.js",
  ];

  for (const target of NOT_FILES) {
    it(`answers 404 without rendering ${target} for an anonymous visitor`, async () => {
      const res = await request(makeServedApp()).get(target).redirects(0);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("data-scope");
      expect(res.text).not.toContain("<h1>");
    });

    it(`answers 404 without rendering ${target} for a forbidden user`, async () => {
      stub.status["/admin/config"] = 403;
      const res = await asUser(request(makeServedApp()).get(target).redirects(0));
      expect(res.status).toBe(404);
      expect(res.text).not.toContain("data-scope");
      expect(res.text).not.toContain("<h1>");
    });
  }

  it("still serves a real asset with an immutable cache to a forbidden user", async () => {
    stub.status["/admin/config"] = 403;
    const res = await asUser(request(makeServedApp()).get(`/console${STUB_ASSET_PATH}`));
    expect(res.status).toBe(200);
    expect(res.text).toBe(STUB_ASSET_CONTENT);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("still serves /console/app-config.json to an anonymous visitor", async () => {
    const res = await request(makeServedApp()).get("/console/app-config.json");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.text).not.toContain("data-scope");
  });
});

interface RawResponse {
  headers: http.IncomingHttpHeaders;
  seenUrl: string | null;
  status: number;
  text: string;
}

/**
 * GET with the path sent exactly as given. supertest and fetch normalize dot segments, so this
 * uses node:http, and `seenUrl` records the `req.url` the server received to prove they survived.
 */
const rawGet = async (
  app: express.Application,
  rawPath: string,
  options: {asUser?: boolean} = {}
): Promise<RawResponse> => {
  let seenUrl: string | null = null;
  const wrapper = express();
  wrapper.use((req, _res, next) => {
    seenUrl = req.url;
    next();
  });
  wrapper.use(app);
  const server = http.createServer(wrapper);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const {port} = server.address() as AddressInfo;
  try {
    return await new Promise<RawResponse>((resolve, reject) => {
      const headers: Record<string, string> = options.asUser
        ? {Cookie: COOKIE, "x-test-user": "1"}
        : {};
      const req = http.request({headers, host: "127.0.0.1", method: "GET", path: rawPath, port});
      req.on("error", reject);
      req.on("response", (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            headers: res.headers,
            seenUrl,
            status: res.statusCode ?? 0,
            text: Buffer.concat(chunks).toString("utf8"),
          })
        );
      });
      req.end();
    });
  } finally {
    server.close();
  }
};

describe("createAdminSpaGate edge cases that guard surviving mutations", () => {
  it("carries the query string into returnTo for an anonymous page", async () => {
    const {app} = await makeGateApp();
    const res = await request(app).get("/console/Todo?filter=a").redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/login?returnTo=%2FTodo%3Ffilter%3Da");
  });

  it("redirects an admin away from /forbidden to the root", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await asUser(request(app).get("/console/forbidden").redirects(0));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/");
    expect(handlerCalls()).toBe(0);
  });

  it("renders /login for a forbidden user with a null admin config and status 403", async () => {
    stub.status["/admin/config"] = 403;
    const {app} = await makeGateApp();
    const res = await asUser(request(app).get("/console/login").redirects(0));
    expect(res.status).toBe(200);
    expect(res.body.scope.adminConfig).toBeNull();
    expect(res.body.scope.adminConfigStatus).toBe(403);
  });

  it("sends a forbidden user on /login to a safe signed-in-only returnTo", async () => {
    stub.status["/admin/config"] = 403;
    const {app, handlerCalls} = await makeGateApp();
    const returnTo = encodeURIComponent("/oauth/consent?client_id=abc");
    const res = await asUser(request(app).get(`/console/login?returnTo=${returnTo}`).redirects(0));
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/oauth/consent?client_id=abc");
    expect(handlerCalls()).toBe(0);
  });

  it("renders /login for a forbidden user when returnTo is unsafe", async () => {
    stub.status["/admin/config"] = 403;
    const {app} = await makeGateApp();
    const res = await asUser(
      request(app).get("/console/login?returnTo=%2F%2Fevil.example").redirects(0)
    );
    expect(res.status).toBe(200);
  });

  it("answers 503 when /admin/config returns 200 with a non-JSON body", async () => {
    const {createAdminSpaGate} = await import("./gate");
    const textOrigin = Bun.serve({
      fetch: (req) => {
        const {pathname} = new URL(req.url);
        if (pathname === "/admin/config") {
          return new Response("<html>not json</html>", {status: 200});
        }
        return Response.json(BODIES[pathname as StubPath] ?? {}, {status: 200});
      },
      port: 0,
    });
    let calls = 0;
    const app = express();
    app.use(setTestUser);
    app.use(
      createAdminSpaGate({
        adminApiBasePath: "/admin",
        appConfig: DEFAULT_APP_CONFIG,
        basePath: BASE_PATH,
        handler: (_req, res) => {
          calls += 1;
          res.send("rendered");
        },
        internalOrigin: `http://127.0.0.1:${textOrigin.port}`,
      })
    );
    try {
      const res = await asUser(request(app).get("/console/User").redirects(0));
      expect(res.status).toBe(503);
      expect(calls).toBe(0);
    } finally {
      textOrigin.stop(true);
    }
  });
});

describe("AdminSpaServeApp gates the normalized path, not the raw one", () => {
  let ssrDir: string;

  beforeAll(() => {
    ssrDir = writeStubSsrBuild({
      extraRoutes: [
        {loaderSource: 'exports.loader = () => ({secret: "LOADER-RAN"});', path: "/Todo"},
        {loaderSource: "exports.loader = () => ({ok: true});", path: "/User"},
      ],
      ssrModules: {
        loadSsrPayload: path.resolve(import.meta.dir, "../server/loadSsrPayload.ts"),
        serverContext: path.resolve(import.meta.dir, "./serverContext.ts"),
      },
    });
  });

  afterAll(() => {
    removeStubSsrBuild(ssrDir);
  });

  afterEach(resetStub);

  const makeServedApp = (): express.Application => {
    const app = express();
    app.use(setTestUser);
    new AdminSpaServeApp({
      distDir: ssrDir,
      internalOrigin: `http://127.0.0.1:${internal.port}`,
    }).register(app);
    app.use((_req, res) => res.status(404).send("not found"));
    return app;
  };

  const PAGE_CASES: Array<[string, string]> = [
    ["/console/assets/../Todo", "/console/login?returnTo=%2FTodo"],
    ["/console/assets/%2e%2e/Todo", "/console/login?returnTo=%2FTodo"],
    ["/console/_expo/static/../../Todo", "/console/login?returnTo=%2FTodo"],
    ["/console/app-config.json/../Todo", "/console/login?returnTo=%2FTodo"],
    ["/console/assets/../", "/console/login?returnTo=%2F"],
  ];

  for (const [rawPath, location] of PAGE_CASES) {
    it(`redirects anonymous ${rawPath} to login`, async () => {
      const res = await rawGet(makeServedApp(), rawPath);
      expect(res.seenUrl).toBe(rawPath);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(location);
      expect(res.text).not.toContain("data-scope");
    });
  }

  for (const rawPath of [
    "/console/assets/../_expo/loaders/Todo",
    "/console/_expo/static/../../_expo/loaders/Todo",
  ]) {
    it(`answers 401 and does not run the loader for anonymous ${rawPath}`, async () => {
      const res = await rawGet(makeServedApp(), rawPath);
      expect(res.seenUrl).toBe(rawPath);
      expect(res.status).toBe(401);
      expect(res.headers["content-type"]).toContain("application/json");
      expect(res.text).not.toContain("LOADER-RAN");
    });
  }

  it("redirects a forbidden user on /console/assets/../Todo to /forbidden", async () => {
    stub.status["/admin/config"] = 403;
    const rawPath = "/console/assets/../Todo";
    const res = await rawGet(makeServedApp(), rawPath, {asUser: true});
    expect(res.seenUrl).toBe(rawPath);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/forbidden");
  });

  for (const rawPath of ["/x/../console/login", "/admin/../console/login"]) {
    it(`renders the login page for anonymous ${rawPath}`, async () => {
      const res = await rawGet(makeServedApp(), rawPath);
      expect(res.seenUrl).toBe(rawPath);
      expect(res.status).toBe(200);
      expect(res.text).toContain('data-testid="admin-spa-login-email"');
      expect(res.text).toContain("data-scope");
    });
  }
});

describe("createAdminSpaGate hands the handler the normalized path", () => {
  it("rewrites req.url for an admin on raw /x/../console/Todo", async () => {
    const {app, handlerCalls, lastUrl} = await makeGateApp();
    const rawPath = "/x/../console/Todo";
    const res = await rawGet(app, rawPath, {asUser: true});
    expect(res.seenUrl).toBe(rawPath);
    expect(res.status).toBe(200);
    expect(handlerCalls()).toBe(1);
    expect(lastUrl()).toBe("/console/Todo");
  });
});

describe("createAdminSpaGate canonicalizes percent-escapes per RFC 3986", () => {
  const ADMIN_ID = "6ae96720ae6891bc61e5a55c";

  it("decodes an escaped unreserved character before handing the admin's request on", async () => {
    const {app, handlerCalls, lastUrl} = await makeGateApp();
    const rawPath = `/console/User/%36${ADMIN_ID.slice(1)}`;
    const res = await rawGet(app, rawPath, {asUser: true});
    expect(res.seenUrl).toBe(rawPath);
    expect(res.status).toBe(200);
    expect(handlerCalls()).toBe(1);
    expect(lastUrl()).toBe(`/console/User/${ADMIN_ID}`);
  });

  it("keeps an escaped reserved character and uppercases its hex", async () => {
    const {app, lastUrl} = await makeGateApp();
    const rawPath = "/console/User/a%2fb";
    const res = await rawGet(app, rawPath, {asUser: true});
    expect(res.seenUrl).toBe(rawPath);
    expect(res.status).toBe(200);
    expect(lastUrl()).toBe("/console/User/a%2Fb");
  });

  it("keeps an escaped space", async () => {
    const {app, lastUrl} = await makeGateApp();
    const rawPath = "/console/User/a%20b";
    const res = await rawGet(app, rawPath, {asUser: true});
    expect(res.seenUrl).toBe(rawPath);
    expect(res.status).toBe(200);
    expect(lastUrl()).toBe("/console/User/a%20b");
  });

  it("decodes a fully escaped id character by character", async () => {
    const {app, lastUrl} = await makeGateApp();
    const encoded = [...ADMIN_ID]
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join("");
    const res = await rawGet(app, `/console/User/${encoded}`, {asUser: true});
    expect(res.status).toBe(200);
    expect(lastUrl()).toBe(`/console/User/${ADMIN_ID}`);
  });

  it("falls through on an escaped static prefix for an anonymous visitor without rendering", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const rawPath = "/console/%61ssets/Todo";
    const res = await rawGet(app, rawPath);
    expect(res.seenUrl).toBe(rawPath);
    expect(res.status).toBe(404);
    expect(res.text).toBe("fell through");
    expect(handlerCalls()).toBe(0);
  });

  it("redirects anonymous /console/%61ssets/../Todo to login like /console/assets/../Todo", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const rawPath = "/console/%61ssets/../Todo";
    const res = await rawGet(app, rawPath);
    expect(res.seenUrl).toBe(rawPath);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/login?returnTo=%2FTodo");
    expect(handlerCalls()).toBe(0);
  });

  it("redirects anonymous /console/%54odo to login with the decoded returnTo", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const rawPath = "/console/%54odo";
    const res = await rawGet(app, rawPath);
    expect(res.seenUrl).toBe(rawPath);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/console/login?returnTo=%2FTodo");
    expect(handlerCalls()).toBe(0);
  });

  it("answers 401 to an anonymous escaped loader path", async () => {
    const {app, handlerCalls} = await makeGateApp();
    const res = await rawGet(app, "/console/_expo/%6coaders/Todo");
    expect(res.status).toBe(401);
    expect(handlerCalls()).toBe(0);
  });
});
