import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi} from "../types";

const pushMock = mock((_href: unknown) => {});
mock.module("expo-router", () => ({
  router: {push: pushMock, replace: mock(() => {})},
}));

interface DetailState {
  data?: Record<string, unknown>;
  error?: unknown;
  isLoading: boolean;
}

const detailState: DetailState = {isLoading: false};
let retryImpl = mock(
  async () => ({data: {_id: "retry-1", name: "demo", status: "pending"}}) as unknown
);
let requeueImpl = mock(
  async () => ({data: {_id: "j1", name: "demo", status: "pending"}}) as unknown
);
let cancelImpl = mock(
  async () => ({data: {_id: "j1", name: "demo", status: "cancelled"}}) as unknown
);

const createJobsApi = (): AdminApi => {
  const jobsHooks: Record<string, unknown> = {
    useJobsDashboardCancelMutation: () => [() => ({unwrap: cancelImpl}), {isLoading: false}],
    useJobsDashboardDetailQuery: () => detailState,
    useJobsDashboardRequeueMutation: () => [() => ({unwrap: requeueImpl}), {isLoading: false}],
    useJobsDashboardRetryMutation: () => [() => ({unwrap: retryImpl}), {isLoading: false}],
  };
  const hooks = new Proxy(jobsHooks, {
    get: (target, key: string) =>
      target[key] ?? (() => ({data: undefined, isLoading: false, isSuccess: true})),
  });
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => hooks,
  };
  return api as unknown as AdminApi;
};

import {JobsJobDetail} from "./JobsJobDetail";
import {formatJobTimestamp} from "./jobPayload";

const baseJob = {
  _id: "j1",
  name: "demo-job",
};

