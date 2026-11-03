/**
 * Isolated: `mock.module` for the Expo screens would leak into the shared suite. Proves the
 * server `loader` of the home, configuration, roles, scripts and version-config routes fetches
 * the URLs `rpcUrlsForRoute` names through `loadSsrPayload`, with the visitor's cookie, and
 * returns the bodies keyed by the seed key.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import {adminRpcSeedKey} from "@terreno/admin-frontend";
import type {ImmutableRequest, LoaderFunction} from "expo-server";
import express from "express";
import {AdminSpaServeApp} from "../serve";
import {type AdminSpaRequestScope, runInAdminSpaRequest} from "../serverContext";
import {removeStubSsrBuild, writeStubSsrBuild} from "../testing/ssrStubBuild";

mock.module("expo-router", () => ({
  useLoaderData: () => undefined,
  useLocalSearchParams: () => ({}),
}));
mock.module("../../components/AdminSpaShell", () => ({AdminSpaShell: () => null}));
mock.module("../../components/AppConfigGate", () => ({useAppConfig: () => ({appConfig: {}})}));

const adminConfig = {
  customScreens: [],
  home: {slots: {main: ["modelStats"], sidebar: ["jobs"]}, title: "Admin"},
  models: [
    {
      displayName: "User",
      fields: {_id: {required: true, type: "string"}},
      listFields: ["_id"],
      name: "User",
      routePath: "/admin/users",
    },
  ],
  scripts: [],
};

interface LoaderModule {
  loader: LoaderFunction<{rpc: Record<string, unknown>}>;
}

const ROUTES: {file: string; load: () => Promise<LoaderModule>; urls: string[]}[] = [
  {
    file: "configuration",
    load: () => import("../../app/configuration"),
    urls: ["/configuration/meta", "/configuration"],
  },
  {
    file: "roles",
    load: () => import("../../app/roles/index"),
    urls: ["/rbac/roles", "/rbac/statements"],
  },
  {
    file: "scripts",
    load: () => import("../../app/scripts"),
    urls: ["/admin/scripts/runs?page=1&limit=25"],
  },
  {
    file: "version-config",
    load: () => import("../../app/version-config"),
    urls: ["/admin/version-config"],
  },
  {
    file: "index (home)",
    load: () => import("../../app/index"),
    urls: ["/admin/users?limit=1&page=1", "/jobs/stats"],
  },
];

describe("rpc route loaders", () => {
  let distDir: string;
  let seen: {headers: Record<string, string>; path: string}[];
  let failPaths: Set<string>;
  let stub: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    distDir = writeStubSsrBuild();
  });

  afterAll(() => {
    removeStubSsrBuild(distDir);
  });

  beforeEach(() => {
    seen = [];
    failPaths = new Set();
    stub = Bun.serve({
      fetch: (req) => {
        const url = new URL(req.url);
        const path = `${url.pathname}${url.search}`;
        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        seen.push({headers, path});
        if (failPaths.has(path)) {
          return new Response("{}", {status: 500});
        }
        return new Response(JSON.stringify({path}), {
          headers: {"content-type": "application/json"},
        });
      },
      port: 0,
    });
    new AdminSpaServeApp({
      distDir,
      internalOrigin: `http://127.0.0.1:${stub.port}`,
    }).register(express());
  });

  afterEach(() => {
    stub.stop(true);
  });

  const runLoader = async (
    load: () => Promise<LoaderModule>,
    {
      appConfig = {},
      cookie = "session=1",
      scope = {adminConfig},
    }: {
      appConfig?: Record<string, unknown>;
      cookie?: string;
      scope?: Partial<AdminSpaRequestScope>;
    } = {}
  ): Promise<{rpc: Record<string, unknown>}> => {
    const {loader} = await load();
    const request = new Request("http://public.example/console/x", {
      headers: cookie ? {Cookie: cookie} : {},
    });
    return runInAdminSpaRequest(
      {
        appConfig: appConfig as unknown as AdminSpaRequestScope["appConfig"],
        basePath: "/console",
        ...scope,
      },
      async () => loader(request as unknown as ImmutableRequest, {})
    );
  };

  describe.each(ROUTES)("$file", ({load, urls}) => {
    it("fetches the route's URLs and returns each body under its seed key", async () => {
      const result = await runLoader(load);
      expect(seen.map((entry) => entry.path).sort()).toEqual([...urls].sort());
      expect(Object.keys(result.rpc).sort()).toEqual(
        urls.map((url) => adminRpcSeedKey(url)).sort()
      );
      expect(result.rpc[adminRpcSeedKey(urls[0])]).toEqual({path: urls[0]});
    });

    it("forwards the visitor's cookie and no organization header", async () => {
      await runLoader(load);
      expect(seen.length).toBeGreaterThan(0);
      for (const entry of seen) {
        expect(entry.headers.cookie).toBe("session=1");
        expect(entry.headers["x-organization-id"]).toBeUndefined();
      }
    });

    it("fetches nothing for an anonymous request", async () => {
      const result = await runLoader(load, {cookie: ""});
      expect(result).toEqual({rpc: {}});
      expect(seen).toEqual([]);
    });
  });

  it("omits a body whose read failed, keeping the others (the client loads that one)", async () => {
    const {load} = ROUTES[1];
    failPaths.add("/rbac/statements");
    const result = await runLoader(load);
    expect(Object.keys(result.rpc)).toEqual([adminRpcSeedKey("/rbac/roles")]);
  });

  it("uses the configured admin API base path for scripts and version-config", async () => {
    // The plugin's config sets the base for both the render and the SSR path allowlist.
    new AdminSpaServeApp({
      appConfig: {adminApiBasePath: "/internal/admin"},
      distDir,
      internalOrigin: `http://127.0.0.1:${stub.port}`,
    }).register(express());
    await runLoader(ROUTES[2].load, {appConfig: {adminApiBasePath: "/internal/admin"}});
    await runLoader(ROUTES[3].load, {appConfig: {adminApiBasePath: "/internal/admin"}});
    expect(seen.map((entry) => entry.path).sort()).toEqual(
      ["/internal/admin/scripts/runs?page=1&limit=25", "/internal/admin/version-config"].sort()
    );
  });

  it("roles fetches the RBAC root derived from a configured admin API base", async () => {
    new AdminSpaServeApp({
      appConfig: {adminApiBasePath: "/internal/admin"},
      distDir,
      internalOrigin: `http://127.0.0.1:${stub.port}`,
    }).register(express());
    const result = await runLoader(ROUTES[1].load, {
      appConfig: {adminApiBasePath: "/internal/admin"},
    });
    expect(seen.map((entry) => entry.path).sort()).toEqual([
      "/internal/rbac/roles",
      "/internal/rbac/statements",
    ]);
    expect(result.rpc[adminRpcSeedKey("/internal/rbac/roles")]).toEqual({
      path: "/internal/rbac/roles",
    });
    expect(result.rpc[adminRpcSeedKey("/internal/rbac/statements")]).toEqual({
      path: "/internal/rbac/statements",
    });
  });

  it("roles returns an empty seed and warns when ssrApiPrefixes omits the RBAC root", async () => {
    new AdminSpaServeApp({
      distDir,
      internalOrigin: `http://127.0.0.1:${stub.port}`,
      ssrApiPrefixes: ["/admin"],
    }).register(express());
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = await runLoader(ROUTES[1].load, {cookie: "session=SECRET-COOKIE-VALUE"});
      expect(result).toEqual({rpc: {}});
      expect(seen).toEqual([]);
      expect(warn).toHaveBeenCalled();
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toContain("/roles");
      expect(logged).not.toContain("SECRET-COOKIE-VALUE");
    } finally {
      warn.mockRestore();
    }
  });

  it("home fetches nothing when the scope has no admin config", async () => {
    const result = await runLoader(ROUTES[4].load, {scope: {adminConfig: null}});
    expect(result).toEqual({rpc: {}});
    expect(seen).toEqual([]);
  });

  it("home with no slots fetches nothing", async () => {
    const result = await runLoader(ROUTES[4].load, {
      scope: {adminConfig: {...adminConfig, home: {slots: {}, title: "Admin"}}},
    });
    expect(result).toEqual({rpc: {}});
    expect(seen).toEqual([]);
  });
});
