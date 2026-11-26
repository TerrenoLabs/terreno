import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminRolesList} from "../../src/AdminRolesList";
import {
  normalizeRoles,
  normalizeStatementDescriptions,
  normalizeStatements,
} from "../../src/useAdminRoles";

const resources = Array.from({length: 8}, (_, index) => `model${index}`);
const statements: Record<string, string[]> = {
  admin: ["access", "runScripts"],
  ...Object.fromEntries(
    resources.map((resource) => [resource, ["archive", "read", "write", "writeOwned"]])
  ),
};
const roles = Array.from({length: 8}, (_, index) => ({
  description: `Role number ${index}`,
  displayName: `Role ${index}`,
  name: `role${index}`,
  permissions: Object.fromEntries(resources.map((resource) => [resource, ["archive", "read"]])),
}));
const rolesResult = {data: roles, error: null, isLoading: false, refetch: (): void => {}};
const statementsResult = {data: {statements}, error: null, isLoading: false};
const mutation = [
  (): {unwrap: () => Promise<unknown>} => ({unwrap: async () => ({})}),
  {isLoading: false},
];

mock.module("../../src/useAdminRoles", () => ({
  normalizeRoles,
  normalizeStatementDescriptions,
  normalizeStatements,
  useAdminRoles: () => ({
    useCreateRoleMutation: () => mutation,
    useListRolesQuery: () => rolesResult,
    useListStatementsQuery: () => statementsResult,
    useUpdateRoleMutation: () => mutation,
  }),
}));

describe("AdminRolesList renders", () => {
  it("does not re-render the role cards while the role form is edited", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const view = await audit.step("mount", () =>
      renderWithTheme(<AdminRolesList apiBase="/admin" />)
    );
    await audit.step("same props", () => view.rerender(<AdminRolesList apiBase="/admin" />));
    await audit.step("open edit modal", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("admin-roles-edit-role3"));
      });
    });
    await audit.step("type in display name", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("admin-role-display-name"), "Role 3x");
      });
    });
    await audit.step("toggle one permission", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("admin-role-permission-model2-archive-clickable"));
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(formatReport(report, {limit: 40}));
    }

    for (const step of ["type in display name", "toggle one permission"]) {
      expect(componentStat(report, step, "RoleCard")).toBeUndefined();
      expect(componentStat(report, step, "PermissionRowsComponent")).toBeUndefined();
      expect(componentStat(report, step, "PermissionActionLabel")).toBeUndefined();
    }
    expect(componentStat(report, "type in display name", "RolePermissionEditor")).toBeUndefined();
    expect(componentStat(report, "toggle one permission", "RolePermissionEditor")?.updates).toBe(1);
    expect(componentStat(report, "same props", "RoleCard")).toBeUndefined();
  });
});