describe("JobsJobDetail", () => {
  beforeEach(() => {
    detailState.data = undefined;
    detailState.error = undefined;
    detailState.isLoading = false;
    pushMock.mockClear();
    retryImpl = mock(
      async () => ({data: {_id: "retry-1", name: "demo", status: "pending"}}) as unknown
    );
    requeueImpl = mock(
      async () => ({data: {_id: "j1", name: "demo", status: "pending"}}) as unknown
    );
    cancelImpl = mock(
      async () => ({data: {_id: "j1", name: "demo", status: "cancelled"}}) as unknown
    );
  });

  it("renders loading and error states", () => {
    detailState.isLoading = true;
    const loading = renderWithTheme(<JobsJobDetail api={createJobsApi()} jobId="j1" />);
    expect(loading.getByTestId("jobs-detail-loading")).toBeTruthy();

    detailState.isLoading = false;
    detailState.error = {status: 500};
    const errored = renderWithTheme(<JobsJobDetail api={createJobsApi()} jobId="j1" />);
    expect(errored.getByTestId("jobs-detail-error")).toBeTruthy();
  });

  it("shows attempts, lock info, payload, and action availability for failed jobs", () => {
    detailState.data = {
      data: {
        ...baseJob,
        attempts: [{at: "2026-08-20T00:00:00.000Z", error: "timeout", errorClass: "transient"}],
        created: "2026-08-20T00:00:00.000Z",
        lastError: "timeout",
        lockedAt: "2026-08-20T00:01:00.000Z",
        lockedBy: "worker-1",
        payload: {value: 1},
        status: "failed",
      },
    };
    const {getByTestId, getByText} = renderWithTheme(
      <JobsJobDetail api={createJobsApi()} jobId="j1" routeBase="/admin" />
    );
    expect(getByTestId("jobs-detail-retry").props.accessibilityState?.disabled).toBe(false);
    expect(getByTestId("jobs-detail-requeue").props.accessibilityState?.disabled).toBe(false);
    expect(getByTestId("jobs-detail-cancel").props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId("jobs-attempt-0")).toBeTruthy();
    expect(getByTestId("jobs-detail-lock-card")).toBeTruthy();
    expect(getByTestId("jobs-detail-payload")).toBeTruthy();
    expect(
      getByText(`Created ${formatJobTimestamp({empty: "—", value: "2026-08-20T00:00:00.000Z"})}`)
    ).toBeTruthy();
  });

  it("gates actions across dead, running, completed, cancelled, and retried jobs", () => {
    const cases: Array<{
      cancel: boolean;
      requeue: boolean;
      retry: boolean;
      status: string;
      retriedById?: string;
    }> = [
      {cancel: false, requeue: true, retry: true, status: "dead"},
      {cancel: true, requeue: false, retry: false, status: "running"},
      {cancel: false, requeue: false, retry: false, status: "completed"},
      {cancel: false, requeue: true, retry: false, status: "cancelled"},
      {cancel: false, requeue: false, retriedById: "retry-1", retry: false, status: "failed"},
    ];

    for (const jobCase of cases) {
      detailState.data = {
        data: {
          ...baseJob,
          retriedById: jobCase.retriedById,
          status: jobCase.status,
        },
      };
      const {getByTestId, unmount} = renderWithTheme(
        <JobsJobDetail api={createJobsApi()} jobId="j1" />
      );
      expect(getByTestId("jobs-detail-retry").props.accessibilityState?.disabled).toBe(
        !jobCase.retry
      );
      expect(getByTestId("jobs-detail-requeue").props.accessibilityState?.disabled).toBe(
        !jobCase.requeue
      );
      expect(getByTestId("jobs-detail-cancel").props.accessibilityState?.disabled).toBe(
        !jobCase.cancel
      );
      unmount();
    }
  });

  it("requires confirmation before retry, requeue, and cancel actions", async () => {
    detailState.data = {
      data: {
        ...baseJob,
        status: "dead",
      },
    };
    const {getAllByText, getByTestId} = renderWithTheme(
      <JobsJobDetail api={createJobsApi()} jobId="j1" routeBase="/admin" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("jobs-detail-retry"));
    });
    await act(async () => {
      const confirms = getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    expect(retryImpl.mock.calls.length).toBe(1);
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/jobs/retry-1");

    await act(async () => {
      fireEvent.press(getByTestId("jobs-detail-requeue"));
    });
    await act(async () => {
      const confirms = getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    expect(requeueImpl.mock.calls.length).toBe(1);

    detailState.data = {
      data: {
        ...baseJob,
        status: "running",
      },
    };
    const running = renderWithTheme(
      <JobsJobDetail api={createJobsApi()} jobId="j1" routeBase="/admin" />
    );
    await act(async () => {
      fireEvent.press(running.getByTestId("jobs-detail-cancel"));
    });
    await act(async () => {
      const confirms = running.getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    expect(cancelImpl.mock.calls.length).toBe(1);
  });

  it("shows redacted and unavailable payload copy", async () => {
    detailState.data = {
      data: {
        ...baseJob,
        payloadRedacted: true,
        status: "dead",
      },
    };
    const redacted = renderWithTheme(<JobsJobDetail api={createJobsApi()} jobId="j1" />);
    await act(async () => {
      fireEvent.press(redacted.getByTestId("jobs-detail-payload.toggle"));
    });
    expect(redacted.getByText("Payload redacted for this job.")).toBeTruthy();

    detailState.data = {
      data: {
        ...baseJob,
        status: "dead",
      },
    };
    const unavailable = renderWithTheme(<JobsJobDetail api={createJobsApi()} jobId="j1" />);
    await act(async () => {
      fireEvent.press(unavailable.getByTestId("jobs-detail-payload.toggle"));
    });
    expect(unavailable.getByText("No payload available.")).toBeTruthy();
  });

  it("navigates retried-from and retried-by links with routeBase", async () => {
    detailState.data = {
      data: {
        ...baseJob,
        retriedById: "retry-1",
        retriedFromId: "orig-1",
        status: "dead",
      },
    };
    const embedded = renderWithTheme(
      <JobsJobDetail api={createJobsApi()} jobId="j1" routeBase="/admin" />
    );
    await act(async () => {
      fireEvent.press(embedded.getByTestId("jobs-detail-retried-from"));
    });
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/jobs/orig-1");
    await act(async () => {
      fireEvent.press(embedded.getByTestId("jobs-detail-retried-by"));
    });
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/jobs/retry-1");

    pushMock.mockClear();
    const spa = renderWithTheme(<JobsJobDetail api={createJobsApi()} jobId="j1" routeBase="" />);
    await act(async () => {
      fireEvent.press(spa.getByTestId("jobs-detail-retried-by"));
    });
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/jobs/retry-1");
  });
});
