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
const statsState: {data?: unknown} = {};
let retryImpl = mock(async () => ({data: {_id: "retry-1"}}) as unknown);
let retryManyImpl = mock(async () => ({retried: [{_id: "n1"}], skipped: []}) as unknown);
const retryManyBodies: unknown[] = [];

/**
 * Stands in for the host RTK Query API so the real `useCommsDashboardApi` runs.
 * Mocking that module instead would leak process-wide and make the suite order-dependent.
 */
const createCommsApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useCommsDashboardDetailQuery: () => ({isLoading: false}),
      useCommsDashboardListQuery: () => listState,
      useCommsDashboardRetryManyMutation: () => [
        (body: unknown) => {
          retryManyBodies.push(body);
          return {unwrap: retryManyImpl};
        },
        {isLoading: false},
      ],
      useCommsDashboardRetryMutation: () => [() => ({unwrap: retryImpl}), {isLoading: false}],
      useCommsDashboardStatsQuery: () => statsState,
    }),
  };
  return api as unknown as AdminApi;
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

import {AdminScreenPage} from "../AdminScreenPage";
import {CommsDashboardScreen} from "./CommsDashboardScreen";
import {formatCommsTimestamp} from "./commsMessagePayload";

describe("CommsDashboardScreen", () => {
  beforeEach(() => {
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
    retryImpl = mock(async () => ({data: {_id: "retry-1"}}) as unknown);
    retryManyImpl = mock(async () => ({retried: [{_id: "n1"}], skipped: []}) as unknown);
  });

  it("renders the loading state", () => {
    listState.isLoading = true;
    const {getByTestId} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(getByTestId("comms-dashboard-loading")).toBeTruthy();
  });

  it("renders the error state", () => {
    listState.error = {status: 500};
    const {getByTestId} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(getByTestId("comms-dashboard-error")).toBeTruthy();
  });

  it("renders the empty state", () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(getByTestId("comms-dashboard-empty")).toBeTruthy();
    expect(getByTestId("comms-stats-range-label")).toBeTruthy();
    assert.isTrue(UNSAFE_root.findByType(AdminScreenPage).props.backHref !== undefined);
  });

  it("writes filter changes through onFiltersChange for URL persistence", () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    const onFiltersChange = mock((_next: unknown) => {});
    const {getByTestId} = renderWithTheme(
      <CommsDashboardScreen
        api={createCommsApi()}
        filters={{channel: "mail", page: 2}}
        onFiltersChange={onFiltersChange}
      />
    );
    fireEvent.changeText(getByTestId("comms-filter-q"), "timeout");
    expect(onFiltersChange).toHaveBeenCalled();
    const next = (onFiltersChange.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(next.q).toBe("timeout");
    expect(next.channel).toBe("mail");
    expect(next.page).toBe(1);
    expect(String(next.startDate)).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(String(next.endDate)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("keeps both default date bounds when search changes with empty URL dates", () => {
    listState.data = {data: [], more: false, page: 1, total: 0};
    const onFiltersChange = mock((_next: unknown) => {});
    const {getByTestId} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={onFiltersChange} />
    );
    fireEvent.changeText(getByTestId("comms-filter-q"), "hello");
    const next = (onFiltersChange.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(next.q).toBe("hello");
    expect(next.page).toBe(1);
    expect(String(next.startDate)).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(String(next.endDate)).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });

  it("clears every active filter and returns to the first page", async () => {
    listState.data = {data: [], more: false, page: 3, total: 0};
    const onFiltersChange = mock((_next: unknown) => {});
    const {getByTestId} = renderWithTheme(
      <CommsDashboardScreen
        api={createCommsApi()}
        filters={{channel: "mail", page: 3, q: "invoice", status: "failed"}}
        onFiltersChange={onFiltersChange}
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("comms-clear-filters"));
    });

    assert.deepEqual(onFiltersChange.mock.calls[0]?.[0], {page: 1});
  });

  it("disables inline retry and exposes the reason", () => {
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
    const {getByTestId} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
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
    const {getByTestId, getByText} = renderWithTheme(
      <CommsDashboardScreen
        api={createCommsApi()}
        filters={{status: "failed"}}
        onFiltersChange={() => undefined}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many"));
    });
    expect(getByText("Retry 42 matching messages (cap 100)?")).toBeTruthy();
  });

  it("opens a row and navigates to the retry it creates", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 1};
    const {getAllByText, getByTestId} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
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
    expect(String(pushMock.mock.calls.at(-1)?.[0])).toBe("/admin/comms/retry-1");
  });

  it("stays on the list when an inline retry is rejected", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 1};
    retryImpl = mock(async () => {
      throw {status: 400, title: "Permanent failures cannot be retried"};
    });
    const {getAllByText, getByTestId} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );

    await act(async () => {
      fireEvent.press(getByTestId("comms-row-retry"));
    });
    await act(async () => {
      const confirms = getAllByText("Confirm");
      fireEvent.press(confirms[confirms.length - 1]);
    });
    expect(retryImpl).toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("sends the active filters and the cap with a bulk retry", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 3};
    retryManyImpl = mock(
      async () =>
        ({
          retried: [{_id: "n1"}, {_id: "n2"}],
          skipped: [{id: "s1", reason: "Permanent failures cannot be retried"}],
        }) as unknown
    );
    const {getByTestId, queryByTestId} = renderWithTheme(
      <CommsDashboardScreen
        api={createCommsApi()}
        filters={{channel: "mail", status: "failed"}}
        onFiltersChange={() => undefined}
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many-modal.primary"));
    });

    expect(retryManyBodies[0]).toMatchObject({channel: "mail", limit: 100, status: "failed"});
    // A resolved bulk retry closes the confirmation.
    expect(queryByTestId("comms-retry-many-count")).toBeNull();
  });

  it("keeps the confirmation open when a bulk retry is rejected", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 3};
    retryManyImpl = mock(async () => {
      throw {status: 500, title: "boom"};
    });
    const {getByTestId} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );

    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("comms-retry-many-modal.primary"));
    });
    expect(retryManyImpl).toHaveBeenCalled();
    expect(getByTestId("comms-retry-many-count")).toBeTruthy();
  });

  it("dismisses the bulk retry confirmation without sending anything", async () => {
    listState.data = {data: [failedRow], more: false, page: 1, total: 3};
    const {getByTestId, queryByTestId} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );

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
    const onFiltersChange = mock((_next: unknown) => {});
    const {getByTestId} = renderWithTheme(
      <CommsDashboardScreen
        api={createCommsApi()}
        filters={{status: "failed"}}
        onFiltersChange={onFiltersChange}
      />
    );
    await act(async () => {
      fireEvent.press(
        within(getByTestId("comms-dashboard-table.pagination")).getAllByA11yHint(
          "Click to go to page 2"
        )[0]
      );
    });
    expect(onFiltersChange.mock.calls[0]?.[0]).toEqual({page: 2, status: "failed"});
  });

  it("flags the failure-rate and provider tiles once the rate clears the alert threshold", () => {
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
    const {getByTestId, getByText} = renderWithTheme(
      <CommsDashboardScreen api={createCommsApi()} filters={{}} onFiltersChange={() => undefined} />
    );
    expect(getByTestId("comms-stat-failure-rate")).toBeTruthy();
    expect(getByText("10%")).toBeTruthy();
    expect(getByText("1 of 10 messages")).toBeTruthy();
    expect(getByTestId("comms-stat-provider-sendgrid")).toBeTruthy();
    expect(getByTestId("comms-stat-provider-twilio")).toBeTruthy();
    expect(getByText("Failure rate by provider")).toBeTruthy();
  });
});
