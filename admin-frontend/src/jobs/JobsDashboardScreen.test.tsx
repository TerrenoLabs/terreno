import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, within} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi} from "../types";

const pushMock = mock((_href: unknown) => {});
mock.module("expo-router", () => ({
  router: {push: pushMock, replace: mock(() => {})},
  useLocalSearchParams: () => ({}),
}));

interface ListState {
  data?: {
    data: unknown[];
    more: boolean;
    page: number;
    total: number;
  };
  error?: unknown;
  isLoading: boolean;
}

const listState: ListState = {isLoading: false};
const statsState: {
  data?: {byStatus: Record<string, number>; total: number};
  error?: unknown;
  isLoading: boolean;
} = {isLoading: false};
const schedulesState: {data?: unknown[]; error?: unknown; isLoading: boolean} = {
  isLoading: false,
};
let pauseImpl = mock(async () => ({data: {enabled: false, name: "nightly"}}) as unknown);
let resumeImpl = mock(async () => ({data: {enabled: true, name: "nightly"}}) as unknown);

const createJobsApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useJobsDashboardCancelMutation: () => [
        () => ({unwrap: async () => ({})}),
        {isLoading: false},
      ],
      useJobsDashboardDetailQuery: () => ({isLoading: false}),
      useJobsDashboardListQuery: () => listState,
      useJobsDashboardPauseScheduleMutation: () => [
        () => ({unwrap: pauseImpl}),
        {isLoading: false},
      ],
      useJobsDashboardRequeueMutation: () => [
        () => ({unwrap: async () => ({})}),
        {isLoading: false},
      ],
      useJobsDashboardResumeScheduleMutation: () => [
        () => ({unwrap: resumeImpl}),
        {isLoading: false},
      ],
      useJobsDashboardRetryMutation: () => [() => ({unwrap: async () => ({})}), {isLoading: false}],
      useJobsDashboardSchedulesQuery: () => schedulesState,
      useJobsDashboardStatsQuery: () => statsState,
    }),
  };
  return api as unknown as AdminApi;
};

import {JobsDashboardScreen} from "./JobsDashboardScreen";

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
    pauseImpl = mock(async () => ({data: {enabled: false, name: "nightly"}}) as unknown);
    resumeImpl = mock(async () => ({data: {enabled: true, name: "nightly"}}) as unknown);
    pushMock.mockClear();
  });

  it("renders stats loading and error states", () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    statsState.isLoading = true;
    const loading = renderWithTheme(
      <JobsDashboardScreen api={createJobsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(loading.getByTestId("jobs-stats-loading")).toBeTruthy();
    expect(loading.queryByTestId("jobs-stat-dead")).toBeNull();

    statsState.isLoading = false;
    statsState.error = {status: 500};
    const errored = renderWithTheme(
      <JobsDashboardScreen api={createJobsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(errored.getByTestId("jobs-stats-error")).toBeTruthy();
    expect(errored.queryByTestId("jobs-stat-dead")).toBeNull();
  });

  it("renders loading, error, and empty states", () => {
    listState.isLoading = true;
    const loading = renderWithTheme(
      <JobsDashboardScreen api={createJobsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(loading.getByTestId("jobs-dashboard-loading")).toBeTruthy();

    listState.isLoading = false;
    listState.error = {status: 500};
    const errored = renderWithTheme(
      <JobsDashboardScreen api={createJobsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(errored.getByTestId("jobs-dashboard-error")).toBeTruthy();

    listState.error = undefined;
    listState.data = {data: [], more: false, page: 1, total: 0};
    const empty = renderWithTheme(
      <JobsDashboardScreen api={createJobsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(empty.getByTestId("jobs-dashboard-empty")).toBeTruthy();
  });

  it("writes filter changes through onFiltersChange", () => {
    const onFiltersChange = mock((_next: unknown) => {});
    listState.data = {data: [deadRow], more: false, page: 1, total: 1};
    schedulesState.data = [
      {_id: "sched-1", cron: "0 0 * * *", enabled: true, name: "nightly", timezone: "UTC"},
    ];
    const {getByTestId} = renderWithTheme(
      <JobsDashboardScreen
        api={createJobsApi()}
        filters={{status: "dead"}}
        onFiltersChange={onFiltersChange}
        routeBase="/admin"
      />
    );
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
    const onFiltersChange = mock((_next: unknown) => {});
    const {UNSAFE_root, getByTestId} = renderWithTheme(
      <JobsDashboardScreen
        api={createJobsApi()}
        filters={{
          end: "2026-01-02T00:00:00.000Z",
          page: 3,
          q: "boom",
          scheduleId: "sched-1",
          start: "2026-01-01T00:00:00.000Z",
          status: "dead",
        }}
        onFiltersChange={onFiltersChange}
      />
    );

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
    const onFiltersChange = mock((_next: unknown) => {});
    const {getByTestId} = renderWithTheme(
      <JobsDashboardScreen
        api={createJobsApi()}
        filters={{scheduleId: "sched-1", status: "dead"}}
        onFiltersChange={onFiltersChange}
      />
    );
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
    const {getByTestId} = renderWithTheme(
      <JobsDashboardScreen
        api={createJobsApi()}
        filters={{}}
        onFiltersChange={() => undefined}
        routeBase="/admin"
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("jobs-row-open"));
    });
    expect(String(pushMock.mock.calls[0]?.[0])).toBe("/admin/jobs/j1");
  });

  it("navigates with an un-prefixed routeBase for SPA hosts", async () => {
    listState.data = {data: [deadRow], more: false, page: 1, total: 1};
    const {getByTestId} = renderWithTheme(
      <JobsDashboardScreen
        api={createJobsApi()}
        filters={{}}
        onFiltersChange={() => undefined}
        routeBase=""
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("jobs-row-open"));
    });
    expect(String(pushMock.mock.calls[0]?.[0])).toBe("/jobs/j1");
  });

  it("shows summary counts from stats and schedules", () => {
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
    const {getByTestId, getByText} = renderWithTheme(
      <JobsDashboardScreen api={createJobsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(getByTestId("jobs-stat-dead")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
    expect(getByTestId("jobs-stat-running")).toBeTruthy();
    expect(getByTestId("jobs-schedule-nightly")).toBeTruthy();
    expect(getByTestId("jobs-filter-schedule.label")).toBeTruthy();
  });

  it("requires confirmation before pausing or resuming a schedule", async () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    schedulesState.data = [{cron: "0 0 * * *", enabled: true, name: "nightly", timezone: "UTC"}];
    const {getAllByText, getByTestId} = renderWithTheme(
      <JobsDashboardScreen api={createJobsApi()} filters={{}} onFiltersChange={() => undefined} />
    );

    await act(async () => {
      fireEvent.press(getByTestId("jobs-schedule-toggle-nightly"));
    });
    await act(async () => {
      const confirms = getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    expect(pauseImpl.mock.calls.length).toBe(1);

    schedulesState.data = [{cron: "0 0 * * *", enabled: false, name: "nightly", timezone: "UTC"}];
    const resumed = renderWithTheme(
      <JobsDashboardScreen api={createJobsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    await act(async () => {
      fireEvent.press(resumed.getByTestId("jobs-schedule-toggle-nightly"));
    });
    await act(async () => {
      const confirms = resumed.getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    expect(resumeImpl.mock.calls.length).toBe(1);
  });
});
