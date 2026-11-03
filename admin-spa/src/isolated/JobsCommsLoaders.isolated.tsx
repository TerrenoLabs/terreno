/**
 * Isolated: `mock.module` for the Expo screens would leak into the shared suite. Proves the
 * server `loader` of the jobs and comms routes fetches the URLs `jobsSsrUrls` / `commsSsrUrls`
 * name through `loadSsrPayload` with the visitor's cookie and returns the bodies under their seed
 * keys; that detail routes decode the (still percent-encoded) route param; and that a backend 404
 * is `{rpc: {}, notFound: true}` (the page still answers 200).
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
import express from "express";
import {DateTime, Settings} from "luxon";
import {commsSsrUrls, jobsSsrUrls} from "../../server/jobsCommsRoutes";
import {AdminSpaServeApp} from "../serve";
import {type AdminSpaRequestScope, runInAdminSpaRequest} from "../serverContext";
import {removeStubSsrBuild, writeStubSsrBuild} from "../testing/ssrStubBuild";

mock.module("expo-router", () => ({
  useLoaderData: () => undefined,
  useLocalSearchParams: () => ({}),
}));
mock.module("../../components/AdminSpaShell", () => ({AdminSpaShell: () => null}));
mock.module("../../components/AppConfigGate", () => ({useAppConfig: () => ({appConfig: {}})}));

interface LoaderData {
  notFound?: boolean;
  rpc: Record<string, unknown>;
}
type LoaderModule = {
  loader: (request: Request, params: Record<string, string>) => Promise<LoaderData>;
};

/** Luxon reads its own clock; the test preload pins `Date.now`, so pin `Settings.now`. */
const setClock = (iso: string): void => {
  const millis = DateTime.fromISO(iso, {zone: "utc"}).toMillis();
  Settings.now = () => millis;
};

const NOW = "2026-11-03T12:00:00.000Z";

interface ListCase {
  file: string;
  load: () => Promise<LoaderModule>;
  urls: () => string[];
}

const LISTS: ListCase[] = [
  {
    file: "jobs/index",
    load: () => import("../../app/jobs/index") as Promise<LoaderModule>,
    urls: () => jobsSsrUrls("/jobs", {}),
  },
  {
    file: "comms/index",
    load: () => import("../../app/comms/index") as Promise<LoaderModule>,
    urls: () => commsSsrUrls("/comms", {}),
  },
];

interface DetailCase {
  file: string;
  load: () => Promise<LoaderModule>;
  /** The URL the screen's hook requests for the decoded id. */
  urlFor: (id: string) => string;
}

const DETAILS: DetailCase[] = [
  {
    file: "jobs/[id]",
    load: () => import("../../app/jobs/[id]") as Promise<LoaderModule>,
    urlFor: (id) => `/jobs/${id}`,
  },
  {
    file: "comms/[id]",
    load: () => import("../../app/comms/[id]") as Promise<LoaderModule>,
    urlFor: (id) => `/comms/messages/${id}`,
  },
];

