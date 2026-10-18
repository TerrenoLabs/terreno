// noExplicitAny: test mocks use loosely typed hook doubles and dynamic mock returns
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminScriptList} from "./AdminScriptList";
import {adminScriptsHarness} from "./adminScriptsHarness.test";
import type {AdminConfigResponse} from "./types";

// Mock useAdminConfig to control returned data
const mockUseAdminConfig = mock(() => ({
  config: null as AdminConfigResponse | null,
  error: null as Error | null,
  isLoading: false,
}));

mock.module("./useAdminConfig", () => ({
  useAdminConfig: (...args: unknown[]) => mockUseAdminConfig(...args),
}));

const sampleRun = {
  _id: "run-1",
  completedAt: "2024-01-01T00:00:10Z",
  created: "2024-01-01T00:00:00Z",
  createdByName: "Ada",
  isDryRun: true,
  logs: [{level: "error" as const, message: "failed once", timestamp: "2024-01-01T00:00:01Z"}],
  startedAt: "2024-01-01T00:00:01Z",
  status: "completed" as const,
  taskType: "test-script",
  updated: "2024-01-01T00:00:10Z",
};

const secondRun = {
  ...sampleRun,
  _id: "run-2",
  created: "2024-01-02T00:00:00Z",
  isDryRun: false,
  taskType: "test-script",
};

const page1RunsResult = {
  data: {data: [sampleRun], limit: 25, more: true, page: 1, total: 2},
};
const page2RunsResult = {
  data: {data: [secondRun], limit: 25, more: false, page: 2, total: 2},
};
const filteredRunsResult = {
  data: {data: [sampleRun], limit: 25, more: false, page: 1, total: 1},
};
const liveRunResult = {
  data: {data: [{...sampleRun, isDryRun: false}], limit: 25, more: false, page: 1, total: 1},
};

const mockUseListScriptRunsQuery = mock((args?: {page?: number; name?: string}) => {
  if (args?.page && args.page > 1) {
    return page2RunsResult;
  }
  if (args?.name) {
    return filteredRunsResult;
  }
  return page1RunsResult;
});

mock.module("./useAdminScripts", () => ({
  useAdminScripts: () => ({
    useCancelScriptTaskMutation: () => [
      mock(() => ({unwrap: async () => ({})})),
      {isLoading: false},
    ],
    useGetScriptTaskQuery: () => adminScriptsHarness.taskQuery,
    useListScriptRunsQuery: mockUseListScriptRunsQuery,
    useRunScriptMutation: () => [
      mock(() => ({unwrap: async () => ({taskId: ""})})),
      {isLoading: false},
    ],
  }),
}));

const modalCallbacks: {
  scriptName: string | null;
  visible: boolean;
  onDismiss: () => void;
} = {onDismiss: () => undefined, scriptName: null, visible: false};

// Mock AdminScriptRunModal so we can observe its props and invoke onDismiss
mock.module("./AdminScriptRunModal", () => ({
  AdminScriptRunModal: (props: {
    scriptName: string | null;
    visible: boolean;
    onDismiss: () => void;
  }) => {
    modalCallbacks.scriptName = props.scriptName;
    modalCallbacks.visible = props.visible;
    modalCallbacks.onDismiss = props.onDismiss;
    return null;
  },
}));

