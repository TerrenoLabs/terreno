/**
 * Isolated: `mock.module("expo-router")` would leak into the shared suite. Binding checks for the
 * jobs and comms loaders (T10): the real screens, with their real `useAdminRpcQuery` hooks, are
 * rendered inside `AdminProvider` with a recording fetch.
 * - Unseeded, a screen requests exactly the URLs `jobsSsrUrls` / `commsSsrUrls` return.
 * - Seeded with a body for each of those URLs, it requests nothing on the first render.
 * - The comms list and stats URLs carry a default date range taken from the clock. The seed is
 *   built at the server's render time and the screen renders moments later (the hydrating
 *   client), so the seeded screen must stay silent when the clock has moved 30 seconds on.
 */
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {
  AdminProvider,
  AdminRpcSeed,
  adminRpcSeedKey,
  CommsDashboardScreenWidget,
  CommsMessageDetail,
  JobsDashboardScreenWidget,
  JobsJobDetail,
} from "@terreno/admin-frontend";
import {act} from "@testing-library/react-native";
import {DateTime, Settings} from "luxon";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {commsSsrUrls, jobsSsrUrls} from "../../server/jobsCommsRoutes";

mock.module("expo-router", () => ({
  router: {back: mock(() => {}), push: mock(() => {}), replace: mock(() => {})},
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({setOptions: mock((_: unknown) => {})}),
  useRouter: () => ({back: mock(() => {}), push: mock(() => {}), replace: mock(() => {})}),
}));

/** Luxon reads its own clock; the test preload pins `Date.now`, so pin `Settings.now`. */
const setClock = (iso: string): void => {
  const millis = DateTime.fromISO(iso, {zone: "utc"}).toMillis();
  Settings.now = () => millis;
};

const NOW = "2026-11-03T12:00:00.000Z";
const originalFetch = globalThis.fetch;

const MESSAGE = {
  _id: "m1",
  attemptCount: 1,
  channel: "mail",
  created: NOW,
  provider: "sendgrid",
  status: "sent",
  subject: "Welcome",
  to: "a***@example.com",
};
const JOB = {_id: "j1", name: "example/log-message", status: "failed"};

/** Stub bodies by URL path; anything else answers `{}`. */
const bodyFor = (path: string): unknown => {
  if (path === "/jobs/stats") {
    return {byStatus: {dead: 1, failed: 2, pending: 3, running: 4}};
  }
  if (path === "/jobs/schedules") {
    return [];
  }
  if (path === "/jobs/j1") {
    return {data: JOB};
  }
  if (path.startsWith("/jobs?")) {
    return {data: [JOB], limit: 20, more: false, page: 1, total: 1};
  }
  if (path === "/comms/messages/m1") {
    return {data: MESSAGE};
  }
  if (path.startsWith("/comms/messages?")) {
    return {data: [MESSAGE], limit: 20, more: false, page: 1, total: 1};
  }
  if (path.startsWith("/comms/stats?")) {
    return {buckets: [], byProvider: [], totals: {sent: 5}};
  }
  return {};
};

const stubFetch = (urls: string[]): void => {
  globalThis.fetch = (async (url: string) => {
    const path = String(url);
    urls.push(path);
    return new Response(JSON.stringify(bodyFor(path)), {
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
  Object.fromEntries(urls.map((url) => [adminRpcSeedKey(url), bodyFor(url)]));

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

const emptyConfig = {customScreens: [], models: [], scripts: []};

interface RouteCase {
  name: string;
  screen: () => React.ReactElement;
  urls: () => string[];
}

const ROUTES: RouteCase[] = [
  {
    name: "jobs dashboard",
    screen: () => <JobsDashboardScreenWidget config={emptyConfig} routeBase="" screenName="jobs" />,
    urls: () => jobsSsrUrls("/jobs", {}),
  },
  {
    name: "job detail",
    screen: () => <JobsJobDetail jobId="j1" routeBase="" />,
    urls: () => jobsSsrUrls("/jobs/[id]", {id: "j1"}),
  },
  {
    name: "comms list",
    screen: () => (
      <CommsDashboardScreenWidget config={emptyConfig} routeBase="" screenName="comms" />
    ),
    urls: () => commsSsrUrls("/comms", {}),
  },
  {
    name: "comms detail",
    screen: () => <CommsMessageDetail messageId="m1" routeBase="" />,
    urls: () => commsSsrUrls("/comms/[id]", {id: "m1"}),
  },
];

describe("jobs and comms route seeds", () => {
  beforeEach(() => {
    setClock(NOW);
  });

  afterEach(() => {
    Settings.now = () => Date.now();
    globalThis.fetch = originalFetch;
  });

  describe.each(ROUTES)("$name", ({screen, urls}) => {
    it("requests exactly the route's URLs when unseeded", async () => {
      const expected = urls();
      expect(expected.length).toBeGreaterThan(0);
      const requested: string[] = [];
      stubFetch(requested);
      renderScreen(screen());
      await flush();
      expect(sorted(requested)).toEqual(sorted(expected));
    });

    it("makes no rpc call on the first render when seeded from those URLs", async () => {
      const requested: string[] = [];
      stubFetch(requested);
      renderScreen(screen(), seedFor(urls()));
      await flush();
      expect(requested).toEqual([]);
    });
  });

  it("the seeded comms list stays silent when the clock moved on since the loader ran", async () => {
    const seed = seedFor(commsSsrUrls("/comms", {}));
    setClock("2026-11-03T12:00:30.000Z");
    const requested: string[] = [];
    stubFetch(requested);
    renderScreen(
      <CommsDashboardScreenWidget config={emptyConfig} routeBase="" screenName="comms" />,
      seed
    );
    await flush();
    expect(requested).toEqual([]);
  });

  it("the seeded jobs dashboard renders its stats and rows on the first render", () => {
    stubFetch([]);
    const view = renderScreen(
      <JobsDashboardScreenWidget config={emptyConfig} routeBase="" screenName="jobs" />,
      seedFor(jobsSsrUrls("/jobs", {}))
    );
    // No await: the dashboard comes from the seed, not from a fetch.
    expect(view.queryByTestId("jobs-stats-loading")).toBeNull();
    expect(view.queryByTestId("jobs-dashboard-loading")).toBeNull();
    expect(view.getByTestId("jobs-dashboard-table")).toBeTruthy();
  });

  it("the seeded comms detail renders the message on the first render", () => {
    stubFetch([]);
    const view = renderScreen(
      <CommsMessageDetail messageId="m1" routeBase="" />,
      seedFor(commsSsrUrls("/comms/[id]", {id: "m1"}))
    );
    expect(view.queryByTestId("comms-detail-loading")).toBeNull();
    expect(view.getAllByTestId("comms-detail-to")[0]).toBeTruthy();
  });
});
