import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiPromptPlaygroundView,
  type AiPromptPlaygroundViewProps,
} from "../../src/widgets/aiObservability/prompts/AiPromptPlaygroundView";
import type {
  PromptDetail,
  PromptVersionDetail,
} from "../../src/widgets/aiObservability/prompts/promptTypes";

const VARIABLES = ["name", "tone", "audience", "length", "language", "topic", "style", "format"];
const selectedVersion: PromptVersionDetail = {
  sensitive: false,
  system: "Be brief",
  template: "Hello {{name}}",
  type: "chat",
  variables: VARIABLES.map((key) => ({key, required: true})),
  version: 1,
};
const detail: PromptDetail = {
  folder: "examples",
  labels: [{label: "latest", version: 1}],
  name: "summarize",
  relationships: {
    experiments: {items: [], limit: 20, total: 0},
    traces: {items: [], limit: 20, total: 0},
  },
  tags: [],
  usedBy: {items: [], limit: 20, total: 0},
  versions: [selectedVersion],
};

describe("AiPromptPlaygroundView renders", () => {
  it("re-renders only the variable field being typed in", async () => {
    const onRun = mock(async (_variables: Record<string, string>): Promise<void> => {});
    const baseline: AiPromptPlaygroundViewProps = {
      detail,
      isRunning: false,
      onRun,
      result: undefined,
      runError: undefined,
      selectedVersion,
    };
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiPromptPlaygroundView {...baseline} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    const type = async (label: string, name: string, text: string): Promise<void> => {
      await audit.step(label, async () => {
        await act(async () => {
          fireEvent.changeText(view.getByTestId(`ai-prompt-var-${name}`), text);
        });
      });
    };
    await type("type one variable", "tone", "w");
    await type("type the same variable again", "tone", "wa");
    await type("type another variable", "topic", "cats");
    await audit.step("same props", () => view.rerender(<AiPromptPlaygroundView {...baseline} />));
    await audit.step("running", () =>
      view.rerender(<AiPromptPlaygroundView {...baseline} isRunning />)
    );
    await audit.step("reset", () => view.rerender(<AiPromptPlaygroundView {...baseline} />));
    // Every typed value still reaches the run payload.
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-run-once"));
    });
    expect(onRun).toHaveBeenCalledWith({
      audience: "",
      format: "",
      language: "",
      length: "",
      name: "",
      style: "",
      tone: "wa",
      topic: "cats",
    });
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiPromptPlaygroundView\n${formatReport(report, {limit: 30})}`);
    }
    expect(componentStat(report, "mount", "VariableField")?.mounts).toBe(VARIABLES.length);
    const typingSteps = [
      "type one variable",
      "type the same variable again",
      "type another variable",
    ];
    for (const step of typingSteps) {
      expect(componentStat(report, step, "VariableField")?.updates).toBe(1);
      expect(componentStat(report, step, "TextField")?.updates).toBe(1);
    }
    for (const step of ["same props", "running", "reset"]) {
      expect(componentStat(report, step, "VariableField")).toBeUndefined();
    }
  });
});
