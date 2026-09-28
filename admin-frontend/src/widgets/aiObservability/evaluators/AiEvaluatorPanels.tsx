import {Badge, Box, Button, Heading, Link, SelectField, Text, TextField} from "@terreno/ui";
import React, {useCallback, useMemo, useState} from "react";
import {
  ObservabilityTable,
  type ObservabilityTableColumn,
  type ObservabilityTableRow,
} from "../shell/ObservabilityTable";
import {
  DIMENSION_DATA_TYPES,
  dimensionForDataType,
  EVALUATOR_TYPE_LABELS,
  type EvaluatorDimension,
  type EvaluatorRecord,
  type EvaluatorUsageRow,
  emptyDimension,
  formatCategories,
  formatNumericRange,
  formatRunModeChips,
  judgeSchemaMissingDimensions,
  parseCategories,
  parseNumericBounds,
} from "./evaluatorTypes";

type JudgePromptStatus = "error" | "idle" | "loading" | "ready";

const EVALUATOR_NEW_INTRO =
  "Evaluators turn AI results into consistent scores you can compare, filter, and review. Set up who decides the score, what they can see, and which score fields are saved.";

const EVALUATOR_TYPE_HELP: Record<EvaluatorRecord["type"], string> = {
  human:
    "A reviewer decides the score. Send traces to this evaluator from Traces; they wait in Human review until someone submits the score.",
  "json-assert":
    "Terreno reads one value from the JSON and checks a rule. This is fast, deterministic, and has no model cost.",
  "llm-judge":
    "A scoring prompt asks a model to judge quality or meaning that code cannot reliably check. Each evaluation is a billed model call.",
};

const FULL_TRACE_TARGET_HELP =
  "The evaluator sees the complete interaction, including nested steps, the compiled prompt, and final output.";

const EVALUATOR_NAME_HELP =
  "Use a short, unique name such as answer-correctness or safe-response. This name also identifies its scores.";

const EVALUATOR_DESCRIPTION_HELP =
  "Explain what a good result means and when your team should use this evaluator.";

const EVALUATOR_DIMENSIONS_HELP =
  "Each dimension becomes a separate saved score. Start with one score unless reviewers or experiments need to compare different qualities separately.";

const EVALUATOR_DIMENSION_KEY_HELP =
  "The score label shown on traces and experiment results, such as correct, helpful, or toxicity.";

const EVALUATOR_DIMENSION_MIN_HELP = "Lowest allowed number, such as 0.";

const EVALUATOR_DIMENSION_MAX_HELP = "Highest allowed number, such as 1 or 5.";

const EVALUATOR_DIMENSION_CATEGORY_HELP =
  "Add each label reviewers or the judge can choose, such as pass, partial, or fail.";

const EVALUATOR_INSTRUCTIONS_HELP =
  "Reviewers see these instructions above the score fields. Define what each score means and include examples of borderline or failing results.";

const EVALUATOR_ASSERTION_PATH_HELP =
  "Enter the field to inspect, such as output.text or output.score.";

const EVALUATOR_ASSERTION_CONSTRAINT_HELP =
  "Enter the rule for that field: exists, an exact value, or a numeric comparison such as gte 0.8.";

const EVALUATOR_JUDGE_PROMPT_HELP =
  "Choose a prompt from AI Observability → Prompts that tells the model how to score. Its production output schema must return every required score name above.";

const EVALUATOR_LIVE_SAMPLE_HELP =
  "Choose what percentage of production traces to score automatically. Use 0 to keep live scoring off.";

interface EvaluatorSetupStepProps {
  children: React.ReactNode;
  description?: string;
  number: number;
  testID: string;
  title: string;
}

const EvaluatorSetupStep: React.FC<EvaluatorSetupStepProps> = ({
  children,
  description,
  number,
  testID,
  title,
}) => {
  return (
    <Box
      accessibilityLabel={`Step ${number} of 6: ${title}`}
      border="default"
      gap={3}
      padding={4}
      rounding="md"
      testID={testID}
    >
      <Box direction="row" gap={2}>
        <Badge status="neutral" value={String(number)} />
        <Box flex="grow" gap={1}>
          <Heading size="sm">{title}</Heading>
          <Text color="secondaryDark" size="sm">
            {description}
          </Text>
        </Box>
      </Box>
      {children}
    </Box>
  );
};

