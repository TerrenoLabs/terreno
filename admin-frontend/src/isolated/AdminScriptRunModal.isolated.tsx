// noExplicitAny: test mocks use loosely typed hook doubles and UNSAFE_root traversal
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../../ui/src/test-utils";

// Mock @terreno/ui so the Modal renders its children inline. The real Modal
// portal isn't mounted by the test renderer, which hides the cancel button.
mock.module("@terreno/ui", () => {
  const RN = require("react-native");
  const ReactMod = require("react");
  const Box = ({children, ...rest}: Record<string, unknown>) =>
    ReactMod.createElement(RN.View, rest, children);
  const Button = ({disabled, text, onClick, testID}: Record<string, unknown>) =>
    ReactMod.createElement(
      RN.Pressable,
      {disabled, onPress: onClick, testID},
      ReactMod.createElement(RN.Text, {}, text)
    );
  const Heading = ({children}: Record<string, unknown>) =>
    ReactMod.createElement(RN.Text, {}, children);
  const Icon = () => ReactMod.createElement(RN.View, {});
  const Modal = ({children, visible}: Record<string, unknown>) => {
    if (!visible) return null;
    return ReactMod.createElement(RN.View, {testID: "mock-modal"}, children);
  };
  const Spinner = () => ReactMod.createElement(RN.View, {testID: "spinner"});
  const Text = ({children, ...rest}: Record<string, unknown>) =>
    ReactMod.createElement(RN.Text, rest, children);
  const Badge = ({value}: Record<string, unknown>) =>
    ReactMod.createElement(RN.Text, {}, value as string);
  const Banner = ({text}: Record<string, unknown>) =>
    ReactMod.createElement(RN.Text, {}, text as string);
  const TextField = ({value, placeholder, onChange, testID}: Record<string, unknown>) =>
    ReactMod.createElement(RN.TextInput, {
      onChangeText: onChange,
      placeholder: placeholder as string,
      testID: testID ?? (placeholder === "Search output" ? "mock-output-search" : undefined),
      value: (value as string) || "",
    });
  return {Badge, Banner, Box, Button, Heading, Icon, Modal, Spinner, Text, TextField};
});

interface TaskState {
  data: {task: Record<string, unknown>} | undefined;
  error: unknown;
  isLoading: boolean;
}
interface MockState {
  task: TaskState;
  runImpl: (arg: unknown) => {unwrap: () => Promise<unknown>};
  cancelImpl: (arg: unknown) => {unwrap: () => Promise<unknown>};
}

const state: MockState = {
  cancelImpl: () => ({unwrap: () => Promise.resolve({message: "cancelled"})}),
  runImpl: () => ({unwrap: () => Promise.resolve({taskId: "task-123"})}),
  task: {data: undefined, error: null, isLoading: false},
};

const runCalls: unknown[] = [];
const cancelCalls: unknown[] = [];

// Stable function references so useEffect deps are reference-equal across
// renders (avoids re-firing the auto-start effect on every setState).
const stableRunScript = (arg: unknown): {unwrap: () => Promise<unknown>} => {
  runCalls.push(arg);
  return state.runImpl(arg);
};
const stableCancelTask = (arg: unknown): {unwrap: () => Promise<unknown>} => {
  cancelCalls.push(arg);
  return state.cancelImpl(arg);
};
const stableRunTuple = [stableRunScript, {isLoading: false}] as const;
const stableCancelTuple = [stableCancelTask, {isLoading: false}] as const;

mock.module("../useAdminScripts", () => ({
  useAdminScripts: () => ({
    useCancelScriptTaskMutation: () => stableCancelTuple,
    useGetScriptTaskQuery: () => state.task,
    useRunScriptMutation: () => stableRunTuple,
  }),
}));

import {AdminScriptRunModal} from "../AdminScriptRunModal";

const waitTicks = async (ms = 40): Promise<void> => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
};

const pressDryRun = async (getByTestId: (id: string) => ReactTestInstance): Promise<void> => {
  await act(async () => {
    fireEvent.press(getByTestId("admin-script-dry-run-button"));
  });
  await waitTicks();
};