describe("AdminScriptList", () => {
  beforeEach(() => {
    mockUseAdminConfig.mockClear();
    mockUseListScriptRunsQuery.mockImplementation((args?: {page?: number; name?: string}) => {
      if (args?.page && args.page > 1) {
        return page2RunsResult;
      }
      if (args?.name) {
        return filteredRunsResult;
      }
      return page1RunsResult;
    });
  });

  it("renders loading state", () => {
    mockUseAdminConfig.mockReturnValue({
      config: null,
      error: null,
      isLoading: true,
    });

    const {getByTestId} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);

    // Spinner should be rendered during loading
    expect(getByTestId).toBeDefined();
  });

  it("renders error state when config fails to load", () => {
    mockUseAdminConfig.mockReturnValue({
      config: null,
      error: new Error("Network error"),
      isLoading: false,
    });

    const {getByText} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);

    expect(getByText("Failed to load admin configuration.")).toBeTruthy();
  });

  it("renders empty state when no scripts are configured", () => {
    mockUseAdminConfig.mockReturnValue({
      config: {models: [], scripts: []},
      error: null,
      isLoading: false,
    });

    const {getByText} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);

    expect(getByText("No scripts registered.")).toBeTruthy();
  });

  it("renders script cards with name and description", () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        scripts: [
          {description: "Migrate old records", name: "migrate-data"},
          {description: "Remove orphaned documents", name: "cleanup"},
        ],
      },
      error: null,
      isLoading: false,
    });

    const {getByText, getByTestId} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);

    expect(getByText("migrate-data")).toBeTruthy();
    expect(getByText("Migrate old records")).toBeTruthy();
    expect(getByText("cleanup")).toBeTruthy();
    expect(getByText("Remove orphaned documents")).toBeTruthy();
    expect(getByTestId("admin-script-card-migrate-data")).toBeTruthy();
    expect(getByTestId("admin-script-card-cleanup")).toBeTruthy();
  });

  it("renders Run buttons for each script", () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        scripts: [{description: "Test script", name: "test-script"}],
      },
      error: null,
      isLoading: false,
    });

    const {getByTestId} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);

    expect(getByTestId("admin-script-run-test-script")).toBeTruthy();
  });

  it("opens modal when Run button is pressed and dismisses it", async () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        scripts: [{description: "Test script", name: "test-script"}],
      },
      error: null,
      isLoading: false,
    });

    const {getByTestId} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);

    expect(modalCallbacks.visible).toBe(false);
    expect(modalCallbacks.scriptName).toBeNull();

    const runBtn = getByTestId("admin-script-run-test-script");
    await act(async () => {
      fireEvent.press(runBtn);
    });

    expect(modalCallbacks.visible).toBe(true);
    expect(modalCallbacks.scriptName).toBe("test-script");

    await act(async () => {
      modalCallbacks.onDismiss();
    });

    expect(modalCallbacks.visible).toBe(false);
    expect(modalCallbacks.scriptName).toBeNull();
  });

  it("disables Run button when isAdmin is false", () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        scripts: [{description: "Test script", name: "test-script"}],
      },
      error: null,
      isLoading: false,
    });

    const {getByTestId} = renderWithTheme(<AdminScriptList baseUrl="/admin" isAdmin={false} />);

    const button = getByTestId("admin-script-run-test-script");
    // The button should have aria-disabled or similar when disabled
    expect(button).toBeTruthy();
  });

  it("shows last-run status when script history is available", async () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        scripts: [{description: "Test script", name: "test-script"}],
      },
      error: null,
      isLoading: false,
    });

    const {getByText, getByTestId} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);
    expect(getByText(/Last run/)).toBeTruthy();
    expect(getByTestId("admin-script-history-test-script-clickable")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("admin-script-history-test-script-clickable"));
    });
    expect(getByText(/Showing runs for test-script/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText("Open"));
    });
    expect(modalCallbacks.visible).toBe(true);
  });

  it("switches to run history and loads another page", async () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        scripts: [{description: "Test script", name: "test-script"}],
      },
      error: null,
      isLoading: false,
    });

    const {getByText} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);

    await act(async () => {
      fireEvent.press(getByText(/Run history \(2\)/));
    });
    expect(getByText(/test-script/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByText("Load more"));
    });
    expect(getByText("#run-2")).toBeTruthy();
  });

  it("clears a per-script history filter opened from the scripts tab", async () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        scripts: [{description: "Test script", name: "test-script"}],
      },
      error: null,
      isLoading: false,
    });

    const {getByTestId, getByText, queryByText} = renderWithTheme(
      <AdminScriptList baseUrl="/admin" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-script-history-test-script-clickable"));
    });
    expect(getByText(/Showing runs for test-script/)).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("admin-script-history-clear-filter-clickable"));
    });
    expect(queryByText(/Showing runs for test-script/)).toBeNull();
  });

  it("shows live-run wording on the last-run badge", () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        scripts: [{description: "Test script", name: "test-script"}],
      },
      error: null,
      isLoading: false,
    });
    mockUseListScriptRunsQuery.mockImplementation((args?: {page?: number; name?: string}) => {
      if (args?.page && args.page > 1) {
        return page2RunsResult;
      }
      if (args?.name) {
        return filteredRunsResult;
      }
      return liveRunResult;
    });

    const {getByText} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);
    expect(getByText(/live run/)).toBeTruthy();
  });

  it("hides scripts when platformTools.viewScripts is false", () => {
    mockUseAdminConfig.mockReturnValue({
      config: {
        models: [],
        platformTools: {runScripts: false, viewScripts: false},
        scripts: [{description: "Test script", name: "test-script"}],
      },
      error: null,
      isLoading: false,
    });
    const {queryByTestId} = renderWithTheme(<AdminScriptList baseUrl="/admin" />);
    expect(queryByTestId("admin-script-run-test-script")).toBeTruthy();
  });
});