export interface AiEvaluatorDetailViewProps {
  evaluator: EvaluatorRecord;
  judgeOutputSchema?: Record<string, unknown>;
  judgePromptStatus?: JudgePromptStatus;
  onOpenPrompt?: (name: string) => void;
  routeBase: string;
  usageRows: EvaluatorUsageRow[];
}

export interface AiEvaluatorNewViewProps {
  assertionConstraint: string;
  assertionPath: string;
  createError?: string;
  description: string;
  dimensions: EvaluatorDimension[];
  instructions: string;
  isCreating: boolean;
  judgePromptName: string;
  judgePromptOptions?: Array<{label: string; value: string}>;
  judgePromptStatus?: JudgePromptStatus;
  name: string;
  onAddDimension: () => void;
  onAssertionConstraintChange: (value: string) => void;
  onAssertionPathChange: (value: string) => void;
  onCreate: () => void;
  onDescriptionChange?: (value: string) => void;
  onDimensionChange: (index: number, dimension: EvaluatorDimension) => void;
  onInstructionsChange: (value: string) => void;
  onJudgePromptNameChange: (value: string) => void;
  onLiveSampleRateChange: (value: number) => void;
  onNameChange: (value: string) => void;
  onRemoveDimension: (index: number) => void;
  onTypeChange: (value: EvaluatorRecord["type"]) => void;
  runModes: EvaluatorRecord["runModes"];
  schemaMismatchKey?: string;
  target: EvaluatorRecord["target"];
  type: EvaluatorRecord["type"];
}

const DIMENSION_COLUMNS: ObservabilityTableColumn[] = [
  {minWidth: 120, title: "Key"},
  {minWidth: 100, title: "Data type"},
  {minWidth: 80, title: "Range"},
  {minWidth: 80, title: "Required"},
];

const USAGE_COLUMNS: ObservabilityTableColumn[] = [
  {minWidth: 160, title: "Experiment"},
  {minWidth: 90, title: "30d runs"},
  {minWidth: 90, title: "Cost"},
];

