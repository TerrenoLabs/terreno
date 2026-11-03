/**
 * Isolated: `mock.module` for the Expo screens would leak into the shared suite. Proves the
 * server `loader` of the orgs routes (T11) fetches the requests `orgsSsrRequests` names through
 * `loadSsrPayload` with the visitor's cookie (and `X-Organization-Id` on the org-scoped ones),
 * keys the bodies by `adminRpcSeedKey(url, headers)`, decodes route params, and decides
 * `isOperator` from the request scope's `profile` through `isOrganizationOperatorProfile`: the
 * gate stores the raw `/auth/me` body, so the profile may arrive as `{data: {...}}` or bare. A
 * non-operator's directory route fetches nothing.
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
import {logger} from "@terreno/api";
import express from "express";
import {orgsSsrRequests} from "../../server/orgsRoutes";
import {AdminSpaServeApp} from "../serve";
import {type AdminSpaRequestScope, runInAdminSpaRequest} from "../serverContext";
import {removeStubSsrBuild, writeStubSsrBuild} from "../testing/ssrStubBuild";

mock.module("expo-router", () => ({
  router: {push: () => {}},
  useLoaderData: () => undefined,
  useLocalSearchParams: () => ({}),
}));
mock.module("../../components/AdminSpaShell", () => ({AdminSpaShell: () => null}));
mock.module("../../components/AppConfigGate", () => ({useAppConfig: () => ({appConfig: {}})}));

interface LoaderData {
  rpc: Record<string, unknown>;
}
type LoaderModule = {
  loader: (request: Request, params: Record<string, string>) => Promise<LoaderData>;
};

const OPERATOR = {roles: ["operator"]};

describe("orgs route loaders", () => {
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
    stub.stop(true);
  });

  const runLoader = async (
    load: () => Promise<LoaderModule>,
    options: {cookie?: string; params?: Record<string, string>; profile?: unknown} = {}
  ): Promise<LoaderData> => {
    const {cookie = "session=1", params = {}} = options;
    // `profile: undefined` means "no profile"; only an omitted key gets the operator default.
    const profile = "profile" in options ? options.profile : OPERATOR;
    const mod = await load();
    expect(typeof mod.loader).toBe("function");
    const request = new Request("http://public.example/console/x", {
      headers: cookie ? {Cookie: cookie} : {},
    });
    const scope: AdminSpaRequestScope = {
      adminConfig: {customScreens: [], models: [], scripts: []},
      appConfig: {} as AdminSpaRequestScope["appConfig"],
      basePath: "/console",
      profile,
    };
    return runInAdminSpaRequest(scope, () => mod.loader(request, params));
  };

  const loadDirectory = (): Promise<LoaderModule> =>
    import("../../app/orgs/index") as Promise<LoaderModule>;
  const loadSettings = (): Promise<LoaderModule> =>
    import("../../app/orgs/[orgId]/index") as Promise<LoaderModule>;
  const loadMembers = (): Promise<LoaderModule> =>
    import("../../app/orgs/[orgId]/members") as Promise<LoaderModule>;

  const seenPaths = (): string[] =>
    seen.map((entry) => entry.path).filter((path) => path !== "/orgs/mine");

  describe("/orgs", () => {
    it("fetches the directory for an operator and returns the body under its seed key", async () => {
      const result = await runLoader(loadDirectory);
      expect(seenPaths()).toEqual(["/orgs"]);
      expect(result.rpc[adminRpcSeedKey("/orgs")]).toEqual({path: "/orgs"});
    });

    it("forwards the visitor's cookie and no organization header", async () => {
      await runLoader(loadDirectory);
      expect(seen.length).toBeGreaterThan(0);
      for (const entry of seen) {
        expect(entry.headers.cookie).toBe("session=1");
        expect(entry.headers["x-organization-id"]).toBeUndefined();
      }
    });

    it.each([
      ["operator", {roles: ["operator"]}],
      ["superadmin", {roles: ["superadmin"]}],
      ["an enveloped operator profile", {data: {roles: ["operator"]}}],
      ["an enveloped superadmin profile", {data: {roles: ["superadmin"]}}],
    ])("fetches the directory for %s", async (_name, profile) => {
      await runLoader(loadDirectory, {profile});
      expect(seenPaths()).toEqual(["/orgs"]);
    });

    it.each([
      ["an org admin", {roles: ["admin"]}],
      ["an enveloped org admin", {data: {roles: ["admin"]}}],
      ["a profile with no roles", {}],
      ["an enveloped profile with no roles", {data: {}}],
      ["admin: true without an operator role", {admin: true}],
      ["a null profile", null],
      ["no profile", undefined],
    ])("fetches no directory data for %s", async (_name, profile) => {
      const result = await runLoader(loadDirectory, {profile});
      expect(seenPaths()).toEqual([]);
      expect(Object.keys(result.rpc)).not.toContain(adminRpcSeedKey("/orgs"));
    });

    it("fetches nothing for an anonymous request", async () => {
      expect(await runLoader(loadDirectory, {cookie: ""})).toEqual({rpc: {}});
      expect(seen).toEqual([]);
    });

    it("omits a body whose read failed (the client loads that one)", async () => {
      respond = () => new Response("{}", {status: 500});
      expect(await runLoader(loadDirectory)).toEqual({rpc: {}});
    });

    it("returns an empty seed and warns, without the cookie, when ssrApiPrefixes omits /orgs", async () => {
      register({ssrApiPrefixes: ["/admin"]});
      const warn = spyOn(logger, "warn").mockImplementation((() => logger) as never);
      try {
        const result = await runLoader(loadDirectory, {cookie: "session=SECRET-COOKIE-VALUE"});
        expect(result).toEqual({rpc: {}});
        expect(seen).toEqual([]);
        expect(warn).toHaveBeenCalled();
        expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-COOKIE-VALUE");
      } finally {
        warn.mockRestore();
      }
    });
  });

  describe.each([
    {file: "orgs/[orgId]", load: loadSettings, route: "/orgs/[orgId]" as const},
    {file: "orgs/[orgId]/members", load: loadMembers, route: "/orgs/[orgId]/members" as const},
  ])("$file", ({load, route}) => {
    const expectedRequests = (orgId: string) =>
      orgsSsrRequests(route, {isOperator: true, orgId}).filter(
        (request) => request.url !== "/orgs/mine"
      );

    it("fetches the org-scoped read with X-Organization-Id and seeds it under the header key", async () => {
      const result = await runLoader(load, {params: {orgId: "o1"}});
      const [request] = expectedRequests("o1");
      expect(request.headers).toEqual({"X-Organization-Id": "o1"});
      expect(seenPaths()).toEqual([request.url]);
      const entry = seen.find((candidate) => candidate.path === request.url);
      expect(entry?.headers["x-organization-id"]).toBe("o1");
      expect(entry?.headers.cookie).toBe("session=1");
      expect(result.rpc[adminRpcSeedKey(request.url, request.headers)]).toEqual({
        path: request.url,
      });
      // The header-less key is a different seed: the hook never asks with it.
      expect(Object.keys(result.rpc)).not.toContain(adminRpcSeedKey(request.url));
    });

    it("fetches for an org admin who is not an operator: the screen reads their own org", async () => {
      await runLoader(load, {params: {orgId: "o1"}, profile: {roles: ["admin"]}});
      expect(seenPaths()).toEqual(expectedRequests("o1").map((request) => request.url));
    });

    // expo-server hands loaders the params still percent-encoded; the hook requests the decoded
    // id as is, so the seed key and the header must be built from the decoded id.
    it("decodes the encoded route param before building the URL and header", async () => {
      const result = await runLoader(load, {params: {orgId: "a%20b"}});
      const [request] = expectedRequests("a b");
      expect(seenPaths()).toEqual([new URL(request.url, "http://x").pathname]);
      expect(
        seen.find((entry) => entry.path.startsWith("/orgs/a"))?.headers["x-organization-id"]
      ).toBe("a b");
      expect(Object.keys(result.rpc)).toContain(adminRpcSeedKey(request.url, request.headers));
    });

    it("fetches nothing for a missing orgId or a malformed escape", async () => {
      expect(await runLoader(load, {params: {}})).toEqual({rpc: {}});
      expect(await runLoader(load, {params: {orgId: "%E0%A4%A"}})).toEqual({rpc: {}});
      expect(seenPaths()).toEqual([]);
    });

    it("fetches nothing for an anonymous request", async () => {
      expect(await runLoader(load, {cookie: "", params: {orgId: "o1"}})).toEqual({rpc: {}});
      expect(seen).toEqual([]);
    });

    it.each([401, 403, 404, 500])("seeds nothing on a %p (the client loads it)", async (status) => {
      respond = () => new Response("{}", {status});
      expect((await runLoader(load, {params: {orgId: "o1"}})).rpc).toEqual({});
    });
  });
});
