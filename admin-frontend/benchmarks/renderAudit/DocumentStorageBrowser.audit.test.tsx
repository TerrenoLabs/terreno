import {afterAll, describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AdminProvider} from "../../src/AdminProvider";
import {DocumentStorageBrowser} from "../../src/DocumentStorageBrowser";

const FILE_COUNT = 10;
const listBody = {
  files: Array.from({length: FILE_COUNT}, (_, index) => ({
    contentType: "application/pdf",
    fullPath: `reports/file-${index}.pdf`,
    name: `file-${index}.pdf`,
    size: 1024 * (index + 1),
    updated: "2026-08-20T00:00:00.000Z",
  })),
  folders: ["reports/2025/", "reports/2026/"],
};
const ROW_COUNT = FILE_COUNT + listBody.folders.length;

const originalFetch = globalThis.fetch;

const settle = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

describe("DocumentStorageBrowser renders", () => {
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it("keeps the file rows mounted and idle while the screen re-renders", async () => {
    globalThis.fetch = (async (): Promise<Response> =>
      new Response(JSON.stringify(listBody), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      })) as unknown as typeof fetch;
    const audit = createRenderAudit({
      ignore: /^(ThemeProvider|TerrenoFontProvider|AdminProvider)$/,
    });
    const element = (): React.ReactElement => (
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <DocumentStorageBrowser
          backButton={false}
          basePath="/documents"
          onFileSelect={(): void => {}}
          onSettingsPress={(): void => {}}
        />
      </AdminProvider>
    );
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", async () => {
      mounted = renderWithTheme(element());
      await settle();
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("same props, new handler identities", () => view.rerender(element()));
    await audit.step("open new folder modal", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("document-new-folder-button"));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    });
    await audit.step("type folder name", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("new-folder-name-input"), "inv");
      });
    });
    const typedValue = view.getByTestId("new-folder-name-input").props.value;
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## DocumentStorageBrowser\n${formatReport(report, {limit: 30})}`);
    }
    expect(typedValue).toBe("inv");
    expect(componentStat(report, "mount", "DataTableRow")?.mounts).toBe(ROW_COUNT);
    // Typing in the modal, opening it, or a parent re-render must not touch the table.
    for (const step of [
      "same props, new handler identities",
      "open new folder modal",
      "type folder name",
    ]) {
      expect(componentStat(report, step, "DataTable")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
      expect(componentStat(report, step, "DataTableCellComponent")).toBeUndefined();
      expect(componentStat(report, step, "IconButton")?.mounts ?? 0).toBe(0);
    }
  });
});
