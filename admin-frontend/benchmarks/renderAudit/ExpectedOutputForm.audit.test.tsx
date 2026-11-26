import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React, {useState} from "react";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiDatasetItemView} from "../../src/widgets/aiObservability/datasets/AiDatasetItemView";

const initialExpected: Record<string, unknown> = {
  answer: "A",
  category: "billing",
  confidence: 0.5,
  crisis: false,
  followUp: "none",
  language: "en",
  notes: "n",
  summary: "s",
};
const input = {question: "What is Terreno?", user: "u1"};

// Mirrors AiDatasetItemScreen: the screen owns the values and passes stable setters.
const Host: React.FC<{tick?: number}> = () => {
  const [expected, setExpected] = useState<unknown>(initialExpected);
  const [outcome, setOutcome] = useState("");
  const [proofread, setProofread] = useState(false);
  const [inputValue, setInputValue] = useState<unknown>(input);
  return (
    <AiDatasetItemView
      expected={expected}
      input={inputValue}
      onExpectedChange={setExpected}
      onInputChange={setInputValue}
      onOutcomeChange={setOutcome}
      onProofreadChange={setProofread}
      onSave={noop}
      outcomeClass={outcome}
      proofread={proofread}
      reviewing
      saveLabel="Save"
    />
  );
};
const noop = (): void => {};

describe("ExpectedOutputForm renders", () => {
  it("re-renders only the field being typed in", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider|Host)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", () => {
      mounted = renderWithTheme(<Host />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("parent re-render", () => view.rerender(<Host tick={1} />));
    await audit.step("type in one field", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-dataset-item-expected-answer"), "AB");
      });
    });
    await audit.step("type again", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-dataset-item-expected-answer"), "ABC");
      });
    });
    await audit.step("type in another field", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-dataset-item-expected-summary"), "sum");
      });
    });
    // The stable commit handler must write into the newest value, not the one it mounted with.
    expect(view.getByTestId("ai-dataset-item-expected-answer").props.value).toBe("ABC");
    expect(view.getByTestId("ai-dataset-item-expected-summary").props.value).toBe("sum");
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## ExpectedOutputForm\n${formatReport(report, {limit: 40})}`);
    }
    expect(componentStat(report, "mount", "FieldInput")?.mounts).toBe(10);
    expect(componentStat(report, "parent re-render", "FieldInput")).toBeUndefined();
    expect(componentStat(report, "parent re-render", "ExpectedOutputForm")).toBeUndefined();
    for (const step of ["type in one field", "type again", "type in another field"]) {
      // Only the expected-output form updates; the read-only input form stays idle.
      expect(componentStat(report, step, "ExpectedOutputForm")?.updates).toBe(1);
      expect(componentStat(report, step, "FieldInput")?.updates).toBe(1);
      expect(componentStat(report, step, "TextField")?.updates).toBe(1);
    }
  });
});
