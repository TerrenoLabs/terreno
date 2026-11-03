/**
 * Isolated: `mock.module` for the Expo screens would leak into the shared suite. Proves the
 * `[model]` route's server `loader` seeds the default list read through `loadSsrPayload`.
 */
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {adminRpcSeedKey} from "@terreno/admin-frontend";
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

const USER_LIST_URL = "/admin/users?limit=20&page=1&sort=-created";

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
    {
      adminBroadcast: true,
      defaultSort: "-created",
      displayName: "Todos",
      fields: {_id: {required: true, type: "string"}, title: {required: false, type: "string"}},
      listFields: ["title"],
      name: "Todo",
      routePath: "/admin/todos",
      syncCollection: "todos",
    },
    {
      displayName: "Sized",
      fields: {_id: {required: true, type: "string"}},
      listFields: ["_id"],
      name: "Sized",
      pageSize: 50,
      routePath: "/admin/sized",
    },
    {
      displayName: "Unrouted",
      fields: {_id: {required: true, type: "string"}},
      listFields: ["_id"],
      name: "Unrouted",
      routePath: "",
    },
  ],
  scripts: [],
};

describe("[model] list loader", () => {
  let distDir: string;
  let seen: {headers: Record<string, string>; path: string}[];
  let stub: ReturnType<typeof Bun.serve>;

  beforeAll(() => {
    distDir = writeStubSsrBuild();
  });

  afterAll(() => {
    removeStubSsrBuild(distDir);
  });

  beforeEach(() => {
    seen = [];
    stub = Bun.serve({
      fetch: (req) => {
        const url = new URL(req.url);
        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });
        seen.push({headers, path: `${url.pathname}${url.search}`});
        return new Response(JSON.stringify({data: [{_id: "u1", email: "ada@example.com"}]}), {
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
    model: string,
    scope: Partial<AdminSpaRequestScope> = {adminConfig}
  ): Promise<{rpc: Record<string, unknown>}> => {
    const {loader} = await import("../../app/[model]/index");
    const request = new Request(`http://public.example/console/${model}`, {
      headers: {Cookie: "session=1"},
    });
    return runInAdminSpaRequest(
      {appConfig: {} as AdminSpaRequestScope["appConfig"], basePath: "/console", ...scope},
      () => loader(request, {model}) as Promise<{rpc: Record<string, unknown>}>
    );
  };

  it("fetches the default list URL and returns the body keyed by the seed key", async () => {
    const result = await runLoader("User");
    expect(seen.map((entry) => entry.path)).toEqual([USER_LIST_URL]);
    expect(Object.keys(result.rpc)).toEqual([adminRpcSeedKey(USER_LIST_URL)]);
    expect(result.rpc[adminRpcSeedKey(USER_LIST_URL)]).toEqual({
      data: [{_id: "u1", email: "ada@example.com"}],
    });
  });

  it("returns {rpc: {}} and fetches nothing for an unknown model name", async () => {
    const result = await runLoader("Nope");
    expect(result).toEqual({rpc: {}});
    expect(seen).toEqual([]);
  });

  it("returns {rpc: {}} and fetches nothing when the scope has no admin config", async () => {
    const result = await runLoader("User", {adminConfig: null});
    expect(result).toEqual({rpc: {}});
    expect(seen).toEqual([]);
  });

  it("sends no X-Organization-Id for an unscoped model list", async () => {
    await runLoader("User");
    expect(seen[0]?.headers["x-organization-id"]).toBeUndefined();
  });
});
