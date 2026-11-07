/**
 * Isolated: runs with `ADMIN_USE_REAL_API=1` (see scripts/run-tests.sh) so the real
 * `useAdminRpcQuery` hooks run under each screen. Binding checks for the admin SPA's server
 * loaders (T9): each screen is rendered inside `AdminProvider` with a recording fetch.
 * - Unseeded, the screen requests exactly the URLs below (this pins the literals to the hooks).
 * - Seeded with a body for each of those URLs, it renders on the first render and requests
 *   nothing.
 * The literals are the ones admin-spa/src/server/rpcRoutes.test.ts asserts `rpcUrlsForRoute`
 * returns, so loader and hook cannot drift apart. Home derives its URLs with `homeWidgetUrls`.
 */
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, describe, expect, it, mock} from "bun:test";
import {act} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";

mock.module("expo-router", () => ({
  router: {back: mock(() => {}), push: mock(() => {})},
  useNavigation: () => ({setOptions: mock((_: unknown) => {})}),
  useRouter: () => ({back: mock(() => {}), push: mock(() => {})}),
}));

const exampleConfig: AdminConfigResponse = {
  customScreens: [],
  home: {
    slots: {
      contentTop: [],
      main: ["modelStats"],
      navGlobal: ["scriptRunner", "feature-flags-overrides"],
      sidebar: ["versionConfig", "jobs", "recentActivity"],
    },
    title: "Example administration",
  },
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
      defaultSort: "-created",
      displayName: "Audit log",
      fields: {_id: {required: true, type: "string"}},
      listFields: ["_id"],
      name: "AdminAuditLog",
      routePath: "/admin/audit-logs",
    },
  ],
  scripts: [],
};

mock.module("../useAdminConfig", () => ({
  useAdminConfig: () => ({config: exampleConfig, error: null, isLoading: false}),
}));

import {AdminHome} from "../AdminHome";
import {AdminProvider} from "../AdminProvider";
import {AdminRolesList} from "../AdminRolesList";
import {AdminScriptList} from "../AdminScriptList";
import {AdminVersionConfig} from "../AdminVersionConfig";
import {AdminRpcSeed, adminRpcSeedKey} from "../adminRpcSeed";
import {ConfigurationScreen} from "../ConfigurationScreen";

const originalFetch = globalThis.fetch;

/** Stub response bodies by request path (query included); anything else answers `{}`. */
const BODIES: Record<string, unknown> = {
  "/admin/audit-logs?limit=1&page=1": {data: [], limit: 1, more: false, page: 1, total: 3},
  "/admin/audit-logs?limit=8&page=1&sort=-created": {
    data: [],
    limit: 8,
    more: false,
    page: 1,
    total: 0,
  },
  "/admin/scripts/runs?page=1&limit=25": {data: [], limit: 25, more: false, page: 1, total: 0},
  "/admin/users?limit=1&page=1": {data: [{_id: "u1"}], limit: 1, more: false, page: 1, total: 7},
  "/admin/version-config": {},
  "/configuration": {general: {appName: "Seeded App"}},
  "/configuration/meta": {
    sections: [
      {
        displayName: "General",
        fields: {appName: {default: "Terreno", required: false, type: "string"}},
        name: "general",
      },
    ],
  },
  "/jobs/stats": {byStatus: {dead: 0, running: 0}},
  "/rbac/roles": {data: []},
  "/rbac/statements": {statements: {}},
};

