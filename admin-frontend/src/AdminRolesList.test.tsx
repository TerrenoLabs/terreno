// noExplicitAny: test mocks use type-erased RTK Query API doubles and dynamic mock returns
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {SelectField} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../ui/src/test-utils";
import {AdminRolesField} from "./AdminRolesField";
import {AdminRolesList} from "./AdminRolesList";
import type {AdminApi} from "./types";
import {normalizeRoles, normalizeStatements, type RolesQueryResult} from "./useAdminRoles";

const mockUseListRolesQuery = mock(
  (): RolesQueryResult => ({data: undefined, error: null, isLoading: false})
);
const mockRefetch = mock(() => {});
const mockCreateRole = mock(() => ({unwrap: async () => ({})}));
const mockUpdateRole = mock(() => ({unwrap: async () => ({})}));
const mockUseListStatementsQuery = mock(() => ({
  data: {
    statements: {
      admin: ["access", "runScripts"],
      adminTodo: ["read", "write", "writeOwned"],
      todo: ["read", "update"],
    },
  },
  error: null,
  isLoading: false,
}));

mock.module("./useAdminRoles", () => ({
  normalizeRoles,
  normalizeStatements,
  useAdminRoles: () => ({
    useCreateRoleMutation: () => [mockCreateRole, {isLoading: false}],
    useListRolesQuery: mockUseListRolesQuery,
    useListStatementsQuery: mockUseListStatementsQuery,
    useUpdateRoleMutation: () => [mockUpdateRole, {isLoading: false}],
  }),
}));

const mockApi = {} as unknown as AdminApi;

interface RenderedNode {
  props?: {testID?: unknown};
  children?: unknown[];
}

const collectTestIDs = (node: unknown): string[] => {
  const rendered = node as RenderedNode | null;
  const own = typeof rendered?.props?.testID === "string" ? [rendered.props.testID] : [];
  const children = Array.isArray(rendered?.children) ? rendered.children : [];
  return [...own, ...children.flatMap((child) => collectTestIDs(child))];
};

const ROLES = [
  {displayName: "Super Admin", isLocked: true, isSealed: true, name: "superadmin"},
  {
    description: "Baseline role for signed-up users",
    displayName: "Todo User",
    name: "todoUser",
    permissions: {adminTodo: ["read", "writeOwned"]},
  },
];

