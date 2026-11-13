/**
 * Isolated: runs with `ADMIN_USE_REAL_API=1` (see ../scripts/ci/testShards/lib.ts) so the real
 * `useAdminRpcQuery` hooks run under each screen. Binding checks for the admin SPA's jobs and
 * comms loaders (T10): each screen is rendered inside `AdminProvider` with a recording fetch.
 * - Unseeded, the screen requests exactly the URLs below (this pins the literals to the hooks).
 * - Seeded with a body for each of those URLs, it renders and requests nothing.
 * The literals are the ones admin-spa/src/server/jobsCommsRoutes.test.ts asserts `jobsSsrUrls` /
 * `commsSsrUrls` return, so loader and hook cannot drift apart. None is under the admin base.
 * - jobs: `useJobsDashboardApi.tsx` list/stats/schedules/detail over `JobsDashboardScreen`'s
 *   `listParams` (`limit` 20, `page` 1); the detail hook does not encode the id.
 * - comms: `useCommsDashboardApi.tsx` list/stats/detail over `CommsDashboardScreen`'s params and
 *   `withDefaultCommsDashboardDates` (end = the next whole minute, UTC; start = end - 7 days).
 */
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act} from "@testing-library/react-native";
import {DateTime, Settings} from "luxon";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../AdminProvider";
import {AdminRpcSeed, adminRpcSeedKey} from "../adminRpcSeed";
import {CommsDashboardScreenWidget} from "../comms/CommsDashboardScreenWidget";
import {CommsMessageDetail} from "../comms/CommsMessageDetail";
import {JobsDashboardScreenWidget} from "../jobs/JobsDashboardScreenWidget";
import {JobsJobDetail} from "../jobs/JobsJobDetail";

mock.module("expo-router", () => ({
  router: {back: mock(() => {}), push: mock(() => {}), replace: mock(() => {})},
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({setOptions: mock((_: unknown) => {})}),
  useRouter: () => ({back: mock(() => {}), push: mock(() => {}), replace: mock(() => {})}),
}));

const NOW = "2026-11-03T12:00:00.000Z";
// The default range ends at the next whole minute after NOW and starts seven days before it.
const COMMS_LIST = `/comms/messages?endDate=2026-11-03T12%3A01%3A00.000Z&limit=20&page=1&startDate=2026-10-27T12%3A01%3A00.000Z`;
const COMMS_STATS = `/comms/stats?endDate=2026-11-03T12%3A01%3A00.000Z&startDate=2026-10-27T12%3A01%3A00.000Z`;

const originalFetch = globalThis.fetch;

const BODIES: Record<string, unknown> = {
  [COMMS_LIST]: {data: [], limit: 20, more: false, page: 1, total: 0},
  [COMMS_STATS]: {buckets: [], byProvider: [], totals: {sent: 0}},
  "/comms/messages/m1": {
    data: {_id: "m1", channel: "mail", provider: "sendgrid", status: "sent", to: "a***@x.com"},
  },
  "/jobs?limit=20&page=1": {data: [], limit: 20, more: false, page: 1, total: 0},
  "/jobs/j1": {data: {_id: "j1", name: "example/log-message", status: "failed"}},
  "/jobs/schedules": [],
  "/jobs/stats": {byStatus: {dead: 1, running: 2}},
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
const emptyConfig = {customScreens: [], models: [], scripts: []};

const ROUTES: {name: string; screen: () => React.ReactElement; urls: string[]}[] = [
  {
    name: "jobs dashboard",
    screen: () => <JobsDashboardScreenWidget config={emptyConfig} routeBase="" screenName="jobs" />,
    urls: ["/jobs?limit=20&page=1", "/jobs/stats", "/jobs/schedules"],
  },
  {
    name: "job detail",
    screen: () => <JobsJobDetail jobId="j1" routeBase="" />,
    urls: ["/jobs/j1"],
  },
  {
    name: "comms list",
    screen: () => (
      <CommsDashboardScreenWidget config={emptyConfig} routeBase="" screenName="comms" />
    ),
    urls: [COMMS_LIST, COMMS_STATS],
  },
  {
    name: "comms detail",
    screen: () => <CommsMessageDetail messageId="m1" routeBase="" />,
    urls: ["/comms/messages/m1"],
  },
];

describe("jobs and comms route seeds", () => {
  beforeEach(() => {
    const millis = DateTime.fromISO(NOW, {zone: "utc"}).toMillis();
    Settings.now = () => millis;
  });

  afterEach(() => {
    Settings.now = () => Date.now();
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
});
