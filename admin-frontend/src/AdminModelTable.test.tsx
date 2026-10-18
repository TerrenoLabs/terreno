// noExplicitAny: test mocks use loosely typed hook doubles and UNSAFE_root traversal
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import {ADMIN_SEARCH_DEBOUNCE_MS} from "./Constants";
import {
  configureAdminModelApiDouble,
  resetAdminModelApiDouble,
} from "./testing/useAdminModelApiDouble";
import type {AdminConfigResponse} from "./types";

const routerPush = mock(() => {});
const setOptions = mock((_: unknown) => {});
mock.module("expo-router", () => ({
  router: {push: routerPush},
  useNavigation: () => ({setOptions}),
}));

const configState: {config: AdminConfigResponse | null; isLoading: boolean} = {
  config: null,
  isLoading: false,
};
// Records the apiBase passed to useAdminConfig so tests can assert that data
// fetching uses the resolved API base (not the route base).
const configApiBaseCalls: string[] = [];
mock.module("./useAdminConfig", () => ({
  useAdminConfig: (apiBase: string) => {
    configApiBaseCalls.push(apiBase);
    return {
      config: configState.config,
      error: null,
      isLoading: configState.isLoading,
    };
  },
}));

const listState: {data: unknown; isLoading: boolean} = {
  data: {data: [], total: 0},
  isLoading: false,
};
const listQueryArgs: unknown[] = [];
const deleteFn = mock(() => ({unwrap: async () => ({})}));
const patchFn = mock(() => ({unwrap: async () => ({})}));
const bulkPatchFn = mock(() => ({unwrap: async () => ({updated: 0})}));
const enqueueBackgroundFn = mock(() => ({unwrap: async () => ({taskId: "t1"})}));

mock.module("./useAdminBackgroundTask", () => ({
  useAdminBackgroundTaskMutation: () => [enqueueBackgroundFn, {isLoading: false}],
}));

import {AdminModelTable} from "./AdminModelTable";

const fullConfig = {
  customScreens: [],
  models: [
    {
      defaultSort: "-created",
      displayName: "User",
      fields: {
        _id: {required: true, type: "string"},
        active: {required: false, type: "boolean"},
        age: {required: false, type: "number"},
        created: {required: false, type: "date"},
        email: {required: false, type: "string"},
        tags: {required: false, type: "array"},
      },
      listFields: ["email", "active", "age", "created", "tags"],
      name: "User",
      routePath: "/admin/users",
    },
  ],
  scripts: [],
};

const interactiveListRows = [
  {_id: "u1", active: false, age: 1, created: null, email: "a@b.com", tags: []},
  {_id: "u2", active: true, age: 2, created: null, email: "c@d.com", tags: []},
];

const interactiveConfig: AdminConfigResponse = {
  customScreens: [],
  models: [
    {
      ...fullConfig.models[0],
      actions: [
        {id: "activate", label: "Activate", patchKeys: ["active"]},
        {background: true, id: "reindex", label: "Reindex"},
        {id: "noop", label: "No handler"},
      ],
      filters: [{field: "active", kind: "boolean", label: "Active"}],
      listDisplayLinks: ["email"],
      searchFields: ["email"],
    },
  ],
  scripts: [],
};

const findDataTable = (root: ReactTestInstance): ReactTestInstance => {
  const tables = root.findAll(
    (n: ReactTestInstance) => typeof n.props?.setPage === "function" && Array.isArray(n.props?.data)
  );
  assert.isAtLeast(tables.length, 1);
  return tables[0] as ReactTestInstance;
};

const expectSelectionCount = (
  getByTestId: (id: string) => ReactTestInstance,
  count: number
): void => {
  const node = getByTestId("admin-table-selection-count");
  const renderedCount = Array.isArray(node.props.children)
    ? node.props.children[0]
    : node.props.children;
  assert.equal(renderedCount, count);
};

