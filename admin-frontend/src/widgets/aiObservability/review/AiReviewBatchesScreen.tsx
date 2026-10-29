import {useToast} from "@terreno/ui";
import {router} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {unwrapEvaluatorList} from "../evaluators/evaluatorTypes";
import {useAiObservabilityEvaluatorsApi} from "../evaluators/useAiObservabilityEvaluatorsApi";
import {unwrapPromptList} from "../prompts/promptTypes";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {AiReviewBatchesView} from "./AiReviewBatchesView";
import {DEFAULT_BATCH_SIZE, unwrapBatchDetail, unwrapBatchList} from "./batchTypes";
import {useAiObservabilityReviewApi} from "./useAiObservabilityReviewApi";

// Judge prompts live in this folder; they never produce traces worth reviewing.
const EVALUATOR_PROMPT_FOLDER = "evaluators";

const BATCHES_DESCRIPTION =
  "A batch is a fixed set of AI outputs that people answer the same questions for. Run LLM judges on it to see which ones agree with people.";

const errorTitle = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const data = (error as {data?: {title?: unknown}}).data;
  return typeof data?.title === "string" ? data.title : undefined;
};

export const AiReviewBatchesScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const {useBatchesQuery, useCreateBatchMutation, useStatusQuery} =
    useAiObservabilityReviewApi(api);
  const {useListQuery: useEvaluatorListQuery} = useAiObservabilityEvaluatorsApi(api);
  const {useListQuery: usePromptListQuery} = useAiObservabilityPromptsApi(api);
  const batchesQuery = useBatchesQuery();
  const statusQuery = useStatusQuery();
  const evaluatorsQuery = useEvaluatorListQuery();
  const promptsQuery = usePromptListQuery({});
  const [createBatch, createState] = useCreateBatchMutation();
  const [questionSetId, setQuestionSetId] = useState("");
  const [promptName, setPromptName] = useState("");
  const [name, setName] = useState("");
  const [createError, setCreateError] = useState("");
  const toast = useToast();
  const prefix = (routeBase ?? "").replace(/\/$/, "");

  const batches = useMemo(() => unwrapBatchList(batchesQuery.data), [batchesQuery.data]);
  const questionSetOptions = useMemo(() => {
    return unwrapEvaluatorList(evaluatorsQuery.data)
      .filter((evaluator) => evaluator.type === "human")
      .map((evaluator) => ({
        label: `${evaluator.name} (${evaluator.dimensions.length} ${
          evaluator.dimensions.length === 1 ? "question" : "questions"
        })`,
        value: evaluator.id,
      }));
  }, [evaluatorsQuery.data]);
  const promptOptions = useMemo(() => {
    return unwrapPromptList(promptsQuery.data)
      .filter((prompt) => prompt.folder !== EVALUATOR_PROMPT_FOLDER)
      .map((prompt) => ({label: prompt.name, value: prompt.name}));
  }, [promptsQuery.data]);

  // Default to the question set with the most questions, the usual batch target.
  useEffect(() => {
    if (questionSetId || questionSetOptions.length === 0) {
      return;
    }
    const humans = unwrapEvaluatorList(evaluatorsQuery.data).filter(
      (evaluator) => evaluator.type === "human"
    );
    const widest = [...humans].sort((a, b) => b.dimensions.length - a.dimensions.length)[0];
    setQuestionSetId(widest?.id ?? questionSetOptions[0]?.value ?? "");
  }, [evaluatorsQuery.data, questionSetId, questionSetOptions]);

  const openBatch = useCallback(
    (id: string): void => {
      router.push(`${prefix}/ai-review-batch?id=${encodeURIComponent(id)}`);
    },
    [prefix]
  );

  const handleCreate = useCallback(async (): Promise<void> => {
    if (!questionSetId) {
      setCreateError("Choose a question set first.");
      return;
    }
    setCreateError("");
    try {
      const result = await createBatch({
        evaluatorId: questionSetId,
        limit: DEFAULT_BATCH_SIZE,
        name: name.trim() || undefined,
        promptName: promptName || undefined,
      }).unwrap();
      const created = unwrapBatchDetail(result);
      setName("");
      toast.success(`Created ${created?.name ?? "batch"} with ${created?.counts.total ?? 0} items`);
      if (created?.id) {
        openBatch(created.id);
      }
    } catch (error) {
      setCreateError(errorTitle(error) ?? "Could not create the batch.");
    }
  }, [createBatch, name, openBatch, promptName, questionSetId, toast]);

  return (
    <AiObservabilityChrome
      {...props}
      backHref={`${prefix}/ai-review`}
      description={BATCHES_DESCRIPTION}
      error={statusQuery.isError}
      isLoading={statusQuery.isLoading}
      screenName="ai-review-batches"
      status={unwrapObservabilityStatus(statusQuery.data)}
    >
      <AiReviewBatchesView
        batches={batches}
        createError={createError}
        isCreating={createState.isLoading}
        isError={batchesQuery.isError}
        isLoading={batchesQuery.isLoading}
        name={name}
        onCreate={handleCreate}
        onNameChange={setName}
        onOpenBatch={openBatch}
        onPromptChange={setPromptName}
        onQuestionSetChange={setQuestionSetId}
        onRetry={batchesQuery.refetch}
        promptName={promptName}
        promptOptions={promptOptions}
        questionSetId={questionSetId}
        questionSetOptions={questionSetOptions}
      />
    </AiObservabilityChrome>
  );
};
