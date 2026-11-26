import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React, {useCallback, useState} from "react";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {
  AiEvaluatorNewView,
  defaultEvaluatorRunModes,
} from "../../src/widgets/aiObservability/evaluators/AiEvaluatorPanels";
import type {EvaluatorDimension} from "../../src/widgets/aiObservability/evaluators/evaluatorTypes";

const DIMENSION_COUNT = 8;
const DATA_TYPES: EvaluatorDimension["dataType"][] = ["boolean", "numeric", "categorical"];
const initialDimensions: EvaluatorDimension[] = Array.from(
  {length: DIMENSION_COUNT},
  (_, index) => {
    const dataType = DATA_TYPES[index % 3] as EvaluatorDimension["dataType"];
    return {
      dataType,
      key: `score_${index}`,
      range: dataType === "numeric" ? "0-5" : dataType === "categorical" ? "good,bad" : undefined,
      required: true,
    };
  }
);
const noop = (): void => {};

// Mirrors AiEvaluatorNewScreenWidget: the screen owns the values and passes stable handlers.
const Host: React.FC<{tick?: number}> = () => {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dimensions, setDimensions] = useState<EvaluatorDimension[]>(initialDimensions);
  const [runModes] = useState(defaultEvaluatorRunModes);
  const handleDimensionChange = useCallback(
    (index: number, dimension: EvaluatorDimension): void => {
      setDimensions((current) =>
        current.map((entry, entryIndex) => (entryIndex === index ? dimension : entry))
      );
    },
    []
  );
  const handleRemoveDimension = useCallback((index: number): void => {
    setDimensions((current) => current.filter((_entry, entryIndex) => entryIndex !== index));
  }, []);
  return (
    <AiEvaluatorNewView
      assertionConstraint="exists"
      assertionPath=""
      description={description}
      dimensions={dimensions}
      instructions={instructions}
      isCreating={false}
      judgePromptName=""
      name={name}
      onAddDimension={noop}
      onAssertionConstraintChange={noop}
      onAssertionPathChange={noop}
      onCancel={noop}
      onCreate={noop}
      onDescriptionChange={setDescription}
      onDimensionChange={handleDimensionChange}
      onInstructionsChange={setInstructions}
      onJudgePromptNameChange={noop}
      onLiveSampleRateChange={noop}
      onNameChange={setName}
      onRemoveDimension={handleRemoveDimension}
      onTypeChange={noop}
      runModes={runModes}
      target="full trace"
      type="human"
    />
  );
};

describe("AiEvaluatorNewView renders", () => {
  it("re-renders only the score card being edited", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider|Host)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", () => {
      mounted = renderWithTheme(<Host />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    await audit.step("parent re-render", () => view.rerender(<Host tick={1} />));
    await audit.step("type the name", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "Q");
      });
    });
    await audit.step("type instructions", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-evaluator-instructions"), "Be strict");
      });
    });
    await audit.step("type one score name", async () => {
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-evaluator-dimension-2-key"), "tone");
      });
    });
    await audit.step("remove one score", async () => {
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-dimension-7-remove"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
    });
    expect(view.getByTestId("ai-evaluator-dimension-2-key").props.value).toBe("tone");
    expect(view.queryByTestId("ai-evaluator-dimension-row-7")).toBeNull();
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiEvaluatorNewView\n${formatReport(report, {limit: 40})}`);
    }
    expect(componentStat(report, "mount", "DimensionRow")?.mounts).toBe(DIMENSION_COUNT);
    for (const step of ["parent re-render", "type the name", "type instructions"]) {
      expect(componentStat(report, step, "DimensionRow")).toBeUndefined();
      expect(componentStat(report, step, "DimensionScaleFields")).toBeUndefined();
    }
    expect(componentStat(report, "type one score name", "DimensionRow")?.updates).toBe(1);
    // Removing the last card leaves the other seven untouched.
    expect(componentStat(report, "remove one score", "DimensionRow")?.updates).toBeUndefined();
  });
});
