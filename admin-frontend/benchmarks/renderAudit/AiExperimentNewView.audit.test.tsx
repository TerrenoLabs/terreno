import {describe, expect, it} from "bun:test";

import {
  componentStat,
  createRenderAudit,
  formatReport,
} from "../../../ui/benchmarks/renderAudit/renderAudit";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {DatasetRecord} from "../../src/widgets/aiObservability/datasets/datasetTypes";
import type {EvaluatorRecord} from "../../src/widgets/aiObservability/evaluators/evaluatorTypes";
import {
  AiExperimentNewView,
  type AiExperimentNewViewProps,
} from "../../src/widgets/aiObservability/experiments/AiExperimentNewView";
import type {AiJudgeExperimentStepsProps} from "../../src/widgets/aiObservability/experiments/AiJudgeExperimentSteps";
import type {
  PromptDetail,
  PromptListItem,
} from "../../src/widgets/aiObservability/prompts/promptTypes";

const runModes = {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0};
const human: EvaluatorRecord = {
  confidenceAlertBelow: 0.5,
  dimensions: [{dataType: "boolean", key: "correct", required: true}],
  id: "eval-human",
  name: "review queue",
  runModes,
  target: "full trace",
  type: "human",
};
const automatic: EvaluatorRecord[] = Array.from({length: 9}, (_, index) => ({
  calibration:
    index % 3 === 0
      ? {
          experimentId: "e",
          experimentName: "exp",
          passed: true,
          rate: 0.95,
          stale: false,
          version: 1,
        }
      : undefined,
  confidenceAlertBelow: 0.5,
  dimensions: [{dataType: "boolean" as const, key: "correct", required: true}],
  id: `eval-${index}`,
  judgePromptName: index % 2 === 0 ? "judge" : undefined,
  name: `Evaluator ${index}`,
  runModes,
  target: "full trace" as const,
  type: index % 2 === 0 ? ("llm-judge" as const) : ("json-assert" as const),
}));
const evaluators: EvaluatorRecord[] = [human, ...automatic];
const datasets: DatasetRecord[] = Array.from({length: 9}, (_, index) => ({
  counts: {auto: 0, human: 3, needsReview: 1, total: 5},
  created: "2026-01-01T00:00:00.000Z",
  id: `ds-${index}`,
  inputSchemaPromptName: "summarize",
  judgments:
    index % 3 === 2
      ? []
      : [
          {
            answered: 3,
            current: 3,
            evaluatorId: "eval-human",
            evaluatorName: "review queue",
            stale: index % 2,
            total: 5,
          },
        ],
  name: `Dataset ${index}`,
  tags: [],
  updated: "2026-01-02T00:00:00.000Z",
}));
const prompts: PromptListItem[] = [
  {folder: "ops", latestVersion: 2, name: "summarize", production: 1, type: "chat"},
];
const promptDetail: PromptDetail = {
  folder: "ops",
  labels: [
    {label: "latest", version: 8},
    {label: "production", version: 1},
  ],
  name: "summarize",
  relationships: {
    experiments: {items: [], limit: 20, total: 0},
    traces: {items: [], limit: 20, total: 0},
  },
  tags: [],
  usedBy: {items: [], limit: 20, total: 0},
  versions: Array.from({length: 8}, (_, index) => ({
    sensitive: false,
    template: `v${index + 1}`,
    type: "chat" as const,
    variables: [],
    version: index + 1,
  })),
};
const noop = (): void => {};
const versions = [1, 2];
const evaluatorIds = ["eval-0"];
const judgeMembers: AiJudgeExperimentStepsProps = {
  datasetId: "ds-0",
  datasets,
  evaluators,
  isCreating: false,
  isEstimating: false,
  judgeEvaluatorId: "eval-0",
  judgePromptDetail: promptDetail,
  modelOverride: "",
  onDatasetChange: noop,
  onJudgeChange: noop,
  onModelOverrideChange: noop,
  onOpenDataset: noop,
  onQuestionSetChange: noop,
  onRun: noop,
  onStepChange: noop,
  onTargetAgreementChange: noop,
  onVersionToggle: noop,
  questionSetId: "eval-human",
  step: 1,
  targetAgreement: "90",
  versions,
};
// The screen builds the `judge` object inline on every render; its members are stable.
const promptPath = (
  overrides: Partial<AiExperimentNewViewProps> = {}
): AiExperimentNewViewProps => ({
  datasetId: "ds-0",
  datasets,
  evaluatorIds,
  evaluators,
  includeUnproofread: false,
  isCreating: false,
  isEstimating: false,
  judge: {...judgeMembers},
  modelOverride: "",
  name: "",
  onDatasetChange: noop,
  onEvaluatorToggle: noop,
  onIncludeUnproofreadChange: noop,
  onModelOverrideChange: noop,
  onNameChange: noop,
  onPipelineChange: noop,
  onPromptChange: noop,
  onRun: noop,
  onStepChange: noop,
  onVersionToggle: noop,
  pipeline: "prompt",
  promptDetail,
  promptName: "summarize",
  prompts,
  step: 3,
  versions,
  ...overrides,
});
const judgePath = (
  overrides: Partial<AiExperimentNewViewProps> = {},
  judgeOverrides: Partial<AiJudgeExperimentStepsProps> = {}
): AiExperimentNewViewProps =>
  promptPath({judge: {...judgeMembers, ...judgeOverrides}, pipeline: "judge", ...overrides});