const renderTypePanel = ({
  assertionConstraint,
  assertionPath,
  evaluator,
  evaluatorType,
  judgeOutputSchema,
  instructions,
  judgePromptName,
  judgePromptStatus,
  onAssertionConstraintChange,
  onAssertionPathChange,
  onInstructionsChange,
  onJudgePromptNameChange,
  judgePromptOptions,
  onOpenPrompt,
  routeBase,
  schemaMismatchKey,
}: {
  assertionConstraint?: string;
  assertionPath?: string;
  evaluator?: EvaluatorRecord;
  evaluatorType?: EvaluatorRecord["type"];
  judgeOutputSchema?: Record<string, unknown>;
  instructions?: string;
  judgePromptName?: string;
  judgePromptOptions?: Array<{label: string; value: string}>;
  judgePromptStatus?: JudgePromptStatus;
  onAssertionConstraintChange?: (value: string) => void;
  onAssertionPathChange?: (value: string) => void;
  onInstructionsChange?: (value: string) => void;
  onJudgePromptNameChange?: (value: string) => void;
  onOpenPrompt?: (name: string) => void;
  routeBase?: string;
  schemaMismatchKey?: string;
}): React.ReactNode => {
  const type = evaluator?.type ?? evaluatorType;
  if (type === "llm-judge") {
    const promptStatus =
      judgePromptStatus ?? (evaluator || judgePromptName?.trim() ? "ready" : "idle");
    const missing =
      promptStatus === "ready"
        ? judgeSchemaMissingDimensions(evaluator?.dimensions ?? [], judgeOutputSchema)
        : [];
    const mismatch = schemaMismatchKey ?? missing[0];
    return (
      <Box gap={2} testID="ai-evaluator-panel-llm-judge">
        {evaluator ? (
          <Box direction="row" gap={2} wrap>
            <Text>
              Judge prompt:{" "}
              {evaluator.judgePromptName ? (
                onOpenPrompt ? (
                  <Button
                    onClick={() => {
                      onOpenPrompt(evaluator.judgePromptName ?? "");
                    }}
                    size="sm"
                    text={evaluator.judgePromptName}
                    variant="ghost"
                  />
                ) : (
                  <Link
                    href={`${routeBase}/ai-prompt-editor?name=${encodeURIComponent(evaluator.judgePromptName)}`}
                    text={evaluator.judgePromptName}
                  />
                )
              ) : (
                "—"
              )}
            </Text>
          </Box>
        ) : (
          <SelectField
            helperText={
              (judgePromptOptions ?? []).length === 0
                ? "Create a prompt first, then choose it here."
                : EVALUATOR_JUDGE_PROMPT_HELP
            }
            onChange={onJudgePromptNameChange ?? (() => undefined)}
            options={judgePromptOptions ?? []}
            placeholder="Select a prompt"
            testID="ai-evaluator-judge-prompt"
            title="Judge prompt"
            value={judgePromptName ?? ""}
          />
        )}
        {mismatch ? (
          <Text color="error" testID="ai-evaluator-schema-mismatch">
            Judge prompt output schema missing required dimension &quot;{mismatch}&quot;
          </Text>
        ) : promptStatus === "loading" ? (
          <Text color="secondaryDark" size="sm" testID="ai-evaluator-schema-loading">
            Checking judge prompt schema…
          </Text>
        ) : promptStatus === "error" ? (
          <Text color="error" size="sm" testID="ai-evaluator-schema-error">
            Judge prompt or its production schema could not be loaded.
          </Text>
        ) : promptStatus === "idle" ? (
          <Text color="secondaryDark" size="sm" testID="ai-evaluator-schema-idle">
            Select a judge prompt to check its production output schema.
          </Text>
        ) : (
          <Text color="success" size="sm">
            Schema match check passed
          </Text>
        )}
      </Box>
    );
  }
  if (type === "json-assert") {
    return (
      <Box gap={2} testID="ai-evaluator-panel-json-assert">
        {evaluator ? (
          <Box gap={1}>
            <Text>
              Path: <Text bold>{evaluator.assertion?.path ?? "—"}</Text>
            </Text>
            <Text>
              Constraint: <Text bold>{evaluator.assertion?.constraint ?? "—"}</Text>
            </Text>
          </Box>
        ) : (
          <>
            <TextField
              helperText={EVALUATOR_ASSERTION_PATH_HELP}
              onChange={onAssertionPathChange ?? (() => undefined)}
              testID="ai-evaluator-assertion-path"
              title="Assertion path"
              value={assertionPath ?? ""}
            />
            <TextField
              helperText={EVALUATOR_ASSERTION_CONSTRAINT_HELP}
              onChange={onAssertionConstraintChange ?? (() => undefined)}
              testID="ai-evaluator-assertion-constraint"
              title="Constraint"
              value={assertionConstraint ?? ""}
            />
          </>
        )}
      </Box>
    );
  }
  return (
    <Box gap={2} testID="ai-evaluator-panel-human">
      {evaluator ? (
        <Text>{evaluator.instructions ?? "No reviewer instructions."}</Text>
      ) : (
        <TextField
          helperText={EVALUATOR_INSTRUCTIONS_HELP}
          multiline
          onChange={onInstructionsChange ?? (() => undefined)}
          rows={4}
          testID="ai-evaluator-instructions"
          title="Reviewer instructions"
          value={instructions ?? ""}
        />
      )}
    </Box>
  );
};

