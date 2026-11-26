import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiPromptsListView,
  type AiPromptsListViewProps,
} from "../../src/widgets/aiObservability/prompts/AiPromptsListView";
import type {PromptListItem} from "../../src/widgets/aiObservability/prompts/promptTypes";

const prompts: PromptListItem[] = [
  ...Array.from(
    {length: 9},
    (_, index): PromptListItem => ({
      folder: "examples",
      latestVersion: index + 1,
      name: `prompt-${index}`,
      production: index % 2 === 0 ? index + 1 : "—",
      tags: ["core"],
      type: index % 2 === 0 ? "chat" : "text",
      usage7d: {calls: index * 10, lastUsed: "2026-01-02T00:00:00.000Z"},
    })
  ),
  {folder: "examples/intake", latestVersion: 1, name: "greet", production: 1, type: "chat"},
  {folder: "examples/billing", latestVersion: 1, name: "remind", production: 1, type: "text"},
];
const noop = (): void => {};
const baseline: AiPromptsListViewProps = {
  createDescription: "",
  createFolder: "examples",
  createName: "",
  createOpen: false,
  createSystem: "",
  createTemplate: "",
  folder: "examples",
  onCreate: noop,
  onCreateDescriptionChange: noop,
  onCreateFolderChange: noop,
  onCreateNameChange: noop,
  onCreateSystemChange: noop,
  onCreateTemplateChange: noop,
  onDismissCreate: noop,
  onFolderChange: noop,
  onOpenCreate: noop,
  onOpenPrompt: noop,
  onSearchChange: noop,
  onTagChange: noop,
  prompts,
  search: "",
  tag: "",
};

describe("AiPromptsListView renders", () => {
  it("keeps the prompt cells mounted when the caller passes new handlers", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    const latestOnOpenPrompt = mock((_name: string): void => {});
    const latestOnFolderChange = mock((_path: string): void => {});
    const steps: Array<[string, AiPromptsListViewProps]> = [
      ["same props", baseline],
      ["create modal open", {...baseline, createOpen: true}],
      ["type create name", {...baseline, createName: "N", createOpen: true}],
      ["reset", baseline],
      [
        "new open callbacks",
        {...baseline, onFolderChange: latestOnFolderChange, onOpenPrompt: latestOnOpenPrompt},
      ],
      ["reset 2", baseline],
      [
        "new other callbacks",
        {...baseline, onCreate: (): void => {}, onSearchChange: (): void => {}},
      ],
      ["new equal prompts", {...baseline, prompts: [...prompts]}],
      ["type search", {...baseline, search: "prompt-3"}],
    ];
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiPromptsListView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    for (const [label, props] of steps) {
      await audit.step(label, () => view.rerender(<AiPromptsListView {...props} />));
      if (label === "new open callbacks") {
        // The stable cells must still call the newest handlers.
        await act(async () => {
          fireEvent.press(view.getByTestId("ai-prompt-open-prompt-2"));
          fireEvent.press(view.getByTestId("ai-prompts-folder-examples/intake-clickable"));
          await new Promise((resolve) => setTimeout(resolve, 50));
        });
      }
    }
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiPromptsListView\n${formatReport(report, {limit: 40})}`);
    }
    expect(latestOnOpenPrompt).toHaveBeenCalledWith("prompt-2");
    expect(latestOnFolderChange).toHaveBeenCalledWith("examples/intake");
    expect(componentStat(report, "mount", "promptName")?.mounts).toBe(12);
    // A rebuilt cell map shows up as cells mounting again and every row updating.
    for (const step of ["same props", "type create name", "new open callbacks", "reset 2"]) {
      expect(componentStat(report, step, "promptName")).toBeUndefined();
      expect(componentStat(report, step, "DataTableRow")).toBeUndefined();
    }
    // Typing in the create modal must not reach the table behind it.
    expect(componentStat(report, "type create name", "DataTable")).toBeUndefined();
  });
});
