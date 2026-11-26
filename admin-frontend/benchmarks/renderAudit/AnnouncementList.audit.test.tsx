import {describe, expect, it} from "bun:test";
import {act} from "@testing-library/react-native";
import type {ReactTestInstance} from "react-test-renderer";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AnnouncementList} from "../../src/AnnouncementList";
import {configureAdminModelApiDouble} from "../../src/testing/useAdminModelApiDouble";

const ROW_COUNT = 10;
const listData = {
  data: Array.from({length: ROW_COUNT}, (_, index) => ({
    _id: `a${index}`,
    acknowledgementPolicy: "required",
    audienceType: "staff",
    displayMode: "modal",
    priority: index,
    publishedAt: "2026-01-01T12:00:00.000Z",
    status: "published",
    title: `Announcement ${index}`,
    version: 1,
  })),
  total: 40,
};
const listResult = {data: listData, error: null, isLoading: false};

describe("AnnouncementList renders", () => {
  it("keeps the table cells when the parent re-renders with new handlers", async () => {
    configureAdminModelApiDouble({useListQuery: () => listResult});
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    const element = (): React.ReactElement => (
      <AnnouncementList baseUrl="/admin" onCreateNew={(): void => {}} onRowClick={(): void => {}} />
    );
    const view = await audit.step("mount", () => renderWithTheme(element()));
    const table = (): ReactTestInstance =>
      view.UNSAFE_root.findAll(
        (node: ReactTestInstance) => typeof node.props?.setSortColumn === "function"
      )[0] as ReactTestInstance;
    await audit.step("same props, new handler identities", () => view.rerender(element()));
    await audit.step("sort by title", async () => {
      await act(async () => {
        table().props.setSortColumn({column: 0, direction: "desc"});
      });
    });
    await audit.step("go to page 2", async () => {
      await act(async () => {
        table().props.setPage(2);
      });
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AnnouncementList\n${formatReport(report, {limit: 30})}`);
    }
    // A new `onRowClick` identity must not rebuild the rows or remount the action cells.
    const handlersStep = "same props, new handler identities";
    expect(componentStat(report, handlersStep, "AnnouncementList")?.updates).toBe(1);
    expect(componentStat(report, handlersStep, "DataTable")).toBeUndefined();
    expect(componentStat(report, handlersStep, "DataTableRow")).toBeUndefined();
    expect(componentStat(report, handlersStep, "DataTableCellComponent")).toBeUndefined();
    expect(componentStat(report, handlersStep, "IconButton")).toBeUndefined();
    // Sorting and paging change the header and the pager, not the rows already on screen.
    for (const step of ["sort by title", "go to page 2"]) {
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
      expect(componentStat(report, step, "DataTableCellComponent")).toBeUndefined();
      expect(componentStat(report, step, "IconButton")).toBeUndefined();
    }
  });
});
