import {afterEach, beforeEach, describe, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import type React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminProvider} from "./AdminProvider";

interface OverviewState {
  data: unknown;
  error: boolean;
  isLoading: boolean;
}

const overviewState: OverviewState = {data: undefined, error: false, isLoading: false};
const requests: Array<{method: string; url: string}> = [];
const originalFetch = globalThis.fetch;

const installFetch = (): void => {
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    requests.push({method: init?.method ?? "GET", url: String(url)});
    if (overviewState.isLoading) {
      return new Promise<Response>(() => {});
    }
    const body = overviewState.error ? {title: "failed"} : (overviewState.data ?? {});
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        headers: {"Content-Type": "application/json"},
        status: overviewState.error ? 500 : 200,
      })
    );
  }) as unknown as typeof fetch;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
};

const renderOverview = async (
  element: React.ReactElement
): Promise<ReturnType<typeof renderWithTheme>> => {
  const view = renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      {element}
    </AdminProvider>
  );
  await flush();
  return view;
};

import {AnnouncementOverview} from "./AnnouncementOverview";

const press = async (el: ReactTestInstance): Promise<void> => {
  await act(async () => {
    fireEvent.press(el);
    await new Promise((r) => setTimeout(r, 50));
  });
};

describe("AnnouncementOverview", () => {
  beforeEach(() => {
    overviewState.data = undefined;
    overviewState.error = false;
    overviewState.isLoading = false;
    requests.length = 0;
    installFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("wires the overview query to GET /announcements/overview", async () => {
    await renderOverview(<AnnouncementOverview baseUrl="/admin" />);
    assert.deepEqual(requests[0], {
      method: "GET",
      url: "/announcements/overview?page=1&limit=20",
    });
  });

  it("renders loading state", async () => {
    overviewState.isLoading = true;
    const {getByTestId} = await renderOverview(<AnnouncementOverview baseUrl="/admin" />);
    assert.exists(getByTestId("announcement-overview-loading"));
  });

  it("renders error state", async () => {
    overviewState.error = true;
    const {getByTestId} = await renderOverview(<AnnouncementOverview baseUrl="/admin" />);
    assert.exists(getByTestId("announcement-overview-error"));
  });

  it("renders summary cards and table rows with metrics", async () => {
    overviewState.data = {
      data: [
        {
          _id: "a1",
          acknowledgementPolicy: "required",
          audienceType: "staff",
          displayMode: "modal",
          metrics: {acknowledgements: 4, clicks: 2, impressions: 10},
          status: "published",
          title: "Launch note",
        },
      ],
      limit: 20,
      more: false,
      page: 1,
      total: 1,
      totals: {
        acknowledgements: 4,
        announcements: 1,
        archived: 0,
        clicks: 2,
        draft: 0,
        impressions: 10,
        published: 1,
      },
    };

    const onEdit = mock((_id: string) => {});
    const {getByTestId, getByText} = await renderOverview(
      <AnnouncementOverview baseUrl="/admin" onEdit={onEdit} />
    );

    assert.exists(getByTestId("announcement-overview-summary"));
    assert.exists(getByTestId("announcement-overview-stat-impressions"));
    assert.exists(getByTestId("announcement-overview-stat-acknowledgements"));
    assert.exists(getByTestId("announcement-overview-stat-clicks"));
    assert.exists(getByText("Launch note"));
  });

  it("invokes create and edit callbacks", async () => {
    overviewState.data = {
      data: [
        {
          _id: "a1",
          acknowledgementPolicy: "required",
          audienceType: "staff",
          displayMode: "modal",
          metrics: {acknowledgements: 0, clicks: 0, impressions: 0},
          status: "draft",
          title: "Draft note",
        },
      ],
      limit: 20,
      more: false,
      page: 1,
      total: 1,
      totals: {
        acknowledgements: 0,
        announcements: 1,
        archived: 0,
        clicks: 0,
        draft: 1,
        impressions: 0,
        published: 0,
      },
    };

    const onCreate = mock(() => {});
    const onEdit = mock((_id: string) => {});
    const {getByTestId, UNSAFE_root} = await renderOverview(
      <AnnouncementOverview baseUrl="/admin" onCreate={onCreate} onEdit={onEdit} />
    );

    await press(getByTestId("announcement-overview-create-button"));
    assert.strictEqual(onCreate.mock.calls.length, 1);

    const editButtons = UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props?.accessibilityLabel === "Edit announcement"
    );
    assert.isAtLeast(editButtons.length, 1);
    await act(async () => {
      (editButtons[0] as ReactTestInstance).props.onClick?.();
      await new Promise((r) => setTimeout(r, 50));
    });
    assert.strictEqual(onEdit.mock.calls.length, 1);
    assert.strictEqual(onEdit.mock.calls[0]?.[0], "a1");
  });

  it("omits the actions column when onEdit is not provided", async () => {
    overviewState.data = {
      data: [
        {
          _id: "a1",
          acknowledgementPolicy: "required",
          audienceType: "staff",
          displayMode: "modal",
          metrics: {acknowledgements: 1, clicks: 1, impressions: 1},
          status: "published",
          title: "Read only",
        },
      ],
      limit: 20,
      more: false,
      page: 1,
      total: 1,
      totals: {
        acknowledgements: 1,
        announcements: 1,
        archived: 0,
        clicks: 1,
        draft: 0,
        impressions: 1,
        published: 1,
      },
    };

    const {UNSAFE_root} = await renderOverview(<AnnouncementOverview baseUrl="/admin" />);
    const editButtons = UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props?.accessibilityLabel === "Edit announcement"
    );
    assert.lengthOf(editButtons, 0);
  });

  it("invokes quick-link callbacks and paginates the table", async () => {
    overviewState.data = {
      data: [
        {
          _id: "a1",
          acknowledgementPolicy: "required",
          audienceType: "staff",
          displayMode: "modal",
          metrics: {
            acknowledgements: Number.NaN,
            clicks: Number.POSITIVE_INFINITY,
            impressions: Number.NaN,
          },
          status: "published",
          title: "Metrics row",
        },
      ],
      limit: 20,
      more: true,
      page: 1,
      total: 40,
      totals: {
        acknowledgements: Number.NaN,
        announcements: 1,
        archived: 0,
        clicks: Number.NaN,
        draft: 0,
        impressions: Number.NaN,
        published: 1,
      },
    };

    const onOpenAcknowledgements = mock(() => {});
    const onOpenImpressions = mock(() => {});
    const onOpenClickEvents = mock(() => {});
    const {getByTestId, getByText, UNSAFE_root} = await renderOverview(
      <AnnouncementOverview
        baseUrl="/admin"
        onOpenAcknowledgements={onOpenAcknowledgements}
        onOpenClickEvents={onOpenClickEvents}
        onOpenImpressions={onOpenImpressions}
      />
    );

    assert.exists(getByText("Metrics row"));

    await press(getByTestId("announcement-overview-link-acknowledgements"));
    await press(getByTestId("announcement-overview-link-impressions"));
    await press(getByTestId("announcement-overview-link-clicks"));
    assert.strictEqual(onOpenAcknowledgements.mock.calls.length, 1);
    assert.strictEqual(onOpenImpressions.mock.calls.length, 1);
    assert.strictEqual(onOpenClickEvents.mock.calls.length, 1);

    const tables = UNSAFE_root.findAll(
      (node: ReactTestInstance) => typeof node.props?.setPage === "function"
    );
    assert.isAtLeast(tables.length, 1);
    await act(async () => {
      (tables[0] as ReactTestInstance).props.setPage(2);
      await new Promise((r) => setTimeout(r, 10));
    });
    assert.strictEqual((tables[0] as ReactTestInstance).props.page, 2);
  });

  it("does not refetch when rerendered with the same page", async () => {
    const view = await renderOverview(<AnnouncementOverview baseUrl="/admin" />);
    requests.length = 0;
    view.rerender(
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <AnnouncementOverview baseUrl="/admin" />
      </AdminProvider>
    );
    await flush();
    assert.lengthOf(requests, 0);
  });

  it("renders empty state when overview has no rows", async () => {
    overviewState.data = {
      data: [],
      limit: 20,
      more: false,
      page: 1,
      total: 0,
      totals: {
        acknowledgements: 0,
        announcements: 0,
        archived: 0,
        clicks: 0,
        draft: 0,
        impressions: 0,
        published: 0,
      },
    };

    const {getByTestId} = await renderOverview(<AnnouncementOverview baseUrl="/admin" />);
    assert.exists(getByTestId("announcement-overview-empty"));
  });
});