describe("jobs and comms route loaders", () => {
  let distDir: string;
  let seen: {headers: Record<string, string>; path: string}[];
  let respond: (path: string) => Response;
  let stub: ReturnType<typeof Bun.serve>;

  const register = (extra: Record<string, unknown> = {}): void => {
    new AdminSpaServeApp({
      distDir,
      internalOrigin: `http://127.0.0.1:${stub.port}`,
      ...extra,
    }).register(express());
  };

  beforeAll(() => {
    distDir = writeStubSsrBuild();
  });

  afterAll(() => {
    removeStubSsrBuild(distDir);
  });

  beforeEach(() => {
    setClock(NOW);
    seen = [];
    respond = (path) =>
      new Response(JSON.stringify({path}), {headers: {"content-type": "application/json"}});
    stub = Bun.serve({
      fetch: (req) => {
        const url = new URL(req.url);
        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        const path = `${url.pathname}${url.search}`;
        seen.push({headers, path});
        return respond(path);
      },
      port: 0,
    });
    register();
  });

  afterEach(() => {
    Settings.now = () => Date.now();
    stub.stop(true);
  });

  const runLoader = async (
    load: () => Promise<LoaderModule>,
    {
      appConfig = {},
      cookie = "session=1",
      params = {},
    }: {appConfig?: Record<string, unknown>; cookie?: string; params?: Record<string, string>} = {}
  ): Promise<LoaderData> => {
    const mod = await load();
    expect(typeof mod.loader).toBe("function");
    const request = new Request("http://public.example/console/x", {
      headers: cookie ? {Cookie: cookie} : {},
    });
    return runInAdminSpaRequest(
      {
        adminConfig: {customScreens: [], models: [], scripts: []},
        appConfig: appConfig as AdminSpaRequestScope["appConfig"],
        basePath: "/console",
      },
      () => mod.loader(request, params)
    );
  };

  describe.each(LISTS)("$file", ({load, urls}) => {
    it("fetches the route's URLs and returns each body under its seed key", async () => {
      const result = await runLoader(load);
      const expected = urls();
      expect(expected.length).toBeGreaterThan(0);
      expect(seen.map((entry) => entry.path).sort()).toEqual([...expected].sort());
      expect(Object.keys(result.rpc).sort()).toEqual(
        expected.map((url) => adminRpcSeedKey(url)).sort()
      );
      expect(result.rpc[adminRpcSeedKey(expected[0])]).toEqual({path: expected[0]});
      expect(result.notFound).toBeFalsy();
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

    it("omits a body whose read failed (the client loads that one) and is not notFound", async () => {
      const expected = urls();
      const failing = expected[0];
      respond = (path) =>
        path === failing
          ? new Response("{}", {status: 500})
          : new Response("{}", {headers: {"content-type": "application/json"}});
      const result = await runLoader(load);
      expect(result.notFound).toBeFalsy();
      expect(Object.keys(result.rpc)).not.toContain(adminRpcSeedKey(failing));
    });

    it("ignores the admin API base path: these routes are not under it", async () => {
      register({appConfig: {adminApiBasePath: "/internal/admin"}});
      await runLoader(load, {appConfig: {adminApiBasePath: "/internal/admin"}});
      expect(seen.map((entry) => entry.path).sort()).toEqual([...urls()].sort());
    });

    it("returns an empty seed and warns, without the cookie, when ssrApiPrefixes omits the route", async () => {
      register({ssrApiPrefixes: ["/admin"]});
      const warn = spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = await runLoader(load, {cookie: "session=SECRET-COOKIE-VALUE"});
        expect(result).toEqual({rpc: {}});
        expect(seen).toEqual([]);
        expect(warn).toHaveBeenCalled();
        expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-COOKIE-VALUE");
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe.each(DETAILS)("$file", ({load, urlFor}) => {
    it("fetches the record and returns its body under the seed key", async () => {
      const result = await runLoader(load, {params: {id: "x1"}});
      expect(seen.map((entry) => entry.path)).toEqual([urlFor("x1")]);
      expect(Object.keys(result.rpc)).toEqual([adminRpcSeedKey(urlFor("x1"))]);
      expect(result.notFound).toBeFalsy();
    });

    it("forwards the visitor's cookie", async () => {
      await runLoader(load, {params: {id: "x1"}});
      expect(seen[0]?.headers.cookie).toBe("session=1");
    });

    // expo-server hands loaders the params still percent-encoded; the hook requests the decoded
    // id as is, so the seed key must be built from the decoded id.
    it("decodes the encoded route param before building the URL", async () => {
      const result = await runLoader(load, {params: {id: "a%20b"}});
      expect(seen.map((entry) => entry.path)).toEqual([
        new URL(urlFor("a b"), "http://x").pathname,
      ]);
      expect(Object.keys(result.rpc)).toEqual([adminRpcSeedKey(urlFor("a b"))]);
    });

    it("fetches nothing for a missing id or a malformed escape", async () => {
      expect(await runLoader(load, {params: {}})).toEqual({rpc: {}});
      expect(await runLoader(load, {params: {id: "%E0%A4%A"}})).toEqual({rpc: {}});
      expect(seen).toEqual([]);
    });

    it("fetches nothing for an anonymous request", async () => {
      expect(await runLoader(load, {cookie: "", params: {id: "x1"}})).toEqual({rpc: {}});
      expect(seen).toEqual([]);
    });

    it("returns {rpc: {}, notFound: true} when the backend answers 404", async () => {
      respond = () => new Response(JSON.stringify({title: "Not found"}), {status: 404});
      expect(await runLoader(load, {params: {id: "missing"}})).toEqual({notFound: true, rpc: {}});
    });

    it.each([401, 403, 500])("returns {rpc: {}} without notFound on a %p", async (status) => {
      respond = () => new Response("{}", {status});
      expect(await runLoader(load, {params: {id: "x1"}})).toEqual({rpc: {}});
    });
  });
});