describe("AdminModelTable", () => {
  let consoleInfoSpy: ReturnType<typeof mock>;
  let consoleWarnSpy: ReturnType<typeof mock>;
  let consoleErrorSpy: ReturnType<typeof mock>;
  const originalConsoleInfo = console.info;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  beforeEach(() => {
    resetAdminModelApiDouble();
    configureAdminModelApiDouble({
      useBulkPatchMutation: () => [bulkPatchFn, {isLoading: false}],
      useCreateMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
      useDeleteMutation: () => [deleteFn, {isLoading: false}],
      useListQuery: (params: unknown) => {
        listQueryArgs.push(params);
        return {
          data: listState.data,
          error: null,
          isLoading: listState.isLoading,
          refetch: async () => ({data: listState.data}),
        };
      },
      useReadQuery: () => ({data: null, error: null, isLoading: false}),
      useUpdateMutation: () => [patchFn, {isLoading: false}],
    });
    routerPush.mockClear();
    setOptions.mockClear();
    deleteFn.mockClear();
    patchFn.mockClear();
    bulkPatchFn.mockClear();
    enqueueBackgroundFn.mockClear();
    listQueryArgs.length = 0;
    configApiBaseCalls.length = 0;
    configState.config = null;
    configState.isLoading = false;
    listState.data = {data: [], total: 0};
    listState.isLoading = false;
    patchFn.mockImplementation(() => ({unwrap: async () => ({})}));
    bulkPatchFn.mockImplementation(() => ({unwrap: async () => ({updated: 0})}));
    enqueueBackgroundFn.mockImplementation(() => ({unwrap: async () => ({taskId: "t1"})}));
    consoleInfoSpy = mock(() => {});
    consoleWarnSpy = mock(() => {});
    consoleErrorSpy = mock(() => {});
    console.info = consoleInfoSpy as typeof console.info;
    console.warn = consoleWarnSpy as typeof console.warn;
    console.error = consoleErrorSpy as typeof console.error;
  });

  afterEach(() => {
    console.info = originalConsoleInfo;
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
  });

  it("renders loading page while config is loading", () => {
    configState.isLoading = true;
    const {toJSON} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    expect(toJSON()).toBeDefined();
  });

  it("renders loading page when model config is missing", () => {
    configState.config = {customScreens: [], models: [], scripts: []};
    const {toJSON} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    expect(toJSON()).toBeDefined();
  });

  it("keeps search and filters available when a query returns no rows", () => {
    configState.config = {
      ...fullConfig,
      models: [
        {
          ...fullConfig.models[0],
          filters: [{field: "active", kind: "boolean" as const}],
          searchFields: ["email"],
        },
      ],
    };
    const {getByTestId, getByText} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );
    expect(getByTestId("data-table-search")).toBeTruthy();
    expect(getByTestId("data-table-filters-trigger")).toBeTruthy();
    expect(getByText("No items found.")).toBeTruthy();
    expect(setOptions).toHaveBeenCalled();
  });

  it("keeps declared filters available when their fields are not table columns", async () => {
    configState.config = {
      ...fullConfig,
      models: [
        {
          ...fullConfig.models[0],
          filters: [{field: "active", kind: "boolean" as const}],
          listFields: ["email"],
        },
      ],
    };
    const {getByTestId} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);

    await act(async () => {
      fireEvent.press(getByTestId("data-table-filters-trigger"));
    });
    expect(getByTestId("data-table-filter-active.switch")).toBeTruthy();
  });

  it("maps reference filters into DataTable additional filters", () => {
    configState.config = {
      ...fullConfig,
      models: [
        {
          ...fullConfig.models[0],
          fields: {
            ...fullConfig.models[0].fields,
            ownerId: {ref: "Group", required: false, type: "objectid"},
          },
          filters: [{field: "ownerId", kind: "ref" as const, refModel: "Group"}],
          listFields: ["email"],
        },
        {
          displayName: "Groups",
          fields: {},
          listFields: ["name"],
          name: "Group",
          routePath: "/admin/groups",
        },
      ],
    };
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    const [refFilter] = findDataTable(UNSAFE_root).props.additionalFilters;
    const onChange = mock(() => {});
    const rendered = refFilter.renderFilter({
      field: "ownerId",
      onChange,
      value: "group-1",
    }) as React.ReactElement<{
      onChange: (next: string) => void;
      routePath: string;
    }>;

    assert.equal(rendered.props.routePath, "/admin/groups");
    rendered.props.onChange("group-2");
    assert.equal(onChange.mock.calls[0]?.[0], "group-2");
  });

  it("renders loading state when the list query is loading", () => {
    configState.config = fullConfig;
    listState.isLoading = true;
    const {toJSON} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    expect(toJSON()).toBeDefined();
  });

  it("renders data with various column types and formats values", () => {
    configState.config = fullConfig;
    listState.data = {
      data: [
        {
          _id: "u1",
          active: true,
          age: 42,
          created: "2024-01-01T00:00:00Z",
          email: "a@b.com",
          tags: ["x", "y"],
        },
        {
          _id: "u2",
          active: false,
          age: null,
          created: null,
          email: "c@d.com",
          tags: {_id: "nested", other: "value"},
        },
      ],
      total: 2,
    };
    const {toJSON} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    expect(toJSON()).toBeDefined();
  });

  it("supports custom column overrides", () => {
    configState.config = fullConfig;
    listState.data = {
      data: [{_id: "u1", email: "a@b.com"}],
      total: 1,
    };
    const {toJSON} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" columns={["email"]} modelName="User" />
    );
    expect(toJSON()).toBeDefined();
  });

  it("treats DATE_FIELD_NAMES without explicit type as date columns and widens _id", () => {
    // "created" and "updated" should be recognized as date fields even without an
    // explicit fieldConfig.type of "date"; "_id" should use the wider column width.
    configState.config = {
      customScreens: [],
      models: [
        {
          defaultSort: undefined,
          displayName: "Plain",
          fields: {
            _id: {required: true, type: "string"},
            // Intentionally mark created/updated as "string" so the DATE_FIELD_NAMES
            // branch (line 49) must be the branch that classifies them as "date".
            created: {required: false, type: "string"},
            name: {required: false, type: "string"},
            updated: {required: false, type: "string"},
          },
          listFields: ["_id", "name", "created", "updated"],
          name: "Plain",
          routePath: "/admin/plain",
        },
      ],
      scripts: [],
    };
    listState.data = {
      data: [
        {
          _id: "p1",
          created: "2024-01-02T00:00:00Z",
          name: "thing",
          updated: "2024-02-03T00:00:00Z",
        },
      ],
      total: 1,
    };
    const {toJSON} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="Plain" />);
    expect(toJSON()).toBeDefined();
  });

  it("renders the in-page create button and pushes to the create route on click", async () => {
    configState.config = fullConfig;
    const table = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    await act(async () => {
      fireEvent.press(table.getByTestId("admin-create-button"));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(routerPush).toHaveBeenCalledWith("/admin/User/create");
  });

  it("handles delete errors without throwing via the actions cell", async () => {
    configState.config = fullConfig;
    listState.data = {
      data: [{_id: "u1", active: true, age: 1, created: null, email: "a@b.com", tags: []}],
      total: 1,
    };
    // Force delete to fail so the catch branch runs.
    deleteFn.mockImplementationOnce(() => ({
      unwrap: async () => {
        throw new Error("nope");
      },
    }));
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    // Find the actions cellData.onDelete handler and invoke it directly.
    const nodes = UNSAFE_root.findAll((n: ReactTestInstance) => {
      const v = n.props?.cellData?.value;
      return v && typeof v.onDelete === "function" && v.id === "u1";
    });
    expect(nodes.length).toBeGreaterThan(0);
    await act(async () => {
      (nodes[0] as ReactTestInstance).props.cellData.value.onDelete("u1");
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(deleteFn).toHaveBeenCalled();
  });

  it("applies columnWidths prop overrides to DataTable columns", () => {
    configState.config = fullConfig;
    listState.data = {data: [{_id: "u1", email: "a@b.com"}], total: 1};
    const {UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" columnWidths={{email: 999}} modelName="User" />
    );
    const tables = UNSAFE_root.findAll((n: ReactTestInstance) => Array.isArray(n.props?.columns));
    expect(tables.length).toBeGreaterThan(0);
    const cols = (tables[0] as ReactTestInstance).props.columns as {
      title: string;
      width?: number;
    }[];
    const emailCol = cols.find((c) => c.title === "Email");
    expect(emailCol?.width).toBe(999);
  });

  it("falls back to listColumnWidths from backend config when columnWidths prop is absent", () => {
    configState.config = {
      customScreens: [],
      models: [
        {
          ...fullConfig.models[0],
          listColumnWidths: {email: 555},
        },
      ],
      scripts: [],
    };
    listState.data = {data: [{_id: "u1", email: "a@b.com"}], total: 1};
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    const tables = UNSAFE_root.findAll((n: ReactTestInstance) => Array.isArray(n.props?.columns));
    const cols = (tables[0] as ReactTestInstance).props.columns as {
      title: string;
      width?: number;
    }[];
    const emailCol = cols.find((c) => c.title === "Email");
    expect(emailCol?.width).toBe(555);
  });

  it("prefers columnWidths prop over backend listColumnWidths", () => {
    configState.config = {
      customScreens: [],
      models: [
        {
          ...fullConfig.models[0],
          listColumnWidths: {email: 100},
        },
      ],
      scripts: [],
    };
    listState.data = {data: [{_id: "u1", email: "a@b.com"}], total: 1};
    const {UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" columnWidths={{email: 200}} modelName="User" />
    );
    const tables = UNSAFE_root.findAll((n: ReactTestInstance) => Array.isArray(n.props?.columns));
    const cols = (tables[0] as ReactTestInstance).props.columns as {
      title: string;
      width?: number;
    }[];
    const emailCol = cols.find((c) => c.title === "Email");
    expect(emailCol?.width).toBe(200);
  });

  it("builds a descending sort string and falls back when column is out of range", async () => {
    configState.config = fullConfig;
    // Render data so DataTable mounts; then capture the setSortColumn via a dummy
    // rendering. We instead verify the pure helper via a specially-crafted sort
    // that maps to an out-of-range column by using columns override with only one field.
    listState.data = {
      data: [{_id: "u1", email: "a@b.com"}],
      total: 1,
    };
    const {UNSAFE_root, toJSON} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" columns={["email"]} modelName="User" />
    );
    // Grab setSortColumn from the rendered DataTable and apply a sort with
    // direction "desc" on column 0 (valid) and then column 5 (out of range).
    const table = UNSAFE_root.findAll(
      (n: ReactTestInstance) => typeof n.props?.setSortColumn === "function"
    );
    expect(table.length).toBeGreaterThan(0);
    await act(async () => {
      (table[0] as ReactTestInstance).props.setSortColumn({column: 0, direction: "desc"});
      await new Promise((r) => setTimeout(r, 10));
    });
    await act(async () => {
      (table[0] as ReactTestInstance).props.setSortColumn({column: 99, direction: "asc"});
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(toJSON()).toBeDefined();
  });

  it("fetches config from apiBase but builds row href + create nav from routeBase when split", async () => {
    configState.config = fullConfig;
    listState.data = {data: [{_id: "u1", email: "a@b.com"}], total: 1};
    const {UNSAFE_root, getByTestId} = renderWithTheme(
      <AdminModelTable apiBase="/admin" modelName="User" routeBase="/console" />
    );
    // Data fetching must use the API base.
    expect(configApiBaseCalls).toContain("/admin");
    // The first cell's link href must use the route base.
    const tables = UNSAFE_root.findAll((n: ReactTestInstance) => Array.isArray(n.props?.data));
    expect(tables.length).toBeGreaterThan(0);
    const rows = (tables[0] as ReactTestInstance).props.data as {value: {href?: string}}[][];
    expect(rows[0][0].value.href).toBe("/console/User/u1");
    // The create button must navigate using the route base.
    await act(async () => {
      fireEvent.press(getByTestId("admin-create-button"));
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(routerPush).toHaveBeenCalledWith("/console/User/create");
  });

  it("uses baseUrl for both fetching and navigation (backward compat)", () => {
    configState.config = fullConfig;
    listState.data = {data: [{_id: "u1", email: "a@b.com"}], total: 1};
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    expect(configApiBaseCalls).toContain("/admin");
    const tables = UNSAFE_root.findAll((n: ReactTestInstance) => Array.isArray(n.props?.data));
    const rows = (tables[0] as ReactTestInstance).props.data as {value: {href?: string}}[][];
    expect(rows[0][0].value.href).toBe("/admin/User/u1");
  });

  it("hides create button when permissions.create is false", async () => {
    configState.config = {
      customScreens: [],
      models: [
        {
          ...fullConfig.models[0],
          permissions: {create: false},
        },
      ],
      scripts: [],
    };
    const table = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    expect(table.queryByTestId("admin-create-button")).toBeNull();
  });

  it("marks only sortableFields as sortable columns", () => {
    configState.config = {
      customScreens: [],
      models: [
        {
          ...fullConfig.models[0],
          listFields: ["email", "active"],
          sortableFields: ["email"],
        },
      ],
      scripts: [],
    };
    listState.data = {data: [{_id: "u1", active: true, email: "a@b.com"}], total: 1};
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    const tables = UNSAFE_root.findAll((n: ReactTestInstance) => Array.isArray(n.props?.columns));
    const cols = (tables[0] as ReactTestInstance).props.columns as {
      sortable?: boolean;
      title: string;
    }[];
    const emailCol = cols.find((c) => c.title === "Email");
    const activeCol = cols.find((c) => c.title === "Active");
    expect(emailCol?.sortable).toBe(true);
    expect(activeCol?.sortable).toBe(false);
  });

  it("renders search on DataTable and does not mount AdminFilterDrawer", () => {
    configState.config = {
      customScreens: [],
      models: [
        {
          ...fullConfig.models[0],
          filters: [{field: "active", kind: "boolean", label: "Active"}],
          searchFields: ["email"],
        },
      ],
      scripts: [],
    };
    listState.data = {data: [{_id: "u1", active: true, email: "a@b.com"}], total: 1};
    const {queryByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );
    expect(queryByTestId("admin-filter-drawer")).toBeNull();
    const tables = UNSAFE_root.findAll((n: ReactTestInstance) => Array.isArray(n.props?.columns));
    expect((tables[0] as ReactTestInstance).props.searchFields).toEqual(["email"]);
    expect(queryByTestId("data-table-search")).toBeTruthy();
  });

  it("uses pageSize from model config for pagination", () => {
    configState.config = {
      customScreens: [],
      models: [
        {
          ...fullConfig.models[0],
          pageSize: 50,
        },
      ],
      scripts: [],
    };
    listState.data = {data: [{_id: "u1", email: "a@b.com"}], total: 100};
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    const tables = UNSAFE_root.findAll(
      (n: ReactTestInstance) => typeof n.props?.totalPages === "number"
    );
    expect((tables[0] as ReactTestInstance).props.totalPages).toBe(2);
  });

  it("toggles row selection and select-all for bulk actions", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 2};
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-row-checkbox-u1"));
    });
    expectSelectionCount(getByTestId, 1);

    const tableAfterSelect = findDataTable(UNSAFE_root);
    const rowOneSelectCell = (
      tableAfterSelect.props.data as {value: {selected?: boolean}}[][]
    )[0][0];
    assert.isTrue(rowOneSelectCell.value.selected);

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-select-all"));
    });
    expectSelectionCount(getByTestId, 2);

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-select-all"));
    });
    expectSelectionCount(getByTestId, 0);
  });

  it("runs a background bulk action and clears selection on success", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 2};
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-row-checkbox-u1"));
      fireEvent.press(getByTestId("admin-table-row-checkbox-u2"));
    });

    const menus = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-action-menu"
    );
    await act(async () => {
      (menus[0] as ReactTestInstance).props.onChange("reindex");
      await new Promise((r) => setTimeout(r, 50));
    });

    assert.equal(enqueueBackgroundFn.mock.calls.length, 1);
    assert.deepEqual(enqueueBackgroundFn.mock.calls[0]?.[0], {
      ids: ["u1", "u2"],
      kind: "reindex",
      metadata: {actionId: "reindex"},
      resourceRoute: "/admin/users",
    });
    assert.isTrue(consoleInfoSpy.mock.calls.some((call) => call[0] === "Background task queued"));
    expectSelectionCount(getByTestId, 0);
  });

  it("runs a patch bulk action and toasts success when all rows update", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 2};
    bulkPatchFn.mockImplementationOnce(() => ({
      unwrap: async () => ({updated: 2}),
    }));
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-row-checkbox-u1"));
    });

    const menus = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-action-menu"
    );
    await act(async () => {
      (menus[0] as ReactTestInstance).props.onChange("activate");
      await new Promise((r) => setTimeout(r, 50));
    });

    assert.equal(bulkPatchFn.mock.calls.length, 1);
    assert.deepEqual(bulkPatchFn.mock.calls[0]?.[0], {
      ids: ["u1"],
      patch: {active: true},
    });
    assert.isTrue(consoleInfoSpy.mock.calls.some((call) => call[0] === "Bulk update applied"));
    expectSelectionCount(getByTestId, 0);
  });

  it("toasts partial failure when bulk patch returns failures", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 2};
    bulkPatchFn.mockImplementationOnce(() => ({
      unwrap: async () => ({
        failures: [{id: "u2", title: "Denied"}],
        updated: 1,
      }),
    }));
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-row-checkbox-u1"));
      fireEvent.press(getByTestId("admin-table-row-checkbox-u2"));
    });

    const menus = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-action-menu"
    );
    await act(async () => {
      (menus[0] as ReactTestInstance).props.onChange("activate");
      await new Promise((r) => setTimeout(r, 50));
    });

    assert.isTrue(
      consoleErrorSpy.mock.calls.some((call) => String(call[0]).includes("Updated 1; 1 failed"))
    );
    expectSelectionCount(getByTestId, 2);
  });

  it("warns when a bulk action has no handler configured", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 2};
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-row-checkbox-u1"));
    });

    const menus = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-action-menu"
    );
    await act(async () => {
      (menus[0] as ReactTestInstance).props.onChange("noop");
      await new Promise((r) => setTimeout(r, 50));
    });

    assert.isTrue(
      consoleWarnSpy.mock.calls.some((call) =>
        String(call[0]).includes("This action has no bulk handler configured.")
      )
    );
    expectSelectionCount(getByTestId, 0);
  });

  it("patches inline boolean fields on toggle and surfaces update failures", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 2};
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);

    const inlineBoolCells = UNSAFE_root.findAll((n: ReactTestInstance) => {
      const value = n.props?.cellData?.value as
        | {disabled?: boolean; onToggle?: () => void; value?: boolean}
        | undefined;
      return (
        value &&
        typeof value.onToggle === "function" &&
        typeof value.value === "boolean" &&
        typeof value.disabled === "boolean"
      );
    });
    assert.isAtLeast(inlineBoolCells.length, 1);

    await act(async () => {
      (inlineBoolCells[0] as ReactTestInstance).props.cellData.value.onToggle();
      await new Promise((r) => setTimeout(r, 50));
    });
    assert.equal(patchFn.mock.calls.length, 1);
    assert.deepEqual(patchFn.mock.calls[0]?.[0], {body: {active: true}, id: "u1"});

    patchFn.mockImplementationOnce(() => ({
      unwrap: async () => {
        throw new Error("patch failed");
      },
    }));
    await act(async () => {
      (inlineBoolCells[0] as ReactTestInstance).props.cellData.value.onToggle();
      await new Promise((r) => setTimeout(r, 50));
    });
    assert.isTrue(
      consoleErrorSpy.mock.calls.some((call) => String(call[0]).includes("Update failed"))
    );
  });

  it("navigates from link and row action cells", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 2};
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);

    const linkCells = UNSAFE_root.findAll((n: ReactTestInstance) => {
      const value = n.props?.cellData?.value as {href?: string; text?: string} | undefined;
      return value && typeof value.href === "string" && typeof value.text === "string";
    });
    assert.isAtLeast(linkCells.length, 1);
    const linkCell = linkCells[0] as ReactTestInstance;
    const linkButtons = linkCell.findAll(
      (n: ReactTestInstance) => typeof n.props?.onClick === "function"
    );
    await act(async () => {
      linkButtons[0]?.props.onClick();
    });
    assert.equal(routerPush.mock.calls[0]?.[0], "/admin/User/u1");

    const viewButtons = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.accessibilityLabel === "View"
    );
    assert.isAtLeast(viewButtons.length, 1);
    await act(async () => {
      viewButtons[0]?.props.onClick();
    });
    assert.equal(routerPush.mock.calls[1]?.[0], "/admin/User/u1");

    const editButtons = UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.accessibilityLabel === "Edit"
    );
    await act(async () => {
      editButtons[0]?.props.onClick();
    });
    assert.equal(routerPush.mock.calls[2]?.[0], "/admin/User/u1");
  });

  it("debounces search, resets page, and clears selection when search changes", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 40};
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );

    await act(async () => {
      findDataTable(UNSAFE_root).props.setPage(2);
    });
    assert.equal(findDataTable(UNSAFE_root).props.page, 2);

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-row-checkbox-u1"));
    });
    expectSelectionCount(getByTestId, 1);

    await act(async () => {
      findDataTable(UNSAFE_root).props.onSearchChange("query");
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, ADMIN_SEARCH_DEBOUNCE_MS + 50));
    });

    assert.equal(findDataTable(UNSAFE_root).props.page, 1);
    expectSelectionCount(getByTestId, 0);
  });

  it("applies DataTable filters and resets pagination", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 40};
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);

    await act(async () => {
      findDataTable(UNSAFE_root).props.setPage(2);
    });
    assert.equal(findDataTable(UNSAFE_root).props.page, 2);

    await act(async () => {
      findDataTable(UNSAFE_root).props.onFilterValuesChange({active: true});
    });

    assert.equal(findDataTable(UNSAFE_root).props.page, 1);
  });

  it("clears bulk selection when sort changes", async () => {
    configState.config = interactiveConfig;
    listState.data = {data: interactiveListRows, total: 2};
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="User" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-table-row-checkbox-u1"));
    });
    expectSelectionCount(getByTestId, 1);

    await act(async () => {
      findDataTable(UNSAFE_root).props.setSortColumn({column: 1, direction: "asc"});
    });
    expectSelectionCount(getByTestId, 0);
  });
  it("toggles an inline boolean and respects per-record update capability", async () => {
    configState.config = fullConfig;
    listState.data = {
      data: [
        {_adminCapabilities: {update: true}, _id: "u1", active: false, email: "a@b.com"},
        {_adminCapabilities: {update: false}, _id: "u2", active: true, email: "c@d.com"},
      ],
      total: 2,
    };
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    const tables = UNSAFE_root.findAll((node: ReactTestInstance) =>
      Array.isArray(node.props?.data)
    );
    const rows = tables[0].props.data as Array<Array<{value: Record<string, unknown>}>>;
    const firstActiveCell = rows[0][1].value;
    const secondActiveCell = rows[1][1].value;

    await act(async () => {
      (firstActiveCell.onToggle as () => void)();
    });
    expect(patchFn).toHaveBeenCalledTimes(1);
    expect(patchFn).toHaveBeenCalledWith({body: {active: true}, id: "u1"});
    expect(secondActiveCell.disabled).toBe(true);
  });

  it("executes rendered link, row-action, and inline-switch callbacks", async () => {
    configState.config = fullConfig;
    listState.data = {
      data: [{_id: "u1", active: false, email: "a@b.com"}],
      total: 1,
    };
    const {UNSAFE_root} = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
    const link = UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        node.props?.text === "a@b.com" && typeof node.props?.onClick === "function"
    )[0];
    const action = (label: string): ReactTestInstance =>
      UNSAFE_root.findAll(
        (node: ReactTestInstance) =>
          node.props?.accessibilityLabel === label && typeof node.props?.onClick === "function"
      )[0];
    const enabledSwitch = UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        node.props?.accessibilityRole === "switch" &&
        node.props?.disabled === false &&
        typeof node.props?.onPress === "function"
    )[0];

    await act(async () => {
      link.props.onClick();
      action("View").props.onClick();
      action("Edit").props.onClick();
      action("Delete").props.onClick();
      enabledSwitch.props.onPress();
      await Promise.resolve();
    });

    expect(routerPush).toHaveBeenCalledWith("/admin/User/u1");
    expect(deleteFn).toHaveBeenCalledWith("u1");
    expect(patchFn).toHaveBeenCalledWith({body: {active: true}, id: "u1"});
  });
});
