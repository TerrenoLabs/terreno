/**
 * Isolated: `@test-env ADMIN_USE_REAL_API=1` so the real
 * `useAdminModelApi` and `useAdminRpcQuery` run under `AdminModelTable`. Proves a table under an
 * `AdminRpcSeed` renders its rows on the first render and asks for no list, and pins the URL the
 * table requests for default params, which the admin SPA's server loader must build identically
 * (`resolveModelListUrl` in admin-spa/server/modelRoutes.ts asserts the same literal).
 */
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, describe, expect, it, mock} from "bun:test";
import {act} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
  useNavigation: () => ({setOptions: mock((_: unknown) => {})}),
}));

const userConfig: AdminConfigResponse = {
  customScreens: [],
  models: [
    {
      defaultSort: "-created",
      displayName: "User",
      fields: {
        _id: {required: true, type: "string"},
        created: {required: false, type: "date"},
        email: {required: false, type: "string"},
      },
      listFields: ["email"],
      name: "User",
      routePath: "/admin/users",
    },
  ],
  scripts: [],
};

mock.module("../useAdminConfig", () => ({
  useAdminConfig: () => ({config: userConfig, error: null, isLoading: false}),
}));

import {AdminModelTable} from "../AdminModelTable";
import {AdminProvider} from "../AdminProvider";
import {AdminRpcSeed, adminRpcSeedKey} from "../adminRpcSeed";

/** The URL the table requests for default params: page 1, default limit, `defaultSort`. */
const DEFAULT_USER_LIST_URL = "/admin/users?limit=20&page=1&sort=-created";

const originalFetch = globalThis.fetch;

const listEnvelope = {
  data: [
    {_id: "u1", email: "ada@example.com"},
    {_id: "u2", email: "grace@example.com"},
  ],
  limit: 20,
  more: false,
  page: 1,
  total: 2,
};

const stubFetch = (urls: string[]): void => {
  globalThis.fetch = (async (url: string) => {
    urls.push(String(url));
    return new Response(JSON.stringify(listEnvelope), {
      headers: {"Content-Type": "application/json"},
      status: 200,
    });
  }) as typeof fetch;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderTable = (seed?: Record<string, unknown>): ReturnType<typeof renderWithTheme> => {
  const table = (
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="">
      <AdminModelTable apiBase="/admin" modelName="User" routeBase="" />
    </AdminProvider>
  );
  return renderWithTheme(seed ? <AdminRpcSeed data={seed}>{table}</AdminRpcSeed> : table);
};

describe("AdminModelTable server seed", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("requests the default list URL when unseeded", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    renderTable();
    await flush();
    expect(urls).toEqual([DEFAULT_USER_LIST_URL]);
  });

  it("renders seeded rows on the first render and requests no list", async () => {
    const urls: string[] = [];
    stubFetch(urls);
    const view = renderTable({[adminRpcSeedKey(DEFAULT_USER_LIST_URL)]: listEnvelope});
    // No await before this assertion: the rows come from the seed, not from a fetch.
    expect(view.getAllByText("ada@example.com").length).toBeGreaterThan(0);
    expect(view.getAllByText("grace@example.com").length).toBeGreaterThan(0);
    await flush();
    expect(urls).toEqual([]);
  });
});
