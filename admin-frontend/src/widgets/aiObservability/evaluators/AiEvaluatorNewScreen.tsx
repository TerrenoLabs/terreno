import {router} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {unwrapPromptDetail, unwrapPromptList} from "../prompts/promptTypes";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {
  AiEvaluatorNewView,
  defaultEvaluatorRunModes,
  initialNewEvaluatorDimensions,
} from "./AiEvaluatorPanels";
import {
  type EvaluatorDimension,
  type EvaluatorRecord,
  isCompleteNumericRange,
  judgeSchemaMissingDimensions,
  parseApiErrorTitle,
  parseCategories,
} from "./evaluatorTypes";
import {useAiObservabilityEvaluatorsApi} from "./useAiObservabilityEvaluatorsApi";

export const AiEvaluatorNewScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const {useCreateMutation} = useAiObservabilityEvaluatorsApi(api);
  const {useDetailQuery: usePromptDetailQuery, useListQuery: usePromptListQuery} =
    useAiObservabilityPromptsApi(api);
  const [createEvaluator, createState] = useCreateMutation();
  const [name, setName] = useState("");
  const [type, setType] = useState<EvaluatorRecord["type"]>("human");
  // TODO: enable generation span and dataset item targets.
  const target: EvaluatorRecord["target"] = "full trace";
  const [dimensions, setDimensions] = useState<EvaluatorDimension[]>(initialNewEvaluatorDimensions);
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [judgePromptName, setJudgePromptName] = useState("");
  const [assertionPath, setAssertionPath] = useState("");
  const [assertionConstraint, setAssertionConstraint] = useState("exists");
  const [runModes, setRunModes] = useState(defaultEvaluatorRunModes);
  const [createError, setCreateError] = useState("");
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-evaluators`;

  const promptsQuery = usePromptListQuery({});
  const judgePromptOptions = useMemo(() => {
    return unwrapPromptList(promptsQuery.data).map((prompt) => {
      return {label: prompt.name, value: prompt.name};
    });
  }, [promptsQuery.data]);

  const {
    data: promptDetailRaw,
    isError: isJudgePromptError,
    isLoading: isJudgePromptLoading,
  } = usePromptDetailQuery(
    {name: judgePromptName},
    {
      skip: type !== "llm-judge" || !judgePromptName.trim(),
    }
  );
  const promptDetail = useMemo(() => unwrapPromptDetail(promptDetailRaw), [promptDetailRaw]);
  const judgeOutputSchema = useMemo(() => {
    if (!promptDetail) {
      return undefined;
    }
    const production = promptDetail.labels.find((label) => label.label === "production");
    const versionNumber = production?.version ?? promptDetail.versions[0]?.version;
    const version = promptDetail.versions.find((entry) => entry.version === versionNumber);
    return version?.outputSchema;
  }, [promptDetail]);

  const schemaMismatchKey = useMemo(() => {
    if (
      type !== "llm-judge" ||
      !judgePromptName.trim() ||
      isJudgePromptLoading ||
      isJudgePromptError ||
      !promptDetail
    ) {
      return undefined;
    }
    const missing = judgeSchemaMissingDimensions(dimensions, judgeOutputSchema);
    return missing[0];
  }, [
    dimensions,
    isJudgePromptError,
    isJudgePromptLoading,
    judgeOutputSchema,
    judgePromptName,
    promptDetail,
    type,
  ]);

  const judgePromptStatus = useMemo((): "error" | "idle" | "loading" | "ready" => {
    if (!judgePromptName.trim()) {
      return "idle";
    }
    if (isJudgePromptLoading) {
      return "loading";
    }
    if (isJudgePromptError || !promptDetail) {
      return "error";
    }
    return "ready";
  }, [isJudgePromptError, isJudgePromptLoading, judgePromptName, promptDetail]);

  const handleAddDimension = useCallback((): void => {
    setDimensions((current) => {
      return [...current, {dataType: "boolean", key: "", required: true}];
    });
  }, []);

  const handleDimensionChange = useCallback(
    (index: number, dimension: EvaluatorDimension): void => {
      setDimensions((current) => {
        return current.map((entry, entryIndex) => {
          if (entryIndex === index) {
            return dimension;
          }
          return entry;
        });
      });
    },
    []
  );

  const handleRemoveDimension = useCallback((index: number): void => {
    setDimensions((current) => {
      if (current.length <= 1) {
        return current;
      }
      return current.filter((_entry, entryIndex) => entryIndex !== index);
    });
  }, []);

  const handleLiveSampleRateChange = useCallback(
    (value: number): void => {
      if (type === "human") {
        setRunModes((current) => {
          return {...current, liveSampleRate: 0};
        });
        return;
      }
      setRunModes((current) => {
        return {...current, liveSampleRate: value};
      });
    },
    [type]
  );

  const handleTypeChange = useCallback((nextType: EvaluatorRecord["type"]): void => {
    setType(nextType);
    setCreateError("");
    if (nextType !== "human") {
      return;
    }
    setRunModes((current) => {
      return {...current, liveSampleRate: 0};
    });
  }, []);

  const handleCreate = useCallback(async (): Promise<void> => {
    setCreateError("");
    if (!name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    if (dimensions.some((dimension) => !dimension.key.trim())) {
      setCreateError("Each score needs a name.");
      return;
    }
    const numericMissingBounds = dimensions.some((dimension) => {
      return dimension.dataType === "numeric" && !isCompleteNumericRange(dimension.range);
    });
    if (numericMissingBounds) {
      setCreateError(
        "Each numeric score needs a min and a max, with min less than or equal to max."
      );
      return;
    }
    const categoricalMissingLabels = dimensions.some((dimension) => {
      return dimension.dataType === "categorical" && parseCategories(dimension.range).length === 0;
    });
    if (categoricalMissingLabels) {
      setCreateError("Add at least one category for each categorical score.");
      return;
    }
    if (type === "llm-judge" && !judgePromptName.trim()) {
      setCreateError("Select a judge prompt.");
      return;
    }
    if (type === "llm-judge" && isJudgePromptLoading) {
      setCreateError("Wait for the judge prompt schema to load.");
      return;
    }
    if (type === "llm-judge" && (isJudgePromptError || !promptDetail)) {
      setCreateError("Judge prompt or its production schema could not be loaded.");
      return;
    }
    if (type === "llm-judge" && schemaMismatchKey) {
      setCreateError(
        `Judge prompt output schema missing required dimension "${schemaMismatchKey}"`
      );
      return;
    }
    try {
      const created = await createEvaluator({
        assertion:
          type === "json-assert"
            ? {constraint: assertionConstraint, path: assertionPath}
            : undefined,
        description: description.trim() || undefined,
        dimensions,
        instructions: type === "human" ? instructions : undefined,
        judgePromptName: type === "llm-judge" ? judgePromptName : undefined,
        name: name.trim(),
        runModes,
        target,
        type,
      }).unwrap();
      router.push(`${prefix}/ai-evaluator-detail?id=${encodeURIComponent(created.id)}`);
    } catch (error) {
      setCreateError(parseApiErrorTitle(error) ?? "Could not create evaluator.");
    }
  }, [
    assertionConstraint,
    assertionPath,
    createEvaluator,
    description,
    dimensions,
    instructions,
    isJudgePromptError,
    isJudgePromptLoading,
    judgePromptName,
    name,
    prefix,
    promptDetail,
    runModes,
    schemaMismatchKey,
    target,
    type,
  ]);

  return (
    <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-evaluator-new">
      <AiEvaluatorNewView
        assertionConstraint={assertionConstraint}
        assertionPath={assertionPath}
        createError={createError}
        description={description}
        dimensions={dimensions}
        instructions={instructions}
        isCreating={createState.isLoading}
        judgePromptName={judgePromptName}
        judgePromptOptions={judgePromptOptions}
        judgePromptStatus={judgePromptStatus}
        name={name}
        onAddDimension={handleAddDimension}
        onAssertionConstraintChange={setAssertionConstraint}
        onAssertionPathChange={setAssertionPath}
        onCreate={handleCreate}
        onDescriptionChange={setDescription}
        onDimensionChange={handleDimensionChange}
        onInstructionsChange={setInstructions}
        onJudgePromptNameChange={setJudgePromptName}
        onLiveSampleRateChange={handleLiveSampleRateChange}
        onNameChange={setName}
        onRemoveDimension={handleRemoveDimension}
        onTypeChange={handleTypeChange}
        runModes={runModes}
        schemaMismatchKey={schemaMismatchKey}
        target={target}
        type={type}
      />
    </AiObservabilityChrome>
  );
};