const stubFetch = (urls: string[]): void => {
  globalThis.fetch = (async (url: string) => {
    const path = String(url);
    urls.push(path);
    return new Response(JSON.stringify(BODIES[path] ?? {}), {
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

const seedFor = (urls: string[]): Record<string, unknown> =>
  Object.fromEntries(urls.map((url) => [adminRpcSeedKey(url), BODIES[url] ?? {}]));

const renderScreen = (
  screen: React.ReactElement,
  seed?: Record<string, unknown>
): ReturnType<typeof renderWithTheme> => {
  const tree = (
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="">
      {screen}
    </AdminProvider>
  );
  return renderWithTheme(seed ? <AdminRpcSeed data={seed}>{tree}</AdminRpcSeed> : tree);
};

const sorted = (urls: string[]): string[] => [...new Set(urls)].sort();

interface RouteCase {
  name: string;
  /** The URLs the screen requests on mount, as `rpcUrlsForRoute(route, ...)` must return them. */
  urls: string[];
  screen: () => React.ReactElement;
}

const ROUTES: RouteCase[] = [
  {
    name: "/configuration",
    screen: () => <ConfigurationScreen title="App Configuration" />,
    urls: ["/configuration/meta", "/configuration"],
  },
  {
    name: "/roles",
    screen: () => <AdminRolesList apiBase="/admin" routeBase="" />,
    urls: ["/rbac/roles", "/rbac/statements"],
  },
  {
    name: "/scripts",
    screen: () => <AdminScriptList apiBase="/admin" isAdmin routeBase="" />,
    urls: ["/admin/scripts/runs?page=1&limit=25"],
  },
  {
    name: "/version-config",
    screen: () => <AdminVersionConfig apiBase="/admin" routeBase="" />,
    urls: ["/admin/version-config"],
  },
];

describe("admin route seeds", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe.each(ROUTES)("$name", ({screen, urls}) => {
    it("requests exactly the route's URLs when unseeded", async () => {
      const requested: string[] = [];
      stubFetch(requested);
      renderScreen(screen());
      await flush();
      expect(sorted(requested)).toEqual(sorted(urls));
    });

    it("makes no rpc call on the first render when seeded from those URLs", async () => {
      const requested: string[] = [];
      stubFetch(requested);
      renderScreen(screen(), seedFor(urls));
      await flush();
      expect(requested).toEqual([]);
    });
  });

  it("/configuration renders the seeded values on the first render", () => {
    stubFetch([]);
    const view = renderScreen(
      <ConfigurationScreen title="App Configuration" />,
      seedFor(["/configuration/meta", "/configuration"])
    );
    // No await: the form comes from the seed, not from a fetch.
    expect(view.getByTestId("config-general-appName").props.value).toBe("Seeded App");
  });

  describe("/configuration with the API's {data: <document>} envelope", () => {
    const ENVELOPED_VALUES = {data: {general: {appName: "Stored Name"}}};
    const ENVELOPED_BODIES: Record<string, unknown> = {
      ...BODIES,
      "/configuration": ENVELOPED_VALUES,
    };

    it("shows the stored value after fetching an enveloped document", async () => {
      globalThis.fetch = (async (url: string) =>
        new Response(JSON.stringify(ENVELOPED_BODIES[String(url)] ?? {}), {
          headers: {"Content-Type": "application/json"},
          status: 200,
        })) as typeof fetch;
      const view = renderScreen(<ConfigurationScreen title="App Configuration" />);
      await flush();
      await flush();
      expect(view.getByTestId("config-general-appName").props.value).toBe("Stored Name");
    });

    it("shows the stored value on the first render from an enveloped seed, with no rpc call", async () => {
      const requested: string[] = [];
      stubFetch(requested);
      const view = renderScreen(
        <ConfigurationScreen title="App Configuration" />,
        Object.fromEntries(
          ["/configuration/meta", "/configuration"].map((url) => [
            adminRpcSeedKey(url),
            ENVELOPED_BODIES[url],
          ])
        )
      );
      // No await: the form comes from the seed, not from a fetch.
      expect(view.getByTestId("config-general-appName").props.value).toBe("Stored Name");
      await flush();
      expect(requested).toEqual([]);
    });
  });

  describe("/ (home, example config slots)", () => {
    const homeUrls = async (): Promise<string[]> => {
      const {homeWidgetUrls} = await import("../widgets/homeWidgetUrls");
      return homeWidgetUrls({adminConfig: exampleConfig, apiBase: "/admin"});
    };
    // The home screen also reads `/admin/config`; the shell seeds it, and the mock above answers it.
    const home = (): React.ReactElement => <AdminHome apiBase="/admin" routeBase="" />;

    it("requests exactly homeWidgetUrls when unseeded", async () => {
      const urls = await homeUrls();
      const requested: string[] = [];
      stubFetch(requested);
      renderScreen(home());
      await flush();
      expect(urls.length).toBeGreaterThan(0);
      expect(sorted(requested)).toEqual(sorted(urls));
    });

    it("makes no rpc call on the first render when seeded from homeWidgetUrls", async () => {
      const urls = await homeUrls();
      const requested: string[] = [];
      stubFetch(requested);
      const view = renderScreen(home(), seedFor(urls));
      // No await: the counts come from the seed, not from a fetch.
      expect(view.getByTestId("admin-home-model-count-User").props.children).toEqual(["7 rows"]);
      await flush();
      expect(requested).toEqual([]);
    });
  });
});
