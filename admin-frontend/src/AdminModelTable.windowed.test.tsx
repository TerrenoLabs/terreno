// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, beforeEach, describe, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import {
  configureAdminModelApiDouble,
  resetAdminModelApiDouble,
} from "./testing/useAdminModelApiDouble";
import type {AdminConfigResponse, AdminSyncConflicts, AdminSyncDb} from "./types";

const setOptions = mock((_: unknown) => {});
mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
  useNavigation: () => ({setOptions}),
}));

const configState: {config: AdminConfigResponse | null; isLoading: boolean} = {
  config: null,
  isLoading: false,
};
mock.module("./useAdminConfig", () => ({
  useAdminConfig: () => ({
    config: configState.config,
    error: null,
    isLoading: configState.isLoading,
  }),
}));

const listState: {data: {data: Array<Record<string, unknown>>; total: number}} = {
  data: {data: [], total: 0},
};
const listRefetch = mock(async () => ({data: listState.data}));
const bulkPatchFn = mock(() => ({unwrap: async () => ({updated: 1})}));

mock.module("./useAdminBackgroundTask", () => ({
  useAdminBackgroundTaskMutation: () => [
    mock(() => ({unwrap: async () => ({taskId: "t1"})})),
    {isLoading: false},
  ],
}));

import {AdminModelTable} from "./AdminModelTable";
import {AdminProvider} from "./AdminProvider";
import {
  markAdminWindowMembershipStale,
  resetAdminWindowRefreshForTests,
} from "./adminWindowRefresh";

const windowedConfig: AdminConfigResponse = {
  customScreens: [],
  models: [
    {
      adminBroadcast: true,
      defaultSort: "-created",
      displayName: "Todos",
      fields: {
        _id: {required: true, type: "string"},
        title: {required: true, type: "string"},
      },
      listFields: ["title"],
      name: "Todo",
      routePath: "/admin/todos",
      syncCollection: "todos",
    },
  ],
  scripts: [],
};

const collectRefreshFailedLogs = (logged: unknown[][]): boolean[] => {
  return logged.map((entry) => entry.some((part) => String(part).includes("Refresh failed")));
};

const withConsoleErrorCapture = async (run: () => Promise<void>): Promise<unknown[][]> => {
  const logged: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]): void => {
    logged.push(args);
  };
  try {
    await run();
    return logged;
  } finally {
    console.error = originalError;
  }
};

const collectTitleTexts = (root: ReactTestInstance): string[] => {
  const tables = root.findAll(
    (node: ReactTestInstance) =>
      Array.isArray(node.props?.data) && Array.isArray(node.props?.columns)
  );
  assert.isAbove(tables.length, 0);
  const rows = tables[0].props.data as Array<Array<{value: unknown}>>;
  return rows.map((row) => {
    const link = row.find((cell) => {
      const value = cell.value as {text?: string} | undefined;
      return Boolean(value && typeof value === "object" && typeof value.text === "string");
    });
    return String((link?.value as {text?: string} | undefined)?.text ?? "");
  });
};

const createFakeSyncDb = (): {
  extraStore: Map<string, {data: unknown; deleted?: boolean; id: string}>;
  hydrateWindow: ReturnType<typeof mock>;
  mutate: ReturnType<typeof mock>;
  notifyStore: () => void;
  syncDb: AdminSyncDb;
} => {
  const extraStore = new Map<string, {data: unknown; deleted?: boolean; id: string}>();
  const listeners = new Map<string, () => void>();
  const notifyStore = (): void => {
    for (const listener of listeners.values()) {
      listener();
    }
  };
  const hydrateWindow = mock(async (args: {ids: string[]; restRows?: Record<string, unknown>}) => {
    for (const id of args.ids) {
      const rest = args.restRows?.[id];
      if (rest !== undefined) {
        extraStore.set(id, {data: rest, id});
      }
    }
    return {hydratedIds: args.ids};
  });
  const mutate = mock(() => ({id: "todo-1", mutationId: "mutation-1"}));
  return {
    extraStore,
    hydrateWindow,
    mutate,
    notifyStore,
    syncDb: {
      hydrateWindow,
      mutate,
      store: {
        getEntity: ({id}: {id: string}) => extraStore.get(id),
        raw: {
          addTableListener: (_tableId: string, listener: () => void): string => {
            const id = `listener-${listeners.size}`;
            listeners.set(id, listener);
            return id;
          },
          delListener: (listenerId: string): void => {
            listeners.delete(listenerId);
          },
        },
      },
    },
  };
};