describe("AdminRolesList", () => {
  beforeEach(() => {
    mockUseListRolesQuery.mockClear();
    mockCreateRole.mockClear();
    mockUpdateRole.mockClear();
    mockUseListStatementsQuery.mockClear();
    mockUseListStatementsQuery.mockClear();
    mockUseListStatementsQuery.mockReturnValue({
      data: {
        statements: {
          admin: ["access", "runScripts"],
          adminTodo: ["read", "write", "writeOwned"],
          todo: ["read", "update"],
        },
      },
      error: null,
      isLoading: false,
    });
    mockUseListRolesQuery.mockReturnValue({
      data: undefined,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
  });

  it("renders a spinner while loading", () => {
    mockUseListRolesQuery.mockReturnValue({data: undefined, error: null, isLoading: true});

    const {getByTestId} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    expect(getByTestId("admin-roles-loading")).toBeTruthy();
  });

  it("renders an error state when the request fails", () => {
    mockUseListRolesQuery.mockReturnValue({
      data: undefined,
      error: new Error("boom"),
      isLoading: false,
    });

    const {getByTestId} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    expect(getByTestId("admin-roles-error")).toBeTruthy();
  });

  it("renders roles returned as a bare array", () => {
    mockUseListRolesQuery.mockReturnValue({data: ROLES, error: null, isLoading: false});

    const {getByTestId, getByText} = renderWithTheme(
      <AdminRolesList api={mockApi} apiBase="/admin" />
    );

    expect(getByTestId("admin-roles-item-superadmin")).toBeTruthy();
    expect(getByTestId("admin-roles-item-todoUser")).toBeTruthy();
    expect(getByText("Super Admin")).toBeTruthy();
    expect(getByText("Todo User")).toBeTruthy();
  });

  it("lists available permissions and exposes role creation", () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId, getByText} = renderWithTheme(
      <AdminRolesList api={mockApi} apiBase="/admin" />
    );

    expect(getByTestId("admin-permissions-list")).toBeTruthy();
    expect(getByTestId("admin-permissions-custom-admin")).toBeTruthy();
    expect(getByText("runScripts")).toBeTruthy();
    expect(getByTestId("admin-roles-add-button")).toBeTruthy();
  });

  it("groups a role's actions into one row per resource", () => {
    mockUseListRolesQuery.mockReturnValue({data: ROLES, error: null, isLoading: false});
    const {getByTestId} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    expect(getByTestId("admin-roles-item-todoUser-permission-model-adminTodo")).toBeTruthy();
    expect(getByTestId("admin-roles-item-todoUser-permission-adminTodo-read")).toBeTruthy();
    expect(getByTestId("admin-roles-item-todoUser-permission-adminTodo-writeOwned")).toBeTruthy();
  });

  it("lists custom permissions before model permissions, splitting mixed resources", () => {
    mockUseListStatementsQuery.mockReturnValue({
      data: {
        statements: {
          admin: ["access", "runScripts"],
          user: ["create", "impersonate", "read"],
        },
      },
      error: null,
      isLoading: false,
    });
    mockUseListRolesQuery.mockReturnValue({data: [], error: null, isLoading: false});
    const {getByTestId} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    const sectionIDs = [
      ...new Set(
        collectTestIDs(getByTestId("admin-permissions-list")).filter(
          (id) => id === "admin-permissions-custom" || id === "admin-permissions-model"
        )
      ),
    ];
    assert.deepEqual(sectionIDs, ["admin-permissions-custom", "admin-permissions-model"]);

    const customIDs = collectTestIDs(getByTestId("admin-permissions-custom"));
    assert.includeMembers(customIDs, [
      "admin-permissions-custom-admin",
      "admin-permissions-admin-runScripts",
      "admin-permissions-custom-user",
      "admin-permissions-user-impersonate",
    ]);
    assert.notInclude(customIDs, "admin-permissions-user-create");

    const modelIDs = collectTestIDs(getByTestId("admin-permissions-model"));
    assert.includeMembers(modelIDs, [
      "admin-permissions-model-user",
      "admin-permissions-user-create",
      "admin-permissions-user-read",
    ]);
    assert.notInclude(modelIDs, "admin-permissions-user-impersonate");
    assert.notInclude(modelIDs, "admin-permissions-model-admin");
  });

  it("colors permission badges green for read, amber for write, and red for delete", () => {
    mockUseListStatementsQuery.mockReturnValue({
      data: {statements: {todo: ["delete", "update", "list", "read"]}},
      error: null,
      isLoading: false,
    });
    mockUseListRolesQuery.mockReturnValue({data: [], error: null, isLoading: false});
    const {UNSAFE_root} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    const badges = UNSAFE_root.findAll(
      (node) =>
        typeof node.props.testID === "string" &&
        node.props.testID.startsWith("admin-permissions-todo-") &&
        typeof node.props.status === "string"
    );
    const statusByAction = Object.fromEntries(
      badges.map((badge) => [badge.props.value, badge.props.status])
    );
    assert.deepEqual(statusByAction, {
      delete: "error",
      list: "success",
      read: "success",
      update: "warning",
    });
    // Read actions first, then write, then delete.
    assert.deepEqual(
      badges.map((badge) => badge.props.value),
      ["list", "read", "update", "delete"]
    );
  });

  it("enables editing for non-sealed roles and disables sealed roles", () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    expect(getByTestId("admin-roles-edit-todoUser").props.disabled).toBeFalsy();
    expect(getByTestId("admin-roles-edit-superadmin").props.disabled).toBeTruthy();
  });

  it("edits standard model access with a single access-level selector", async () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminRolesList api={mockApi} apiBase="/admin" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-roles-edit-todoUser"));
    });
    const accessSelect = UNSAFE_root.findAllByType(SelectField).find(
      (field) => field.props.testID === "admin-role-access-adminTodo"
    );
    assert.equal(accessSelect?.props.value, "writeOwned");

    await act(async () => {
      accessSelect?.props.onChange("write");
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-role-save-button"));
    });

    const updateInput = mockUpdateRole.mock.calls[0]?.[0] as {
      changes?: {permissions?: Record<string, string[]>};
      roleName?: string;
    };
    assert.equal(updateInput.roleName, "todoUser");
    assert.deepEqual(updateInput.changes?.permissions, {adminTodo: ["read", "write"]});
  });

  it("edits admin page access with a dedicated toggle", async () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId, getByText} = renderWithTheme(
      <AdminRolesList api={mockApi} apiBase="/admin" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-roles-edit-todoUser"));
    });

    expect(getByTestId("admin-role-page-access")).toBeTruthy();
    expect(getByText("Allow access to the admin page")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("admin-role-permission-admin-access-clickable"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-role-save-button"));
    });

    const updateInput = mockUpdateRole.mock.calls[0]?.[0] as {
      changes?: {permissions?: Record<string, string[]>};
      roleName?: string;
    };
    assert.equal(updateInput.roleName, "todoUser");
    assert.deepEqual(updateInput.changes?.permissions, {
      admin: ["access"],
      adminTodo: ["read", "writeOwned"],
    });
  });

  it("scrolls the role list body while keeping the add button outside the scroll area", () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    const scrollArea = getByTestId("admin-roles-scroll");
    expect(scrollArea).toBeTruthy();

    const scrollTestIDs = collectTestIDs(scrollArea);
    expect(scrollTestIDs).toContain("admin-roles-item-superadmin");
    expect(scrollTestIDs).toContain("admin-permissions-list");
    expect(scrollTestIDs).not.toContain("admin-roles-add-button");
  });

  it("renders roles returned inside a data envelope", () => {
    mockUseListRolesQuery.mockReturnValue({data: {data: ROLES}, error: null, isLoading: false});

    const {getByTestId} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    expect(getByTestId("admin-roles-item-superadmin")).toBeTruthy();
  });

  it("renders an empty state when there are no roles", () => {
    mockUseListRolesQuery.mockReturnValue({data: [], error: null, isLoading: false});

    const {getByText} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    expect(getByText("No roles found.")).toBeTruthy();
  });

  it("shows locked badges, descriptions, and permission statement states", () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    mockUseListStatementsQuery.mockReturnValue({
      data: undefined,
      error: new Error("statements failed"),
      isLoading: true,
    });

    const {getByText} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    expect(getByText("locked")).toBeTruthy();
    expect(getByText("sealed")).toBeTruthy();
    expect(getByText("Baseline role for signed-up users")).toBeTruthy();
    expect(getByText("Failed to load permissions.")).toBeTruthy();
  });

  it("creates a role from the add-role modal and refetches the list", async () => {
    mockCreateRole.mockImplementation(() => ({unwrap: async () => ({})}));
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId} = renderWithTheme(<AdminRolesList api={mockApi} apiBase="/admin" />);

    await act(async () => {
      fireEvent.press(getByTestId("admin-roles-add-button"));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-role-name"), "reviewer");
      fireEvent.changeText(getByTestId("admin-role-display-name"), "Reviewer");
      fireEvent.changeText(getByTestId("admin-role-description"), "Can review todos");
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-role-save-button"));
    });

    const createInput = mockCreateRole.mock.calls[0]?.[0] as {
      description?: string;
      displayName?: string;
      name?: string;
      permissions?: Record<string, string[]>;
    };
    assert.equal(createInput.name, "reviewer");
    assert.equal(createInput.displayName, "Reviewer");
    assert.equal(createInput.description, "Can review todos");
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("shows validation and API errors while saving a role", async () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId, getByText} = renderWithTheme(
      <AdminRolesList api={mockApi} apiBase="/admin" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-roles-add-button"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-role-save-button"));
    });
    expect(getByText("Name and display name are required.")).toBeTruthy();

    mockUpdateRole.mockImplementation(() => ({
      unwrap: async () => {
        throw {data: {detail: "Role update rejected"}};
      },
    }));
    await act(async () => {
      fireEvent.press(getByTestId("admin-roles-edit-todoUser"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-role-save-button"));
    });
    expect(getByText("Role update rejected")).toBeTruthy();
  });

  it("dismisses the role editor without saving", async () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId, queryByTestId, UNSAFE_root} = renderWithTheme(
      <AdminRolesList api={mockApi} apiBase="/admin" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-roles-add-button"));
    });
    expect(getByTestId("admin-role-form")).toBeTruthy();

    const modal = UNSAFE_root.findAll((node) => node.props?.testID === "admin-role-modal")[0];
    await act(async () => {
      modal?.props?.secondaryButtonOnClick?.();
    });
    expect(queryByTestId("admin-role-form")).toBeNull();
  });

  it("toggles custom permissions and clears standard access", async () => {
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminRolesList api={mockApi} apiBase="/admin" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-roles-edit-todoUser"));
    });

    await act(async () => {
      fireEvent.press(getByTestId("admin-role-permission-admin-runScripts-clickable"));
    });

    const accessSelect = UNSAFE_root.findAllByType(SelectField).find(
      (field) => field.props.testID === "admin-role-access-adminTodo"
    );
    await act(async () => {
      accessSelect?.props.onChange("none");
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-role-save-button"));
    });

    const updateInput = mockUpdateRole.mock.calls[0]?.[0] as {
      changes?: {permissions?: Record<string, string[]>};
    };
    assert.deepEqual(updateInput.changes?.permissions, {
      admin: ["runScripts"],
    });
  });
  it("shows an API detail when role creation fails and dismisses the form", async () => {
    mockCreateRole.mockImplementationOnce(() => ({
      unwrap: async () => {
        throw {data: {detail: "Role already exists"}};
      },
    }));
    mockUseListRolesQuery.mockReturnValue({
      data: ROLES,
      error: null,
      isLoading: false,
      refetch: mockRefetch,
    });
    const {UNSAFE_root, getByTestId, getByText, queryByText} = renderWithTheme(
      <AdminRolesList api={mockApi} apiBase="/admin" />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-roles-add-button"));
    });
    await act(async () => {
      fireEvent.changeText(getByTestId("admin-role-name"), "operator");
      fireEvent.changeText(getByTestId("admin-role-display-name"), "Operator");
    });
    await act(async () => {
      fireEvent.press(getByTestId("admin-role-save-button"));
      await Promise.resolve();
    });
    expect(getByText("Role already exists")).toBeTruthy();

    await act(async () => {
      const modal = UNSAFE_root.findAll(
        (node) =>
          node.props?.testID === "admin-role-modal" && typeof node.props?.onDismiss === "function"
      )[0];
      modal.props.onDismiss();
    });
    expect(queryByText("Role already exists")).toBeNull();
  });
});

