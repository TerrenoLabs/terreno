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
  body: unknown;
  method: string;
  path: string;
  url: string;
}

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
const statsState: {data?: unknown} = {};
let retryImpl = mock((): FakeResponse => ({body: {data: {_id: "retry-1"}}}));
let retryManyImpl = mock((): FakeResponse => ({body: {retried: [{_id: "n1"}], skipped: []}}));
const retryManyBodies: unknown[] = [];
const requests: FakeRequest[] = [];
const originalFetch = globalThis.fetch;

/** Serves the dashboard routes from the mutable test state above. */
const route = (request: FakeRequest): FakeResponse => {
  if (request.method === "GET" && request.path === "/comms/messages") {
    if (listState.isLoading) {
      return {pending: true};
    }
    if (listState.error) {
      return {body: {title: "Server error"}, status: 500};
    }
    return {body: listState.data ?? {data: [], more: false, page: 1, total: 0}};
  }
  if (request.method === "GET" && request.path === "/comms/stats") {
    return {body: statsState.data ?? {}};
  }
  if (request.method === "POST" && request.path === "/comms/messages/retryMany") {
    retryManyBodies.push(request.body);
    return retryManyImpl();
  }
  if (request.method === "POST" && /^\/comms\/messages\/[^/]+\/retry$/.test(request.path)) {
    return retryImpl();
  }
  return {body: {title: "Not found"}, status: 404};
};

const installFetch = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const request: FakeRequest = {
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
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

const failedRow = {
  _id: "m1",
  channel: "mail",
  created: "2026-08-20T00:00:00.000Z",
  errorCode: "timeout",
  provider: "sendgrid",
  retryable: true,
  status: "failed",
  subject: "Hi",
  to: "a***@example.com",
};

import {AdminProvider} from "../AdminProvider";
import {AdminScreenPage} from "../AdminScreenPage";
import {CommsDashboardScreen, type CommsDashboardScreenProps} from "./CommsDashboardScreen";
import {formatCommsTimestamp} from "./commsMessagePayload";

const renderScreen = async (
  props: Partial<CommsDashboardScreenProps> = {}
): Promise<ReturnType<typeof renderWithTheme>> => {
  const utils = renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      <CommsDashboardScreen filters={{}} onFiltersChange={() => undefined} {...props} />
    </AdminProvider>
  );
  await flush();
  return utils;
};

