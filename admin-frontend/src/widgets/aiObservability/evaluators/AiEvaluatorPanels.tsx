import {
  Badge,
  Banner,
  Box,
  Button,
  Card,
  Heading,
  Link,
  NumberField,
  SegmentedControl,
  SelectField,
  Text,
  TextField,
} from "@terreno/ui";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {
  ObservabilityTable,
  type ObservabilityTableColumn,
  type ObservabilityTableRow,
} from "../shell/ObservabilityTable";
import {EVALUATOR_TARGET_LABELS, EvaluatorKindBadge} from "./AiEvaluatorsListView";
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

/** Order of the kind picker on the new-evaluator form. */
const EVALUATOR_TYPE_ORDER: EvaluatorRecord["type"][] = ["human", "llm-judge", "json-assert"];

/** Readable data-type labels; the API keeps boolean / numeric / categorical. */
const DIMENSION_DATA_TYPE_LABELS: Record<EvaluatorDimension["dataType"], string> = {
  boolean: "Yes or no",
  categorical: "Category",
  numeric: "Number",
};

const DIMENSION_DATA_TYPE_HELP: Record<EvaluatorDimension["dataType"], string> = {
  boolean: "A yes or no answer, saved as pass or fail.",
  categorical: "One label from a list you define, such as pass, partial or fail.",
  numeric: "A number between a minimum and a maximum.",
};

const STEP_COUNT = 6;

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

const EVALUATOR_DIMENSION_QUESTION_HELP =
  "Shown to human reviewers instead of the score name, such as: Does it mention every todo?";

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
    <Card
      accessibilityLabel={`Step ${number} of ${STEP_COUNT}: ${title}`}
      gap={3}
      padding={4}
      testID={testID}
    >
      <Box direction="row" gap={3}>
        <Box>
          <Badge secondary status="neutral" value={String(number)} />
        </Box>
        <Box flex="grow" gap={1}>
          <Heading size="sm">{title}</Heading>
          {description ? (
            <Text color="secondaryLight" size="sm">
              {description}
            </Text>
          ) : null}
        </Box>
      </Box>
      {children}
    </Card>
  );
};

export interface AiEvaluatorDetailViewProps {
  evaluator: EvaluatorRecord;
  judgeOutputSchema?: Record<string, unknown>;
  judgePromptStatus?: JudgePromptStatus;
  onOpenExperiment?: (experimentId: string) => void;
  onOpenPrompt?: (name: string) => void;
  routeBase: string;
  usageError?: string;
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
  /** Leaves the form without saving. */
  onCancel?: () => void;
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
  {minWidth: 120, title: "Score"},
  {grow: 2, minWidth: 200, title: "Reviewer question"},
  {minWidth: 100, title: "Data type"},
  {minWidth: 80, title: "Range"},
  {minWidth: 80, title: "Required"},
];

