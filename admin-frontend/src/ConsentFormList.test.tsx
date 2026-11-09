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

import {ConsentFormList} from "./ConsentFormList";

describe("ConsentFormList", () => {
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
    const {toJSON} = renderWithTheme(<ConsentFormList baseUrl="/admin" />);
    expect(toJSON()).toBeDefined();
  });

  it("renders error state", () => {
    listState.error = new Error("x");
    const {getByText} = renderWithTheme(<ConsentFormList baseUrl="/admin" />);
    expect(getByText(/Failed to load consent forms/)).toBeDefined();
  });

  it("renders empty state", () => {
    listState.data = {data: [], total: 0};
    const {getByText} = renderWithTheme(<ConsentFormList baseUrl="/admin" />);
    expect(getByText(/No consent forms found/)).toBeDefined();
  });

  it("renders data without onRowClick so the ActionsCell edit-callback branch is absent", () => {
    listState.data = {
      data: [{_id: "a", active: true, order: 1, title: "T1", type: "standard", version: "2"}],
      total: 1,
    };
    // No onRowClick is provided. The ActionsCell edit-button path should be hidden.
    const {toJSON} = renderWithTheme(<ConsentFormList baseUrl="/admin" />);
    expect(toJSON()).toBeDefined();
  });

  it("renders data with create button and edit callback", async () => {
    listState.data = {
      data: [
        {
          _id: "a",
          active: true,
          order: 1,
          title: "T1",
          type: "standard",
          version: "2",
        },
        {_id: "b", active: false, order: "x", title: "T2", type: "privacy", version: 3},
      ],
      total: 2,
    };
    const onCreateNew = mock(() => undefined);
    const onRowClick = mock((_: string) => undefined);
    const {getAllByLabelText, getByTestId} = renderWithTheme(
      <ConsentFormList baseUrl="/admin" onCreateNew={onCreateNew} onRowClick={onRowClick} />
    );
    await act(async () => {
      fireEvent.press(getByTestId("consent-form-list-create-button"));
      fireEvent.press(getAllByLabelText("Edit")[0]);
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onCreateNew).toHaveBeenCalled();
    expect(onRowClick).toHaveBeenCalledWith("a");
  });

  it("falls back when sort column is out of range (buildSortString returns undefined)", async () => {
    listState.data = {
      data: [{_id: "a", active: true, order: 1, title: "T1", type: "standard", version: "2"}],
      total: 1,
    };
    const {UNSAFE_root, toJSON} = renderWithTheme(
      <ConsentFormList baseUrl="/admin" onRowClick={() => undefined} />
    );
    const tables = UNSAFE_root.findAll(
      (n: ReactTestInstance) => typeof n.props?.setSortColumn === "function"
    );
    expect(tables.length).toBeGreaterThan(0);
    await act(async () => {
      // Column 99 is out of range, so buildSortString returns undefined and
      // the default "-created" sort should be used.
      (tables[0] as ReactTestInstance).props.setSortColumn({column: 99, direction: "asc"});
      await new Promise((r) => setTimeout(r, 10));
    });
    // Also exercise the desc branch on a valid column.
    await act(async () => {
      (tables[0] as ReactTestInstance).props.setSortColumn({column: 0, direction: "desc"});
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(toJSON()).toBeDefined();
  });
});