export const AiEvaluatorDetailView: React.FC<AiEvaluatorDetailViewProps> = ({
  evaluator,
  judgeOutputSchema,
  judgePromptStatus,
  onOpenPrompt,
  routeBase,
  usageRows,
}) => {
  const dimensionRows: ObservabilityTableRow[] = useMemo(() => {
    return evaluator.dimensions.map((dimension, index) => {
      return {
        cells: [
          dimension.key,
          dimension.dataType,
          dimension.range ?? "—",
          dimension.required ? "Yes" : "No",
        ],
        key: dimension.key || `dimension-${index}`,
      };
    });
  }, [evaluator.dimensions]);

  const usageTableRows: ObservabilityTableRow[] = useMemo(() => {
    return usageRows.map((row, index) => {
      return {
        cells: [
          row.experimentName,
          String(row.runs),
          row.costUsd !== undefined ? `$${row.costUsd.toFixed(2)}` : "—",
        ],
        key: row.experimentId ?? `usage-${index}`,
      };
    });
  }, [usageRows]);

  const chips = formatRunModeChips(evaluator.runModes);

  return (
    <Box gap={4} testID="ai-evaluator-detail">
      <Box gap={2}>
        <Heading size="md" testID="ai-evaluator-name">
          {evaluator.name}
        </Heading>
        {evaluator.description ? (
          <Text color="secondaryDark">{evaluator.description}</Text>
        ) : undefined}
        <Box direction="row" gap={2} wrap>
          <Badge status="info" value={EVALUATOR_TYPE_LABELS[evaluator.type]} />
          <Badge status="neutral" value={evaluator.target} />
          {chips.map((chip) => {
            return <Badge key={chip} status="neutral" value={chip} />;
          })}
        </Box>
      </Box>
      <Box gap={2}>
        <Heading size="sm">Scores this evaluator saves</Heading>
        <Text color="secondaryDark" size="sm">
          Each row is stored as a separate score on the trace or experiment result.
        </Text>
        <ObservabilityTable
          columns={DIMENSION_COLUMNS}
          rows={dimensionRows}
          testID="ai-evaluator-dimensions"
        />
      </Box>
      <Box gap={2}>
        <Heading size="sm">How scoring works</Heading>
        {renderTypePanel({
          evaluator,
          judgeOutputSchema,
          judgePromptStatus,
          onOpenPrompt,
          routeBase,
        })}
      </Box>
      <Box gap={2}>
        <Heading size="sm">Where it runs</Heading>
        {evaluator.type === "human" ? (
          <Text size="sm">
            Reviewers apply this evaluator in Human review. It never runs automatically on live
            traffic.
          </Text>
        ) : (
          <Text size="sm">
            Available for manual runs and experiments. Live sampling scores{" "}
            {Math.round(evaluator.runModes.liveSampleRate)}% of matching production traffic.
          </Text>
        )}
      </Box>
      <Box gap={2}>
        <Heading size="sm">Used by (30 days)</Heading>
        {usageRows.length === 0 ? (
          <Text color="secondaryDark" testID="ai-evaluator-used-by-empty">
            No experiments in the last 30 days.
          </Text>
        ) : (
          <ObservabilityTable
            columns={USAGE_COLUMNS}
            rows={usageTableRows}
            testID="ai-evaluator-used-by"
          />
        )}
      </Box>
    </Box>
  );
};

interface DimensionScaleFieldsProps {
  dimension: EvaluatorDimension;
  index: number;
  onDimensionChange: (index: number, dimension: EvaluatorDimension) => void;
}

const DimensionScaleFields: React.FC<DimensionScaleFieldsProps> = ({
  dimension,
  index,
  onDimensionChange,
}) => {
  const [draftCategory, setDraftCategory] = useState("");
  const bounds = parseNumericBounds(dimension.range);
  const [min, setMin] = useState(bounds.min);
  const [max, setMax] = useState(bounds.max);
  const categories = parseCategories(dimension.range);

  const handleMinChange = useCallback(
    (value: string): void => {
      setMin(value);
      onDimensionChange(index, {...dimension, range: formatNumericRange(value, max)});
    },
    [dimension, index, max, onDimensionChange]
  );

  const handleMaxChange = useCallback(
    (value: string): void => {
      setMax(value);
      onDimensionChange(index, {...dimension, range: formatNumericRange(min, value)});
    },
    [dimension, index, min, onDimensionChange]
  );

  const handleAddCategory = useCallback((): void => {
    const next = draftCategory.trim();
    if (!next) {
      return;
    }
    if (categories.includes(next)) {
      setDraftCategory("");
      return;
    }
    onDimensionChange(index, {
      ...dimension,
      range: formatCategories([...categories, next]),
    });
    setDraftCategory("");
  }, [categories, dimension, draftCategory, index, onDimensionChange]);

  const handleRemoveCategory = useCallback(
    (category: string): void => {
      onDimensionChange(index, {
        ...dimension,
        range: formatCategories(categories.filter((entry) => entry !== category)),
      });
    },
    [categories, dimension, index, onDimensionChange]
  );

  if (dimension.dataType === "boolean") {
    return null;
  }

  if (dimension.dataType === "numeric") {
    return (
      <Box direction="row" gap={2} testID={`ai-evaluator-dimension-${index}-numeric`} wrap>
        <TextField
          helperText={EVALUATOR_DIMENSION_MIN_HELP}
          onChange={handleMinChange}
          testID={`ai-evaluator-dimension-${index}-min`}
          title="Min"
          value={min}
        />
        <TextField
          helperText={EVALUATOR_DIMENSION_MAX_HELP}
          onChange={handleMaxChange}
          testID={`ai-evaluator-dimension-${index}-max`}
          title="Max"
          value={max}
        />
      </Box>
    );
  }

  return (
    <Box gap={2} testID={`ai-evaluator-dimension-${index}-categories`}>
      <Box direction="row" gap={2} wrap>
        <TextField
          helperText={EVALUATOR_DIMENSION_CATEGORY_HELP}
          onChange={setDraftCategory}
          testID={`ai-evaluator-dimension-${index}-category-draft`}
          title="Category"
          value={draftCategory}
        />
        <Button
          onClick={handleAddCategory}
          testID={`ai-evaluator-dimension-${index}-add-category`}
          text="Add category"
        />
      </Box>
      {categories.map((category) => {
        return (
          <Box alignItems="center" direction="row" gap={2} key={category}>
            <Text>{category}</Text>
            <Button
              onClick={() => {
                handleRemoveCategory(category);
              }}
              testID={`ai-evaluator-dimension-${index}-remove-category-${category}`}
              text="Remove category"
              variant="ghost"
            />
          </Box>
        );
      })}
    </Box>
  );
};

