/**
 * Isolated: `mock.module` for the Expo screens would leak into the shared suite. Proves the
 * `[model]/[id]` route's server `loader` seeds the record read through `loadSsrPayload`, reports
 * a backend 404 as `notFound` (the page still answers 200), and never treats `create` as an id (create.tsx, a static sibling, has no loader).
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
import type {ImmutableRequest} from "expo-server";
import express from "express";
import {AdminSpaServeApp} from "../serve";
import {type AdminSpaRequestScope, runInAdminSpaRequest} from "../serverContext";
import {removeStubSsrBuild, writeStubSsrBuild} from "../testing/ssrStubBuild";

// The route file pulls in the Expo screens; the loader under test never touches them.
mock.module("expo-router", () => ({
  useLoaderData: () => undefined,
  useLocalSearchParams: () => ({}),
}));
mock.module("../../components/AdminSpaShell", () => ({AdminSpaShell: () => null}));
mock.module("../../components/AppConfigGate", () => ({useAppConfig: () => ({appConfig: {}})}));

const USER = {_id: "u1", email: "ada@example.com"};

const adminConfig = {
  customScreens: [],
  models: [
    {
      defaultSort: "-created",
      displayName: "User",
      fields: {_id: {required: true, type: "string"}, email: {required: false, type: "string"}},
      listFields: ["email"],
      name: "User",
      routePath: "/admin/users",
    },
  ],
  scripts: [],
};

interface DetailLoaderData {
  notFound?: boolean;
  rpc: Record<string, unknown>;
}

describe("[model]/[id] detail loader", () => {
  let distDir: string;
  let seen: {headers: Record<string, string>; path: string}[];
  let respond: (path: string) => Response;
  let stub: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    distDir = writeStubSsrBuild();
  });

  afterAll(() => {
    removeStubSsrBuild(distDir);
  });

  beforeEach(() => {
    seen = [];
    respond = () =>
      new Response(JSON.stringify({data: USER}), {headers: {"content-type": "application/json"}});
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
    new AdminSpaServeApp({
      distDir,
      internalOrigin: `http://127.0.0.1:${stub.port}`,
    }).register(express());
  });

  afterEach(() => {
    stub.stop(true);
  });

  const runLoader = async (
    model: string,
    id: string,
    scope: Partial<AdminSpaRequestScope> = {adminConfig},
    cookie = "session=1"
  ): Promise<DetailLoaderData> => {
    const {loader} = await import("../../app/[model]/[id]");
    const request = new Request(`http://public.example/console/${model}/${id}`, {
      headers: {Cookie: cookie},
    });
    return runInAdminSpaRequest(
      {appConfig: {} as AdminSpaRequestScope["appConfig"], basePath: "/console", ...scope},
      async () =>
        (await loader(request as unknown as ImmutableRequest, {id, model})) as DetailLoaderData
    );
  };

  it("fetches the record's read URL and returns the body keyed by the seed key", async () => {
    const result = await runLoader("User", "u1");
    expect(seen.map((entry) => entry.path)).toEqual(["/admin/users/u1"]);
    expect(Object.keys(result.rpc)).toEqual([adminRpcSeedKey("/admin/users/u1")]);
    expect(result.rpc[adminRpcSeedKey("/admin/users/u1")]).toEqual({data: USER});
    expect(result.notFound).toBeFalsy();
  });

  it("forwards the visitor's session cookie to the backend", async () => {
    await runLoader("User", "u1");
    expect(seen[0]?.headers.cookie).toBe("session=1");
  });

  // expo-server hands loaders the params still percent-encoded (it never decodeURIComponents the
  // pathname), so every id below is what the router really delivers.
  it("keeps an encoded id that tries to leave the model route encoded once", async () => {
    const result = await runLoader("User", "..%2Fconfig");
    expect(seen.map((entry) => entry.path)).toEqual(["/admin/users/..%2Fconfig"]);
    expect(Object.keys(result.rpc)).toEqual([adminRpcSeedKey("/admin/users/..%2Fconfig")]);
  });

  it("does not double-encode an id with an encoded space", async () => {
    const result = await runLoader("User", "a%20b");
    expect(seen.map((entry) => entry.path)).toEqual(["/admin/users/a%20b"]);
    expect(Object.keys(result.rpc)).toEqual([adminRpcSeedKey("/admin/users/a%20b")]);
    expect(result.notFound).toBeFalsy();
  });

  it("does not double-encode an id with encoded unicode", async () => {
    await runLoader("User", "%E2%9C%93");
    expect(seen.map((entry) => entry.path)).toEqual(["/admin/users/%E2%9C%93"]);
  });

  it("does not throw on a malformed percent sequence and never double-encodes it", async () => {
    let result: DetailLoaderData | undefined;
    let thrown: unknown;
    try {
      result = await runLoader("User", "%E0%A4%A");
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeUndefined();
    expect(result).toBeDefined();
    expect(seen.some((entry) => entry.path.includes("%25E0"))).toBe(false);
  });

  it("treats an encoded 'create' as the create route and fetches nothing", async () => {
    const result = await runLoader("User", "cre%61te");
    expect(result).toEqual({rpc: {}});
    expect(seen).toEqual([]);
  });

  it("returns {rpc: {}, notFound: true} when the backend answers 404", async () => {
    respond = () => new Response(JSON.stringify({title: "Not found"}), {status: 404});
    const result = await runLoader("User", "missing");
    expect(result).toEqual({notFound: true, rpc: {}});
  });

  it.each([401, 403, 500])(
    "returns {rpc: {}} without notFound when the backend answers %p",
    async (status) => {
      respond = () => new Response("{}", {status});
      const result = await runLoader("User", "u1");
      expect(result).toEqual({rpc: {}});
    }
  );

  it("returns {rpc: {}} and fetches nothing for an unknown model name", async () => {
    const result = await runLoader("Nope", "u1");
    expect(result).toEqual({rpc: {}});
    expect(seen).toEqual([]);
  });

  it("returns {rpc: {}} and fetches nothing when the scope has no admin config", async () => {
    const result = await runLoader("User", "u1", {adminConfig: null});
    expect(result).toEqual({rpc: {}});
    expect(seen).toEqual([]);
  });

  it("does not treat the create route's segment as a record id", async () => {
    const result = await runLoader("User", "create");
    expect(result).toEqual({rpc: {}});
    expect(seen).toEqual([]);
  });

  describe("when the SSR fetch cannot be served", () => {
    const SECRET = "session=SECRET-COOKIE-VALUE";
    let warn: ReturnType<typeof spyOn>;

    beforeEach(() => {
      warn = spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warn.mockRestore();
    });

    it("returns {rpc: {}} and warns without the cookie when ssrApiPrefixes omits the admin base", async () => {
      new AdminSpaServeApp({
        distDir,
        internalOrigin: `http://127.0.0.1:${stub.port}`,
        ssrApiPrefixes: ["/auth/me"],
      }).register(express());
      const result = await runLoader("User", "u1", {adminConfig}, SECRET);
      expect(result).toEqual({rpc: {}});
      expect(result.notFound).toBeFalsy();
      expect(seen).toEqual([]);
      expect(warn).toHaveBeenCalled();
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).toMatch(/users|User|\[model\]/);
      expect(logged).not.toContain("SECRET-COOKIE-VALUE");
    });

    it("returns {rpc: {}} without throwing when the internal fetch fails", async () => {
      const deadPort = stub.port;
      stub.stop(true);
      new AdminSpaServeApp({
        distDir,
        internalOrigin: `http://127.0.0.1:${deadPort}`,
      }).register(express());
      const result = await runLoader("User", "u1", {adminConfig}, SECRET);
      expect(result).toEqual({rpc: {}});
      expect(result.notFound).toBeFalsy();
      expect(JSON.stringify(warn.mock.calls)).not.toContain("SECRET-COOKIE-VALUE");
    });
  });
});
