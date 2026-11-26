import {afterAll, describe, expect, it} from "bun:test";
import {act} from "@testing-library/react-native";
import type {ReactTestInstance} from "react-test-renderer";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../../src/AdminProvider";
import {AnnouncementOverview} from "../../src/AnnouncementOverview";

const ROW_COUNT = 10;
const overview = {
  data: Array.from({length: ROW_COUNT}, (_, index) => ({
    _id: `a${index}`,
    acknowledgementPolicy: "required",
    audienceType: "staff",
    displayMode: "modal",
    metrics: {acknowledgements: index, clicks: index, impressions: index * 10},
    status: "published",
    title: `Announcement ${index}`,
  })),
  limit: 20,
  more: true,
  page: 1,
  total: 40,
  totals: {
    acknowledgements: 45,
    announcements: 40,
    archived: 0,
    clicks: 45,
    draft: 3,
    impressions: 450,
    published: 37,
  },
};

const originalFetch = globalThis.fetch;
// A page that never answers keeps the previous page's rows on screen, as a slow network does.
let isHolding = false;
const installFetch = (): void => {
  globalThis.fetch = ((): Promise<Response> => {
    if (isHolding) {
      return new Promise<Response>(() => {});
    }
    return Promise.resolve(
      new Response(JSON.stringify(overview), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      })
    );
  }) as unknown as typeof fetch;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe("AnnouncementOverview renders", () => {
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps the table rows when handlers change identity or the page changes", async () => {
    installFetch();
    const audit = createRenderAudit({
      ignore: /^(ThemeProvider|TerrenoFontProvider|AdminProvider)$/,
    });
    const element = (): React.ReactElement => (
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <AnnouncementOverview
          onCreate={(): void => {}}
          onEdit={(): void => {}}
          onOpenAcknowledgements={(): void => {}}
          onOpenClickEvents={(): void => {}}
          onOpenImpressions={(): void => {}}
        />
      </AdminProvider>
    );
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      mounted = renderWithTheme(element());
      await flush();
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    const table = (): ReactTestInstance =>
      view.UNSAFE_root.findAll(
        (node: ReactTestInstance) => typeof node.props?.setPage === "function"
      )[0] as ReactTestInstance;
    await audit.step("same props, new handler identities", () => view.rerender(element()));
    isHolding = true;
    await audit.step("go to page 2", async () => {
      await act(async () => {
        table().props.setPage(2);
      });
      await flush();
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AnnouncementOverview\n${formatReport(report, {limit: 30})}`);
    }
    expect(componentStat(report, "mount", "DataTableRow")?.mounts).toBe(ROW_COUNT);
    // A new `onEdit` identity must not rebuild the rows or remount the action cells, and
    // paging keeps the previous page's rows untouched until the next page arrives.
    for (const step of ["same props, new handler identities", "go to page 2"]) {
      expect(componentStat(report, step, "AnnouncementOverview")?.updates).toBe(1);
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
      expect(componentStat(report, step, "DataTableCellComponent")).toBeUndefined();
      expect(componentStat(report, step, "IconButton")).toBeUndefined();
    }
    expect(
      componentStat(report, "same props, new handler identities", "DataTable")
    ).toBeUndefined();
  });
});