export const AiEvaluatorNewView: React.FC<AiEvaluatorNewViewProps> = ({
  assertionConstraint,
  assertionPath,
  createError,
  description,
  dimensions,
  instructions,
  isCreating,
  judgePromptName,
  judgePromptOptions = [],
  judgePromptStatus,
  name,
  onAddDimension,
  onAssertionConstraintChange,
  onAssertionPathChange,
  onCreate,
  onDescriptionChange,
  onDimensionChange,
  onInstructionsChange,
  onJudgePromptNameChange,
  onLiveSampleRateChange,
  onNameChange,
  onRemoveDimension,
  onTypeChange,
  runModes,
  schemaMismatchKey,
  target,
  type,
}) => {
  const handleTypeSelect = useCallback(
    (next: EvaluatorRecord["type"]): void => {
      onTypeChange(next);
    },
    [onTypeChange]
  );

  const methodStepDescription =
    type === "human"
      ? "Write the guidance a reviewer needs to apply the scores consistently."
      : type === "json-assert"
        ? "Point to one JSON value and define the rule it must satisfy."
        : "Connect the prompt that will read the data and return the scores.";

  const runStepDescription =
    type === "human"
      ? "Human evaluators appear in the review queue and never score live traffic automatically."
      : "Automatic evaluators are available in experiments and manual runs. Live sampling is optional.";

  return (
    <Box gap={4} testID="ai-evaluator-new">
      <EvaluatorSetupStep
        description="Give teammates enough context to recognize and reuse this evaluator."
        number={1}
        testID="ai-evaluator-step-name"
        title="Name the evaluator"
      >
        <TextField
          helperText={EVALUATOR_NAME_HELP}
          onChange={onNameChange}
          testID="ai-evaluator-name"
          title="Name"
          value={name}
        />
        <TextField
          helperText={EVALUATOR_DESCRIPTION_HELP}
          multiline
          onChange={onDescriptionChange ?? (() => undefined)}
          rows={3}
          testID="ai-evaluator-description"
          title="Purpose (optional)"
          value={description ?? ""}
        />
      </EvaluatorSetupStep>
      <Box border="default" gap={2} padding={4} rounding="md" testID="ai-evaluator-help-intro">
        <Heading size="sm">Create a reusable scoring rule</Heading>
        <Text color="secondaryDark">{EVALUATOR_NEW_INTRO}</Text>
      </Box>
      <EvaluatorSetupStep
        description="Choose whether a person, a deterministic JSON rule, or another model decides the score."
        number={2}
        testID="ai-evaluator-step-method"
        title="Choose how scoring happens"
      >
        <Box direction="row" gap={2} wrap>
          {(["human", "json-assert", "llm-judge"] as const).map((entry) => {
            return (
              <Button
                key={entry}
                onClick={() => {
                  handleTypeSelect(entry);
                }}
                testID={`ai-evaluator-type-${entry}`}
                text={EVALUATOR_TYPE_LABELS[entry]}
                variant={type === entry ? "primary" : "secondary"}
              />
            );
          })}
        </Box>
        <Text color="secondaryDark" size="sm" testID="ai-evaluator-help-type">
          {EVALUATOR_TYPE_HELP[type]}
        </Text>
      </EvaluatorSetupStep>
      {/* TODO: enable generation span and dataset item targets. */}
      <EvaluatorSetupStep
        description="Full traces are the only target available. Span and dataset item scoring are not enabled yet."
        number={3}
        testID="ai-evaluator-step-target"
        title="What it evaluates"
      >
        <Badge status="neutral" value={target} />
        <Text color="secondaryDark" size="sm" testID="ai-evaluator-help-target">
          {FULL_TRACE_TARGET_HELP}
        </Text>
      </EvaluatorSetupStep>
      <EvaluatorSetupStep
        description="Define exactly what appears in results. Each dimension is saved independently."
        number={4}
        testID="ai-evaluator-step-scores"
        title="Define the scores it returns"
      >
        <Box direction="row" gap={2} justifyContent="between">
          <Text bold>Score fields</Text>
          <Button onClick={onAddDimension} testID="ai-evaluator-add-dimension" text="Add score" />
        </Box>
        <Text color="secondaryDark" size="sm" testID="ai-evaluator-help-dimensions">
          {EVALUATOR_DIMENSIONS_HELP}
        </Text>
        {dimensions.map((dimension, index) => {
          return (
            <Box
              color="secondaryLight"
              direction="row"
              gap={2}
              key={`dimension-${index}`}
              padding={2}
              testID={`ai-evaluator-dimension-row-${index}`}
              wrap
            >
              <TextField
                helperText={EVALUATOR_DIMENSION_KEY_HELP}
                onChange={(value) => {
                  onDimensionChange(index, {...dimension, key: value});
                }}
                testID={`ai-evaluator-dimension-${index}-key`}
                title="Score name"
                value={dimension.key}
              />
              <Box gap={1}>
                <Text size="sm">Data type</Text>
                <Box direction="row" gap={1} wrap>
                  {DIMENSION_DATA_TYPES.map((dataType) => {
                    return (
                      <Button
                        key={dataType}
                        onClick={() => {
                          onDimensionChange(index, dimensionForDataType(dimension, dataType));
                        }}
                        text={dataType}
                        variant={dimension.dataType === dataType ? "primary" : "ghost"}
                      />
                    );
                  })}
                </Box>
                <Text color="secondaryDark" size="sm">
                  boolean is pass/fail, numeric is a number, categorical is a labeled bucket.
                </Text>
              </Box>
              <DimensionScaleFields
                dimension={dimension}
                index={index}
                onDimensionChange={onDimensionChange}
              />
              <Button
                onClick={() => {
                  onRemoveDimension(index);
                }}
                text="Remove"
                variant="ghost"
              />
            </Box>
          );
        })}
      </EvaluatorSetupStep>
      <EvaluatorSetupStep
        description={methodStepDescription}
        number={5}
        testID="ai-evaluator-step-config"
        title="Configure the scoring method"
      >
        {renderTypePanel({
          assertionConstraint,
          assertionPath,
          evaluatorType: type,
          instructions,
          judgePromptName,
          judgePromptOptions,
          judgePromptStatus,
          onAssertionConstraintChange,
          onAssertionPathChange,
          onInstructionsChange,
          onJudgePromptNameChange,
          schemaMismatchKey,
        })}
      </EvaluatorSetupStep>
      <EvaluatorSetupStep
        description={runStepDescription}
        number={6}
        testID="ai-evaluator-step-run"
        title="Choose where it runs"
      >
        {type === "human" ? (
          <Text color="secondaryDark" size="sm">
            To use it, select traces and choose Send to human review.
          </Text>
        ) : (
          <>
            <TextField
              helperText={EVALUATOR_LIVE_SAMPLE_HELP}
              onChange={(value) => {
                const parsed = Number(value);
                if (!Number.isNaN(parsed)) {
                  onLiveSampleRateChange(Math.min(100, Math.max(0, parsed)));
                }
              }}
              testID="ai-evaluator-live-sample"
              title="Production traces to score (%)"
              value={String(Math.round(runModes.liveSampleRate))}
            />
            {runModes.liveSampleRate > 0 ? (
              <Text color="warning" size="sm">
                {type === "llm-judge"
                  ? "Live scoring creates a billed judge call for each sampled trace."
                  : "Live scoring checks each sampled trace automatically without a model call."}
              </Text>
            ) : undefined}
          </>
        )}
      </EvaluatorSetupStep>
      {createError ? (
        <Text color="error" testID="ai-evaluator-create-error">
          {createError}
        </Text>
      ) : undefined}
      <Button
        loading={isCreating}
        onClick={onCreate}
        testID="ai-evaluator-submit"
        text="Create evaluator"
      />
    </Box>
  );
};

export const defaultEvaluatorRunModes = (): EvaluatorRecord["runModes"] => {
  return {
    allowManualRun: true,
    availableInExperiments: true,
    liveSampleRate: 0,
  };
};

export const initialNewEvaluatorDimensions = (): EvaluatorDimension[] => {
  return [emptyDimension()];
};
