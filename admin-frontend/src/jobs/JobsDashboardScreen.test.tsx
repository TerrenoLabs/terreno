import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, within} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

const pushMock = mock(() => {});
mock.module("expo-router", () => ({
  router: {push: pushMock, replace: mock(() => {})},
  useLocalSearchParams: () => ({}),
}));

interface FakeResponse {
  body?: unknown;
  pending?: boolean;
  status?: number;
}

interface FakeRequest {
  method: string;
  path: string;
  url: string;
}

interface QueryState {
  data?: unknown;
  error?: unknown;
  isLoading: boolean;
}

interface ListState extends QueryState {
  data?: {
    data: unknown[];
    more: boolean;
    page: number;
    total: number;
  };
}

const listState: ListState = {isLoading: false};
const statsState: QueryState & {data?: {byStatus: Record<string, number>; total: number}} = {
  isLoading: false,
};
const schedulesState: QueryState & {data?: unknown[]} = {isLoading: false};
let pauseImpl = mock((): FakeResponse => ({body: {data: {enabled: false, name: "nightly"}}}));
let resumeImpl = mock((): FakeResponse => ({body: {data: {enabled: true, name: "nightly"}}}));
const requests: FakeRequest[] = [];
const originalFetch = globalThis.fetch;

const serveQuery = (state: QueryState, fallback: unknown): FakeResponse => {
  if (state.isLoading) {
    return {pending: true};
  }
  if (state.error) {
    return {body: {title: "Server error"}, status: 500};
  }
  return {body: state.data ?? fallback};
};

/** Serves the `/jobs` admin routes from the mutable test state above. */
const route = (request: FakeRequest): FakeResponse => {
  if (request.method === "GET" && request.path === "/jobs") {
    return serveQuery(listState, {data: [], more: false, page: 1, total: 0});
  }
  if (request.method === "GET" && request.path === "/jobs/stats") {
    return serveQuery(statsState, {});
  }
  if (request.method === "GET" && request.path === "/jobs/schedules") {
    return serveQuery(schedulesState, []);
  }
  if (request.method === "POST" && request.path.endsWith("/pause")) {
    return pauseImpl();
  }
  if (request.method === "POST" && request.path.endsWith("/resume")) {
    return resumeImpl();
  }
  return {body: {title: "Not found"}, status: 404};
};

const installFetch = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const request: FakeRequest = {
      method: init?.method ?? "GET",
      path: url.split("?")[0] ?? url,
      url,
    };
    requests.push(request);
    const response = route(request);
    if (response.pending) {
      return new Promise<Response>(() => undefined);
    }
    return new Response(JSON.stringify(response.body ?? {}), {
      headers: {"Content-Type": "application/json"},
      status: response.status ?? 200,
    });
  }) as typeof fetch;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

import {AdminProvider} from "../AdminProvider";
import {JobsDashboardScreen, type JobsDashboardScreenProps} from "./JobsDashboardScreen";

const renderScreen = async (
  props: Partial<JobsDashboardScreenProps> = {}
): Promise<ReturnType<typeof renderWithTheme>> => {
  const utils = renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      <JobsDashboardScreen filters={{}} onFiltersChange={() => undefined} {...props} />
    </AdminProvider>
  );
  await flush();
  return utils;
};

const deadRow = {
  _id: "j1",
  attemptCount: 2,
  created: "2026-08-20T00:00:00.000Z",
  lastError: "boom",
  name: "demo-job",
  runAt: "2026-08-20T00:00:00.000Z",
  status: "dead",
};

