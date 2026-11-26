import {afterAll, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

mock.module("expo-router", () => ({
  router: {push: mock((): void => {}), replace: mock((): void => {})},
}));

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../../src/AdminProvider";
import {OrgDirectoryScreen} from "../../src/orgs/OrgDirectoryScreen";

const ROW_COUNT = 10;
const listBody = {
  data: Array.from({length: ROW_COUNT}, (_, index) => ({
    _id: `org-${index}`,
    disabled: index % 3 === 0,
    name: `Org ${index}`,
    slug: `org-${index}`,
  })),
};

const originalFetch = globalThis.fetch;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

describe("OrgDirectoryScreen renders", () => {
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps the organization rows idle while the create modal is used", async () => {
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(JSON.stringify(listBody), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      })) as unknown as typeof fetch;
    const audit = createRenderAudit({
      ignore: /^(ThemeProvider|TerrenoFontProvider|AdminProvider)$/,
    });
    // Callers pass an inline handler, so every parent render hands the screen a new one.
    const element = (): React.ReactElement => (
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <OrgDirectoryScreen isOperator onEnterOrganization={(): void => {}} />
      </AdminProvider>
    );
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      mounted = renderWithTheme(element());
      await settle();
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("parent re-render", () => view.rerender(element()));
    await audit.step("open create modal", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("org-directory-create"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });
    await audit.step("type a name", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("org-directory-name"), "N");
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## OrgDirectoryScreen\n${formatReport(report, {limit: 200})}`);
    }
    expect(componentStat(report, "mount", "DataTableRow")?.mounts).toBe(ROW_COUNT);
    // The action buttons live in the table's custom cell: a remount shows up as new mounts.
    for (const step of ["parent re-render", "open create modal", "type a name"]) {
      expect(componentStat(report, step, "DataTable")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
      expect(componentStat(report, step, "DataTableCellComponent")).toBeUndefined();
      expect(componentStat(report, step, "TextCell")).toBeUndefined();
    }
  });
});
