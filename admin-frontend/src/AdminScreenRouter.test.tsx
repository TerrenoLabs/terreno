// noExplicitAny: test harness doubles for AdminScreenRouter routing and config mocks
// biome-ignore-all lint/suspicious/noExplicitAny: test harness doubles
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {
  configureAdminModelApiDouble,
  resetAdminModelApiDouble,
} from "./testing/useAdminModelApiDouble";
import type {AdminConfigResponse, BackgroundTask} from "./types";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
  useNavigation: () => ({setOptions: mock(() => {})}),
}));

const configState: {
  config: AdminConfigResponse | null;
  error: unknown;
  isLoading: boolean;
} = {
  config: null,
  error: null,
  isLoading: false,
};

mock.module("./useAdminConfig", () => ({
  useAdminConfig: () => ({
    config: configState.config,
    error: configState.error,
    isLoading: configState.isLoading,
  }),
}));

mock.module("./useAdminBackgroundTask", () => ({
  useAdminBackgroundTaskMutation: () => [mock(() => ({unwrap: async () => ({taskId: "t1"})}))],
}));

mock.module("./useAdminScripts", () => ({
  useAdminScripts: () => {
    const hooks: Record<string, unknown> = {
      useCancelScriptTaskMutation: () => [
        mock(() => ({unwrap: async () => ({})})),
        {isLoading: false},
      ],
      useListScriptRunsQuery: () => ({
        data: undefined,
        error: null,
        isLoading: false,
      }),
      useRunScriptMutation: () => [
        mock(() => ({unwrap: async () => ({taskId: ""})})),
        {isLoading: false},
      ],
    };
    if (!adminScriptsHarness.omitGetScriptTaskQuery) {
      hooks.useGetScriptTaskQuery = () => adminScriptsHarness.taskQuery;
    }
    return hooks;
  },
}));

import {AdminMigrations} from "./AdminMigrations";
import {AdminMigrationsView} from "./AdminMigrationsView";
import {AdminScreenRouter} from "./AdminScreenRouter";
import {adminScriptsHarness} from "./adminScriptsHarness.test";

const baseConfig: AdminConfigResponse = {
  customScreens: [{displayName: "AI Admin", name: "ai-admin"}],
  models: [
    {
      defaultSort: "-created",
      displayName: "Foods",
      fields: {name: {required: true, type: "string"}},
      listFields: ["name"],
      name: "Food",
      routePath: "/admin/foods",
    },
  ],
  scripts: [{description: "Test", name: "test-script"}],
};

describe("AdminScreenRouter", () => {
  beforeEach(() => {
    resetAdminModelApiDouble();
    configureAdminModelApiDouble({
      useBulkPatchMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
      useCreateMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
      useDeleteMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
      useListQuery: () => ({
        data: {data: [], total: 0},
        error: null,
        isError: false,
        isLoading: false,
        refetch: mock(() => {}),
      }),
      useReadQuery: () => ({data: undefined, isLoading: false}),
      useUpdateMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
    });
    configState.config = baseConfig;
    configState.error = null;
    configState.isLoading = false;
  });

  it("renders AdminMigrations for __migrations", () => {
    const {getByTestId} = renderWithTheme(
      <AdminScreenRouter baseUrl="/admin" name="__migrations" />
    );
    expect(getByTestId("admin-migrations")).toBeTruthy();
  });

  it("skips page chrome while AdminMigrations config is loading", () => {
    configState.config = null;
    configState.isLoading = true;
    const {getByTestId, queryByText} = renderWithTheme(<AdminMigrations apiBase="/admin" />);
    expect(getByTestId("admin-migrations-loading")).toBeTruthy();
    expect(queryByText("Migrations")).toBeNull();
  });

  it("wraps loaded AdminMigrations in a page", () => {
    configState.config = {migrations: {enabled: true}, models: [], scripts: []};
    const {getByTestId, getByText} = renderWithTheme(<AdminMigrations apiBase="/admin" />);
    expect(getByText("Migrations")).toBeTruthy();
    expect(getByTestId("admin-migrations")).toBeTruthy();
  });

  it("renders AdminModelTable for a configured model name", () => {
    const {getByTestId, unmount} = renderWithTheme(
      <AdminScreenRouter baseUrl="/admin" name="Food" />
    );
    expect(getByTestId("admin-list-Food")).toBeTruthy();
    unmount();
  });

  it("renders built-in version-config screen widget", () => {
    const {getByText, unmount} = renderWithTheme(
      <AdminScreenRouter baseUrl="/admin" name="version-config" />
    );
    expect(getByText("Version Config")).toBeTruthy();
    unmount();
  });

  it("shows missing widget placeholder for unregistered custom screens", () => {
    const {getByTestId, unmount} = renderWithTheme(
      <AdminScreenRouter baseUrl="/admin" name="ai-admin" />
    );
    expect(getByTestId("admin-missing-widget-ai-admin")).toBeTruthy();
    unmount();
  });

  it("returns not-found for unknown routes", () => {
    const {getByTestId, unmount} = renderWithTheme(
      <AdminScreenRouter baseUrl="/admin" name="unknown-route" />
    );
    expect(getByTestId("admin-screen-not-found")).toBeTruthy();
    unmount();
  });
});

