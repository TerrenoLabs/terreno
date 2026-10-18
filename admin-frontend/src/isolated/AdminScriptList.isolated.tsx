// noExplicitAny: hook doubles expose loosely typed query results to the component.
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse, ScriptRun} from "../types";

const config: AdminConfigResponse = {
  models: [],
  scripts: [{description: "Migrates records", name: "migrate"}],
};

const run: ScriptRun = {
  _id: "task-123456",
  completedAt: "2026-09-01T10:00:02.000Z",
  created: "2026-09-01T10:00:00.000Z",
  createdByName: "Admin",
  isDryRun: false,
  logs: [
    {
      level: "error",
      message: "failed",
      timestamp: "2026-09-01T10:00:01.000Z",
    },
  ],
  startedAt: "2026-09-01T10:00:00.000Z",
  status: "failed",
  taskType: "migrate",
  updated: "2026-09-01T10:00:02.000Z",
};

const queryResult = {
  data: {data: [run], limit: 25, more: true, page: 1, total: 2},
  isLoading: false,
};

mock.module("../useAdminConfig", () => ({
  useAdminConfig: () => ({config, error: null, isLoading: false}),
}));

mock.module("../useAdminScripts", () => ({
  useAdminScripts: () => ({
    useListScriptRunsQuery: () => queryResult,
  }),
}));

const modalProps: Record<string, unknown> = {};
mock.module("../AdminScriptRunModal", () => ({
  AdminScriptRunModal: (props: Record<string, unknown>) => {
    Object.assign(modalProps, props);
    return null;
  },
}));

import {AdminScriptList} from "../AdminScriptList";

describe("AdminScriptList history", () => {
  beforeEach(() => {
    for (const key of Object.keys(modalProps)) {
      delete modalProps[key];
    }
  });

  it("renders the latest run and opens per-script history", async () => {
    const {UNSAFE_root, getByTestId, getByText} = renderWithTheme(
      <AdminScriptList baseUrl="/admin" />
    );

    expect(getByText(/Last run/)).toBeDefined();
    expect(getByText("Run history (2)")).toBeDefined();
    await act(async () => {
      fireEvent.press(getByTestId("admin-script-history-migrate-clickable"));
    });
    expect(getByText("Showing runs for migrate. Open a run to review its output.")).toBeDefined();
    expect(getByText("Load more")).toBeDefined();

    const openButtons = UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        node.props?.text === "Open" && typeof node.props?.onClick === "function"
    );
    await act(async () => {
      openButtons[0].props.onClick();
    });
    expect(modalProps.historyTaskId).toBe("task-123456");
    expect(modalProps.scriptName).toBe("migrate");
  });

  it("switches to global history, loads more, and clears a script filter", async () => {
    const {UNSAFE_root, getByTestId, getByText} = renderWithTheme(
      <AdminScriptList baseUrl="/admin" />
    );
    const segmentedControls = UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        Array.isArray(node.props?.items) && typeof node.props?.onChange === "function"
    );

    await act(async () => {
      segmentedControls[0].props.onChange(1);
    });
    expect(
      getByText("Every dry and live run is logged. Open a run to review its output.")
    ).toBeDefined();

    const loadMoreButtons = UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        node.props?.text === "Load more" && typeof node.props?.onClick === "function"
    );
    await act(async () => {
      loadMoreButtons[0].props.onClick();
      segmentedControls[0].props.onChange(0);
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-script-history-migrate-clickable"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-script-history-clear-filter-clickable"));
    });
    expect(
      getByText("Every dry and live run is logged. Open a run to review its output.")
    ).toBeDefined();
  });
});