/**
 * This package has no global testing-library teardown and `cleanup()` permanently tears down the
 * shared test renderer, so each render is tracked and unmounted here. A table left mounted keeps
 * its adminWindowRefresh subscription and races later tests over the shared list mock.
 */
const mountedViews: Array<ReturnType<typeof renderWithTheme>> = [];

const renderWindowed = (
  syncDb: AdminSyncDb,
  syncConflicts?: AdminSyncConflicts
): ReturnType<typeof renderWithTheme> => {
  const view = renderWithTheme(
    <AdminProvider
      apiBase="/admin"
      getAuthHeaders={() => ({})}
      routeBase="/admin"
      syncConflicts={syncConflicts}
      syncDb={syncDb}
    >
      <AdminModelTable baseUrl="/admin" modelName="Todo" />
    </AdminProvider>
  );
  mountedViews.push(view);
  return view;
};

describe("AdminModelTable windowed path", () => {
  afterEach(() => {
    while (mountedViews.length > 0) {
      mountedViews.pop()?.unmount();
    }
  });

  beforeEach(() => {
    resetAdminModelApiDouble();
    configureAdminModelApiDouble({
      useBulkPatchMutation: () => [bulkPatchFn, {isLoading: false}],
      useCreateMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
      useDeleteMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
      useListQuery: () => ({
        data: listState.data,
        error: null,
        isLoading: false,
        refetch: listRefetch,
      }),
      useReadQuery: () => ({data: null, error: null, isLoading: false}),
      useUpdateMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
    });
    setOptions.mockClear();
    listRefetch.mockClear();
    bulkPatchFn.mockClear();
    configState.config = windowedConfig;
    listState.data = {data: [], total: 0};
    listRefetch.mockImplementation(async () => ({data: listState.data}));
    resetAdminWindowRefreshForTests();
  });

  it("renders REST membership page ids and hydrates them", async () => {
    const {hydrateWindow, syncDb} = createFakeSyncDb();
    listState.data = {
      data: [
        {_id: "todo-1", title: "Alpha"},
        {_id: "todo-2", title: "Beta"},
      ],
      total: 2,
    };
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha", "Beta"]);
    assert.isTrue(hydrateWindow.mock.calls.length > 0);
    const firstCall = hydrateWindow.mock.calls[0]?.[0] as {ids: string[]};
    assert.deepEqual(firstCall.ids, ["todo-1", "todo-2"]);
  });

  it("shows conflicts only for ids on the rendered page", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    const resolve = mock((_args: {mutationId: string; strategy: "useServer" | "keepMine"}) => {});
    const view = renderWindowed(syncDb, {
      conflicts: [
        {
          collection: "todos",
          entityId: "todo-1",
          localData: JSON.stringify({title: "Mine"}),
          mutationId: "mutation-1",
          serverData: JSON.stringify({title: "Server"}),
        },
        {
          collection: "todos",
          entityId: "todo-2",
          localData: JSON.stringify({title: "Other mine"}),
          mutationId: "mutation-2",
          serverData: JSON.stringify({title: "Other server"}),
        },
      ],
      resolve,
    });

    assert.isDefined(await view.findByTestId("conflict-item-todo-1"));
    assert.isNull(view.queryByTestId("conflict-item-todo-2"));
    await act(async () => {
      fireEvent.press(view.getByTestId("conflict-use-server-button-mutation-1"));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
    });
    assert.deepEqual(resolve.mock.calls[0]?.[0], {
      mutationId: "mutation-1",
      strategy: "useServer",
    });
  });

  it("does not render a TinyBase id that is outside REST membership", async () => {
    const {extraStore, syncDb} = createFakeSyncDb();
    extraStore.set("ghost", {data: {_id: "ghost", title: "Ghost row"}, id: "ghost"});
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    const {UNSAFE_root, queryByTestId} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);
    assert.isNotNull(queryByTestId("admin-table-refresh"));
    assert.isNotNull(queryByTestId("admin-create-button"));
  });

  it("re-renders known membership rows when TinyBase receives a delta", async () => {
    const {extraStore, notifyStore, syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    const {UNSAFE_root, queryByText} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);

    await act(async () => {
      extraStore.set("todo-1", {
        data: {_id: "todo-1", title: "Updated by delta"},
        id: "todo-1",
      });
      notifyStore();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Updated by delta"]);

    await act(async () => {
      extraStore.set("todo-1", {
        data: {_id: "todo-1", title: "Updated by delta"},
        deleted: true,
        id: "todo-1",
      });
      notifyStore();
    });
    assert.isNull(queryByText("Updated by delta"));
  });

  it("Refresh re-queries membership and then shows the new id", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    listRefetch.mockImplementation(async () => {
      listState.data = {
        data: [
          {_id: "todo-1", title: "Alpha"},
          {_id: "todo-2", title: "From refresh"},
        ],
        total: 2,
      };
      return {data: listState.data};
    });
    const {UNSAFE_root, getByTestId} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-refresh"));
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha", "From refresh"]);
  });

  it("retries membership until a queued create appears, then stops", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    let refetchCount = 0;
    listRefetch.mockImplementation(async () => {
      refetchCount += 1;
      // The first refetch races the outbox: the server does not have the row yet.
      if (refetchCount > 1) {
        listState.data = {
          data: [
            {_id: "todo-1", title: "Alpha"},
            {_id: "todo-2", title: "Accepted by server"},
          ],
          total: 2,
        };
      }
      return {data: listState.data};
    });
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      markAdminWindowMembershipStale({awaitId: "todo-2", collection: "todos"});
      await new Promise((resolve) => setTimeout(resolve, 1_600));
    });

    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha", "Accepted by server"]);
    assert.equal(refetchCount, 2);
  });

  it("retries a transient refresh failure while settling a queued create", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    let refetchCount = 0;
    listRefetch.mockImplementation(async () => {
      refetchCount += 1;
      if (refetchCount === 1) {
        throw new Error("temporary network failure");
      }
      listState.data = {
        data: [
          {_id: "todo-1", title: "Alpha"},
          {_id: "todo-2", title: "Accepted after retry"},
        ],
        total: 2,
      };
      return {data: listState.data};
    });
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      markAdminWindowMembershipStale({awaitId: "todo-2", collection: "todos"});
      await new Promise((resolve) => setTimeout(resolve, 1_600));
    });

    assert.equal(refetchCount, 2);
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha", "Accepted after retry"]);
  });

  it("does not toast a settle refresh failure that a later attempt recovers", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    let refetchCount = 0;
    listRefetch.mockImplementation(async () => {
      refetchCount += 1;
      if (refetchCount === 1) {
        throw new Error("temporary network failure");
      }
      listState.data = {
        data: [
          {_id: "todo-1", title: "Alpha"},
          {_id: "todo-2", title: "Accepted after retry"},
        ],
        total: 2,
      };
      return {data: listState.data};
    });
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });

    const logged = await withConsoleErrorCapture(async () => {
      await act(async () => {
        markAdminWindowMembershipStale({awaitId: "todo-2", collection: "todos"});
        await new Promise((resolve) => setTimeout(resolve, 1_600));
      });
    });

    assert.equal(refetchCount, 2);
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha", "Accepted after retry"]);
    assert.isFalse(collectRefreshFailedLogs(logged).includes(true));
  });

  it("toasts Refresh failed once when settle retries exhaust on list errors", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    listRefetch.mockImplementation(async () => {
      throw new Error("network down");
    });
    renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });

    const logged = await withConsoleErrorCapture(async () => {
      await act(async () => {
        markAdminWindowMembershipStale({awaitId: "todo-2", collection: "todos"});
        await new Promise((resolve) => setTimeout(resolve, 2_600));
      });
    });

    assert.equal(collectRefreshFailedLogs(logged).filter(Boolean).length, 1);
  });

  it("gives up retrying after the attempt budget and leaves Refresh available", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    let refetchCount = 0;
    listRefetch.mockImplementation(async () => {
      refetchCount += 1;
      return {data: listState.data};
    });
    const {queryByTestId} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      markAdminWindowMembershipStale({awaitId: "never-accepted", collection: "todos"});
      await new Promise((resolve) => setTimeout(resolve, 2_600));
    });

    assert.equal(refetchCount, 3);
    assert.isNotNull(queryByTestId("admin-table-refresh"));
  });

  it("refetches membership when a windowed write marks the collection stale", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    listRefetch.mockImplementation(async () => {
      listState.data = {
        data: [
          {_id: "todo-1", title: "Alpha"},
          {_id: "todo-2", title: "Created in form"},
        ],
        total: 2,
      };
      return {data: listState.data};
    });
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);

    await act(async () => {
      markAdminWindowMembershipStale({collection: "todos"});
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha", "Created in form"]);
  });

  it("retries a transient refresh failure when settling a delete with no awaitId", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [
        {_id: "todo-1", title: "Alpha"},
        {_id: "todo-2", title: "Gone after retry"},
      ],
      total: 2,
    };
    let refetchCount = 0;
    listRefetch.mockImplementation(async () => {
      refetchCount += 1;
      if (refetchCount === 1) {
        throw new Error("temporary network failure");
      }
      listState.data = {
        data: [{_id: "todo-1", title: "Alpha"}],
        total: 1,
      };
      return {data: listState.data};
    });
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha", "Gone after retry"]);

    const logged = await withConsoleErrorCapture(async () => {
      await act(async () => {
        markAdminWindowMembershipStale({collection: "todos"});
        await new Promise((resolve) => setTimeout(resolve, 1_600));
      });
    });

    assert.equal(refetchCount, 2);
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);
    assert.isFalse(collectRefreshFailedLogs(logged).includes(true));
  });

  it("toasts Refresh failed once when a delete settle exhausts on list errors", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    listRefetch.mockImplementation(async () => {
      throw new Error("network down");
    });
    renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });

    const logged = await withConsoleErrorCapture(async () => {
      await act(async () => {
        markAdminWindowMembershipStale({collection: "todos"});
        await new Promise((resolve) => setTimeout(resolve, 2_600));
      });
    });

    assert.equal(collectRefreshFailedLogs(logged).filter(Boolean).length, 1);
  });

  it("refetches membership when the table remounts while the collection is stale", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    markAdminWindowMembershipStale({collection: "todos"});
    listRefetch.mockImplementation(async () => {
      listState.data = {
        data: [
          {_id: "todo-1", title: "Alpha"},
          {_id: "todo-2", title: "Created before remount"},
        ],
        total: 2,
      };
      return {data: listState.data};
    });
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha", "Created before remount"]);
    assert.equal(listRefetch.mock.calls.length, 1);
  });

  it("ignores a stale flag raised for another collection", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      markAdminWindowMembershipStale({collection: "users"});
      await Promise.resolve();
    });
    assert.equal(listRefetch.mock.calls.length, 0);
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);
  });

  it("surfaces a Refresh failure without throwing", async () => {
    const {syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    listRefetch.mockImplementation(async () => {
      throw new Error("network down");
    });
    const {getByTestId} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-refresh"));
      await Promise.resolve();
    });
    assert.isTrue(listRefetch.mock.calls.length > 0);
  });

  it("treats an RTK refetch error envelope as a Refresh failure", async () => {
    const {hydrateWindow, syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    listRefetch.mockImplementation(async () => ({
      error: {data: "nope", status: 500},
      isError: true,
    }));
    const {UNSAFE_root, getByTestId} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    const hydrateCountAfterMount = hydrateWindow.mock.calls.length;
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-refresh"));
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);
    assert.equal(hydrateWindow.mock.calls.length, hydrateCountAfterMount);
  });

  it("does not throw when window hydrate rejects", async () => {
    const {hydrateWindow, syncDb} = createFakeSyncDb();
    hydrateWindow.mockImplementation(async () => {
      throw new Error("tinybase down");
    });
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    const {UNSAFE_root} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);
  });

  it("drops a stale Refresh after the table unmounts", async () => {
    const {hydrateWindow, syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    let resolveRefetch: ((value: {data: typeof listState.data}) => void) | undefined;
    listRefetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRefetch = resolve;
        })
    );
    const {getByTestId, unmount} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    const hydrateCountAfterMount = hydrateWindow.mock.calls.length;
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-refresh"));
    });
    unmount();
    await act(async () => {
      resolveRefetch?.({
        data: {
          data: [{_id: "stale", title: "Stale refresh"}],
          total: 1,
        },
      });
      await Promise.resolve();
    });
    const refreshHydrates = hydrateWindow.mock.calls.slice(hydrateCountAfterMount);
    for (const call of refreshHydrates) {
      const args = call[0] as {ids: string[]};
      assert.notInclude(args.ids, "stale");
    }
  });

  it("skips membership rows without ids and Refresh without a new envelope", async () => {
    const {hydrateWindow, syncDb} = createFakeSyncDb();
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}, {title: "orphan"}],
      total: 1,
    };
    listRefetch.mockImplementation(async () => ({}));
    const {UNSAFE_root, getByTestId} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-refresh"));
      await Promise.resolve();
    });
    const lastCall = hydrateWindow.mock.calls[hydrateWindow.mock.calls.length - 1]?.[0] as {
      ids: string[];
    };
    assert.deepEqual(lastCall.ids, ["todo-1"]);
  });

  it("keeps the REST-only path when no syncDb is provided", () => {
    configState.config = windowedConfig;
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    const {queryByTestId, UNSAFE_root} = renderWithTheme(
      <AdminModelTable baseUrl="/admin" modelName="Todo" />
    );
    assert.isNull(queryByTestId("admin-table-refresh"));
    assert.deepEqual(collectTitleTexts(UNSAFE_root), ["Alpha"]);
  });

  it("selects the membership page and warns when a bulk action has no handler", async () => {
    configState.config = {
      ...windowedConfig,
      models: windowedConfig.models.map((model) => ({
        ...model,
        actions: [
          {id: "noop", label: "Noop"},
          {id: "activate", label: "Activate", patchKeys: ["active"]},
        ],
        filters: [{field: "due", kind: "dateRange"}],
        listDisplayLinks: ["title"],
      })),
    };
    listState.data = {
      data: [
        {_id: "todo-1", title: "Alpha"},
        {_id: "todo-2", title: "Beta"},
      ],
      total: 2,
    };
    const {UNSAFE_root, getByTestId} = renderWindowed(createFakeSyncDb().syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-select-all"));
    });
    assert.include(String(getByTestId("admin-table-selection-count").children), "2");
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-select-all"));
    });
    assert.include(String(getByTestId("admin-table-selection-count").children), "0");
    const actionMenus = UNSAFE_root.findAll(
      (node: ReactTestInstance) => typeof node.props?.onRunAction === "function"
    );
    await act(async () => {
      await actionMenus[0].props.onRunAction("missing");
      await actionMenus[0].props.onRunAction("noop");
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-select-all"));
    });
    await act(async () => {
      await actionMenus[0].props.onRunAction("noop");
    });
  });

  it("sends windowed bulk patch through the model bulk-patch mutation", async () => {
    configState.config = {
      ...windowedConfig,
      models: windowedConfig.models.map((model) => ({
        ...model,
        actions: [{id: "activate", label: "Activate", patchKeys: ["active"]}],
      })),
    };
    listState.data = {
      data: [{_id: "todo-1", title: "Alpha"}],
      total: 1,
    };
    const {mutate, syncDb} = createFakeSyncDb();
    const {UNSAFE_root, getByTestId} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
      fireEvent.press(getByTestId("admin-table-select-all"));
    });
    const actionMenu = UNSAFE_root.find(
      (node: ReactTestInstance) => typeof node.props?.onRunAction === "function"
    );
    await act(async () => {
      await actionMenu.props.onRunAction("activate");
    });

    assert.deepEqual(bulkPatchFn.mock.calls as unknown[], [
      [{ids: ["todo-1"], patch: {active: true}}],
    ]);
    assert.equal(mutate.mock.calls.length, 0);
  });

  it("drops a selected row that a live tombstone removed from the window", async () => {
    configState.config = {
      ...windowedConfig,
      models: windowedConfig.models.map((model) => ({
        ...model,
        actions: [{id: "activate", label: "Activate", patchKeys: ["active"]}],
      })),
    };
    listState.data = {
      data: [
        {_id: "todo-1", title: "Alpha"},
        {_id: "todo-2", title: "Beta"},
      ],
      total: 2,
    };
    const {extraStore, notifyStore, syncDb} = createFakeSyncDb();
    const {getByTestId} = renderWindowed(syncDb);
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-table-select-all"));
    });
    assert.include(String(getByTestId("admin-table-selection-count").children), "2");

    await act(async () => {
      extraStore.set("todo-2", {data: {_id: "todo-2", title: "Beta"}, deleted: true, id: "todo-2"});
      notifyStore();
    });

    assert.include(String(getByTestId("admin-table-selection-count").children), "1");
  });
});