const USAGE_COLUMNS: ObservabilityTableColumn[] = [
  {minWidth: 160, title: "Experiment"},
  {minWidth: 90, title: "Runs"},
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
          <Box alignItems="start">
            <Badge iconName="check" secondary status="success" value="Schema match check passed" />
          </Box>
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
  onOpenExperiment,
  onOpenPrompt,
  routeBase,
  usageError,
  usageRows,
}) => {
  const dimensionRows: ObservabilityTableRow[] = useMemo(() => {
    return evaluator.dimensions.map((dimension, index) => {
      return {
        cells: [
          dimension.key,
          dimension.question ?? "—",
          DIMENSION_DATA_TYPE_LABELS[dimension.dataType] ?? dimension.dataType,
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
        onClick:
          onOpenExperiment && row.experimentId
            ? () => {
                onOpenExperiment(row.experimentId);
              }
            : undefined,
      };
    });
  }, [onOpenExperiment, usageRows]);

  return (
    <Box gap={4} testID="ai-evaluator-detail">
      <Card gap={3} padding={4} testID="ai-evaluator-scores-card">
        <Box gap={1}>
          <Heading size="sm">Scores this evaluator saves</Heading>
          <Text color="secondaryLight" size="sm">
            Each row is stored as a separate score on the trace or experiment result.
          </Text>
        </Box>
        <ObservabilityTable
          columns={DIMENSION_COLUMNS}
          rows={dimensionRows}
          testID="ai-evaluator-dimensions"
        />
      </Card>
      <Card gap={3} padding={4} testID="ai-evaluator-method-card">
        <Heading size="sm">How scoring works</Heading>
        {renderTypePanel({
          evaluator,
          judgeOutputSchema,
          judgePromptStatus,
          onOpenPrompt,
          routeBase,
        })}
      </Card>
      <Card gap={3} padding={4} testID="ai-evaluator-runs-card">
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
      </Card>
      <Card gap={3} padding={4} testID="ai-evaluator-usage-card">
        <Heading size="sm">Used in the last 30 days</Heading>
        {usageError ? (
          <Text color="error" testID="ai-evaluator-used-by-error">
            {usageError}
          </Text>
        ) : usageRows.length === 0 ? (
          <Text color="secondaryLight" testID="ai-evaluator-used-by-empty">
            No experiments in the last 30 days.
          </Text>
        ) : (
          <ObservabilityTable
            columns={USAGE_COLUMNS}
            rows={usageTableRows}
            testID="ai-evaluator-used-by"
          />
        )}
      </Card>
    </Box>
  );
};

export interface AiEvaluatorDetailMetaProps {
  evaluator: EvaluatorRecord;
}

/** Header badges for an evaluator: kind with icon, what it looks at, and where it runs. */
export const AiEvaluatorDetailMeta: React.FC<AiEvaluatorDetailMetaProps> = ({evaluator}) => {
  const chips =
    evaluator.type === "human" ? ["People in review"] : formatRunModeChips(evaluator.runModes);
  return (
    <>
      <EvaluatorKindBadge testID="ai-evaluator-kind-badge" type={evaluator.type} />
      <Badge
        iconName="eye"
        secondary
        status="neutral"
        value={EVALUATOR_TARGET_LABELS[evaluator.target] ?? evaluator.target}
      />
      {chips.map((chip) => {
        return <Badge key={chip} secondary status="neutral" value={chip} />;
      })}
    </>
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
  const lastEmittedRange = useRef(dimension.range);
  const categories = parseCategories(dimension.range);

  // Parent range changes (type switch or row reorder) must replace the draft
  // bounds; useState only reads the initial range.
  useEffect(() => {
    if (dimension.range === lastEmittedRange.current) {
      return;
    }
    setMin(bounds.min);
    setMax(bounds.max);
    lastEmittedRange.current = dimension.range;
  }, [bounds.max, bounds.min, dimension.range]);

  const handleMinChange = useCallback(
    (value: string): void => {
      setMin(value);
      const range = formatNumericRange(value, max);
      lastEmittedRange.current = range;
      onDimensionChange(index, {...dimension, range});
    },
    [dimension, index, max, onDimensionChange]
  );

  const handleMaxChange = useCallback(
    (value: string): void => {
      setMax(value);
      const range = formatNumericRange(min, value);
      lastEmittedRange.current = range;
      onDimensionChange(index, {...dimension, range});
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
          title="New category"
          value={draftCategory}
        />
        <Button
          onClick={handleAddCategory}
          testID={`ai-evaluator-dimension-${index}-add-category`}
          text="Add category"
          variant="outline"
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
  onCancel,
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
  const handleTypeIndexChange = useCallback(
    (index: number): void => {
      const next = EVALUATOR_TYPE_ORDER[index];
      if (next) {
        onTypeChange(next);
      }
    },
    [onTypeChange]
  );

  const handleLiveSampleChange = useCallback(
    (value: string): void => {
      const parsed = Number(value);
      if (value === "" || Number.isNaN(parsed)) {
        return;
      }
      onLiveSampleRateChange(Math.min(100, Math.max(0, parsed)));
    },
    [onLiveSampleRateChange]
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
      <Box gap={1} testID="ai-evaluator-help-intro">
        <Heading size="sm">Create a reusable scoring rule</Heading>
        <Text color="secondaryLight">{EVALUATOR_NEW_INTRO}</Text>
      </Box>
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
      <EvaluatorSetupStep
        description="Choose whether a person, another model, or a JSON rule decides the score."
        number={2}
        testID="ai-evaluator-step-method"
        title="Choose how scoring happens"
      >
        <Box alignItems="start" testID="ai-evaluator-type-picker">
          <SegmentedControl
            items={EVALUATOR_TYPE_ORDER.map((entry) => EVALUATOR_TYPE_LABELS[entry])}
            onChange={handleTypeIndexChange}
            selectedIndex={EVALUATOR_TYPE_ORDER.indexOf(type)}
            size="sm"
            testID="ai-evaluator-type"
          />
        </Box>
        <Text color="secondaryLight" size="sm" testID="ai-evaluator-help-type">
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
        <Box alignItems="start">
          <Badge
            iconName="eye"
            secondary
            status="neutral"
            value={EVALUATOR_TARGET_LABELS[target] ?? target}
          />
        </Box>
        <Text color="secondaryLight" size="sm" testID="ai-evaluator-help-target">
          {FULL_TRACE_TARGET_HELP}
        </Text>
      </EvaluatorSetupStep>
      <EvaluatorSetupStep
        description="Define exactly what appears in results. Each dimension is saved independently."
        number={4}
        testID="ai-evaluator-step-scores"
        title="Define the scores it returns"
      >
        <Text color="secondaryLight" size="sm" testID="ai-evaluator-help-dimensions">
          {EVALUATOR_DIMENSIONS_HELP}
        </Text>
        {dimensions.map((dimension, index) => {
          return (
            <Card
              gap={3}
              key={`dimension-${index}`}
              padding={4}
              testID={`ai-evaluator-dimension-row-${index}`}
            >
              <Box alignItems="center" direction="row" justifyContent="between">
                <Text bold>{`Score ${index + 1}`}</Text>
                <Button
                  disabled={dimensions.length <= 1}
                  iconName="trash"
                  onClick={() => {
                    onRemoveDimension(index);
                  }}
                  size="sm"
                  testID={`ai-evaluator-dimension-${index}-remove`}
                  text="Remove"
                  variant="ghost"
                />
              </Box>
              <TextField
                helperText={EVALUATOR_DIMENSION_KEY_HELP}
                onChange={(value) => {
                  onDimensionChange(index, {...dimension, key: value});
                }}
                testID={`ai-evaluator-dimension-${index}-key`}
                title="Score name"
                value={dimension.key}
              />
              {type === "human" ? (
                <TextField
                  helperText={EVALUATOR_DIMENSION_QUESTION_HELP}
                  onChange={(value) => {
                    onDimensionChange(index, {...dimension, question: value || undefined});
                  }}
                  testID={`ai-evaluator-dimension-${index}-question`}
                  title="Reviewer question (optional)"
                  value={dimension.question ?? ""}
                />
              ) : null}
              <Box gap={2}>
                <Text bold size="sm">
                  Answer type
                </Text>
                <Box alignItems="start" testID={`ai-evaluator-dimension-${index}-data-type`}>
                  <SegmentedControl
                    items={DIMENSION_DATA_TYPES.map(
                      (dataType) => DIMENSION_DATA_TYPE_LABELS[dataType]
                    )}
                    onChange={(dataTypeIndex) => {
                      const dataType = DIMENSION_DATA_TYPES[dataTypeIndex];
                      if (dataType) {
                        onDimensionChange(index, dimensionForDataType(dimension, dataType));
                      }
                    }}
                    selectedIndex={DIMENSION_DATA_TYPES.indexOf(dimension.dataType)}
                    size="sm"
                  />
                </Box>
                <Text color="secondaryLight" size="sm">
                  {DIMENSION_DATA_TYPE_HELP[dimension.dataType]}
                </Text>
              </Box>
              <DimensionScaleFields
                dimension={dimension}
                index={index}
                onDimensionChange={onDimensionChange}
              />
            </Card>
          );
        })}
        <Box alignItems="start">
          <Button
            iconName="plus"
            onClick={onAddDimension}
            testID="ai-evaluator-add-dimension"
            text="Add score"
            variant="outline"
          />
        </Box>
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
          <Text color="secondaryLight" size="sm">
            To use it, select traces and choose Send to human review.
          </Text>
        ) : (
          <>
            <NumberField
              helperText={EVALUATOR_LIVE_SAMPLE_HELP}
              onChange={handleLiveSampleChange}
              testID="ai-evaluator-live-sample"
              title="Production traces to score (%)"
              type="number"
              value={String(Math.round(runModes.liveSampleRate))}
            />
            {runModes.liveSampleRate > 0 ? (
              <Banner
                hasIcon
                status="warning"
                text={
                  type === "llm-judge"
                    ? "Live scoring creates a billed judge call for each sampled trace."
                    : "Live scoring checks each sampled trace automatically without a model call."
                }
              />
            ) : null}
          </>
        )}
      </EvaluatorSetupStep>
      {createError ? (
        <Text color="error" testID="ai-evaluator-create-error">
          {createError}
        </Text>
      ) : null}
      <Box direction="row" gap={2} justifyContent="end" wrap>
        {onCancel ? (
          <Button onClick={onCancel} testID="ai-evaluator-cancel" text="Cancel" variant="outline" />
        ) : null}
        <Button
          loading={isCreating}
          onClick={onCreate}
          testID="ai-evaluator-submit"
          text="Create evaluator"
          variant="primary"
        />
      </Box>
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
