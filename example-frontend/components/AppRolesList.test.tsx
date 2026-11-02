import {beforeEach, describe, expect, it} from "bun:test";
import React from "react";
import {act, create, type ReactTestInstance, type ReactTestRenderer} from "react-test-renderer";

import {AppRolesList} from "./AppRolesList";

interface RpcArgs {
  body?: Record<string, unknown>;
  method?: string;
  url: string;
}

interface ServerState {
  roles: unknown;
  rolesError: unknown;
  statements: unknown;
  statementsError: unknown;
  writeError: unknown;
}

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

const server: ServerState = {
  roles: ROLES,
  rolesError: null,
  statements: {statements: STATEMENTS},
  statementsError: null,
  writeError: null,
};
const writes: RpcArgs[] = [];
const pending: {roles: boolean; statements: boolean} = {roles: false, statements: false};

const never = (): Promise<never> => new Promise<never>(() => {});

// Injected in place of the AdminProvider RPC client, so the real admin RPC hooks run unmocked.
const fakeRpc = async (args: RpcArgs): Promise<unknown> => {
  if (args.method && args.method !== "GET") {
    writes.push(args);
    if (server.writeError) {
      throw server.writeError;
    }
    return {};
  }
  if (args.url === "/rbac/roles") {
    if (pending.roles) {
      return never();
    }
    if (server.rolesError) {
      throw server.rolesError;
    }
    return server.roles;
  }
  if (pending.statements) {
    return never();
  }
  if (server.statementsError) {
    throw server.statementsError;
  }
  return server.statements;
};

const rpc = fakeRpc as unknown as NonNullable<React.ComponentProps<typeof AppRolesList>["rpc"]>;

const nodesWithTestId = (renderer: ReactTestRenderer, testID: string): ReactTestInstance[] =>
  renderer.root.findAll((node) => node.props.testID === testID);

const byTestId = (renderer: ReactTestRenderer, testID: string): ReactTestInstance => {
  const [node] = nodesWithTestId(renderer, testID);
  if (!node) {
    throw new Error(`No node with testID ${testID}`);
  }
  return node;
};

const hasTestId = (renderer: ReactTestRenderer, testID: string): boolean =>
  nodesWithTestId(renderer, testID).length > 0;

const textOf = (renderer: ReactTestRenderer): string =>
  renderer.root
    .findAll((node) => typeof node.type === "string")
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
  const node = byTestId(renderer, testID);
  await act(async () => {
    ((node.props.onClick ?? node.props.onPress) as () => void)();
  });
};

const type = async (renderer: ReactTestRenderer, testID: string, value: string): Promise<void> => {
  const node = byTestId(renderer, testID);
  await act(async () => {
    (node.props.onChange as (next: string) => void)(value);
  });
};

const save = async (renderer: ReactTestRenderer): Promise<void> => {
  await act(async () => {
    await (modal(renderer).props.primaryButtonOnClick as () => Promise<void>)();
  });
};

