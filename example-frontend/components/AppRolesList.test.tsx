import {afterAll, beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import React, {type ReactNode} from "react";
import {act, create, type ReactTestInstance, type ReactTestRenderer} from "react-test-renderer";

interface QueryState {
  data: unknown;
  error: unknown;
  isLoading: boolean;
}

interface RpcArgs {
  body?: Record<string, unknown>;
  method?: string;
  url: string;
}

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true});

// Bun's mock.module replaces a module for every file in this process. Each stub delegates to the
// preloaded module unless this suite is running, so sibling suites keep real behavior.
const preloadUi = await import("@terreno/ui");
const preloadAdminFrontend = await import("@terreno/admin-frontend");
const stubState = {isActive: false};

const createHostComponent = (name: keyof typeof preloadUi): React.FC<Record<string, unknown>> => {
  const Real = preloadUi[name] as unknown as React.ComponentType<Record<string, unknown>>;
  const HostComponent: React.FC<Record<string, unknown>> = ({children, ...props}) =>
    stubState.isActive
      ? React.createElement(name, props, children as ReactNode)
      : React.createElement(Real, props, children as ReactNode);
  HostComponent.displayName = name;
  return HostComponent;
};

type RealHook = (...args: never[]) => unknown;
const whenActive =
  <T extends RealHook>(real: T, stub: (...args: Parameters<T>) => unknown) =>
  (...args: Parameters<T>): unknown =>
    stubState.isActive ? stub(...args) : real(...args);

const queries: {roles: QueryState; statements: QueryState} = {
  roles: {data: undefined, error: null, isLoading: false},
  statements: {data: undefined, error: null, isLoading: false},
};
const rpcCalls: RpcArgs[] = [];
let rpcFailure: unknown = null;

mock.module("@terreno/admin-frontend", () => ({
  ...preloadAdminFrontend,
  useAdminRpc: whenActive(
    preloadAdminFrontend.useAdminRpc,
    () => (): Promise<unknown> => Promise.resolve(undefined)
  ),
  useAdminRpcMutation: whenActive(preloadAdminFrontend.useAdminRpcMutation, () => [
    (args: RpcArgs) => ({
      unwrap: async (): Promise<unknown> => {
        rpcCalls.push(args);
        if (rpcFailure) {
          throw rpcFailure;
        }
        return {};
      },
    }),
    {isLoading: false},
  ]),
  useAdminRpcQuery: whenActive(preloadAdminFrontend.useAdminRpcQuery, ({url}: {url: string}) => ({
    ...(url === "/rbac/roles" ? queries.roles : queries.statements),
    isFetching: false,
    refetch: (): void => {},
  })),
}));

mock.module("@terreno/ui", () => ({
  ...preloadUi,
  Badge: createHostComponent("Badge"),
  Box: createHostComponent("Box"),
  Button: createHostComponent("Button"),
  CheckBox: createHostComponent("CheckBox"),
  Heading: createHostComponent("Heading"),
  Modal: createHostComponent("Modal"),
  Spinner: createHostComponent("Spinner"),
  Text: createHostComponent("Text"),
  TextField: createHostComponent("TextField"),
}));

const {AppRolesList} = await import("./AppRolesList");

const STATEMENTS = {
  admin: ["access", "jobs"],
  clinicalIntake: ["signoff"],
  todo: ["create", "read", "update", "delete", "list"],
};

const ROLES = [
  {
    description: "Signs off intake",
    displayName: "Clinician",
    name: "clinician",
    permissions: {clinicalIntake: ["signoff"], todo: ["read"]},
  },
  {displayName: "Todo User", name: "todoUser", permissions: {todo: ["read"]}},
  {displayName: "Super Admin", isLocked: true, isSealed: true, name: "superadmin"},
];

const byTestId = (renderer: ReactTestRenderer, testID: string): ReactTestInstance =>
  renderer.root.find((node) => typeof node.type === "string" && node.props.testID === testID);

const hasTestId = (renderer: ReactTestRenderer, testID: string): boolean =>
  renderer.root.findAll((node) => typeof node.type === "string" && node.props.testID === testID)
    .length > 0;

const textOf = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAll((node) => String(node.type) === "Text")
    .flatMap((node) => node.children.filter((child) => typeof child === "string"))
    .join("|");

const modal = (renderer: ReactTestRenderer): ReactTestInstance =>
  byTestId(renderer, "admin-role-modal");

const render = async (element: React.ReactElement): Promise<ReactTestRenderer> => {
  // Assigned inside act().
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
};

const press = async (renderer: ReactTestRenderer, testID: string): Promise<void> => {
  await act(async () => {
    (byTestId(renderer, testID).props.onClick as () => void)();
  });
};

const type = async (renderer: ReactTestRenderer, testID: string, value: string): Promise<void> => {
  await act(async () => {
    (byTestId(renderer, testID).props.onChange as (next: string) => void)(value);
  });
};

const save = async (renderer: ReactTestRenderer): Promise<void> => {
  await act(async () => {
    await (modal(renderer).props.primaryButtonOnClick as () => Promise<void>)();
  });
};

