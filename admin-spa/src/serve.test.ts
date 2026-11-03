import {afterAll, afterEach, beforeAll, describe, expect, it, spyOn} from "bun:test";
import path from "node:path";
import {logger} from "@terreno/api";
import express from "express";
import request from "supertest";
import {DEFAULT_APP_CONFIG} from "./appConfig";
import {AdminSpaServeApp, injectBaseGlobal, rewriteIndexHtml} from "./serve";
import {getAdminSpaServerContext} from "./serverContext";
import {
  removeStubSsrBuild,
  STUB_ASSET_CONTENT,
  STUB_ASSET_PATH,
  writeStubSsrBuild,
} from "./testing/ssrStubBuild";

let distDir: string;
let distDirWithoutServer: string;

beforeAll(() => {
  distDir = writeStubSsrBuild();
  distDirWithoutServer = writeStubSsrBuild({omitServer: true});
});

afterAll(() => {
  removeStubSsrBuild(distDir);
  removeStubSsrBuild(distDirWithoutServer);
});

const makeApp = (opts?: {
  basePath?: string;
  appConfig?: Record<string, unknown>;
  devProxyTarget?: string;
  distDir?: string;
}): express.Application => {
  const app = express();
  new AdminSpaServeApp({
    appConfig: opts?.appConfig,
    basePath: opts?.basePath,
    devProxyTarget: opts?.devProxyTarget,
    distDir: opts?.distDir ?? distDir,
  }).register(app);
  // A fallthrough 404 so requests outside basePath resolve.
  app.use((_req, res) => res.status(404).send("not found"));
  return app;
};

describe("AdminSpaServeApp server rendering", () => {
  it("renders /console/login on the server with the default brand name", async () => {
    const res = await request(makeApp()).get("/console/login");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("Terreno Admin");
    expect(res.text).toContain(DEFAULT_APP_CONFIG.brandName);
    expect(res.text).toContain('data-testid="admin-spa-login-email"');
    expect(res.text).not.toContain("admin-spa-app-config-loading");
  });

  it("publishes the override brandName and basePath for render.js", async () => {
    const res = await request(makeApp({appConfig: {brandName: "Acme Console"}})).get(
      "/console/login"
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain("<h1>Acme Console</h1>");
    expect(res.text).toContain('window.__ADMIN_SPA_BASE__="/console"');
  });

  it("runs the static route's loader when a dynamic route is listed first", async () => {
    // Expo 58 exports routes.json unsorted: `/[model]` precedes `/login` and its regex also
    // matches `/login`, which would render /login without its loader data.
    const unsortedDir = writeStubSsrBuild({dynamicRouteFirst: true});
    try {
      const res = await request(
        makeApp({appConfig: {brandName: "Acme Console"}, distDir: unsortedDir})
      ).get("/console/login");
      expect(res.status).toBe(200);
      expect(res.text).toContain('data-loader="{\\"appConfig\\":{');
      expect(res.text).toContain("Acme Console");
      expect(res.text).not.toContain('data-loader="null"');
    } finally {
      removeStubSsrBuild(unsortedDir);
    }
  });

  it("serves the login loader JSON under the base path", async () => {
    const res = await request(makeApp({appConfig: {brandName: "Acme Console"}})).get(
      "/console/_expo/loaders/login"
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.appConfig.brandName).toBe("Acme Console");
  });

  it("serves the login loader JSON at the site root for Expo's client navigation", async () => {
    const res = await request(makeApp({appConfig: {brandName: "Acme Console"}})).get(
      "/_expo/loaders/login"
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.appConfig.brandName).toBe("Acme Console");
  });

  it("does not claim a root loader path for a route without a loader", async () => {
    const res = await request(makeApp()).get("/_expo/loaders/nonexistent");
    expect(res.status).toBe(404);
  });

  it("does not claim other root paths", async () => {
    const res = await request(makeApp()).get("/login");
    expect(res.status).toBe(404);
    expect(res.text).toBe("not found");
  });

  it("resolves the server build from <distDir>/server", async () => {
    // The export root has client/ and server/; pointing distDir at server/ itself must not work.
    const res = await request(makeApp({distDir: `${distDir}/server`})).get("/console/login");
    expect(res.status).toBe(503);
  });
});

describe("AdminSpaServeApp static files", () => {
  it("serves hashed client assets with an immutable long-lived cache header", async () => {
    const res = await request(makeApp()).get(`/console${STUB_ASSET_PATH}`);
    expect(res.status).toBe(200);
    expect(res.text).toBe(STUB_ASSET_CONTENT);
    expect(res.headers["cache-control"]).toContain("max-age=31536000");
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("serves /assets from the client directory with an immutable cache header", async () => {
    const res = await request(makeApp()).get("/console/assets/logo.png");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toContain("immutable");
  });

  it("serves app-config.json with defaults and no-store", async () => {
    const res = await request(makeApp()).get("/console/app-config.json");
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body.brandName).toBe(DEFAULT_APP_CONFIG.brandName);
    expect(res.body.primaryColor).toBe("#2563EB");
    expect(res.body.providers).toEqual(["email"]);
  });

  it("merges provided app-config over the defaults field-by-field", async () => {
    const res = await request(
      makeApp({appConfig: {brandName: "Acme Admin", providers: ["email", "google"]}})
    ).get("/console/app-config.json");
    expect(res.body.brandName).toBe("Acme Admin");
    expect(res.body.providers).toEqual(["email", "google"]);
    expect(res.body.primaryColor).toBe("#2563EB");
  });

  it("does not handle requests outside the base path", async () => {
    const res = await request(makeApp()).get("/unrelated");
    expect(res.status).toBe(404);
  });
});

describe("AdminSpaServeApp without a server build", () => {
  it("logs the missing-bundle warning and answers 503 instead of crashing", async () => {
    const warn = spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      const app = makeApp({distDir: distDirWithoutServer});
      expect(warn.mock.calls.some(([message]) => String(message).includes("Admin SPA"))).toBe(true);
      const res = await request(app).get("/console/login");
      expect(res.status).toBe(503);
    } finally {
      warn.mockRestore();
    }
  });

  it("still serves app-config.json and static files", async () => {
    const warn = spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      const app = makeApp({distDir: distDirWithoutServer});
      const config = await request(app).get("/console/app-config.json");
      expect(config.status).toBe(200);
      const asset = await request(app).get(`/console${STUB_ASSET_PATH}`);
      expect(asset.status).toBe(200);
      expect(asset.text).toBe(STUB_ASSET_CONTENT);
    } finally {
      warn.mockRestore();
    }
  });
});

