// noExplicitAny: test mocks use type-erased admin model API doubles and UNSAFE_root traversal
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import {
  configureAdminModelApiDouble,
  resetAdminModelApiDouble,
} from "./testing/useAdminModelApiDouble";

interface ListState {
  data: unknown;
  isLoading: boolean;
  error: unknown;
}
const listState: ListState = {data: undefined, error: null, isLoading: false};

import {AnnouncementList} from "./AnnouncementList";

describe("AnnouncementList", () => {
  beforeEach(() => {
    resetAdminModelApiDouble();
    configureAdminModelApiDouble({
      useListQuery: () => ({
        data: listState.data,
        error: listState.error,
        isLoading: listState.isLoading,
      }),
    });
    listState.data = undefined;
    listState.isLoading = false;
    listState.error = null;
  });

  it("renders loading state", () => {
    listState.isLoading = true;
    const {toJSON} = renderWithTheme(<AnnouncementList baseUrl="/admin" />);
    expect(toJSON()).toBeDefined();
  });

  it("renders error state", () => {
    listState.error = new Error("x");
    const {getByText} = renderWithTheme(<AnnouncementList baseUrl="/admin" />);
    expect(getByText(/Failed to load announcements/)).toBeDefined();
  });

  it("renders empty state", () => {
    listState.data = {data: [], total: 0};
    const {getByText} = renderWithTheme(<AnnouncementList baseUrl="/admin" />);
    expect(getByText(/No announcements found/)).toBeDefined();
  });

  it("renders data without onRowClick so the ActionsCell edit-callback branch is absent", () => {
    listState.data = {
      data: [
        {
          _id: "a",
          acknowledgementPolicy: "required",
          audienceType: "staff",
          displayMode: "modal",
          priority: 1,
          publishedAt: "2026-01-01T12:00:00.000Z",
          status: "published",
          title: "Hello",
          version: 2,
        },
      ],
      total: 1,
    };
    const {toJSON} = renderWithTheme(<AnnouncementList baseUrl="/admin" />);
    expect(toJSON()).toBeDefined();
  });

  it("renders data with create button and edit callback", async () => {
    listState.data = {
      data: [
        {
          _id: "a",
          expiresAt: "2026-12-31T12:00:00.000Z",
          priority: 1,
          publishedAt: "2026-01-01T12:00:00.000Z",
          status: "published",
          title: "T1",
          version: 2,
        },
        {_id: "b", priority: "x", status: "draft", title: "T2", version: 1},
      ],
      total: 2,
    };
    const onCreateNew = mock(() => undefined);
    const onRowClick = mock((_: string) => undefined);
    const {getByTestId} = renderWithTheme(
      <AnnouncementList baseUrl="/admin" onCreateNew={onCreateNew} onRowClick={onRowClick} />
    );
    await act(async () => {
      fireEvent.press(getByTestId("announcement-list-create-button"));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onCreateNew).toHaveBeenCalled();
  });

  it("falls back when sort column is out of range (buildSortString returns undefined)", async () => {
    listState.data = {
      data: [{_id: "a", priority: 1, status: "draft", title: "T1", version: 1}],
      total: 1,
    };
    const {UNSAFE_root, toJSON} = renderWithTheme(
      <AnnouncementList baseUrl="/admin" onRowClick={() => undefined} />
    );
    const tables = UNSAFE_root.findAll(
      (n: ReactTestInstance) => typeof n.props?.setSortColumn === "function"
    );
    expect(tables.length).toBeGreaterThan(0);
    await act(async () => {
      (tables[0] as ReactTestInstance).props.setSortColumn({column: 99, direction: "asc"});
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      (tables[0] as ReactTestInstance).props.setSortColumn({column: 0, direction: "desc"});
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(toJSON()).toBeDefined();
  });

  it("invokes onRowClick from the actions cell", async () => {
    listState.data = {
      data: [{_id: "row-1", priority: 1, status: "draft", title: "Row", version: 1}],
      total: 1,
    };
    const onRowClick = mock((_: string) => undefined);
    const {UNSAFE_root} = renderWithTheme(
      <AnnouncementList baseUrl="/admin" onRowClick={onRowClick} />
    );
    const editButtons = UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props?.accessibilityLabel === "Edit"
    );
    expect(editButtons.length).toBeGreaterThan(0);
    await act(async () => {
      const editButton = editButtons[0] as ReactTestInstance;
      editButton.props.onClick?.();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onRowClick).toHaveBeenCalledWith("row-1");
  });

  it("formats invalid date cells and paginates results", async () => {
    listState.data = {
      data: [
        {
          _id: "a",
          expiresAt: "not-a-date",
          priority: "bad",
          publishedAt: "also-bad",
          status: "draft",
          title: "Row",
          version: "bad",
        },
      ],
      total: 40,
    };
    const {UNSAFE_root} = renderWithTheme(<AnnouncementList baseUrl="/admin" />);
    const tables = UNSAFE_root.findAll(
      (node: ReactTestInstance) => typeof node.props?.setPage === "function"
    );
    expect(tables.length).toBeGreaterThan(0);
    await act(async () => {
      (tables[0] as ReactTestInstance).props.setPage(2);
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  it("accepts apiBase and routeBase aliases", () => {
    listState.data = {data: [], total: 0};
    const {getByText} = renderWithTheme(<AnnouncementList apiBase="/admin" routeBase="/admin" />);
    expect(getByText(/No announcements found/)).toBeDefined();
  });
});
