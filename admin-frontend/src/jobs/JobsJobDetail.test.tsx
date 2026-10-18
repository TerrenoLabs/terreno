import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";

const pushMock = mock(() => {});
mock.module("expo-router", () => ({
  router: {push: pushMock, replace: mock(() => {})},
}));

interface FakeResponse {
  body?: unknown;
  pending?: boolean;
  status?: number;
}

interface FakeRequest {
  method: string;
  path: string;
}

interface DetailState {
  data?: Record<string, unknown>;
  error?: unknown;
  isLoading: boolean;
}

const detailState: DetailState = {isLoading: false};
const okJob = (job: Record<string, unknown>) => mock((): FakeResponse => ({body: {data: job}}));
let retryImpl = okJob({_id: "retry-1", name: "demo", status: "pending"});
let requeueImpl = okJob({_id: "j1", name: "demo", status: "pending"});
let cancelImpl = okJob({_id: "j1", name: "demo", status: "cancelled"});
const requests: FakeRequest[] = [];
const originalFetch = globalThis.fetch;

/** Serves `/jobs/:id` and its POST actions from the mutable test state above. */
const route = (request: FakeRequest): FakeResponse => {
  if (request.method === "GET" && /^\/jobs\/[^/]+$/.test(request.path)) {
    if (detailState.isLoading) {
      return {pending: true};
    }
    if (detailState.error) {
      return {body: {title: "Server error"}, status: 500};
    }
    return {body: detailState.data ?? {}};
  }
  if (request.method === "POST" && request.path.endsWith("/retry")) {
    return retryImpl();
  }
  if (request.method === "POST" && request.path.endsWith("/requeue")) {
    return requeueImpl();
  }
  if (request.method === "POST" && request.path.endsWith("/cancel")) {
    return cancelImpl();
  }
  return {body: {title: "Not found"}, status: 404};
};

const installFetch = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const request: FakeRequest = {method: init?.method ?? "GET", path: url.split("?")[0] ?? url};
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
import {JobsJobDetail} from "./JobsJobDetail";
import {formatJobTimestamp} from "./jobPayload";

const renderDetail = async (routeBase?: string): Promise<ReturnType<typeof renderWithTheme>> => {
  const utils = renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      <JobsJobDetail jobId="j1" routeBase={routeBase} />
    </AdminProvider>
  );
  await flush();
  return utils;
};

const baseJob = {
  _id: "j1",
  name: "demo-job",
};

describe("JobsJobDetail", () => {
  beforeEach(() => {
    installFetch();
    requests.length = 0;
    detailState.data = undefined;
    detailState.error = undefined;
    detailState.isLoading = false;
    pushMock.mockClear();
    retryImpl = okJob({_id: "retry-1", name: "demo", status: "pending"});
    requeueImpl = okJob({_id: "j1", name: "demo", status: "pending"});
    cancelImpl = okJob({_id: "j1", name: "demo", status: "cancelled"});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders loading and error states", async () => {
    detailState.isLoading = true;
    const loading = await renderDetail();
    expect(loading.getByTestId("jobs-detail-loading")).toBeTruthy();
    loading.unmount();

    detailState.isLoading = false;
    detailState.error = {status: 500};
    const errored = await renderDetail();
    expect(errored.getByTestId("jobs-detail-error")).toBeTruthy();
  });

  it("shows attempts, lock info, payload, and action availability for failed jobs", async () => {
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
    const {getByTestId, getByText} = await renderDetail("/admin");
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

  it("gates actions across dead, running, completed, cancelled, and retried jobs", async () => {
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
      const {getByTestId, unmount} = await renderDetail();
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
    const {getAllByText, getByTestId} = await renderDetail("/admin");

    await act(async () => {
      fireEvent.press(getByTestId("jobs-detail-retry"));
    });
    await act(async () => {
      const confirms = getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    await flush();
    expect(retryImpl.mock.calls.length).toBe(1);
    expect(requests).toContainEqual({method: "POST", path: "/jobs/j1/retry"});
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/jobs/retry-1");

    await act(async () => {
      fireEvent.press(getByTestId("jobs-detail-requeue"));
    });
    await act(async () => {
      const confirms = getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    await flush();
    expect(requeueImpl.mock.calls.length).toBe(1);
    expect(requests).toContainEqual({method: "POST", path: "/jobs/j1/requeue"});

    detailState.data = {
      data: {
        ...baseJob,
        status: "running",
      },
    };
    const running = await renderDetail("/admin");
    await act(async () => {
      fireEvent.press(running.getByTestId("jobs-detail-cancel"));
    });
    await act(async () => {
      const confirms = running.getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    await flush();
    expect(cancelImpl.mock.calls.length).toBe(1);
    expect(requests).toContainEqual({method: "POST", path: "/jobs/j1/cancel"});
  });

  it("shows redacted and unavailable payload copy", async () => {
    detailState.data = {
      data: {
        ...baseJob,
        payloadRedacted: true,
        status: "dead",
      },
    };
    const redacted = await renderDetail();
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
    const unavailable = await renderDetail();
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
    const embedded = await renderDetail("/admin");
    await act(async () => {
      fireEvent.press(embedded.getByTestId("jobs-detail-retried-from"));
    });
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/jobs/orig-1");
    await act(async () => {
      fireEvent.press(embedded.getByTestId("jobs-detail-retried-by"));
    });
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/jobs/retry-1");

    pushMock.mockClear();
    const spa = await renderDetail("");
    await act(async () => {
      fireEvent.press(spa.getByTestId("jobs-detail-retried-by"));
    });
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/jobs/retry-1");
  });
});