describe("CommsDashboardScreen", () => {
  beforeEach(() => {
    installFetch();
    requests.length = 0;
    listState.data = undefined;
    listState.error = undefined;
    listState.isLoading = false;
    statsState.data = {
      byProvider: [],
      totals: {
        bounced: 0,
        cancelled: 0,
        delivered: 0,
        failed: 0,
        failureRate: 0,
        sent: 0,
        total: 0,
      },
    };
    pushMock.mockClear();
    retryManyBodies.length = 0;
    retryImpl = mock((): FakeResponse => ({body: {data: {_id: "retry-1"}}}));
    retryManyImpl = mock((): FakeResponse => ({body: {retried: [{_id: "n1"}], skipped: []}}));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders the loading state", async () => {
    listState.isLoading = true;
    const {getByTestId} = await renderScreen();
    expect(getByTestId("comms-dashboard-loading")).toBeTruthy();
  });

  it("requests the list and stats with the active filters", async () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    await renderScreen({filters: {channel: "mail", status: "failed"}});
    const list = requests.find((request) => request.path === "/comms/messages");
    const stats = requests.find((request) => request.path === "/comms/stats");
    expect(list?.method).toBe("GET");
    expect(list?.url).toContain("channel=mail");
    expect(list?.url).toContain("status=failed");
    expect(stats?.url).toContain("channel=mail");
  });

  it("renders the error state", async () => {
    listState.error = {status: 500};
    const {getByTestId} = await renderScreen();
    expect(getByTestId("comms-dashboard-error")).toBeTruthy();
  });

  it("renders the empty state", async () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    const {getByTestId, UNSAFE_root} = await renderScreen();
    expect(getByTestId("comms-dashboard-empty")).toBeTruthy();
    expect(getByTestId("comms-stats-range-label")).toBeTruthy();
    assert.isTrue(UNSAFE_root.findByType(AdminScreenPage).props.backHref !== undefined);
  });

  it("writes filter changes through onFiltersChange for URL persistence", async () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    const onFiltersChange = mock(() => {});
    const {getByTestId} = await renderScreen({
      filters: {channel: "mail", page: 2},
      onFiltersChange,
    });
    fireEvent.changeText(getByTestId("comms-filter-q"), "timeout");
    expect(onFiltersChange).toHaveBeenCalled();
    const next = (onFiltersChange.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(next.q).toBe("timeout");
    expect(next.channel).toBe("mail");
    expect(next.page).toBe(1);
    expect(String(next.startDate)).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(String(next.endDate)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("keeps both default date bounds when search changes with empty URL dates", async () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    const onFiltersChange = mock(() => {});
    const {getByTestId} = await renderScreen({onFiltersChange});
    fireEvent.changeText(getByTestId("comms-filter-q"), "hello");
    const next = (onFiltersChange.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(next.q).toBe("hello");
    expect(next.page).toBe(1);
    expect(String(next.startDate)).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(String(next.endDate)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("clears every active filter and returns to the first page", async () => {
    listState.data = {data: [], more: false, page: 3, total: 0};
    const onFiltersChange = mock(() => {});
    const {getByTestId} = await renderScreen({
      filters: {channel: "mail", page: 3, q: "invoice", status: "failed"},
      onFiltersChange,
    });

    await act(async () => {
      fireEvent.press(getByTestId("comms-clear-filters"));
    });

    assert.deepEqual(onFiltersChange.mock.calls[0]?.[0], {page: 1});
  });

  it("disables inline retry and exposes the reason", async () => {
    listState.data = {
      data: [
        {
          _id: "m1",
          channel: "mail",
          created: "2026-08-20T00:00:00.000Z",
          provider: "sendgrid",
          retryable: false,
          retryDisabledReason: "Permanent failures cannot be retried",
          status: "failed",
          subject: "Hi",
          to: "a***@example.com",
        },
      ],
      more: false,
      page: 1,
      total: 1,
    };
    const {getByTestId} = await renderScreen();
    const retryButton = getByTestId("comms-row-retry");
    expect(retryButton.props["aria-label"]).toBe("Permanent failures cannot be retried");
  });

  it("shows the exact matching count in the bulk retry confirmation", async () => {
    listState.data = {
      data: [
        {
          _id: "m1",
          channel: "mail",
          created: "2026-08-20T00:00:00.000Z",
          provider: "sendgrid",
          retryable: true,
          status: "failed",
          to: "a***@example.com",
        },
      ],
      more: true,
      page: 1,
      total: 42,
    };
    const {getByTestId, getByText} = await renderScreen({filters: {status: "failed"}});
    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many"));
    });
    expect(getByText("Retry 42 matching messages (cap 100)?")).toBeTruthy();
  });

  it("opens a row and navigates to the retry it creates", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 1};
    const {getAllByText, getByTestId} = await renderScreen();
    expect(getAllByText(formatCommsTimestamp({value: failedRow.created}))).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("comms-row-open"));
    });
    expect(String(pushMock.mock.calls[0]?.[0])).toBe("/admin/comms/m1");

    await act(async () => {
      fireEvent.press(getByTestId("comms-row-retry"));
    });
    await act(async () => {
      const confirms = getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    await flush();
    const retry = requests.find((request) => request.path === "/comms/messages/m1/retry");
    expect(retry?.method).toBe("POST");
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/comms/retry-1");
  });

  it("stays on the list when an inline retry is rejected", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 1};
    retryImpl = mock(
      (): FakeResponse => ({body: {title: "Permanent failures cannot be retried"}, status: 400})
    );
    const {getAllByText, getByTestId} = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId("comms-row-retry"));
    });
    await act(async () => {
      const confirms = getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    await flush();
    expect(retryImpl).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("sends the active filters and the cap with a bulk retry", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 3};
    retryManyImpl = mock(
      (): FakeResponse => ({
        body: {
          retried: [{_id: "n1"}, {_id: "n2"}],
          skipped: [{id: "s1", reason: "Permanent failures cannot be retried"}],
        },
      })
    );
    const {getByTestId, queryByTestId} = await renderScreen({
      filters: {channel: "mail", status: "failed"},
    });

    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many-modal.primary"));
    });
    await flush();

    expect(retryManyBodies[0]).toMatchObject({channel: "mail", limit: 100, status: "failed"});
    // A resolved bulk retry closes the confirmation.
    expect(queryByTestId("comms-retry-many-count")).toBeNull();
  });

  it("keeps the confirmation open when a bulk retry is rejected", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 3};
    retryManyImpl = mock((): FakeResponse => ({body: {title: "boom"}, status: 500}));
    const {getByTestId} = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many-modal.primary"));
    });
    await flush();
    expect(retryManyImpl).toHaveBeenCalled();
    expect(getByTestId("comms-retry-many-count")).toBeTruthy();
  });

  it("dismisses the bulk retry confirmation without sending anything", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 3};
    const {getByTestId, queryByTestId} = await renderScreen();

    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many-modal.secondary"));
    });
    expect(retryManyBodies).toHaveLength(0);
    expect(queryByTestId("comms-retry-many-count")).toBeNull();
  });

  it("pages through results without dropping the active filters", async () => {
    listState.data = {data: [failedRow], more: true, page: 1, total: 60};
    const onFiltersChange = mock(() => {});
    const {getByTestId} = await renderScreen({filters: {status: "failed"}, onFiltersChange});
    await act(async () => {
      fireEvent.press(
        within(getByTestId("comms-dashboard-table.pagination")).getAllByA11yHint(
          "Click to go to page 2"
        )[0]
      );
    });
    expect(onFiltersChange.mock.calls[0]?.[0]).toEqual({page: 2, status: "failed"});
  });

  it("flags the failure-rate and provider tiles once the rate clears the alert threshold", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 1};
    statsState.data = {
      byProvider: [
        {
          bounced: 0,
          delivered: 0,
          failed: 1,
          failureRate: 1,
          provider: "sendgrid",
          sent: 0,
          total: 1,
        },
        {
          bounced: 0,
          delivered: 9,
          failed: 0,
          failureRate: 0,
          provider: "twilio",
          sent: 9,
          total: 9,
        },
      ],
      totals: {
        bounced: 0,
        cancelled: 0,
        delivered: 9,
        failed: 1,
        failureRate: 0.1,
        sent: 9,
        total: 10,
      },
    };
    const {getByTestId, getByText} = await renderScreen();
    expect(getByTestId("comms-stat-failure-rate")).toBeTruthy();
    expect(getByText("10%")).toBeTruthy();
    expect(getByText("1 of 10 messages")).toBeTruthy();
    expect(getByTestId("comms-stat-provider-sendgrid")).toBeTruthy();
    expect(getByTestId("comms-stat-provider-twilio")).toBeTruthy();
    expect(getByText("Failure rate by provider")).toBeTruthy();
  });
});
