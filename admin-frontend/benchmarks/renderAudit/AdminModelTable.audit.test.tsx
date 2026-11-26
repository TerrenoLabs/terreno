import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {configureAdminModelApiDouble} from "../../src/testing/useAdminModelApiDouble";
import type {AdminConfigResponse} from "../../src/types";

mock.module("expo-router", () => ({
  router: {push: (): void => {}},
  useNavigation: () => ({setOptions: (): void => {}}),
}));

const config: AdminConfigResponse = {
  customScreens: [],
  models: [
    {
      actions: [{id: "activate", label: "Activate", patchKeys: ["active"]}],
      defaultSort: "-created",
      displayName: "User",
      fields: {
        _id: {required: true, type: "string"},
        active: {required: false, type: "boolean"},
        age: {required: false, type: "number"},
        created: {required: false, type: "date"},
        email: {required: false, type: "string"},
        tags: {required: false, type: "array"},
      },
      filters: [{field: "active", kind: "boolean", label: "Active"}],
      listDisplayLinks: ["email"],
      listFields: ["email", "active", "age", "created", "tags"],
      name: "User",
      routePath: "/admin/users",
      searchFields: ["email"],
    },
  ],
  scripts: [],
} as unknown as AdminConfigResponse;

mock.module("../../src/useAdminConfig", () => ({
  useAdminConfig: () => ({config, error: null, isLoading: false}),
}));
mock.module("../../src/useAdminBackgroundTask", () => ({
  useAdminBackgroundTaskMutation: () => [
    (): {unwrap: () => Promise<unknown>} => ({unwrap: async () => ({})}),
    {isLoading: false},
  ],
}));

import {AdminModelTable} from "../../src/AdminModelTable";

const ROW_COUNT = 10;
const listData = {
  data: Array.from({length: ROW_COUNT}, (_, index) => ({
    _id: `u${index}`,
    active: index % 2 === 0,
    age: 20 + index,
    created: null,
    email: `user${index}@example.com`,
    tags: [],
  })),
  total: ROW_COUNT,
};
const refetch = async (): Promise<unknown> => ({data: listData});
const mutation = (): unknown[] => [
  (): {unwrap: () => Promise<unknown>} => ({unwrap: async () => ({})}),
  {isLoading: false},
];

describe("AdminModelTable renders", () => {
  it("does not re-render every cell when one row is selected or the search text changes", async () => {
    configureAdminModelApiDouble({
      useBulkPatchMutation: mutation,
      useDeleteMutation: mutation,
      useListQuery: () => ({data: listData, error: null, isLoading: false, refetch}),
      useUpdateMutation: mutation,
    });
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      view = renderWithTheme(<AdminModelTable baseUrl="/admin" modelName="User" />);
      await act(async () => {});
    });
    const mounted = view as ReturnType<typeof renderWithTheme>;
    await audit.step("same props", () => {
      mounted.rerender(<AdminModelTable baseUrl="/admin" modelName="User" />);
    });
    await audit.step("select one row", async () => {
      await act(async () => {
        fireEvent.press(mounted.getByTestId("admin-table-row-checkbox-u3"));
      });
    });
    await audit.step("type one search character", async () => {
      await act(async () => {
        fireEvent.changeText(mounted.getByTestId("data-table-search"), "u");
      });
    });
    const report = audit.report();
    audit.dispose();
    mounted.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AdminModelTable\n${formatReport(report, {limit: 30})}`);
    }
    // Only the toggled checkbox cell re-renders; the other rows' cells keep their identity.
    expect(componentStat(report, "select one row", "AdminSelectCell")?.updates).toBe(1);
    expect(componentStat(report, "select one row", "AdminLinkCell")).toBeUndefined();
    expect(componentStat(report, "select one row", "AdminActionsCell")).toBeUndefined();
    expect(componentStat(report, "select one row", "AdminInlineBoolCell")).toBeUndefined();
    expect(componentStat(report, "select one row", "AdminActionMenu")?.updates).toBe(1);
    for (const step of ["same props", "type one search character"]) {
      expect(componentStat(report, step, "AdminActionMenu")).toBeUndefined();
      expect(componentStat(report, step, "AdminSelectCell")).toBeUndefined();
      expect(componentStat(report, step, "AdminLinkCell")).toBeUndefined();
      expect(componentStat(report, step, "AdminActionsCell")).toBeUndefined();
      expect(componentStat(report, step, "AdminInlineBoolCell")).toBeUndefined();
    }
  });
});
