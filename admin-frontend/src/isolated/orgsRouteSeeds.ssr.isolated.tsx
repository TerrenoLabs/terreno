/**
 * Isolated: runs with `ADMIN_USE_REAL_API=1` (see ../scripts/ci/testShards/lib.ts) so the real
 * `useAdminRpcQuery` hooks run under each screen. Binding checks for the admin SPA's orgs
 * loaders (T11): each screen is rendered inside `AdminProvider` with a recording fetch.
 * - Unseeded, the screen requests exactly the requests below (this pins the literals to the hooks).
 * - Seeded with a body for each of those requests (keyed by `adminRpcSeedKey(url, headers)`), it
 *   renders its data and requests nothing.
 * - A seed fetched without the `X-Organization-Id` the hook sends does not satisfy it.
 * - `OrgDirectoryScreen` with `isOperator` false renders nothing and requests nothing.
 * The literals are the ones admin-spa/src/server/orgsRoutes.test.ts asserts `orgsSsrRequests`
 * returns, so loader and hook cannot drift apart.
 * - directory: `useOrganizationsApi.useListQuery`: `/orgs`, no header, skipped unless operator.
 * - settings: `useReadQuery`: `/orgs/o1` + `X-Organization-Id: o1`.
 * - members: `useMembersQuery`: `/orgs/o1/members` + `X-Organization-Id: o1`. The member security
 *   read (`useMemberSecurityApi`) mounts only with `MemberSecurityPanel`, after a click.
 */
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, describe, expect, it, mock} from "bun:test";
import {act} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

mock.module("expo-router", () => ({
  router: {back: mock(() => {}), push: mock(() => {}), replace: mock(() => {})},
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({setOptions: mock((_: unknown) => {})}),
  useRouter: () => ({back: mock(() => {}), push: mock(() => {}), replace: mock(() => {})}),
}));

import {AdminProvider} from "../AdminProvider";
import {AdminRpcSeed, adminRpcSeedKey} from "../adminRpcSeed";
import {OrgDirectoryScreen} from "../orgs/OrgDirectoryScreen";
import {OrgMembersScreen} from "../orgs/OrgMembersScreen";
import {OrgSettingsScreen} from "../orgs/OrgSettingsScreen";

const originalFetch = globalThis.fetch;

interface RouteRequest {
  headers?: Record<string, string>;
  url: string;
}

const ORG_HEADERS = {"X-Organization-Id": "o1"};

const BODIES: Record<string, unknown> = {
  "/orgs": {
    data: [{_id: "o1", name: "Seeded Org", slug: "seeded-org"}],
    limit: 100,
    more: false,
    page: 1,
    total: 1,
  },
  "/orgs/o1": {data: {_id: "o1", name: "Seeded Org", slug: "seeded-org"}},
  "/orgs/o1/members": {
    data: [
      {
        _id: "m1",
        roleName: "member",
        status: "active",
        userId: {_id: "u1", email: "seeded.member@example.com", name: "Seeded Member"},
      },
    ],
    limit: 100,
    more: false,
    page: 1,
    total: 1,
  },
};

/** Records `url` plus the `X-Organization-Id` header of each call, as `RouteRequest`s. */
const stubFetch = (calls: RouteRequest[]): void => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const path = String(url);
    const org = new Headers(init?.headers).get("x-organization-id");
    calls.push(org ? {headers: {"X-Organization-Id": org}, url: path} : {url: path});
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

const seedFor = (requests: RouteRequest[]): Record<string, unknown> =>
  Object.fromEntries(
    requests.map((request) => [adminRpcSeedKey(request.url, request.headers), BODIES[request.url]])
  );

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

const keyOf = (request: RouteRequest): string => adminRpcSeedKey(request.url, request.headers);
const sortedKeys = (requests: RouteRequest[]): string[] => [...new Set(requests.map(keyOf))].sort();

interface RouteCase {
  name: string;
  /** What the screen requests on mount, as `orgsSsrRequests(route, ...)` must return it. */
  requests: RouteRequest[];
  screen: () => React.ReactElement;
  /** TestID of the loaded data, present on the first render when seeded. */
  loadedTestID: string;
}

const ROUTES: RouteCase[] = [
  {
    loadedTestID: "org-directory-table",
    name: "org directory (operator)",
    requests: [{url: "/orgs"}],
    screen: () => <OrgDirectoryScreen isOperator onEnterOrganization={() => {}} routeBase="" />,
  },
  {
    loadedTestID: "org-settings-name",
    name: "org settings",
    requests: [{headers: ORG_HEADERS, url: "/orgs/o1"}],
    screen: () => <OrgSettingsScreen organizationId="o1" routeBase="" />,
  },
  {
    loadedTestID: "org-members-table",
    name: "org members",
    requests: [{headers: ORG_HEADERS, url: "/orgs/o1/members"}],
    screen: () => <OrgMembersScreen organizationId="o1" routeBase="" />,
  },
];

describe("orgs route seeds", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe.each(ROUTES)("$name", ({loadedTestID, requests, screen}) => {
    it("requests exactly the route's requests when unseeded, with the organization header", async () => {
      const calls: RouteRequest[] = [];
      stubFetch(calls);
      renderScreen(screen());
      await flush();
      expect(sortedKeys(calls)).toEqual(sortedKeys(requests));
      expect(calls.map((call) => call.headers)).toEqual(requests.map((request) => request.headers));
    });

    it("renders its data and makes no rpc call on the first render when seeded", async () => {
      const calls: RouteRequest[] = [];
      stubFetch(calls);
      const view = renderScreen(screen(), seedFor(requests));
      // Before any effect or promise runs: the data is already there.
      expect(view.queryByTestId(loadedTestID)).toBeTruthy();
      await flush();
      expect(calls).toEqual([]);
    });
  });

  it("seeds without the X-Organization-Id header do not satisfy the org-scoped reads", async () => {
    for (const route of ROUTES.filter((candidate) => candidate.requests[0].headers)) {
      const calls: RouteRequest[] = [];
      stubFetch(calls);
      const headerless = route.requests.map((request) => ({url: request.url}));
      renderScreen(route.screen(), seedFor(headerless));
      await flush();
      expect(sortedKeys(calls)).toEqual(sortedKeys(route.requests));
    }
  });

  describe("org directory for a non-operator (the existing forbidden behavior)", () => {
    it("renders nothing and requests nothing", async () => {
      const calls: RouteRequest[] = [];
      stubFetch(calls);
      const view = renderScreen(
        <OrgDirectoryScreen isOperator={false} onEnterOrganization={() => {}} routeBase="" />
      );
      await flush();
      expect(calls).toEqual([]);
      expect(view.queryByTestId("org-directory-table")).toBeNull();
      expect(view.queryByTestId("org-directory-create")).toBeNull();
      expect(view.queryByTestId("org-directory-loading")).toBeNull();
      expect(view.queryByTestId("org-directory-error")).toBeNull();
    });

    it("does not render a seeded directory either", async () => {
      const calls: RouteRequest[] = [];
      stubFetch(calls);
      const view = renderScreen(
        <OrgDirectoryScreen isOperator={false} onEnterOrganization={() => {}} routeBase="" />,
        seedFor([{url: "/orgs"}])
      );
      await flush();
      expect(calls).toEqual([]);
      expect(view.queryByTestId("org-directory-table")).toBeNull();
    });
  });
});