const mockRun = mock((_args: {wetRun: boolean}) => ({
  unwrap: async () => ({taskId: "task-1"}),
}));

const mockRefetch = mock(() => {});

interface MigrationQueryState {
  data:
    | {
        applied: Array<{appliedAt?: string; checksum: string; id: string}>;
        lock: {expiresAt: string; holder: string} | null;
        pending: Array<{checksum: string; id: string}>;
      }
    | undefined;
  error: Error | null;
  isLoading: boolean;
  refetch: typeof mockRefetch;
}

const queryState: MigrationQueryState = {
  data: {
    applied: [],
    lock: null,
    pending: [{checksum: "abc", id: "20260910120000-todos-title-owner-index"}],
  },
  error: null,
  isLoading: false,
  refetch: mockRefetch,
};

const mockTask: {data: {task?: BackgroundTask} | undefined; error: unknown} = {
  data: undefined,
  error: null,
};

const migrationRequests: {method: string; url: string}[] = [];
const originalFetch = globalThis.fetch;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

/** Serves migration status from `queryState` and routes runs through `mockRun`. */
const installMigrationFetch = (): void => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(url);
    migrationRequests.push({method, url: path});
    if (method === "POST" && path.startsWith("/admin/migrations/run")) {
      const wetRun = path.endsWith("wetRun=true");
      try {
        return jsonResponse(await mockRun({wetRun}).unwrap());
      } catch (error) {
        return jsonResponse({title: String(error)}, 500);
      }
    }
    if (queryState.isLoading) {
      return new Promise<Response>(() => undefined);
    }
    if (queryState.error) {
      return jsonResponse({title: queryState.error.message}, 500);
    }
    return jsonResponse(queryState.data ?? {});
  }) as typeof fetch;
};

const statusRequestCount = (): number =>
  migrationRequests.filter(
    (request) => request.method === "GET" && request.url === "/admin/migrations/status"
  ).length;

const enabledConfig = {
  migrations: {enabled: true},
  models: [],
  scripts: [],
} as AdminConfigResponse;