describe("AdminScriptRunModal", () => {
  beforeEach(() => {
    runCalls.length = 0;
    cancelCalls.length = 0;
    state.task = {data: undefined, error: null, isLoading: false};
    state.runImpl = () => ({unwrap: () => Promise.resolve({taskId: "task-123"})});
    state.cancelImpl = () => ({unwrap: () => Promise.resolve({message: "cancelled"})});
  });

  it("renders without crashing when not visible", () => {
    const {toJSON} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="test-script"
        visible={false}
      />
    );
    expect(toJSON()).toBeDefined();
    expect(runCalls.length).toBe(0);
  });

  it("shows confirm-phase Dry Run, Run, and Cancel buttons when visible", () => {
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => undefined}
        scriptName="my-script"
        visible
      />
    );

    expect(getByTestId("admin-script-dry-run-button")).toBeTruthy();
    expect(getByTestId("admin-script-wet-run-button")).toBeTruthy();
    expect(getByTestId("admin-script-confirm-cancel-button")).toBeTruthy();
    expect(runCalls.length).toBe(0);
  });

  it("calls onDismiss from confirm Cancel without starting a run", async () => {
    const onDismiss = mock(() => undefined);

    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal baseUrl="/admin" onDismiss={onDismiss} scriptName="my-script" visible />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-script-confirm-cancel-button"));
    });

    expect(onDismiss).toHaveBeenCalled();
    expect(runCalls.length).toBe(0);
  });

  it("starts a dry run when Dry Run is pressed", async () => {
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => undefined}
        scriptName="my-script"
        visible
      />
    );

    await pressDryRun(getByTestId);

    expect(runCalls.length).toBe(1);
    expect(runCalls[0]).toEqual({name: "my-script", wetRun: false});
  });

  it("starts a wet run when the Run button is pressed", async () => {
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => undefined}
        scriptName="my-script"
        visible
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-script-wet-run-button"));
    });
    await waitTicks();

    expect(runCalls.length).toBe(1);
    expect(runCalls[0]).toEqual({name: "my-script", wetRun: true});
  });

  it("hides the wet-run button when dryRunOnly is true", () => {
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        dryRunOnly
        onDismiss={() => undefined}
        scriptName="my-script"
        visible
      />
    );

    expect(getByTestId("admin-script-dry-run-button")).toBeTruthy();
    expect(getByTestId("admin-script-confirm-cancel-button")).toBeTruthy();
    expect(queryByTestId("admin-script-wet-run-button")).toBeNull();
  });

  it("renders the script description in the confirm phase", () => {
    const {getByText} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => undefined}
        scriptDescription="Migrates legacy records"
        scriptName="migrate-data"
        visible
      />
    );

    expect(getByText("Migrates legacy records")).toBeTruthy();
    expect(getByText("migrate-data")).toBeTruthy();
  });

  it("renders running phase with progress details", async () => {
    state.task = {
      data: {
        task: {
          progress: {message: "Working", percentage: 42, stage: "processing"},
          status: "running",
        },
      },
      error: null,
      isLoading: false,
    };
    const {toJSON} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="my-script"
        visible={true}
      />
    );
    await waitTicks();
    expect(toJSON()).toBeDefined();
  });

  it("renders running phase with zero percentage omitted", async () => {
    state.task = {
      data: {task: {progress: {percentage: 0}, status: "running"}},
      error: null,
      isLoading: false,
    };
    const {toJSON} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="zero-pct"
        visible={true}
      />
    );
    await waitTicks();
    expect(toJSON()).toBeDefined();
  });

  it("renders completed status with results", async () => {
    state.task = {
      data: {
        task: {
          result: ["line1", "line2", "line3"],
          status: "completed",
        },
      },
      error: null,
      isLoading: false,
    };
    const {toJSON} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="done-script"
        visible={true}
      />
    );
    await waitTicks();
    expect(toJSON()).toBeDefined();
  });

  it("renders failed status with error message", async () => {
    state.task = {
      data: {
        task: {error: "Failed to process", status: "failed"},
      },
      error: null,
      isLoading: false,
    };
    const {toJSON} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="fail-script"
        visible={true}
      />
    );
    await waitTicks();
    expect(toJSON()).toBeDefined();
  });

  it("renders cancelled status", async () => {
    state.task = {
      data: {task: {status: "cancelled"}},
      error: null,
      isLoading: false,
    };
    const {toJSON} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="cancelled-script"
        visible={true}
      />
    );
    await waitTicks();
    expect(toJSON()).toBeDefined();
  });

  it("shows the done view (no stuck spinner) once the task reaches completed", async () => {
    // Start in confirm with no task so the dry-run button is available.
    state.task = {data: undefined, error: null, isLoading: false};
    const {getByTestId, queryByTestId, rerender} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="wet-script"
        visible={true}
      />
    );

    await pressDryRun(getByTestId);
    // While running with no terminal task yet, the spinner + cancel are shown.
    expect(queryByTestId("spinner")).toBeTruthy();
    expect(queryByTestId("admin-script-cancel-button")).toBeTruthy();

    // Simulate the poll returning a completed task with the framework's 100% progress.
    state.task = {
      data: {
        task: {
          progress: {message: "Done", percentage: 100, stage: "Complete"},
          result: ["ok"],
          status: "completed",
        },
      },
      error: null,
      isLoading: false,
    };
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="wet-script"
        visible={true}
      />
    );
    await waitTicks();

    // The done view must render — no lingering spinner or cancel button.
    expect(queryByTestId("spinner")).toBeNull();
    expect(queryByTestId("admin-script-cancel-button")).toBeNull();
  });

  it("offers a live run from the done view after a dry run completes", async () => {
    state.task = {data: undefined, error: null, isLoading: false};
    const {getByTestId, rerender} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="migrate"
        visible={true}
      />
    );

    await pressDryRun(getByTestId);

    state.task = {
      data: {task: {isDryRun: true, result: ["all good"], status: "completed"}},
      error: null,
      isLoading: false,
    };
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="migrate"
        visible={true}
      />
    );
    await waitTicks();

    const wetButton = getByTestId("admin-script-done-wet-run-button");
    expect(wetButton).toBeTruthy();

    runCalls.length = 0;
    await act(async () => {
      fireEvent.press(wetButton);
    });
    await waitTicks();

    const startedWet = runCalls.some((c) => {
      const arg = c as {name?: string; wetRun?: boolean};
      return arg?.name === "migrate" && arg?.wetRun === true;
    });
    expect(startedWet).toBe(true);
  });

  it("resets to the confirm step when reopened so a previous run does not linger", async () => {
    // First open: complete a run so the done view is showing.
    state.task = {
      data: {task: {result: ["done"], status: "completed"}},
      error: null,
      isLoading: false,
    };
    const {getByTestId, queryByTestId, rerender} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="migrate"
        visible={false}
      />
    );
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="migrate"
        visible={true}
      />
    );
    await waitTicks();

    // Close, then reopen: the confirm step (dry-run button) must be shown again, not
    // the previous run's results.
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="migrate"
        visible={false}
      />
    );
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="migrate"
        visible={true}
      />
    );
    await waitTicks();

    expect(getByTestId("admin-script-dry-run-button")).toBeTruthy();
    expect(queryByTestId("admin-script-done-wet-run-button")).toBeNull();
  });

  it("early-returns when scriptName is null", async () => {
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal baseUrl="/admin" onDismiss={() => {}} scriptName={null} visible={true} />
    );
    await act(async () => {
      fireEvent.press(getByTestId("admin-script-dry-run-button"));
    });
    await waitTicks();
    expect(runCalls.length).toBe(0);
  });

  it("presses the cancel button to cancel the running task", async () => {
    state.task = {
      data: {task: {status: "running"}},
      error: null,
      isLoading: false,
    };
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="cancel-me"
        visible={true}
      />
    );
    await pressDryRun(getByTestId);
    await act(async () => {
      fireEvent.press(getByTestId("admin-script-cancel-button"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(cancelCalls).toEqual(["task-123"]);
  });

  it("swallows cancel errors so UI stays responsive", async () => {
    state.cancelImpl = () => ({unwrap: () => Promise.reject(new Error("cancel failed"))});
    state.task = {
      data: {task: {status: "running"}},
      error: null,
      isLoading: false,
    };
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="cancel-fail"
        visible={true}
      />
    );
    await pressDryRun(getByTestId);
    await act(async () => {
      fireEvent.press(getByTestId("admin-script-cancel-button"));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(cancelCalls).toEqual(["task-123"]);
  });

  it("handles runScript rejection with error.data.detail", async () => {
    state.runImpl = () => ({
      unwrap: () => Promise.reject({data: {detail: "Detailed failure"}}),
    });
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="failing"
        visible={true}
      />
    );
    await pressDryRun(getByTestId);
    expect(runCalls.length).toBe(1);
  });

  it("handles runScript rejection with error.data.title (no detail)", async () => {
    state.runImpl = () => ({
      unwrap: () => Promise.reject({data: {title: "Title failure"}}),
    });
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="title-only"
        visible={true}
      />
    );
    await pressDryRun(getByTestId);
    expect(runCalls.length).toBe(1);
  });

  it("handles runScript rejection with empty payload (default message path)", async () => {
    state.runImpl = () => ({
      unwrap: () => Promise.reject(new Error("network boom")),
    });
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="no-payload"
        visible={true}
      />
    );
    await pressDryRun(getByTestId);
    expect(runCalls.length).toBe(1);
  });

  it("renders results with many lines (exercises long-result branch)", async () => {
    state.task = {
      data: {
        task: {
          result: Array.from({length: 25}, (_v, i) => `line-${i}`),
          status: "completed",
        },
      },
      error: null,
      isLoading: false,
    };
    const {toJSON} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="long-results"
        visible={true}
      />
    );
    await waitTicks();
    expect(toJSON()).toBeDefined();
  });

  it("returns early from handleCancel when taskId is still null", async () => {
    // Never set a taskId: runImpl never resolves to set one. The Modal stays in
    // the running phase with taskId === null, so pressing cancel hits the guard.
    state.runImpl = () => ({unwrap: () => new Promise(() => {})});
    state.task = {
      data: {task: {status: "running"}},
      error: null,
      isLoading: false,
    };
    const {getByTestId} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="pending"
        visible={true}
      />
    );
    await pressDryRun(getByTestId);
    await act(async () => {
      fireEvent.press(getByTestId("admin-script-cancel-button"));
    });
    // No cancel mutation should have been called since taskId was null
    expect(cancelCalls.length).toBe(0);
  });

  it("opens read-only history mode with prior task output and duration", async () => {
    state.task = {
      data: {
        task: {
          completedAt: "2024-06-01T12:00:05Z",
          created: "2024-06-01T12:00:00Z",
          isDryRun: false,
          result: ["ok line", "ERROR: bad row", "another ok"],
          startedAt: "2024-06-01T12:00:00Z",
          status: "completed",
        },
      },
      error: null,
      isLoading: false,
    };
    const {getByText} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        historyTaskId="hist-99"
        onDismiss={() => {}}
        scriptName="history-script"
        visible={true}
      />
    );
    await waitTicks();
    expect(getByText("history-script")).toBeTruthy();
    expect(getByText(/Completed with 1 error/)).toBeTruthy();
  });

  it("filters output to errors and searches result lines", async () => {
    state.task = {data: undefined, error: null, isLoading: false};
    const {getByPlaceholderText, getByTestId, getByText, queryByText, rerender} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="filter-script"
        visible={true}
      />
    );
    await pressDryRun(getByTestId);
    state.task = {
      data: {
        task: {
          isDryRun: true,
          result: ["success row", "failed: bad thing", "success two"],
          status: "completed",
        },
      },
      error: null,
      isLoading: false,
    };
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="filter-script"
        visible={true}
      />
    );
    await waitTicks();

    await act(async () => {
      fireEvent.press(getByText("Errors (1)"));
    });
    expect(getByText("failed: bad thing")).toBeTruthy();
    expect(queryByText("success row")).toBeNull();

    await act(async () => {
      fireEvent.press(getByText("All (3)"));
      fireEvent.changeText(getByPlaceholderText("Search output"), "success two");
    });
    expect(getByText("success two")).toBeTruthy();
    expect(queryByText("failed: bad thing")).toBeNull();
  });

  it("exports CSV and JSON when browser download APIs exist", async () => {
    state.task = {data: undefined, error: null, isLoading: false};
    const click = mock(() => undefined);
    const anchor = {click, download: "", href: ""};
    const createElement = mock((tag: string) => {
      if (tag === "a") {
        return anchor;
      }
      return {};
    });
    const originalDocument = globalThis.document;
    const originalUrl = globalThis.URL;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {createElement},
    });
    Object.defineProperty(globalThis, "URL", {
      configurable: true,
      value: {
        createObjectURL: () => "blob:test",
        revokeObjectURL: () => undefined,
      },
    });

    const {getByTestId, getByText, rerender} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="export-script"
        visible={true}
      />
    );
    await pressDryRun(getByTestId);
    state.task = {
      data: {
        task: {
          isDryRun: true,
          result: ["line one", "line two"],
          status: "completed",
        },
      },
      error: null,
      isLoading: false,
    };
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="export-script"
        visible={true}
      />
    );
    await waitTicks();

    await act(async () => {
      fireEvent.press(getByText("Export CSV"));
      fireEvent.press(getByText("Export JSON"));
    });

    expect(createElement).toHaveBeenCalledWith("a");
    expect(click.mock.calls.length).toBeGreaterThan(0);

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
    Object.defineProperty(globalThis, "URL", {
      configurable: true,
      value: originalUrl,
    });
  });

  it("re-runs dry from the done view after a completed dry run", async () => {
    state.task = {data: undefined, error: null, isLoading: false};
    const {getByTestId, getByText, rerender} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="migrate"
        visible={true}
      />
    );

    await pressDryRun(getByTestId);

    state.task = {
      data: {task: {isDryRun: true, result: ["all good"], status: "completed"}},
      error: null,
      isLoading: false,
    };
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="migrate"
        visible={true}
      />
    );
    await waitTicks();

    runCalls.length = 0;
    await act(async () => {
      fireEvent.press(getByText("Re-run dry"));
    });
    await waitTicks();

    expect(runCalls.some((call) => (call as {wetRun?: boolean}).wetRun === false)).toBe(true);
  });

  it("renders without error when visible flips from true→false (reset cycle)", async () => {
    const {rerender} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="reset-cycle"
        visible={true}
      />
    );
    await waitTicks();
    rerender(
      <AdminScriptRunModal
        baseUrl="/admin"
        onDismiss={() => {}}
        scriptName="reset-cycle"
        visible={false}
      />
    );
  });

  it("renders, filters, searches, and exports a completed history run", async () => {
    state.task = {
      data: {
        task: {
          _id: "history-1",
          completedAt: "2026-09-01T10:00:02.000Z",
          created: "2026-09-01T10:00:00.000Z",
          isDryRun: true,
          result: ["updated todo", "ERROR failed todo"],
          startedAt: "2026-09-01T10:00:00.000Z",
          status: "completed",
        },
      },
      error: null,
      isLoading: false,
    };
    const clickedDownloads: string[] = [];
    const originalDocument = globalThis.document;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: () => ({
          click: () => clickedDownloads.push("clicked"),
          download: "",
          href: "",
        }),
      },
    });
    URL.createObjectURL = () => "blob:test";
    URL.revokeObjectURL = () => undefined;

    const {getByTestId, getByText} = renderWithTheme(
      <AdminScriptRunModal
        baseUrl="/admin"
        historyTaskId="history-1"
        onDismiss={() => undefined}
        scriptDescription="Historical run"
        scriptName="migrate"
        visible
      />
    );
    await waitTicks();

    expect(getByText("Historical run")).toBeDefined();
    expect(getByText("updated todo")).toBeDefined();
    await act(async () => {
      fireEvent.press(getByText("Errors (1)"));
    });
    expect(getByText("ERROR failed todo")).toBeDefined();
    await act(async () => {
      fireEvent.changeText(getByTestId("mock-output-search"), "missing");
    });
    expect(getByText("No output lines match this filter.")).toBeDefined();
    await act(async () => {
      fireEvent.press(getByText("Export CSV"));
      fireEvent.press(getByText("Export JSON"));
    });
    expect(clickedDownloads).toHaveLength(2);

    if (originalDocument === undefined) {
      Reflect.deleteProperty(globalThis, "document");
    } else {
      Object.defineProperty(globalThis, "document", {
        configurable: true,
        value: originalDocument,
      });
    }
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });
});
