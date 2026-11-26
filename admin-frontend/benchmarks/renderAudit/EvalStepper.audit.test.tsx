import {describe, expect, it} from "bun:test";

import {auditComponent} from "../../../ui/benchmarks/renderAudit/auditComponent";
import {componentStat} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {
  EvalPipelineOverview,
  type EvalPipelineOverviewProps,
} from "../../src/widgets/aiObservability/shell/EvalPipelineOverview";
import {
  EvalStepper,
  type EvalStepperProps,
  type EvalStepperStep,
} from "../../src/widgets/aiObservability/shell/EvalStepper";

const handlePress = (): void => {};
const buildSteps = (now: number): EvalStepperStep[] =>
  Array.from({length: 8}, (_, index) => ({
    detail: `Detail ${index}`,
    onPress: handlePress,
    state: index < now ? "done" : index === now ? "now" : "later",
    title: `Step ${index}`,
  }));
const baseline: EvalStepperProps = {steps: buildSteps(2), testID: "stepper"};
const overview: EvalPipelineOverviewProps = {
  ctaText: "Start",
  currentSteps: [2],
  onStart: handlePress,
};

describe("EvalStepper renders", () => {
  it("re-renders only the steps whose state changed", async () => {
    const report = await auditComponent({
      baseline,
      Component: EvalStepper,
      changes: {
        "advance one step": {...baseline, steps: buildSteps(3)},
        "new onPress identity": {
          ...baseline,
          steps: buildSteps(2).map((step) => ({...step, onPress: (): void => {}})),
        },
        "new steps, equal content": {...baseline, steps: buildSteps(2)},
      },
      name: "EvalStepper",
    });

    expect(componentStat(report, "same props", "StepItem")).toBeUndefined();
    expect(componentStat(report, "new steps, equal content", "StepItem")).toBeUndefined();
    expect(componentStat(report, "new onPress identity", "StepItem")).toBeUndefined();
    expect(componentStat(report, "advance one step", "StepItem")?.updates).toBe(2);
  });
  it("keeps the eval plan steps still when the overview re-renders", async () => {
    const report = await auditComponent({
      baseline: overview,
      Component: EvalPipelineOverview,
      changes: {
        "current step changed": {...overview, currentSteps: [3]},
        "new currentSteps array": {...overview, currentSteps: [2]},
        "new onStart identity": {...overview, onStart: (): void => {}},
      },
      name: "EvalPipelineOverview",
    });

    expect(componentStat(report, "same props", "StepItem")).toBeUndefined();
    expect(componentStat(report, "new currentSteps array", "StepItem")).toBeUndefined();
    expect(componentStat(report, "new onStart identity", "StepItem")).toBeUndefined();
    expect(componentStat(report, "current step changed", "StepItem")?.updates).toBe(2);
  });
});