const renderView = async (
  overrides: Partial<{
    config: AdminConfigResponse | null;
    configError: unknown;
    isConfigLoading: boolean;
  }> = {}
): Promise<ReturnType<typeof renderWithTheme>> => {
  const rendered = renderWithTheme(
    <AdminMigrationsView
      apiBase="/admin"
      config={overrides.config === undefined ? enabledConfig : overrides.config}
      configError={overrides.configError}
      isConfigLoading={overrides.isConfigLoading ?? false}
    />
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
};

const resetQueryState = (): void => {
  queryState.data = {
    applied: [],
    lock: null,
    pending: [{checksum: "abc", id: "20260910120000-todos-title-owner-index"}],
  };
  queryState.error = null;
  queryState.isLoading = false;
  queryState.refetch = mockRefetch;
};

describe("AdminMigrationsView", () => {
  beforeEach(() => {
    mockRun.mockClear();
    mockRefetch.mockClear();
    mockTask.data = undefined;
    mockTask.error = null;
    adminScriptsHarness.omitGetScriptTaskQuery = false;
    adminScriptsHarness.taskQuery = mockTask;
    resetQueryState();
    migrationRequests.length = 0;
    installMigrationFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("renders a spinner while admin config loads", async () => {
    const {getByTestId} = await renderView({config: null, isConfigLoading: true});
    expect(getByTestId("admin-migrations-loading")).toBeTruthy();
  });

  it("renders a config error", async () => {
    const {getByTestId} = await renderView({config: null, configError: new Error("network")});
    expect(getByTestId("admin-migrations-config-error")).toBeTruthy();
  });

  it("renders a disabled message when migrations are not configured", async () => {
    const {getByText} = await renderView({
      config: {migrations: {enabled: false}, models: [], scripts: []},
    });
    expect(getByText("Migrations are not configured on this server.")).toBeTruthy();
  });

  it("lists pending files and starts a dry-run", async () => {
    const {getByTestId, getByText} = await renderView();

    expect(getByTestId("admin-migrations")).toBeTruthy();
    expect(getByText("20260910120000-todos-title-owner-index")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText("Dry run"));
    });
    expect(mockRun).toHaveBeenCalledWith({wetRun: false});
  });

  it("starts a wet apply", async () => {
    const {getByText} = await renderView();
    await act(async () => {
      fireEvent.press(getByText("Apply pending"));
    });
    expect(mockRun).toHaveBeenCalledWith({wetRun: true});
  });

  it("disables dry-run and apply when runScripts is false", async () => {
    const {getByTestId} = await renderView({
      config: {
        migrations: {enabled: true},
        models: [],
        platformTools: {runScripts: false},
        scripts: [],
      } as AdminConfigResponse,
    });
    expect(getByTestId("admin-migrations-dry-run").props.accessibilityState.disabled).toBe(true);
    expect(getByTestId("admin-migrations-apply").props.accessibilityState.disabled).toBe(true);
  });

  it("renders a status error", async () => {
    queryState.data = undefined;
    queryState.error = new Error("status failed");
    const {getByText} = await renderView();
    expect(getByText("Failed to load migration status.")).toBeTruthy();
  });

  it("renders a spinner while migration status loads", async () => {
    queryState.data = undefined;
    queryState.isLoading = true;
    const {getByTestId, queryByTestId} = await renderView();
    expect(getByTestId("admin-migrations")).toBeTruthy();
    expect(queryByTestId("admin-migrations-pending")).toBeNull();
  });

  it("renders lock and applied rows", async () => {
    queryState.data = {
      applied: [
        {
          appliedAt: "2026-09-10T12:00:00.000Z",
          checksum: "def",
          id: "20260910110000-todos-title-index",
        },
      ],
      lock: {expiresAt: "2026-09-10T13:00:00.000Z", holder: "api-1"},
      pending: [],
    };
    const {getByText} = await renderView();
    expect(getByText("Lock held by api-1")).toBeTruthy();
    expect(getByText(/20260910110000-todos-title-index/)).toBeTruthy();
    expect(getByText(/2026-09-10 12:00:00 UTC/)).toBeTruthy();
  });

  it("omits appliedAt when the timestamp is missing", async () => {
    queryState.data = {
      applied: [{checksum: "def", id: "20260910110000-todos-title-index"}],
      lock: null,
      pending: [],
    };
    const {getByText, queryByText} = await renderView();
    expect(getByText("20260910110000-todos-title-index")).toBeTruthy();
    expect(queryByText(/UTC/)).toBeNull();
  });

  it("renders an invalid appliedAt timestamp as-is", async () => {
    queryState.data = {
      applied: [
        {
          appliedAt: "not-a-date",
          checksum: "ghi",
          id: "20260910100000-invalid-applied-at",
        },
      ],
      lock: null,
      pending: [],
    };
    const {getByText} = await renderView();
    expect(getByText(/20260910100000-invalid-applied-at · not-a-date/)).toBeTruthy();
  });

  it("renders an empty pending list", async () => {
    queryState.data = {applied: [], lock: null, pending: []};
    const {getByText} = await renderView();
    expect(getByText("No pending migrations.")).toBeTruthy();
  });

  it("renders a failed task error", async () => {
    mockTask.data = {
      task: {
        error: "migrate exploded",
        logs: [{level: "error", message: "Migration failed", timestamp: "2026-09-11T22:00:00Z"}],
        result: ["No migrations applied"],
        status: "failed",
      } as BackgroundTask,
    };
    const {getByTestId, getByText} = await renderView();
    await act(async () => {
      fireEvent.press(getByText("Dry run"));
    });
    expect(getByTestId("admin-migrations-task")).toBeTruthy();
    expect(getByText(/migrate exploded/)).toBeTruthy();
    expect(getByText("Migration failed")).toBeTruthy();
    expect(getByText("No migrations applied")).toBeTruthy();
  });

  it("disables apply while a queued task is in flight", async () => {
    mockTask.data = {task: {status: "queued"}};
    const {getByTestId, getByText} = await renderView();
    await act(async () => {
      fireEvent.press(getByText("Dry run"));
    });
    expect(getByTestId("admin-migrations-task")).toBeTruthy();
    expect(getByTestId("admin-migrations-apply").props.accessibilityState.disabled).toBe(true);
  });

  it("refetches status after a completed task", async () => {
    mockTask.data = {task: {status: "completed"}};
    const {getByText} = await renderView();
    await act(async () => {
      fireEvent.press(getByText("Dry run"));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(statusRequestCount()).toBeGreaterThan(1);
  });

  it("keeps apply disabled while a task is running", async () => {
    mockTask.data = {task: {status: "running"}};
    const {getByTestId, getByText} = await renderView();
    await act(async () => {
      fireEvent.press(getByText("Dry run"));
    });
    expect(getByTestId("admin-migrations-apply").props.accessibilityState.disabled).toBe(true);
  });

  it("re-enables dry-run when task polling fails", async () => {
    mockTask.data = undefined;
    mockTask.error = new Error("forbidden");
    const {getByTestId, getByText} = await renderView();
    await act(async () => {
      fireEvent.press(getByText("Dry run"));
    });
    expect(getByTestId("admin-migrations-task-error")).toBeTruthy();
    expect(getByTestId("admin-migrations-dry-run").props.accessibilityState.disabled).toBe(false);
  });

  it("still starts a dry-run when script task polling is unavailable", async () => {
    adminScriptsHarness.omitGetScriptTaskQuery = true;
    const {getByText} = await renderView();
    await act(async () => {
      fireEvent.press(getByText("Dry run"));
    });
    expect(mockRun).toHaveBeenCalledWith({wetRun: false});
  });

  it("surfaces unwrap errors from run", async () => {
    mockRun.mockImplementationOnce(() => ({
      unwrap: async () => {
        throw new Error("cannot run");
      },
    }));
    const {getByTestId, getByText} = await renderView();
    await act(async () => {
      fireEvent.press(getByText("Dry run"));
    });
    expect(getByTestId("admin-migrations-start-error")).toBeTruthy();
  });
});