describe("AiExperimentNewView renders", () => {
  it("keeps choice rows and the judge wizard out of name keystrokes", async () => {
    const audit = createRenderAudit({ignore: /^(ThemeProvider|TerrenoFontProvider)$/});
    let mounted: ReturnType<typeof renderWithTheme> | undefined;
    await audit.step("mount", () => {
      mounted = renderWithTheme(<AiExperimentNewView {...promptPath()} />);
    });
    const view = mounted as ReturnType<typeof renderWithTheme>;
    const steps: Array<[string, AiExperimentNewViewProps]> = [
      ["same props", promptPath()],
      ["type name", promptPath({name: "N"})],
      ["reset", promptPath()],
      ["toggle evaluator", promptPath({evaluatorIds: ["eval-0", "eval-3"]})],
      ["reset 2", promptPath()],
      ["new equal evaluatorIds", promptPath({evaluatorIds: [...evaluatorIds]})],
      ["new equal evaluators", promptPath({evaluators: [...evaluators]})],
      ["reset 3", promptPath()],
      ["new callbacks", promptPath({onEvaluatorToggle: (): void => {}, onRun: (): void => {}})],
      ["versions step", promptPath({step: 2})],
      ["versions step: type name", promptPath({name: "N", step: 2})],
      ["versions step: toggle version", promptPath({name: "N", step: 2, versions: [1, 2, 3]})],
      ["judge path", judgePath()],
      ["judge path: same props", judgePath()],
      ["judge path: type name", judgePath({name: "N"})],
      ["judge path: select dataset", judgePath({name: "N"}, {datasetId: "ds-1"})],
      ["judge path: versions step", judgePath({name: "N"}, {step: 3})],
      ["judge path: versions step, type name", judgePath({name: "Na"}, {step: 3})],
    ];
    for (const [label, props] of steps) {
      await audit.step(label, () => view.rerender(<AiExperimentNewView {...props} />));
    }
    const report = audit.report();
    audit.dispose();
    view.unmount();
    if (process.env.RENDER_AUDIT_PRINT) {
      console.info(`\n## AiExperimentNewView\n${formatReport(report, {limit: 30})}`);
    }
    expect(componentStat(report, "mount", "EvaluatorChoice")?.mounts).toBe(automatic.length);
    // Typing the experiment name re-renders no evaluator, version, or dataset row.
    expect(componentStat(report, "type name", "EvaluatorChoice")).toBeUndefined();
    expect(componentStat(report, "new equal evaluatorIds", "EvaluatorChoice")).toBeUndefined();
    expect(componentStat(report, "toggle evaluator", "EvaluatorChoice")?.updates).toBe(1);
    expect(componentStat(report, "versions step", "VersionChoice")?.mounts).toBe(
      promptDetail.versions.length
    );
    expect(componentStat(report, "versions step: type name", "VersionChoice")).toBeUndefined();
    expect(componentStat(report, "versions step: toggle version", "VersionChoice")?.updates).toBe(
      1
    );
    // The judge wizard receives a new `judge` object each render but equal members.
    expect(componentStat(report, "judge path", "DatasetChoiceBody")?.mounts).toBe(datasets.length);
    for (const step of ["judge path: same props", "judge path: type name"]) {
      expect(componentStat(report, step, "AiJudgeExperimentSteps")).toBeUndefined();
      expect(componentStat(report, step, "DatasetChoiceBody")).toBeUndefined();
    }
    expect(
      componentStat(report, "judge path: versions step, type name", "AiJudgeExperimentSteps")
    ).toBeUndefined();
    // Picking another dataset re-renders the row that lost the selection and the one that got it.
    expect(componentStat(report, "judge path: select dataset", "DatasetChoiceBody")?.updates).toBe(
      2
    );
  });
});
