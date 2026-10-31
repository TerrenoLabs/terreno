// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {
  configureAdminModelApiDouble,
  resetAdminModelApiDouble,
} from "./testing/useAdminModelApiDouble";
import type {AdminConfigResponse, AdminSyncConflicts, AdminSyncDb} from "./types";

const REGRESSION_TITLE = "Review the sync status banner — admin window verified";
const AUTOCORRECT_LOOP_TITLE =
  "Tetginsbhep al attempt to trigger loop crash now via extended typed input to reach threshold fo maximum update depth exc";

const routerBack = mock(() => {});
const routerPush = mock(() => {});
const setOptions = mock((_opts: Record<string, unknown>) => {});

const stableNavigation = {setOptions};
const unstableUseNavigation = (): {setOptions: typeof setOptions} => ({setOptions});

mock.module("expo-router", () => ({
  router: {back: routerBack, push: routerPush},
  useNavigation: () => stableNavigation,
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

const readState: {data: Record<string, unknown> | null; isLoading: boolean} = {
  data: null,
  isLoading: false,
};

const configureUpdateDepthAdminApiDouble = (): void => {
  resetAdminModelApiDouble();
  configureAdminModelApiDouble({
    useBulkPatchMutation: () => [
      mock(() => ({unwrap: async () => ({updated: 1})})),
      {isLoading: false},
    ],
    useCreateMutation: () => [
      mock(() => ({unwrap: async () => ({_id: "new"})})),
      {isLoading: false},
    ],
    useDeleteMutation: () => [mock(() => ({unwrap: async () => ({})})), {isLoading: false}],
    useListQuery: () => ({data: {data: [], total: 0}, isLoading: false, refetch: async () => ({})}),
    useReadQuery: () => ({
      data: readState.data,
      error: null,
      isLoading: readState.isLoading,
    }),
    useUpdateMutation: () => [
      mock(() => ({unwrap: async () => ({_id: "todo-1"})})),
      {isLoading: false},
    ],
  });
};

const syncDb: AdminSyncDb = {
  hydrateWindow: mock(async () => ({hydratedIds: ["todo-1"]})),
  mutate: mock(() => ({id: "todo-1", mutationId: "mutation-id"})),
  store: {
    getEntity: () => undefined,
    raw: {
      addTableListener: () => "listener",
      delListener: () => {},
    },
  },
};

import {AdminModelForm} from "./AdminModelForm";
import {AdminProvider} from "./AdminProvider";

const todoModelConfig = {
  adminBroadcast: true,
  defaultSort: "-created",
  displayName: "Todos",
  fieldOrder: ["title", "tags", "priority", "completed", "ownerId"],
  fields: {
    _id: {required: true, type: "string"},
    completed: {default: false, required: false, type: "boolean"},
    ownerId: {ref: "User", required: true, type: "objectid"},
    priority: {
      enum: ["low", "medium", "high"],
      required: false,
      type: "string",
    },
    tags: {itemType: "string", required: false, type: "array"},
    title: {required: true, type: "string"},
  },
  fieldsets: [
    {fields: ["title", "tags", "priority", "completed"], title: "Task"},
    {fields: ["ownerId"], title: "Ownership"},
  ],
  listFields: ["title", "completed"],
  name: "Todo",
  readonlyFields: ["ownerId"],
  routePath: "/admin/todos",
  syncCollection: "todos",
};

const renderTodoEditForm = (
  syncConflicts?: AdminSyncConflicts
): ReturnType<typeof renderWithTheme> =>
  renderWithTheme(
    <AdminProvider
      apiBase="/admin"
      getAuthHeaders={() => ({})}
      syncConflicts={syncConflicts}
      syncDb={syncDb}
    >
      <AdminModelForm apiBase="/admin" itemId="todo-1" mode="edit" modelName="Todo" />
    </AdminProvider>
  );

describe("AdminModelForm update-depth regression", () => {
  beforeEach(() => {
    configureUpdateDepthAdminApiDouble();
    setOptions.mockClear();
    configState.config = {
      customScreens: [],
      models: [todoModelConfig],
      scripts: [],
    };
    readState.data = {
      completed: false,
      ownerId: "user-1",
      priority: "medium",
      tags: ["sync"],
      title: "Original title",
    };
    readState.isLoading = false;
  });

  it("types an autocorrect-sensitive title without runaway setOptions under stable navigation", async () => {
    const view = renderTodoEditForm({
      conflicts: [],
      resolve: () => {},
    });
    const titleField = view.getByTestId("admin-field-title");

    await act(async () => {
      fireEvent.changeText(titleField, AUTOCORRECT_LOOP_TITLE);
    });

    assert.isAtMost(
      setOptions.mock.calls.length,
      3,
      `setOptions called ${setOptions.mock.calls.length} times after one changeText`
    );
    expect(titleField.props.value).toBe(AUTOCORRECT_LOOP_TITLE);
  });

  it("types the reported title without runaway setOptions under stable navigation", async () => {
    const view = renderTodoEditForm({
      conflicts: [],
      resolve: () => {},
    });
    const titleField = view.getByTestId("admin-field-title");

    await act(async () => {
      fireEvent.changeText(titleField, REGRESSION_TITLE);
    });

    assert.isAtMost(
      setOptions.mock.calls.length,
      3,
      `setOptions called ${setOptions.mock.calls.length} times after one changeText`
    );
    expect(titleField.props.value).toBe(REGRESSION_TITLE);
  });
});

describe("AdminModelForm update-depth regression (setOptions triggers parent re-render)", () => {
  let parentRerender: (() => void) | null = null;

  const setOptionsWithRerender = mock((_opts: Record<string, unknown>) => {
    parentRerender?.();
  });

  afterEach(() => {
    parentRerender = null;
    mock.module("expo-router", () => ({
      router: {back: routerBack, push: routerPush},
      useNavigation: () => stableNavigation,
    }));
  });

  beforeEach(() => {
    configureUpdateDepthAdminApiDouble();
    mock.module("expo-router", () => ({
      router: {back: routerBack, push: routerPush},
      useNavigation: () => ({setOptions: setOptionsWithRerender}),
    }));
    setOptionsWithRerender.mockClear();
    configState.config = {
      customScreens: [],
      models: [todoModelConfig],
      scripts: [],
    };
    readState.data = {
      completed: false,
      ownerId: "user-1",
      priority: "medium",
      tags: ["sync"],
      title: "Original title",
    };
    readState.isLoading = false;
  });

  it("preserves per-character typing when setOptions forces a parent re-render each keystroke", async () => {
    const form = (
      <AdminProvider
        apiBase="/admin"
        getAuthHeaders={() => ({})}
        syncConflicts={{conflicts: [], resolve: () => {}}}
        syncDb={syncDb}
      >
        <AdminModelForm apiBase="/admin" itemId="todo-1" mode="edit" modelName="Todo" />
      </AdminProvider>
    );
    const view = renderWithTheme(form);

    parentRerender = () => {
      view.rerender(form);
    };

    const titleField = view.getByTestId("admin-field-title");
    const setOptionsBeforeTyping = setOptionsWithRerender.mock.calls.length;

    for (let i = 0; i < REGRESSION_TITLE.length; i++) {
      const partial = REGRESSION_TITLE.slice(0, i + 1);
      await act(async () => {
        fireEvent.changeText(titleField, partial);
      });
    }

    const field = view.getByTestId("admin-field-title");
    expect(field.props.value).toBe(REGRESSION_TITLE);
    const setOptionsDuringTyping =
      setOptionsWithRerender.mock.calls.length - setOptionsBeforeTyping;
    assert.equal(
      setOptionsDuringTyping,
      0,
      `setOptions called ${setOptionsDuringTyping} times during per-character title typing`
    );
  });

  it("does not recurse when navigation.setOptions forces a parent re-render on title change", async () => {
    const form = (
      <AdminProvider
        apiBase="/admin"
        getAuthHeaders={() => ({})}
        syncConflicts={{conflicts: [], resolve: () => {}}}
        syncDb={syncDb}
      >
        <AdminModelForm apiBase="/admin" itemId="todo-1" mode="edit" modelName="Todo" />
      </AdminProvider>
    );
    const view = renderWithTheme(form);

    parentRerender = () => {
      view.rerender(form);
    };

    const titleField = view.getByTestId("admin-field-title");
    await act(async () => {
      fireEvent.changeText(titleField, REGRESSION_TITLE);
    });

    assert.isAtMost(
      setOptionsWithRerender.mock.calls.length,
      3,
      `setOptions rerender storm: ${setOptionsWithRerender.mock.calls.length}`
    );
    expect(titleField.props.value).toBe(REGRESSION_TITLE);
  });
});

describe("AdminModelForm update-depth regression (unstable navigation)", () => {
  afterEach(() => {
    mock.module("expo-router", () => ({
      router: {back: routerBack, push: routerPush},
      useNavigation: () => stableNavigation,
    }));
  });

  beforeEach(() => {
    configureUpdateDepthAdminApiDouble();
    mock.module("expo-router", () => ({
      router: {back: routerBack, push: routerPush},
      useNavigation: unstableUseNavigation,
    }));
    setOptions.mockClear();
    configState.config = {
      customScreens: [],
      models: [todoModelConfig],
      scripts: [],
    };
    readState.data = {
      completed: false,
      ownerId: "user-1",
      priority: "medium",
      tags: ["sync"],
      title: "Original title",
    };
    readState.isLoading = false;
  });

  it("does not run away when useNavigation returns a new object on every render", async () => {
    const view = renderTodoEditForm({
      conflicts: [],
      resolve: () => {},
    });
    const titleField = view.getByTestId("admin-field-title");
    const setOptionsBefore = setOptions.mock.calls.length;

    await act(async () => {
      fireEvent.changeText(titleField, REGRESSION_TITLE);
    });

    const setOptionsAfterOneChange = setOptions.mock.calls.length - setOptionsBefore;
    assert.isAtMost(
      setOptionsAfterOneChange,
      2,
      `setOptions called ${setOptionsAfterOneChange} times after one changeText with unstable navigation`
    );
    expect(titleField.props.value).toBe(REGRESSION_TITLE);
  });
});

const PER_CHAR_TITLE = "Review";

describe("AdminModelForm update-depth regression (field onChange identity)", () => {
  beforeEach(() => {
    configureUpdateDepthAdminApiDouble();
    setOptions.mockClear();
    configState.config = {
      customScreens: [],
      models: [todoModelConfig],
      scripts: [],
    };
    readState.data = {
      completed: false,
      ownerId: "user-1",
      priority: "medium",
      tags: ["sync"],
      title: "Original title",
    };
    readState.isLoading = false;
  });

  it("keeps a stable title onChange callback across formState updates", async () => {
    const view = renderTodoEditForm({
      conflicts: [],
      resolve: () => {},
    });
    const initialField = view.getByTestId("admin-field-title");
    const initialOnChange = initialField.props.onChange;

    await act(async () => {
      fireEvent.changeText(initialField, "R");
    });

    const afterField = view.getByTestId("admin-field-title");
    expect(afterField.props.onChange).toBe(initialOnChange);
    expect(afterField.props.value).toBe("R");
  });

  it("preserves per-character typing when onChange identity churn triggers stale RN Web rebinds", async () => {
    const view = renderTodoEditForm({
      conflicts: [],
      resolve: () => {},
    });

    for (let i = 0; i < PER_CHAR_TITLE.length; i++) {
      const partial = PER_CHAR_TITLE.slice(0, i + 1);
      const field = view.getByTestId("admin-field-title");
      const previousOnChange = field.props.onChange;
      const previousValue = field.props.value;

      await act(async () => {
        fireEvent.changeText(field, partial);
      });

      const fieldAfterChange = view.getByTestId("admin-field-title");
      if (fieldAfterChange.props.onChange !== previousOnChange) {
        await act(async () => {
          previousOnChange(previousValue ?? "");
        });
      }
    }

    const field = view.getByTestId("admin-field-title");
    expect(field.props.value).toBe(PER_CHAR_TITLE);
  });
});
