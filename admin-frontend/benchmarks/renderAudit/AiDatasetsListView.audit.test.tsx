import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiDatasetsListView,
  type AiDatasetsListViewProps,
} from "../../src/widgets/aiObservability/datasets/AiDatasetsListView";
import type {DatasetRecord} from "../../src/widgets/aiObservability/datasets/datasetTypes";

const datasets: DatasetRecord[] = Array.from({length: 9}, (_, index) => ({
  counts: {auto: 2, human: index, needsReview: 2, total: index + 2},
  created: "2026-01-01T00:00:00.000Z",
  id: `ds-${index}`,
  inputSchemaPromptName: index % 2 === 0 ? "summarize" : undefined,
  judgments:
    index % 2 === 0
      ? [{answered: 1, current: 1, evaluatorId: "e", evaluatorName: "E", stale: 0, total: 2}]
      : [],
  name: `Dataset ${index}`,
  tags: [],
  updated: "2026-01-02T00:00:00.000Z",
}));
const noop = (): void => {};
const baseline: AiDatasetsListViewProps = {
  createName: "",
  createOpen: false,
  createPromptBinding: "",
  datasets,
  importOpen: false,
  importPaste: "",
  isCreating: false,
  isImporting: false,
  isLoading: false,
  onCreate: noop,
  onCreateNameChange: noop,
  onCreatePromptBindingChange: noop,
  onDismissCreate: noop,
  onDismissImport: noop,
  onFilePicked: noop,
  onImportPasteChange: noop,
  onImportSubmit: noop,
  onOpenDetail: noop,
  onOpenImport: noop,
  onRetry: noop,
};

describe("AiDatasetsListView renders", () => {
  it("keeps the name and import cells mounted when the caller passes new handlers", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    const latestOnOpenDetail = mock((_id: string): void => {});
    const latestOnOpenImport = mock((_id: string): void => {});
    const steps: Array<[string, AiDatasetsListViewProps]> = [
      ["same props", baseline],
      ["create modal open", {...baseline, createOpen: true}],
      ["type create name", {...baseline, createName: "N", createOpen: true}],
      ["reset", baseline],
      ["import modal open", {...baseline, importOpen: true}],
      ["type import paste", {...baseline, importOpen: true, importPaste: "[1"}],
      ["reset 2", baseline],
      [
        "new open callbacks",
        {...baseline, onOpenDetail: latestOnOpenDetail, onOpenImport: latestOnOpenImport},
      ],
      ["reset 3", baseline],
      ["new other callbacks", {...baseline, onCreate: (): void => {}, onRetry: (): void => {}}],
      ["new equal datasets", {...baseline, datasets: [...datasets]}],
    ];
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiDatasetsListView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    for (const [label, props] of steps) {
      await audit.step(label, () => view.rerender(<AiDatasetsListView {...props} />));
      if (label === "new open callbacks") {
        // The stable cells must still call the newest handlers.
        await act(async () => {
          fireEvent.press(view.getByTestId("ai-datasets-open-ds-2"));
          fireEvent.press(view.getByTestId("ai-datasets-import-ds-3"));
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
      }
    }
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiDatasetsListView\n${formatReport(report, {limit: 40})}`);
    }
    expect(latestOnOpenDetail).toHaveBeenCalledWith("ds-2");
    expect(latestOnOpenImport).toHaveBeenCalledWith("ds-3");
    expect(componentStat(report, "mount", "datasetName")?.mounts).toBe(datasets.length);
    // A rebuilt cell map shows up as cells mounting again and every row updating.
    for (const step of ["same props", "type create name", "new open callbacks", "reset 3"]) {
      expect(componentStat(report, step, "datasetName")).toBeUndefined();
      expect(componentStat(report, step, "datasetImport")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
    }
  });
});