describe("AdminRolesField", () => {
  const fieldConfig = {
    description: "Roles assigned to this user",
    itemType: "string",
    required: false,
    type: "array",
  };

  beforeEach(() => {
    mockUseListRolesQuery.mockReturnValue({
      data: [
        {displayName: "Admin", name: "admin"},
        {displayName: "Manager", name: "manager"},
        {displayName: "Member", name: "member"},
      ],
      error: null,
      isLoading: false,
    });
  });

  it("offers unassigned existing roles in an Add role dropdown", () => {
    const onChange = mock((_value: unknown) => undefined);
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AdminRolesField
        api={mockApi}
        apiBase="/admin"
        fieldConfig={fieldConfig}
        fieldKey="roles"
        onChange={onChange}
        value={["member"]}
      />
    );

    expect(getByTestId("admin-field-roles-selected-member")).toBeTruthy();
    const roleSelect = UNSAFE_root.findByType(SelectField);
    expect(roleSelect.props.title).toBe("Add role");
    expect(roleSelect.props.options).toEqual([
      {label: "Admin", value: "admin"},
      {label: "Manager", value: "manager"},
    ]);

    act(() => {
      roleSelect.props.onChange("manager");
    });
    expect(onChange).toHaveBeenCalledWith(["member", "manager"]);
  });

  it("removes an assigned role without changing other assignments", async () => {
    const onChange = mock((_value: unknown) => undefined);
    const {getByTestId} = renderWithTheme(
      <AdminRolesField
        api={mockApi}
        apiBase="/admin"
        fieldConfig={fieldConfig}
        fieldKey="roles"
        onChange={onChange}
        value={["admin", "member"]}
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("admin-field-roles-remove-admin"));
    });

    expect(onChange).toHaveBeenCalledWith(["member"]);
  });
});

describe("normalizeRoles", () => {
  it("returns a bare array unchanged", () => {
    expect(normalizeRoles(ROLES)).toEqual(ROLES);
  });

  it("unwraps a data envelope", () => {
    expect(normalizeRoles({data: ROLES})).toEqual(ROLES);
  });

  it("falls back to an empty array", () => {
    expect(normalizeRoles(undefined)).toEqual([]);
    expect(normalizeRoles({})).toEqual([]);
  });
});

describe("normalizeStatements", () => {
  it("normalizes direct and enveloped statement responses", () => {
    const statements = {todo: ["read", "update"]};
    expect(normalizeStatements({statements})).toEqual(statements);
    expect(normalizeStatements({data: {statements}})).toEqual(statements);
    expect(normalizeStatements(undefined)).toEqual({});
  });
});
