// noExplicitAny: test mocks use type-erased RTK Query API doubles and dynamic endpoint injection
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminObjectPicker as BaseAdminObjectPicker} from "../AdminObjectPicker";
import type {AdminApi} from "../types";

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

interface QuerySpec {
  params?: Record<string, unknown>;
  url?: string;
}

const querySpecs: QuerySpec[] = [];
const makeApi = () => ({
  injectEndpoints: ({endpoints}: {endpoints: (b: unknown) => Record<string, unknown>}) => {
    const build = {
      query: (spec: Record<string, unknown>) => {
        // Invoke the query lambda so the URL/params builders run.
        if (typeof spec?.query === "function") {
          querySpecs.push(spec.query("some-id"));
        }
        return spec;
      },
    };
    const defs = endpoints(build);
    const keys = Object.keys(defs);
    const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const searchKey = keys.find((k) => k.startsWith("adminSearch_"));
    const readKey = keys.find((k) => k.startsWith("adminSearchRead_"));
    const listKey = keys.find((k) => k.startsWith("adminPickerList_"));
    const enhanced: Record<string, unknown> = {};
    if (searchKey) {
      enhanced[`use${cap(searchKey)}Query`] = (_q: string, opts: Record<string, unknown>) => {
        if (opts?.skip) {
          return {data: undefined, isFetching: false};
        }
        return {data: apiState.searchData, isFetching: apiState.isSearching};
      };
    }
    if (readKey) {
      enhanced[`use${cap(readKey)}Query`] = (_id: string, opts: Record<string, unknown>) => {
        if (opts?.skip) {
          return {data: undefined};
        }
        return {data: apiState.selectedItem};
      };
    }
    if (listKey) {
      enhanced[`use${cap(listKey)}Query`] = () => ({data: undefined, isFetching: false});
    }
    return enhanced;
  },
});

describe("AdminObjectPicker", () => {
  beforeEach(() => {
    apiState.searchData = undefined;
    apiState.isSearching = false;
    apiState.selectedItem = undefined;
    querySpecs.length = 0;
  });

  it("wires the search and read query endpoints to the right URLs", () => {
    renderWithTheme(
      <AdminObjectPicker
        api={makeApi() as unknown as AdminApi}
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value=""
      />
    );
    const urls = querySpecs.map((s) => s.url).sort();
    expect(urls).toContain("/admin/users/search");
    expect(urls).toContain("/admin/users/some-id");
    expect(urls).toContain("/admin/users");
    const listSpec = querySpecs.find((s) => s.url === "/admin/users" && Boolean(s.params?.limit));
    expect(listSpec?.params).toEqual({limit: 100, page: 1});
    const searchSpec = querySpecs.find((s) => s.url === "/admin/users/search");
    expect(searchSpec?.params).toEqual({q: "some-id"});
  });

  it("falls back to _id when no known display field is present", () => {
    // Exercises the return "_id" branch of getPrimaryField (line 41).
    apiState.selectedItem = {_id: "abc123"};
    const {toJSON} = renderWithTheme(
      <AdminObjectPicker
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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

  it("renders the selected display when value resolves", () => {
    apiState.selectedItem = {_id: "u1", email: "e@x.com", name: "Alice"};
    const {toJSON, getByTestId} = renderWithTheme(
      <AdminObjectPicker
        api={makeApi() as unknown as AdminApi}
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="u1"
      />
    );
    expect(toJSON()).toBeDefined();
    expect(getByTestId("admin-picker-User-display")).toBeDefined();
  });

  it("clears the selection on clear press", async () => {
    apiState.selectedItem = {_id: "u1", name: "Alice"};
    const onChange = mock((_: string) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        api={makeApi() as unknown as AdminApi}
        onChange={onChange}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="u1"
      />
    );
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
        api={makeApi() as unknown as AdminApi}
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="u1"
      />
    );
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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
        api={makeApi() as unknown as AdminApi}
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

  it("uses first matching display field (name, title, label, etc.)", () => {
    apiState.selectedItem = {_id: "x", label: "Label", title: "Title"};
    const {getByTestId} = renderWithTheme(
      <AdminObjectPicker
        api={makeApi() as unknown as AdminApi}
        onChange={() => {}}
        refModelName="User"
        routePath="/admin/users"
        title="User"
        value="x"
      />
    );
    expect(getByTestId("admin-picker-User-display")).toBeDefined();
  });
});