describe("AppRolesList", () => {
  beforeEach(() => {
    server.roles = ROLES;
    server.rolesError = null;
    server.statements = {statements: STATEMENTS};
    server.statementsError = null;
    server.writeError = null;
    pending.roles = false;
    pending.statements = false;
    writes.splice(0);
  });

  it("shows a spinner while roles load", async () => {
    pending.roles = true;
    const renderer = await render(<AppRolesList rpc={rpc} />);
    expect(hasTestId(renderer, "admin-roles-loading")).toBe(true);
  });

  it("shows an error when roles fail to load", async () => {
    server.rolesError = new Error("boom");
    const renderer = await render(<AppRolesList rpc={rpc} />);
    expect(hasTestId(renderer, "admin-roles-error")).toBe(true);
  });

  it("shows only permission checks by default", async () => {
    const renderer = await render(<AppRolesList rpc={rpc} />);
    expect(
      hasTestId(renderer, "admin-roles-item-clinician-permission-clinicalIntake-signoff")
    ).toBe(true);
    expect(hasTestId(renderer, "admin-roles-item-clinician-permission-todo")).toBe(false);
    expect(hasTestId(renderer, "admin-permissions-admin-access")).toBe(true);
    expect(hasTestId(renderer, "admin-permissions-todo")).toBe(false);
    expect(hasTestId(renderer, "admin-roles-item-todoUser-permission-empty")).toBe(true);
    expect(textOf(renderer)).toContain("No permission checks granted.");
    await press(renderer, "admin-roles-add-button");
    expect(hasTestId(renderer, "admin-role-permission-admin-access")).toBe(true);
    expect(hasTestId(renderer, "admin-role-permission-todo-read")).toBe(false);
  });

  it("shows model permissions when showAllPermissions is set", async () => {
    const renderer = await render(<AppRolesList rpc={rpc} showAllPermissions />);
    expect(hasTestId(renderer, "admin-roles-item-clinician-permission-todo-read")).toBe(true);
    expect(hasTestId(renderer, "admin-permissions-todo-update")).toBe(true);
    expect(textOf(renderer)).toContain("No permissions granted.");
    await press(renderer, "admin-roles-add-button");
    expect(hasTestId(renderer, "admin-role-permission-todo-read")).toBe(true);
  });

  it("accepts roles wrapped in a data envelope and handles an empty list", async () => {
    server.roles = {data: []};
    server.statements = {data: {statements: STATEMENTS}};
    const renderer = await render(<AppRolesList rpc={rpc} />);
    expect(textOf(renderer)).toContain("No roles found.");
    expect(hasTestId(renderer, "admin-permissions-clinicalIntake-signoff")).toBe(true);
  });

  it("shows statement loading and error states", async () => {
    pending.statements = true;
    const loading = await render(<AppRolesList rpc={rpc} />);
    expect(hasTestId(loading, "admin-permissions-clinicalIntake")).toBe(false);
    expect(textOf(loading)).not.toContain("Failed to load permissions.");

    pending.statements = false;
    server.statementsError = new Error("boom");
    const failed = await render(<AppRolesList rpc={rpc} />);
    expect(textOf(failed)).toContain("Failed to load permissions.");
  });

  it("requires a name and display name before creating", async () => {
    const renderer = await render(<AppRolesList rpc={rpc} />);
    await press(renderer, "admin-roles-add-button");
    expect(modal(renderer).props.visible).toBe(true);
    await save(renderer);
    expect(writes).toHaveLength(0);
    expect(hasTestId(renderer, "admin-role-save-error")).toBe(true);
  });

  it("creates a role with the selected permission checks", async () => {
    const renderer = await render(<AppRolesList rpc={rpc} />);
    await press(renderer, "admin-roles-add-button");
    await type(renderer, "admin-role-name", " auditorPlus ");
    await type(renderer, "admin-role-display-name", "Auditor Plus");
    await press(renderer, "admin-role-permission-admin-access");
    await press(renderer, "admin-role-permission-admin-jobs");
    await press(renderer, "admin-role-permission-admin-jobs");
    await press(renderer, "admin-role-permission-clinicalIntake-signoff");
    await press(renderer, "admin-role-permission-clinicalIntake-signoff");
    await save(renderer);

    expect(writes).toEqual([
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
    const renderer = await render(<AppRolesList rpc={rpc} />);
    await press(renderer, "admin-roles-edit-clinician");
    await type(renderer, "admin-role-description", "  ");
    await press(renderer, "admin-role-permission-admin-access");
    await save(renderer);

    expect(writes).toEqual([
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
    server.writeError = {data: {detail: "Role is sealed"}};
    const renderer = await render(<AppRolesList rpc={rpc} />);
    await press(renderer, "admin-roles-edit-todoUser");
    await save(renderer);
    expect(textOf(renderer)).toContain("Role is sealed");

    server.writeError = new Error("network");
    await save(renderer);
    expect(textOf(renderer)).toContain("Failed to save role.");

    await act(async () => {
      (modal(renderer).props.onDismiss as () => void)();
    });
    expect(modal(renderer).props.visible).toBe(false);
  });
});
