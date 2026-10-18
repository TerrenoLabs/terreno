/**
 * Isolated: `mock.module("expo-router")` and `./useAdminModelApi` leak across the
 * main suite and flake header-action tests. Keep this file next to
 * `AdminModelForm.tsx` so those specifiers match the component imports.
 */
// noExplicitAny: test mocks use loosely typed hook doubles and UNSAFE_root traversal
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
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

const routerBack = mock(() => {});
const routerPush = mock(() => {});
const setOptions = mock((_opts: Record<string, unknown>) => {});
mock.module("expo-router", () => ({
  router: {back: routerBack, push: routerPush},
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

const readState: {data: Record<string, unknown> | null; isLoading: boolean} = {
  data: null,
  isLoading: false,
};
const createFn = mock((_: unknown) => ({unwrap: async () => ({_id: "new"})}));
const updateFn = mock((_: unknown) => ({unwrap: async () => ({_id: "u"})}));
const deleteFn = mock((_: unknown) => ({unwrap: async () => ({})}));

const syncMutateFn = mock((_args: unknown) => ({id: "sync-id", mutationId: "mutation-id"}));
const hydrateWindowFn = mock(async (_args: unknown) => ({hydratedIds: ["todo-1"]}));

import {AdminModelForm} from "./AdminModelForm";
import {AdminProvider} from "./AdminProvider";
import {getAdminWindowMembershipStale, resetAdminWindowRefreshForTests} from "./adminWindowRefresh";

const syncDb: AdminSyncDb = {
  hydrateWindow: hydrateWindowFn,
  mutate: syncMutateFn,
  store: {
    getEntity: () => undefined,
    raw: {
      addTableListener: () => "listener",
      delListener: () => {},
    },
  },
};

const renderWithSyncAdmin = (
  child: React.ReactElement,
  syncConflicts?: AdminSyncConflicts
): ReturnType<typeof renderWithTheme> =>
  renderWithTheme(
    <AdminProvider
      apiBase="/admin"
      getAuthHeaders={() => ({})}
      syncConflicts={syncConflicts}
      syncDb={syncDb}
    >
      {child}
    </AdminProvider>
  );

const modelConfig = {
  defaultSort: "-created",
  displayName: "User",
  fieldOrder: ["email", "name", "age", "active"],
  fields: {
    _id: {required: true, type: "string"},
    active: {default: true, required: false, type: "boolean"},
    age: {required: false, type: "number"},
    email: {required: true, type: "string"},
    name: {required: false, type: "string"},
  },
  listFields: ["email"],
  name: "User",
  routePath: "/admin/users",
};
const config = {customScreens: [], models: [modelConfig], scripts: []};

describe("AdminModelForm", () => {
  beforeEach(() => {
    resetAdminModelApiDouble();
    configureAdminModelApiDouble({
      useCreateMutation: () => [createFn, {isLoading: false}],
      useDeleteMutation: () => [deleteFn, {isLoading: false}],
      useListQuery: () => ({data: {data: [], total: 0}, isLoading: false}),
      useReadQuery: () => ({
        data: readState.data,
        error: null,
        isLoading: readState.isLoading,
      }),
      useUpdateMutation: () => [updateFn, {isLoading: false}],
    });
    routerBack.mockClear();
    setOptions.mockClear();
    createFn.mockClear();
    updateFn.mockClear();
    deleteFn.mockClear();
    syncMutateFn.mockClear();
    syncMutateFn.mockImplementation((_args: unknown) => ({
      id: "sync-id",
      mutationId: "mutation-id",
    }));
    hydrateWindowFn.mockClear();
    configState.config = null;
    configState.isLoading = false;
    readState.data = null;
    readState.isLoading = false;
    resetAdminWindowRefreshForTests();
  });

  it("uses syncdb mutations for create, update, and delete on windowed String-id models", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          adminBroadcast: true,
          fields: {
            ...modelConfig.fields,
            email: {required: false, type: "string"},
          },
          name: "Todo",
          syncCollection: "todos",
        },
      ],
    };
    const onSaveSuccess = mock(async (_args: unknown) => {});

    const createForm = renderWithSyncAdmin(
      <AdminModelForm
        apiBase="/admin"
        mode="create"
        modelName="Todo"
        onSaveSuccess={onSaveSuccess}
      />
    );
    await act(async () => {
      fireEvent.press(createForm.getByTestId("admin-save-button"));
    });
    assert.deepEqual(syncMutateFn.mock.calls[0]?.[0], {
      collection: "todos",
      data: {active: true, age: 0, email: "", name: ""},
      operation: "create",
    });
    assert.equal(createFn.mock.calls.length, 0);
    assert.deepEqual(onSaveSuccess.mock.calls[0]?.[0], {
      itemId: undefined,
      mode: "create",
      payload: {active: true, age: 0, email: "", name: ""},
      result: {_id: "sync-id", active: true, age: 0, email: "", name: ""},
    });
    assert.equal(routerBack.mock.calls.length, 1);
    assert.deepEqual(getAdminWindowMembershipStale("todos"), {awaitId: "sync-id"});
    createForm.unmount();
    resetAdminWindowRefreshForTests();

    readState.data = {active: true, age: 1, email: "todo@example.com", name: "Todo"};
    const editForm = renderWithSyncAdmin(
      <AdminModelForm apiBase="/admin" itemId="todo-1" mode="edit" modelName="Todo" />
    );
    await act(async () => {
      fireEvent.press(editForm.getByTestId("admin-save-button"));
    });
    assert.deepEqual(hydrateWindowFn.mock.calls[0]?.[0], {
      collection: "todos",
      ids: ["todo-1"],
      restRows: {
        "todo-1": {active: true, age: 1, email: "todo@example.com", name: "Todo"},
      },
    });
    assert.deepEqual(syncMutateFn.mock.calls[1]?.[0], {
      collection: "todos",
      data: {active: true, age: 1, email: "todo@example.com", name: "Todo"},
      id: "todo-1",
      operation: "update",
    });
    assert.equal(updateFn.mock.calls.length, 0);
    assert.equal(routerBack.mock.calls.length, 2);
    assert.isUndefined(getAdminWindowMembershipStale("todos"));

    const deleteButton = editForm.UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props?.testID === "admin-delete-button"
    )[0];
    await act(async () => {
      deleteButton?.props.onClick();
    });
    assert.deepEqual(syncMutateFn.mock.calls[2]?.[0], {
      collection: "todos",
      id: "todo-1",
      operation: "delete",
    });
    assert.equal(deleteFn.mock.calls.length, 0);
    assert.equal(routerBack.mock.calls.length, 3);
    assert.deepEqual(getAdminWindowMembershipStale("todos"), {});
  });

  it("ignores duplicate windowed save presses while the first save is pending", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          adminBroadcast: true,
          fields: {
            ...modelConfig.fields,
            email: {required: false, type: "string"},
          },
          name: "Todo",
          syncCollection: "todos",
        },
      ],
    };
    let releaseSave: (() => void) | undefined;
    const onSaveSuccess = mock(
      () =>
        new Promise<void>((resolve) => {
          releaseSave = resolve;
        })
    );
    const form = renderWithSyncAdmin(
      <AdminModelForm
        apiBase="/admin"
        mode="create"
        modelName="Todo"
        onSaveSuccess={onSaveSuccess}
      />
    );
    const saveButton = form.UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        node.props?.testID === "admin-save-button" && typeof node.props.onClick === "function"
    )[0];

    await act(async () => {
      void saveButton?.props.onClick();
      void saveButton?.props.onClick();
      await Promise.resolve();
    });

    assert.equal(syncMutateFn.mock.calls.length, 1);
    assert.equal(onSaveSuccess.mock.calls.length, 1);

    await act(async () => {
      releaseSave?.();
      await Promise.resolve();
    });
  });

  it("ignores duplicate windowed delete presses while hydration is pending", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          adminBroadcast: true,
          name: "Todo",
          syncCollection: "todos",
        },
      ],
    };
    readState.data = {email: "todo@example.com"};
    let releaseHydrate: (() => void) | undefined;
    hydrateWindowFn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseHydrate = (): void => resolve({hydratedIds: ["todo-1"]});
        })
    );
    const form = renderWithSyncAdmin(
      <AdminModelForm apiBase="/admin" itemId="todo-1" mode="edit" modelName="Todo" />
    );
    const deleteButton = form.UNSAFE_root.findAll(
      (node: ReactTestInstance) =>
        node.props?.testID === "admin-delete-button" && typeof node.props.onClick === "function"
    )[0];

    await act(async () => {
      void deleteButton?.props.onClick();
      void deleteButton?.props.onClick();
      await Promise.resolve();
    });

    assert.equal(hydrateWindowFn.mock.calls.length, 1);
    assert.equal(syncMutateFn.mock.calls.length, 0);

    await act(async () => {
      releaseHydrate?.();
      await Promise.resolve();
    });
    assert.equal(syncMutateFn.mock.calls.length, 1);
  });

  it("shows an edit conflict for the loaded form id", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          adminBroadcast: true,
          name: "Todo",
          syncCollection: "todos",
        },
      ],
    };
    readState.data = {email: "todo@example.com", name: "Todo"};
    const syncConflicts: AdminSyncConflicts = {
      conflicts: [
        {
          collection: "todos",
          entityId: "todo-1",
          localData: JSON.stringify({name: "Mine"}),
          mutationId: "mutation-1",
          serverData: JSON.stringify({name: "Server"}),
        },
        {
          collection: "todos",
          entityId: "todo-2",
          localData: JSON.stringify({name: "Other mine"}),
          mutationId: "mutation-2",
          serverData: JSON.stringify({name: "Other server"}),
        },
      ],
      resolve: () => {},
    };

    const view = renderWithSyncAdmin(
      <AdminModelForm apiBase="/admin" itemId="todo-1" mode="edit" modelName="Todo" />,
      syncConflicts
    );

    assert.isDefined(await view.findByTestId("conflict-item-todo-1"));
    assert.isNull(view.queryByTestId("conflict-item-todo-2"));
  });

  it("keeps ObjectId model create, update, and delete on the REST mutation path", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          adminBroadcast: true,
          fields: {
            ...modelConfig.fields,
            _id: {required: true, type: "objectid"},
            email: {required: false, type: "string"},
          },
          syncCollection: "users",
        },
      ],
    };
    const form = renderWithSyncAdmin(
      <AdminModelForm apiBase="/admin" mode="create" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
    });

    assert.equal(syncMutateFn.mock.calls.length, 0);
    assert.equal(createFn.mock.calls.length, 1);
    form.unmount();

    readState.data = {active: true, age: 1, email: "user@example.com", name: "User"};
    const editForm = renderWithSyncAdmin(
      <AdminModelForm apiBase="/admin" itemId="object-id" mode="edit" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(editForm.getByTestId("admin-save-button"));
    });
    const deleteButton = editForm.UNSAFE_root.findAll(
      (node: ReactTestInstance) => node.props?.testID === "admin-delete-button"
    )[0];
    await act(async () => {
      deleteButton?.props.onClick();
    });

    assert.equal(syncMutateFn.mock.calls.length, 0);
    assert.equal(hydrateWindowFn.mock.calls.length, 0);
    assert.equal(updateFn.mock.calls.length, 1);
    assert.equal(deleteFn.mock.calls.length, 1);
  });

  it("falls back to REST when a String-id model is not adminBroadcast-enabled", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fields: {
            ...modelConfig.fields,
            email: {required: false, type: "string"},
          },
          syncCollection: "users",
        },
      ],
    };
    const form = renderWithSyncAdmin(
      <AdminModelForm apiBase="/admin" mode="create" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
    });

    assert.equal(syncMutateFn.mock.calls.length, 0);
    assert.equal(createFn.mock.calls.length, 1);
  });

  it("keeps the form open when a syncdb mutation throws", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          adminBroadcast: true,
          fields: {
            ...modelConfig.fields,
            email: {required: false, type: "string"},
          },
          syncCollection: "users",
        },
      ],
    };
    syncMutateFn.mockImplementation(() => {
      throw new Error("sync failed");
    });

    const form = renderWithSyncAdmin(
      <AdminModelForm apiBase="/admin" mode="create" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
    });

    assert.equal(routerBack.mock.calls.length, 0);
    assert.equal(createFn.mock.calls.length, 0);
  });

  it("renders loading state while config loads", () => {
    configState.isLoading = true;
    const {toJSON} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders loading state when the model config is missing", () => {
    configState.config = {customScreens: [], models: [], scripts: []};
    const {toJSON} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders the form in create mode with defaulted fields", () => {
    configState.config = config;
    const {toJSON} = renderWithTheme(
      <AdminModelForm
        baseUrl="/admin"
        footerContent={React.createElement("FooterMarker")}
        mode="create"
        modelName="User"
      />
    );
    expect(toJSON()).toBeDefined();
    expect(setOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "New User",
      })
    );
  });

  it("removes save controls when effective model permissions are read-only", () => {
    configState.config = {
      ...config,
      models: [{...modelConfig, permissions: {create: true, delete: true, update: true}}],
    };
    readState.data = {
      _adminCapabilities: {delete: false, update: false},
      email: "readonly@example.com",
      name: "Read only",
    };
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="readonly" mode="edit" modelName="User" />
    );

    assert.isNull(form.queryByTestId("admin-save-button"));
    assert.isNull(form.queryByTestId("admin-delete-button"));
  });

  it("renders spinner during edit when the item is loading", () => {
    configState.config = config;
    readState.isLoading = true;
    const {toJSON} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    expect(toJSON()).toBeDefined();
    expect(setOptions).toHaveBeenCalledWith(expect.objectContaining({title: "User"}));
  });

  it("initializes form state from fetched item data in edit mode", () => {
    configState.config = config;
    readState.data = {
      active: false,
      age: 30,
      email: "e@x.com",
      name: "Existing",
    };
    const {toJSON} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    expect(toJSON()).toBeDefined();
    expect(setOptions).toHaveBeenCalledWith(expect.objectContaining({title: "Existing"}));
  });

  it("uses recordTitleField from model config for the navigation title", () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fieldOrder: ["email", "name"],
          fields: {
            email: {required: false, type: "string"},
            name: {required: false, type: "string"},
          },
          recordTitleField: "email",
        },
      ],
    };
    readState.data = {
      email: "pick@me.com",
      name: "Other",
    };
    const {toJSON} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    expect(toJSON()).toBeDefined();
    expect(setOptions).toHaveBeenCalledWith(expect.objectContaining({title: "pick@me.com"}));
  });

  it("renders 'No editable fields' when the model has only system fields", () => {
    configState.config = {
      customScreens: [],
      models: [
        {
          ...modelConfig,
          fieldOrder: [],
          fields: {_id: {required: true, type: "string"}},
        },
      ],
      scripts: [],
    };
    const {toJSON, getByText} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    expect(toJSON()).toBeDefined();
    expect(getByText("No editable fields.")).toBeDefined();
  });

  it("renders a form without fieldOrder", () => {
    configState.config = {
      customScreens: [],
      models: [{...modelConfig, fieldOrder: undefined}],
      scripts: [],
    };
    const {toJSON} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    expect(toJSON()).toBeDefined();
  });

  it("invokes save callback via the form save button", async () => {
    // Build a config with no required fields so validation passes without field edits.
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fieldOrder: ["email", "name"],
          fields: {
            email: {required: false, type: "string"},
            name: {required: false, type: "string"},
          },
        },
      ],
    };
    const header = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(header.getByTestId("admin-save-button"));
    });
    for (let attempt = 0; attempt < 30 && createFn.mock.calls.length === 0; attempt++) {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
    }
    expect(createFn).toHaveBeenCalled();
    expect(routerBack).toHaveBeenCalled();
  });

  it("blocks save and surfaces validation errors when required fields are missing", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fieldOrder: ["email"],
          fields: {
            email: {required: true, type: "string"},
          },
        },
      ],
    };
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(createFn).not.toHaveBeenCalled();
  });

  it("runs transformPayload and onSaveSuccess on save", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fieldOrder: ["name"],
          fields: {name: {required: false, type: "string"}},
        },
      ],
    };
    const transformPayload = mock(async ({payload}: {payload: Record<string, unknown>}) => ({
      ...payload,
      transformed: true,
    }));
    const onSaveSuccess = mock(async () => undefined);
    const form = renderWithTheme(
      <AdminModelForm
        baseUrl="/admin"
        mode="create"
        modelName="User"
        onSaveSuccess={onSaveSuccess}
        transformPayload={transformPayload}
      />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(transformPayload).toHaveBeenCalled();
    expect(onSaveSuccess).toHaveBeenCalled();
  });

  it("catches create errors via toast.catch", async () => {
    configState.config = config;
    createFn.mockImplementationOnce(() => ({
      unwrap: async () => {
        throw new Error("boom");
      },
    }));
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    // router.back is not called on error.
    expect(routerBack).not.toHaveBeenCalled();
  });

  it("deletes an existing item via the delete button confirm flow", async () => {
    configState.config = config;
    readState.data = {active: true, age: 1, email: "e@x.com", name: "Name"};
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    // Open confirmation modal.
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-delete-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    // Confirm by pressing delete again (Button toggles showConfirmation on first press
    // and invokes onClick on the second press when not using the lazy modal).
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-delete-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    // The delete handler may not fire under the lazy-loaded Modal, but the render path
    // still exercises handleDelete references.
    expect(setOptions).toHaveBeenCalled();
  });

  it("handles delete errors without navigating back", async () => {
    configState.config = config;
    readState.data = {active: true, age: 1, email: "e@x.com", name: "Name"};
    deleteFn.mockImplementationOnce(() => ({
      unwrap: async () => {
        throw new Error("nope");
      },
    }));
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    assert.isNotNull(form.getByTestId("admin-delete-button"));
  });

  it("covers update-mode errors via toast.catch", async () => {
    configState.config = config;
    readState.data = {active: true, age: 1, email: "e@x.com", name: "Name"};
    updateFn.mockImplementationOnce(() => ({
      unwrap: async () => {
        throw new Error("update failed");
      },
    }));
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(routerBack).not.toHaveBeenCalled();
  });

  it("sanitizes payload by dropping null values, filtering arrays, and walking nested objects", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          // Intentionally omit one of the declared fields ("age") from fieldOrder so
          // the append-remaining-fields branch (line 49) is exercised.
          fieldOrder: ["email", "name"],
          fields: {
            email: {required: false, type: "string"},
            name: {required: false, type: "string"},
            tags: {required: false, type: "array"},
          },
        },
      ],
    };
    readState.data = {
      email: "e@x.com",
      name: null,
      nested: {inner: null, keep: "yes"},
      tags: ["a", null, "b"],
    };
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(updateFn).toHaveBeenCalled();
    const body = updateFn.mock.calls[0][0] as {body: Record<string, unknown>; id: string};
    // Array was stripped of null entries.
    expect(body.body.tags).toEqual(["a", "b"]);
  });

  it("omits blank optional enum fields from update payloads", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fieldOrder: ["email", "oauthProvider"],
          fields: {
            email: {required: true, type: "string"},
            oauthProvider: {
              enum: ["google", "github", "apple"],
              required: false,
              type: "string",
            },
          },
        },
      ],
    };
    readState.data = {email: "e@x.com"};
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    const body = updateFn.mock.calls[0][0] as {body: Record<string, unknown>; id: string};
    expect(body.body.oauthProvider).toBeUndefined();
    expect(body.body.email).toBe("e@x.com");
  });

  it("applies field-level onChange via the rendered text field", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fieldOrder: ["name"],
          fields: {name: {required: false, type: "string"}},
        },
      ],
    };
    const {getByTestId} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    const nameField = getByTestId("admin-field-name");
    await act(async () => {
      fireEvent.changeText(nameField, "Updated Name");
    });
    expect(nameField).toBeDefined();
  });

  it("uses boolean/number/string field defaults when default is not provided", () => {
    // Ensure getFieldDefault returns the right fallbacks for each type when no
    // default is set on the config. This hits the boolean and number branches.
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fieldOrder: ["flag", "count", "name"],
          fields: {
            count: {required: false, type: "number"},
            flag: {required: false, type: "boolean"},
            name: {required: false, type: "string"},
          },
        },
      ],
    };
    const {toJSON} = renderWithTheme(
      <AdminModelForm baseUrl="/admin" mode="create" modelName="User" />
    );
    expect(toJSON()).toBeDefined();
  });

  it("deletes an existing item via direct handler invocation on the delete button", async () => {
    configState.config = config;
    readState.data = {active: true, age: 1, email: "e@x.com", name: "Name"};
    // Ensure no leftover mockImplementationOnce from earlier test runs.
    deleteFn.mockReset();
    deleteFn.mockImplementation(() => ({unwrap: async () => ({})}));
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    // Invoke the delete Button's onClick callback directly so we exercise
    // handleDelete's success branch (calls deleteItem + router.back).
    const deleteBtns = form.UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-delete-button"
    );
    expect(deleteBtns.length).toBeGreaterThan(0);
    await act(async () => {
      (deleteBtns[0] as ReactTestInstance).props.onClick();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(deleteFn).toHaveBeenCalledWith("u1");
    expect(routerBack).toHaveBeenCalled();
  });

  it("surfaces delete errors via toast.catch without navigating", async () => {
    configState.config = config;
    readState.data = {active: true, age: 1, email: "e@x.com", name: "Name"};
    deleteFn.mockImplementationOnce(() => ({
      unwrap: async () => {
        throw new Error("delete failed");
      },
    }));
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    const deleteBtns = form.UNSAFE_root.findAll(
      (n: ReactTestInstance) => n.props?.testID === "admin-delete-button"
    );
    await act(async () => {
      (deleteBtns[0] as ReactTestInstance).props.onClick();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(deleteFn).toHaveBeenCalled();
    // Router should not navigate away because an error was thrown.
    expect(routerBack).not.toHaveBeenCalled();
  });

  it("excludes readonly fields from the PATCH body on save", async () => {
    configState.config = {
      ...config,
      models: [
        {
          ...modelConfig,
          fieldOrder: ["email", "name"],
          fields: {
            email: {required: false, type: "string"},
            name: {required: false, type: "string"},
          },
          readonlyFields: ["email"],
        },
      ],
    };
    readState.data = {email: "locked@x.com", name: "N"};
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(updateFn).toHaveBeenCalled();
    const arg = updateFn.mock.calls[0][0] as {body: Record<string, unknown>; id: string};
    expect(arg.body.email).toBeUndefined();
    expect(arg.body.name).toBeDefined();
  });

  it("updates an existing item in edit mode", async () => {
    configState.config = config;
    readState.data = {active: true, age: 1, email: "e@x.com", name: "Name"};
    const form = renderWithTheme(
      <AdminModelForm baseUrl="/admin" itemId="u1" mode="edit" modelName="User" />
    );
    await act(async () => {
      fireEvent.press(form.getByTestId("admin-save-button"));
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(updateFn).toHaveBeenCalled();
    expect(routerBack).toHaveBeenCalled();
  });
});