describe("JobsDashboardScreen", () => {
  beforeEach(() => {
    installFetch();
    requests.length = 0;
    listState.data = undefined;
    listState.error = undefined;
    listState.isLoading = false;
    statsState.data = {
      byStatus: {dead: 3, failed: 0, pending: 5, running: 1},
      total: 9,
    };
    statsState.error = undefined;
    statsState.isLoading = false;
    schedulesState.data = undefined;
    schedulesState.error = undefined;
    schedulesState.isLoading = false;
    pauseImpl = mock((): FakeResponse => ({body: {data: {enabled: false, name: "nightly"}}}));
    resumeImpl = mock((): FakeResponse => ({body: {data: {enabled: true, name: "nightly"}}}));
    pushMock.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders stats loading and error states", async () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    statsState.isLoading = true;
    const loading = await renderScreen();
    expect(loading.getByTestId("jobs-stats-loading")).toBeTruthy();
    expect(loading.queryByTestId("jobs-stat-dead")).toBeNull();
    loading.unmount();

    statsState.isLoading = false;
    statsState.error = {status: 500};
    const errored = await renderScreen();
    expect(errored.getByTestId("jobs-stats-error")).toBeTruthy();
    expect(errored.queryByTestId("jobs-stat-dead")).toBeNull();
  });

  it("renders loading, error, and empty states", async () => {
    listState.isLoading = true;
    const loading = await renderScreen();
    expect(loading.getByTestId("jobs-dashboard-loading")).toBeTruthy();
    loading.unmount();

    listState.isLoading = false;
    listState.error = {status: 500};
    const errored = await renderScreen();
    expect(errored.getByTestId("jobs-dashboard-error")).toBeTruthy();
    errored.unmount();

    listState.error = undefined;
    listState.data = {data: [], more: false, page: 1, total: 0};
    const empty = await renderScreen();
    expect(empty.getByTestId("jobs-dashboard-empty")).toBeTruthy();
  });

  it("requests the list with the active filters", async () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    await renderScreen({filters: {q: "boom", status: "dead"}});
    const list = requests.find((request) => request.path === "/jobs");
    expect(list?.method).toBe("GET");
    expect(list?.url).toContain("status=dead");
    expect(list?.url).toContain("q=boom");
    expect(requests.some((request) => request.path === "/jobs/stats")).toBe(true);
    expect(requests.some((request) => request.path === "/jobs/schedules")).toBe(true);
  });

  it("writes filter changes through onFiltersChange", async () => {
    const onFiltersChange = mock((_next: unknown) => {});
    listState.data = {data: [deadRow], more: false, page: 1, total: 1};
    schedulesState.data = [
      {_id: "sched-1", cron: "0 0 * * *", enabled: true, name: "nightly", timezone: "UTC"},
    ];
    const {getByTestId} = await renderScreen({
      filters: {status: "dead"},
      onFiltersChange,
      routeBase: "/admin",
    });
    fireEvent.changeText(getByTestId("jobs-filter-q"), "timeout");
    assert.equal(onFiltersChange.mock.calls.length, 1);
    const next = (onFiltersChange.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    assert.equal(next.q, "timeout");
    assert.equal(next.status, "dead");
    assert.equal(next.page, 1);
  });

  it("applies schedule, date, and clear filter controls", async () => {
    listState.data = {data: [], more: false, page: 3, total: 0};
    schedulesState.data = [
      {cron: "0 0 * * *", enabled: true, id: "sched-1", name: "nightly", timezone: "UTC"},
    ];
    const onFiltersChange = mock(() => {});
    const {UNSAFE_root, getByTestId} = await renderScreen({
      filters: {
        end: "2026-01-02T00:00:00.000Z",
        page: 3,
        q: "boom",
        scheduleId: "sched-1",
        start: "2026-01-01T00:00:00.000Z",
        status: "dead",
      },
      onFiltersChange,
    });

    const schedulePicker = UNSAFE_root.findAll(
      (node) =>
        Array.isArray(node.props?.items) &&
        node.props.items.some((item: {label?: string}) => item.label === "nightly")
    )[0];
    await act(async () => {
      schedulePicker.props.onValueChange("sched-2");
    });
    const scheduleCall = onFiltersChange.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(scheduleCall.scheduleId).toBe("sched-2");

    await act(async () => {
      fireEvent(getByTestId("jobs-filter-start"), "onChange", "2026-02-01T00:00:00.000Z");
    });
    const startCall = onFiltersChange.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(startCall.start).toBe("2026-02-01T00:00:00.000Z");

    await act(async () => {
      fireEvent.press(getByTestId("jobs-clear-filters"));
    });
    assert.deepEqual(onFiltersChange.mock.calls[2]?.[0], {page: 1});
  });

  it("pages through results without dropping the active filters", async () => {
    listState.data = {data: [deadRow], more: true, page: 1, total: 60};
    const onFiltersChange = mock(() => {});
    const {getByTestId} = await renderScreen({
      filters: {scheduleId: "sched-1", status: "dead"},
      onFiltersChange,
    });
    await act(async () => {
      fireEvent.press(
        within(getByTestId("jobs-dashboard-table.pagination")).getAllByA11yHint(
          "Click to go to page 2"
        )[0]
      );
    });
    expect(onFiltersChange.mock.calls[0]?.[0]).toEqual({
      page: 2,
      scheduleId: "sched-1",
      status: "dead",
    });
  });

  it("navigates to job detail from the row action", async () => {
    listState.data = {data: [deadRow], more: false, page: 1, total: 1};
    const {getByTestId} = await renderScreen({routeBase: "/admin"});
    await act(async () => {
      fireEvent.press(getByTestId("jobs-row-open"));
    });
    expect(String(pushMock.mock.calls[0]?.[0])).toBe("/admin/jobs/j1");
  });

  it("navigates with an un-prefixed routeBase for SPA hosts", async () => {
    listState.data = {data: [deadRow], more: false, page: 1, total: 1};
    const {getByTestId} = await renderScreen({routeBase: ""});
    await act(async () => {
      fireEvent.press(getByTestId("jobs-row-open"));
    });
    expect(String(pushMock.mock.calls[0]?.[0])).toBe("/jobs/j1");
  });

  it("shows summary counts from stats and schedules", async () => {
    listState.data = {data: [deadRow], more: false, page: 1, total: 1};
    schedulesState.data = [
      {
        cron: "0 0 * * *",
        enabled: true,
        name: "nightly",
        nextRunAt: "2026-08-21T00:00:00.000Z",
        timezone: "UTC",
      },
    ];
    const {getByTestId, getByText} = await renderScreen();
    expect(getByTestId("jobs-stat-dead")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
    expect(getByTestId("jobs-stat-running")).toBeTruthy();
    expect(getByTestId("jobs-schedule-nightly")).toBeTruthy();
    expect(getByTestId("jobs-filter-schedule.label")).toBeTruthy();
  });

  it("requires confirmation before pausing or resuming a schedule", async () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    schedulesState.data = [{cron: "0 0 * * *", enabled: true, name: "nightly", timezone: "UTC"}];
    const paused = await renderScreen();

    await act(async () => {
      fireEvent.press(paused.getByTestId("jobs-schedule-toggle-nightly"));
    });
    await act(async () => {
      const confirms = paused.getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    await flush();
    expect(pauseImpl.mock.calls.length).toBe(1);
    expect(
      requests.some((r) => r.method === "POST" && r.path === "/jobs/schedules/nightly/pause")
    ).toBe(true);
    paused.unmount();

    schedulesState.data = [{cron: "0 0 * * *", enabled: false, name: "nightly", timezone: "UTC"}];
    const resumed = await renderScreen();
    await act(async () => {
      fireEvent.press(resumed.getByTestId("jobs-schedule-toggle-nightly"));
    });
    await act(async () => {
      const confirms = resumed.getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    await flush();
    expect(resumeImpl.mock.calls.length).toBe(1);
    expect(
      requests.some((r) => r.method === "POST" && r.path === "/jobs/schedules/nightly/resume")
    ).toBe(true);
  });
});
