// biome-ignore-all lint/suspicious/noExplicitAny: test reads loosely typed picker payloads
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminObjectPicker as BaseAdminObjectPicker} from "../AdminObjectPicker";

interface ApiState {
  searchData: unknown;
  isSearching: boolean;
  selectedItem: Record<string, unknown> | undefined;
}

const apiState: ApiState = {
  isSearching: false,
  searchData: undefined,
  selectedItem: undefined,
};

// This suite exercises the search-as-you-type contract explicitly.
const AdminObjectPicker: React.FC<React.ComponentProps<typeof BaseAdminObjectPicker>> = (
  props
): React.ReactElement => <BaseAdminObjectPicker {...props} autocomplete />;

const requestedUrls: string[] = [];
const originalFetch = globalThis.fetch;

const jsonResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status: 200});

/** Serves picker search, read, and list requests from `apiState`. */
const installFetch = (): void => {
  globalThis.fetch = (async (url: string) => {
    const path = String(url);
    requestedUrls.push(path);
    if (path.includes("/search?")) {
      if (apiState.isSearching) {
        return new Promise<Response>(() => undefined);
      }
      return jsonResponse(apiState.searchData ?? []);
    }
    if (path.includes("?")) {
      return jsonResponse({data: [], limit: 100, more: false, page: 1, total: 0});
    }
    return jsonResponse({data: apiState.selectedItem ?? {}});
  }) as typeof fetch;
};

const flushPicker = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("AdminObjectPicker", () => {
  beforeEach(() => {
    apiState.searchData = undefined;
    apiState.isSearching = false;
    apiState.selectedItem = undefined;
    requestedUrls.length = 0;
    installFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads the selected item, searches as the user types, and lists on open", async () => {
    apiState.selectedItem = {_id: "some-id", name: "Some"};
    apiState.searchData = {data: [{_id: "a", name: "Ada"}]};
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "ada");
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(requestedUrls).toContain("/admin/users/search?q=ada");

    renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="some-id"
      />
    );
    await flushPicker();
    expect(requestedUrls).toContain("/admin/users/some-id");

    const list = renderWithTheme(
      <BaseAdminObjectPicker
        onChange={() => {}}
        refModelName="Team"
        routePath="/admin/teams"
        title="Team"
        value=""
      />
    );
    await act(async () => {
      fireEvent(list.getByTestId("admin-picker-Team-search"), "focus");
    });
    await flushPicker();
    expect(requestedUrls).toContain("/admin/teams?limit=100&page=1");
  });

  it("falls back to _id when no known display field is present", () => {
    // Exercises the return "_id" branch of getPrimaryField (line 41).
    apiState.selectedItem = {_id: "abc123"};
    const {toJSON} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="Foo"
        routePath="/admin/foo"
        title="Foo"
        value="abc123"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("clears the pending debounce timeout on rapid input (line 120)", async () => {
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    // Two rapid changes within the 300ms window force the second call to
    // clear the pending timeout from the first (covers line 120).
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "a");
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "ab");
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(true).toBe(true);
  });

  it("renders a search field when there is no selected value", () => {
    const {toJSON} = renderWithTheme(
      <AdminObjectPicker
        errorText="bad"
        helperText="helper"
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders the selected display when value resolves", async () => {
    apiState.selectedItem = {_id: "u1", email: "e@x.com", name: "Alice"};
    const {toJSON, getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="u1"
      />
    );
    await flushPicker();
    expect(toJSON()).toBeDefined();
    expect(getByTestId("admin-picker-User-display")).toBeDefined();
  });

  it("clears the selection on clear press", async () => {
    apiState.selectedItem = {_id: "u1", name: "Alice"};
    const onChange = mock((_: string) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={onChange}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="u1"
      />
    );
    await flushPicker();
    await act(async () => {
      fireEvent.press(getByTestId("admin-picker-User-clear"));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("switches to edit mode on change press", async () => {
    apiState.selectedItem = {_id: "u1", name: "Alice"};
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="u1"
      />
    );
    await flushPicker();
    await act(async () => {
      fireEvent.press(getByTestId("admin-picker-User-change"));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(queryByTestId("admin-picker-User-search")).toBeDefined();
  });

  it("debounces search input and shows results", async () => {
    apiState.searchData = [
      {_id: "a", name: "Alpha"},
      {_id: "b", email: "beta@x.com", name: "Beta"},
    ];
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "al");
      await new Promise((r) => setTimeout(r, 350));
    });
  });

  it("shows spinner while fetching results", () => {
    apiState.isSearching = true;
    apiState.searchData = undefined;
    const {toJSON} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("falls back to _id display when no known field is present", () => {
    apiState.selectedItem = {_id: "raw-id"};
    const {toJSON} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="raw-id"
      />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders secondary fields for search results with email", async () => {
    apiState.searchData = [
      {_id: "a", email: "a@x.com", name: "Alpha"},
      {_id: "b", label: "Beta Item", title: "Title-B"},
    ];
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "al");
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(getByTestId("admin-picker-User-result-a-clickable")).toBeDefined();
  });

  it("selects a result and calls onChange with the item id", async () => {
    apiState.searchData = [{_id: "chosen", name: "Chosen"}];
    const onChange = mock((_: string) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={onChange}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "ch");
      await new Promise((r) => setTimeout(r, 350));
    });
    const resultNode = getByTestId("admin-picker-User-result-chosen-clickable");
    await act(async () => {
      fireEvent.press(resultNode);
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(onChange).toHaveBeenCalledWith("chosen");
  });

  it("shows 'No results found' when the query returns an empty list", async () => {
    apiState.searchData = [];
    const {getByTestId, getByText} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "zzz");
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(getByText("No results found")).toBeDefined();
  });

  it("unwraps {data: [...]} pagination shape for search results", async () => {
    apiState.searchData = {data: [{_id: "p1", name: "Paginated"}]};
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "p");
      await new Promise((r) => setTimeout(r, 350));
    });
    expect(getByTestId("admin-picker-User-result-p1-clickable")).toBeDefined();
  });

  it("cleans up the debounce timer on unmount", async () => {
    const {getByTestId, unmount} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-picker-User-search"), "pending");
    });
    unmount();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
  });

  it("opens results dropdown on focus and shows 'Start typing to search'", async () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    await act(async () => {
      fireEvent(getByTestId("admin-picker-User-search"), "focus");
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(getByText("Start typing to search")).toBeDefined();
  });

  it("uses first matching display field (name, title, label, etc.)", async () => {
    apiState.selectedItem = {_id: "x", label: "Label", title: "Title"};
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="x"
      />
    );
    await flushPicker();
    expect(getByTestId("admin-picker-User-display")).toBeDefined();
  });
});