describe("AppRolesList", () => {
  beforeAll(() => {
    stubState.isActive = true;
  });

  afterAll(() => {
    stubState.isActive = false;
  });

  beforeEach(() => {
    queries.roles = {data: ROLES, error: null, isLoading: false};
    queries.statements = {data: {statements: STATEMENTS}, error: null, isLoading: false};
    rpcCalls.splice(0);
    rpcFailure = null;
  });

  it("shows a spinner while roles load", async () => {
    queries.roles = {data: undefined, error: null, isLoading: true};
    const renderer = await render(<AppRolesList />);
    expect(hasTestId(renderer, "admin-roles-loading")).toBe(true);
  });

  it("shows an error when roles fail to load", async () => {
    queries.roles = {data: undefined, error: new Error("boom"), isLoading: false};
    const renderer = await render(<AppRolesList />);
    expect(hasTestId(renderer, "admin-roles-error")).toBe(true);
  });

  it("shows only permission checks by default", async () => {
    const renderer = await render(<AppRolesList />);
    expect(
      hasTestId(renderer, "admin-roles-item-clinician-permission-clinicalIntake-signoff")
    ).toBe(true);
    expect(hasTestId(renderer, "admin-roles-item-clinician-permission-todo")).toBe(false);
    expect(hasTestId(renderer, "admin-permissions-admin-access")).toBe(true);
    expect(hasTestId(renderer, "admin-permissions-todo")).toBe(false);
    expect(hasTestId(renderer, "admin-roles-item-todoUser-permission-empty")).toBe(true);
    expect(textOf(renderer)).toContain("No permission checks granted.");
    expect(hasTestId(renderer, "admin-role-permission-todo-read")).toBe(false);
    expect(byTestId(renderer, "admin-roles-edit-superadmin").props.disabled).toBe(true);
  });

  it("shows model permissions when showAllPermissions is set", async () => {
    const renderer = await render(<AppRolesList showAllPermissions />);
    expect(hasTestId(renderer, "admin-roles-item-clinician-permission-todo-read")).toBe(true);
    expect(hasTestId(renderer, "admin-permissions-todo-update")).toBe(true);
    expect(hasTestId(renderer, "admin-role-permission-todo-read")).toBe(true);
    expect(textOf(renderer)).toContain("No permissions granted.");
  });

  it("accepts roles wrapped in a data envelope and handles an empty list", async () => {
    queries.roles = {data: {data: []}, error: null, isLoading: false};
    queries.statements = {data: {data: {statements: STATEMENTS}}, error: null, isLoading: false};
    const renderer = await render(<AppRolesList />);
    expect(textOf(renderer)).toContain("No roles found.");
    expect(hasTestId(renderer, "admin-permissions-clinicalIntake-signoff")).toBe(true);
  });

  it("shows statement loading and error states", async () => {
    queries.statements = {data: undefined, error: null, isLoading: true};
    const loading = await render(<AppRolesList />);
    expect(
      byTestId(loading, "admin-permissions-list").findAll((node) => String(node.type) === "Spinner")
        .length
    ).toBe(1);

    queries.statements = {data: undefined, error: new Error("boom"), isLoading: false};
    const failed = await render(<AppRolesList />);
    expect(textOf(failed)).toContain("Failed to load permissions.");
  });

  it("requires a name and display name before creating", async () => {
    const renderer = await render(<AppRolesList />);
    await press(renderer, "admin-roles-add-button");
    expect(modal(renderer).props.visible).toBe(true);
    await save(renderer);
    expect(rpcCalls).toHaveLength(0);
    expect(hasTestId(renderer, "admin-role-save-error")).toBe(true);
  });

  it("creates a role with the selected permission checks", async () => {
    const renderer = await render(<AppRolesList />);
    await press(renderer, "admin-roles-add-button");
    await type(renderer, "admin-role-name", " auditorPlus ");
    await type(renderer, "admin-role-display-name", "Auditor Plus");
    await press(renderer, "admin-role-permission-admin-access");
    await press(renderer, "admin-role-permission-admin-jobs");
    await press(renderer, "admin-role-permission-admin-jobs");
    await press(renderer, "admin-role-permission-clinicalIntake-signoff");
    await press(renderer, "admin-role-permission-clinicalIntake-signoff");
    await save(renderer);

    expect(rpcCalls).toEqual([
      {
        body: {
          description: undefined,
          displayName: "Auditor Plus",
          name: "auditorPlus",
          permissions: {admin: ["access"]},
        },
        method: "POST",
        url: "/rbac/roles",
      },
    ]);
    expect(modal(renderer).props.visible).toBe(false);
  });

  it("keeps model permissions when editing a role's permission checks", async () => {
    const renderer = await render(<AppRolesList />);
    await press(renderer, "admin-roles-edit-clinician");
    expect(byTestId(renderer, "admin-role-name").props.disabled).toBe(true);
    await type(renderer, "admin-role-description", "  ");
    await press(renderer, "admin-role-permission-admin-access");
    await save(renderer);

    expect(rpcCalls).toEqual([
      {
        body: {
          description: null,
          displayName: "Clinician",
          permissions: {admin: ["access"], clinicalIntake: ["signoff"], todo: ["read"]},
        },
        method: "PATCH",
        url: "/rbac/roles/clinician",
      },
    ]);
  });

  it("shows the server error when saving fails and dismisses the modal", async () => {
    rpcFailure = {data: {detail: "Role is sealed"}};
    const renderer = await render(<AppRolesList />);
    await press(renderer, "admin-roles-edit-todoUser");
    await save(renderer);
    expect(textOf(renderer)).toContain("Role is sealed");

    rpcFailure = new Error("network");
    await save(renderer);
    expect(textOf(renderer)).toContain("Failed to save role.");

    await act(async () => {
      (modal(renderer).props.onDismiss as () => void)();
    });
    expect(modal(renderer).props.visible).toBe(false);
  });
});
