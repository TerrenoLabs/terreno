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

const navigation = {setOptions: (): void => {}};
mock.module("expo-router", () => ({
  router: {back: (): void => {}, push: (): void => {}},
  useNavigation: () => navigation,
}));

const config = {
  customScreens: [],
  models: [
    {
      defaultSort: "-created",
      displayName: "Articles",
      fields: {
        _id: {required: true, type: "string"},
        author: {required: false, type: "string"},
        body: {required: false, type: "string"},
        category: {enum: ["news", "blog", "docs"], required: false, type: "string"},
        featured: {required: false, type: "boolean"},
        metadata: {required: false, type: "object"},
        published: {required: false, type: "boolean"},
        rank: {required: false, type: "number"},
        slug: {required: false, type: "string"},
        status: {enum: ["draft", "live"], required: false, type: "string"},
        subtitle: {required: false, type: "string"},
        title: {required: true, type: "string"},
        views: {required: false, type: "number"},
      },
      listFields: ["title"],
      name: "Article",
      routePath: "/admin/articles",
    },
  ],
  scripts: [],
} as unknown as AdminConfigResponse;

mock.module("../../src/useAdminConfig", () => ({
  useAdminConfig: () => ({config, error: null, isLoading: false}),
}));

import {AdminModelForm} from "../../src/AdminModelForm";

const mutation = (): unknown[] => [
  (): {unwrap: () => Promise<unknown>} => ({unwrap: async () => ({})}),
  {isLoading: false},
];

describe("AdminModelForm renders", () => {
  it("re-renders only the edited input on a keystroke", async () => {
    configureAdminModelApiDouble({
      useCreateMutation: mutation,
      useDeleteMutation: mutation,
      useReadQuery: () => ({data: undefined, error: null, isLoading: false}),
      useUpdateMutation: mutation,
    });
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let view: ReturnType<typeof renderWithTheme> | undefined;
    const element = <AdminModelForm baseUrl="/admin" mode="create" modelName="Article" />;
    await audit.step("mount", async () => {
      view = renderWithTheme(element);
      await act(async () => {});
    });
    const mounted = view as ReturnType<typeof renderWithTheme>;
    await audit.step("same props", () => {
      mounted.rerender(<AdminModelForm baseUrl="/admin" mode="create" modelName="Article" />);
    });
    await audit.step("type one character in title", async () => {
      await act(async () => {
        fireEvent.changeText(mounted.getByTestId("admin-field-title"), "H");
      });
    });
    await audit.step("type one digit in rank", async () => {
      await act(async () => {
        fireEvent.changeText(mounted.getByTestId("admin-field-rank"), "7");
      });
    });
    const report = audit.report();
    audit.dispose();
    mounted.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AdminModelForm\n${formatReport(report, {limit: 30})}`);
    }
    // Every field renderer sees the new form state, but only the edited input renders again.
    for (const step of ["type one character in title", "type one digit in rank"]) {
      expect(componentStat(report, step, "AdminFieldRendererCore")?.updates).toBe(12);
      expect(componentStat(report, step, "TextField")?.updates).toBe(1);
      expect(componentStat(report, step, "SelectField")).toBeUndefined();
      expect(componentStat(report, step, "BooleanField")).toBeUndefined();
    }
    expect(componentStat(report, "same props", "TextField")).toBeUndefined();
    expect(componentStat(report, "same props", "SelectField")).toBeUndefined();
  });
});