describe("AdminSpaServeApp basePath guard", () => {
  it("honors a custom basePath that matches the baked baseUrl", async () => {
    const bakedDir = writeStubSsrBuild({bakedBaseUrl: "/admin-ui"});
    try {
      const res = await request(makeApp({basePath: "/admin-ui", distDir: bakedDir})).get(
        "/admin-ui/login"
      );
      expect(res.status).toBe(200);
      expect(res.text).toContain('window.__ADMIN_SPA_BASE__="/admin-ui"');
    } finally {
      removeStubSsrBuild(bakedDir);
    }
  });

  it("throws at register() when basePath differs from the bundle's baked baseUrl", () => {
    expect(() => makeApp({basePath: "/admin-ui"})).toThrow(
      'Admin SPA basePath "/admin-ui" does not match the bundle\'s baseUrl "/console"'
    );
  });
});

describe("AdminSpaServeApp dev proxy", () => {
  it("serves app-config from the plugin before the dev proxy", async () => {
    const proxyTarget = express();
    proxyTarget.get("/app-config.json", (_req, res) => {
      res.json({brandName: "Proxied Config"});
    });
    const proxyServer = proxyTarget.listen(0);
    const port = (proxyServer.address() as {port: number}).port;

    try {
      const res = await request(
        makeApp({
          appConfig: {brandName: "Plugin Config"},
          devProxyTarget: `http://127.0.0.1:${port}`,
        })
      ).get("/console/app-config.json");
      expect(res.status).toBe(200);
      expect(res.body.brandName).toBe("Plugin Config");
    } finally {
      await new Promise<void>((resolve, reject) => {
        proxyServer.close((err) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("proxies SPA paths to the dev server and does not read the server build", async () => {
    const proxyTarget = express();
    proxyTarget.get("/login", (_req, res) => {
      res.send("FROM-EXPO-DEV");
    });
    const proxyServer = proxyTarget.listen(0);
    const port = (proxyServer.address() as {port: number}).port;

    try {
      const res = await request(
        makeApp({
          devProxyTarget: `http://127.0.0.1:${port}`,
          distDir: "/nonexistent-dist-dir",
        })
      ).get("/console/login");
      expect(res.status).toBe(200);
      expect(res.text).toBe("FROM-EXPO-DEV");
    } finally {
      await new Promise<void>((resolve) => {
        proxyServer.close(() => resolve());
      });
    }
  });
});

// Deprecated static-export helpers stay exported until the next major (plan Q4).
const STUB_INDEX =
  '<html><head><link href="/_expo/static/css/app.css"><script src="/_expo/static/js/web/entry.js"></script></head><body>STUB-SPA</body></html>';

describe("rewriteIndexHtml", () => {
  it("rewrites absolute /_expo/ and /assets/ refs to the basePath", () => {
    const out = rewriteIndexHtml(STUB_INDEX, "/console");
    expect(out).toContain('href="/console/_expo/static/css/app.css"');
    expect(out).toContain('src="/console/_expo/static/js/web/entry.js"');
    expect(out).not.toContain('href="/_expo/');
  });

  it("rewrites assets references too", () => {
    const out = rewriteIndexHtml('<img src="/assets/logo.png">', "/admin-ui");
    expect(out).toContain('src="/admin-ui/assets/logo.png"');
  });
});
describe("injectBaseGlobal", () => {
  it("injects window.__ADMIN_SPA_BASE__ before </head>", () => {
    const out = injectBaseGlobal(
      "<html><head><title>x</title></head><body></body></html>",
      "/console"
    );
    expect(out).toContain('<script>window.__ADMIN_SPA_BASE__="/console";</script></head>');
  });

  it("falls back to prepending when there is no </head>", () => {
    const out = injectBaseGlobal("<body>x</body>", "/admin-ui");
    expect(out.startsWith('<script>window.__ADMIN_SPA_BASE__="/admin-ui";</script>')).toBe(true);
  });
});

describe("AdminSpaServeApp PHI response headers", () => {
  it.each([
    ["HTML page", "/console/login"],
    ["loader under basePath", "/console/_expo/loaders/login"],
    ["loader at the site root", "/_expo/loaders/login"],
  ])("sends Cache-Control: no-store, private on the %s", async (_label, url) => {
    const res = await request(makeApp()).get(url);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store, private");
  });

  it("keeps app-config.json at plain no-store", async () => {
    const res = await request(makeApp()).get("/console/app-config.json");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("keeps the immutable cache header on hashed assets", async () => {
    const res = await request(makeApp()).get(`/console${STUB_ASSET_PATH}`);
    expect(res.headers["cache-control"]).not.toContain("private");
  });
});

describe("AdminSpaServeApp internalOrigin and ssrApiPrefixes options", () => {
  const savedPort = process.env.PORT;

  afterEach(() => {
    if (savedPort === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = savedPort;
    }
  });

  it("defaults internalOrigin to http://127.0.0.1:$PORT", () => {
    process.env.PORT = "5123";
    makeApp();
    expect(getAdminSpaServerContext()?.internalOrigin).toBe("http://127.0.0.1:5123");
  });

  it("defaults internalOrigin to port 4000 when PORT is unset", () => {
    delete process.env.PORT;
    makeApp();
    expect(getAdminSpaServerContext()?.internalOrigin).toBe("http://127.0.0.1:4000");
  });

  it("publishes an explicit internalOrigin and ssrApiPrefixes", () => {
    const app = express();
    new AdminSpaServeApp({
      distDir,
      internalOrigin: "http://127.0.0.1:9999",
      ssrApiPrefixes: ["/admin"],
    }).register(app);
    expect(getAdminSpaServerContext()?.internalOrigin).toBe("http://127.0.0.1:9999");
    expect(getAdminSpaServerContext()?.ssrApiPrefixes).toEqual(["/admin"]);
  });

  it("publishes the default ssrApiPrefixes", () => {
    makeApp();
    expect(getAdminSpaServerContext()?.ssrApiPrefixes).toEqual([
      "/admin",
      "/auth/me",
      "/orgs",
      "/jobs",
      "/comms",
      "/configuration",
      "/rbac",
    ]);
  });
});

const SENTINEL = "PHI-SENTINEL";
const SERVER_MODULES = {
  loadSsrPayload: path.resolve(import.meta.dir, "../server/loadSsrPayload.ts"),
  serverContext: path.resolve(import.meta.dir, "./serverContext.ts"),
};

describe("AdminSpaServeApp request scope and escaping through the Expo handler", () => {
  let ssrDir: string;
  let internal: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    internal = Bun.serve({
      fetch: () => Response.json({rows: [{email: SENTINEL}]}),
      port: 0,
    });
    ssrDir = writeStubSsrBuild({
      extraRoutes: [
        {
          loaderSource: 'exports.loader = () => ({rows: [{note: "</script><script>x()"}]});',
          path: "/phi",
        },
        {
          loaderSource: `exports.loader = async (request) => {
  const {loadSsrPayload} = require(LOAD_SSR_PAYLOAD);
  await loadSsrPayload(request, {requests: [{url: "/admin/users"}]});
  throw new Error("loader exploded");
};`,
          path: "/boom",
        },
      ],
      ssrModules: SERVER_MODULES,
    });
  });

  afterAll(() => {
    internal.stop(true);
    removeStubSsrBuild(ssrDir);
  });

  const makeScopedApp = async (): Promise<express.Application> => {
    // Loaded lazily so the pre-existing cases in this file still run while the export is missing.
    const {runInAdminSpaRequest} = await import("./serverContext");
    const app = express();
    // Stands in for the T3 gate: sets the per-request scope before the Expo handler runs.
    app.use((req, _res, next) => {
      runInAdminSpaRequest(
        {
          appConfig: DEFAULT_APP_CONFIG,
          basePath: "/console",
          session: {userId: String(req.headers["x-user"] ?? "none")},
        } as unknown as Parameters<typeof runInAdminSpaRequest>[0],
        next
      );
    });
    new AdminSpaServeApp({
      distDir: ssrDir,
      internalOrigin: `http://127.0.0.1:${internal.port}`,
    }).register(app);
    return app;
  };

  it("escapes a loader row containing </script><script>x() in the server-rendered HTML", async () => {
    const res = await request(await makeScopedApp()).get("/console/phi");
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="loader-blob"');
    expect(res.text).not.toContain("</script><script>x()");
  });

  it("exposes a value set before the handler inside render.js, and not across requests", async () => {
    const app = await makeScopedApp();
    const [a, b] = await Promise.all([
      request(app).get("/console/phi").set("x-user", "user-A"),
      request(app).get("/console/phi").set("x-user", "user-B"),
    ]);
    expect(a.text).toContain("user-A");
    expect(a.text).not.toContain("user-B");
    expect(b.text).toContain("user-B");
    expect(b.text).not.toContain("user-A");
  });

  it("logs the route path and error, never row values, when a loader throws after fetching rows", async () => {
    const errorSpy = spyOn(logger, "error").mockImplementation((() => logger) as never);
    const warnSpy = spyOn(logger, "warn").mockImplementation((() => logger) as never);
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await request(await makeScopedApp())
        .get("/console/boom")
        .set("Cookie", "sid=1");
      expect(res.text).not.toContain(SENTINEL);
      const dump = (calls: unknown[][]): string =>
        JSON.stringify(calls, (_key, value) =>
          value instanceof Error ? `${value.message}\n${value.stack}` : value
        );
      const logged = dump(errorSpy.mock.calls);
      expect(errorSpy).toHaveBeenCalled();
      expect(logged).toContain("/boom");
      expect(logged).toContain("loader exploded");
      for (const calls of [errorSpy.mock.calls, warnSpy.mock.calls, consoleSpy.mock.calls]) {
        expect(dump(calls)).not.toContain(SENTINEL);
      }
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });

  it("logs req.path, never the query string, when a loader throws on /boom?q=PHI-SENTINEL", async () => {
    const errorSpy = spyOn(logger, "error").mockImplementation((() => logger) as never);
    const warnSpy = spyOn(logger, "warn").mockImplementation((() => logger) as never);
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      await request(await makeScopedApp())
        .get(`/console/boom?q=${SENTINEL}`)
        .set("Cookie", "sid=1");
      const dump = (calls: unknown[][]): string =>
        JSON.stringify(calls, (_key, value) =>
          value instanceof Error ? `${value.message}\n${value.stack}` : value
        );
      expect(errorSpy).toHaveBeenCalled();
      expect(dump(errorSpy.mock.calls)).toContain("/boom");
      for (const calls of [errorSpy.mock.calls, warnSpy.mock.calls, consoleSpy.mock.calls]) {
        expect(dump(calls)).not.toContain(SENTINEL);
      }
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});

describe("AdminSpaServeApp when the internal origin returns a non-JSON body", () => {
  let ssrDir: string;
  let internal: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    internal = Bun.serve({
      fetch: () =>
        new Response(`PHISENTINEL not json ${SENTINEL}`, {
          headers: {"content-type": "text/plain"},
          status: 200,
        }),
      port: 0,
    });
    ssrDir = writeStubSsrBuild({
      extraRoutes: [
        {
          loaderSource: `exports.loader = async (request) => {
  const {loadSsrPayload} = require(LOAD_SSR_PAYLOAD);
  return loadSsrPayload(request, {requests: [{url: "/admin/users"}]});
};`,
          path: "/badjson",
        },
      ],
      ssrModules: SERVER_MODULES,
    });
  });

  afterAll(() => {
    internal.stop(true);
    removeStubSsrBuild(ssrDir);
  });

  it("keeps the body out of every log call and the response", async () => {
    const errorSpy = spyOn(logger, "error").mockImplementation((() => logger) as never);
    const warnSpy = spyOn(logger, "warn").mockImplementation((() => logger) as never);
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = express();
      new AdminSpaServeApp({
        distDir: ssrDir,
        internalOrigin: `http://127.0.0.1:${internal.port}`,
      }).register(app);
      const res = await request(app).get("/console/badjson").set("Cookie", "sid=1");
      expect(res.text).not.toContain(SENTINEL);
      expect(res.text).not.toContain("PHISENTINEL");
      expect(errorSpy).toHaveBeenCalled();
      const dump = (calls: unknown[][]): string =>
        JSON.stringify(calls, (_key, value) =>
          value instanceof Error ? `${value.message}\n${value.stack}` : value
        );
      for (const calls of [errorSpy.mock.calls, warnSpy.mock.calls, consoleSpy.mock.calls]) {
        expect(dump(calls)).not.toContain(SENTINEL);
        expect(dump(calls)).not.toContain("PHISENTINEL");
      }
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  });
});

describe("AdminSpaServeApp keeps a loader's API query string out of logs", () => {
  const PHI_LOADER = `exports.loader = async (request) => {
  const {loadSsrPayload} = require(LOAD_SSR_PAYLOAD);
  return loadSsrPayload(request, {requests: [{url: "/admin/users?search=${SENTINEL}"}]});
};`;
  let ssrDir: string;

  beforeAll(() => {
    ssrDir = writeStubSsrBuild({
      extraRoutes: [{loaderSource: PHI_LOADER, path: "/phiquery"}],
      ssrModules: SERVER_MODULES,
    });
  });

  afterAll(() => {
    removeStubSsrBuild(ssrDir);
  });

  /** Renders each call with Bun.inspect so Error causes and stacks are included. */
  const dump = (calls: unknown[][]): string =>
    calls
      .map((args) =>
        [
          Bun.inspect(args),
          JSON.stringify(args, (_key, value) =>
            value instanceof Error ? `${value.message}\n${value.stack}` : value
          ),
        ].join("\n")
      )
      .join("\n");

  const expectNoQueryInLogs = async (internalOrigin: string): Promise<void> => {
    const errorSpy = spyOn(logger, "error").mockImplementation((() => logger) as never);
    const warnSpy = spyOn(logger, "warn").mockImplementation((() => logger) as never);
    const consoleSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const app = express();
      new AdminSpaServeApp({distDir: ssrDir, internalOrigin}).register(app);
      const res = await request(app).get("/console/phiquery").set("Cookie", "sid=1");
      expect(res.text).not.toContain(SENTINEL);
      expect(errorSpy).toHaveBeenCalled();
      expect(dump(errorSpy.mock.calls)).toContain("/phiquery");
      for (const calls of [errorSpy.mock.calls, warnSpy.mock.calls, consoleSpy.mock.calls]) {
        expect(dump(calls)).not.toContain(SENTINEL);
      }
    } finally {
      errorSpy.mockRestore();
      warnSpy.mockRestore();
      consoleSpy.mockRestore();
    }
  };

  it("logs the route path, never the API query string, when the internal origin is down", async () => {
    const dead = Bun.serve({fetch: () => new Response("unused"), port: 0});
    const deadOrigin = `http://127.0.0.1:${dead.port}`;
    dead.stop(true);
    await expectNoQueryInLogs(deadOrigin);
  });

  it("logs the route path, never the API query string, when the internal origin returns non-JSON", async () => {
    const plain = Bun.serve({
      fetch: () => new Response("not json", {headers: {"content-type": "text/plain"}, status: 200}),
      port: 0,
    });
    try {
      await expectNoQueryInLogs(`http://127.0.0.1:${plain.port}`);
    } finally {
      plain.stop(true);
    }
  });
});

describe("AdminSpaServeApp base request scope without upstream middleware", () => {
  it("renders inside a scope whose basePath is /console", async () => {
    const ssrDir = writeStubSsrBuild({ssrModules: SERVER_MODULES});
    try {
      const app = express();
      new AdminSpaServeApp({distDir: ssrDir}).register(app);
      const res = await request(app).get("/console/login");
      expect(res.status).toBe(200);
      const match = res.text.match(/data-scope=("(?:[^"\\]|\\.)*")/);
      expect(match).not.toBeNull();
      const scope = JSON.parse(match?.[1] ?? '""') as string;
      expect(scope).not.toBe("null");
      expect(scope).toContain("/console");
    } finally {
      removeStubSsrBuild(ssrDir);
    }
  });
});
