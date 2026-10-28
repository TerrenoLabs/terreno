import {Badge, Box, Button, Spinner, Text, useToast} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {unwrapEvaluatorList} from "../evaluators/evaluatorTypes";
import {useAiObservabilityEvaluatorsApi} from "../evaluators/useAiObservabilityEvaluatorsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {ObservabilityErrorState} from "../shell/ObservabilityStates";
import {AiReviewBatchView} from "./AiReviewBatchView";
import {formatPercent, unwrapBatchDetail} from "./batchTypes";
import {useAiObservabilityReviewApi} from "./useAiObservabilityReviewApi";

const errorTitle = (error: unknown): string | undefined => {
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const data = (error as {data?: {title?: unknown}}).data;
  return typeof data?.title === "string" ? data.title : undefined;
};

export interface AiReviewBatchScreenWidgetProps extends AdminScreenWidgetProps {
  /** Caller AI key sent as `x-ai-api-key` when the server has no `aiService`. */
  apiKey?: string;
  /** Shown when the server expects a caller key and none is saved yet. */
  apiKeyHint?: string;
  apiKeyLoading?: boolean;
}

export const AiReviewBatchScreenWidget: React.FC<AiReviewBatchScreenWidgetProps> = (props) => {
  const {api, apiKey, apiKeyHint, apiKeyLoading, routeBase} = props;
  const params = useLocalSearchParams<{id?: string | string[]}>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const {useBatchQuery, useRunJudgeMutation, useStatusQuery} = useAiObservabilityReviewApi(api);
  const {useListQuery: useEvaluatorListQuery} = useAiObservabilityEvaluatorsApi(api);
  const batchQuery = useBatchQuery(id ?? "", {skip: !id});
  const statusQuery = useStatusQuery();
  const evaluatorsQuery = useEvaluatorListQuery();
  const [runJudge, runState] = useRunJudgeMutation();
  const [judgeId, setJudgeId] = useState("");
  const [selectedJudgeId, setSelectedJudgeId] = useState<string | undefined>(undefined);
  const [runError, setRunError] = useState("");
  const toast = useToast();
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const listHref = `${prefix}/ai-review-batches`;

  const batch = useMemo(() => unwrapBatchDetail(batchQuery.data), [batchQuery.data]);
  const aiSource = unwrapObservabilityStatus(statusQuery.data)?.playgroundAi?.source;
  const aiBlockedMessage =
    aiSource === "unavailable"
      ? "No AI service is configured on the server, so judges cannot run."
      : aiSource === "request-key" && !apiKey && !apiKeyLoading
        ? (apiKeyHint ?? "Save an AI API key to run judges.")
        : undefined;
  const judgeOptions = useMemo(() => {
    const questionKeys = new Set((batch?.dimensions ?? []).map((dimension) => dimension.key));
    return unwrapEvaluatorList(evaluatorsQuery.data)
      .filter((evaluator) => evaluator.type === "llm-judge")
      .map((evaluator) => {
        const shared = evaluator.dimensions.filter((dimension) => questionKeys.has(dimension.key));
        return {evaluator, shared: shared.length};
      })
      .filter((entry) => entry.shared > 0)
      .sort((a, b) => b.shared - a.shared)
      .map(({evaluator, shared}) => ({
        label: `${evaluator.name} (answers ${shared} of ${questionKeys.size})`,
        value: evaluator.id,
      }));
  }, [batch?.dimensions, evaluatorsQuery.data]);

  // Preselect the first judge that has not run on this batch yet, else the first option.
  useEffect(() => {
    if (judgeId || judgeOptions.length === 0) {
      return;
    }
    const ran = new Set((batch?.judges ?? []).map((judge) => judge.evaluatorId));
    setJudgeId(
      judgeOptions.find((option) => !ran.has(option.value))?.value ?? judgeOptions[0]?.value ?? ""
    );
  }, [batch?.judges, judgeId, judgeOptions]);

  const selectedJudge = useMemo(() => {
    const judges = batch?.judges ?? [];
    return judges.find((judge) => judge.evaluatorId === selectedJudgeId) ?? judges[0];
  }, [batch?.judges, selectedJudgeId]);

  const openItem = useCallback(
    (reviewItemId: string): void => {
      router.push(`${prefix}/ai-review-item?id=${encodeURIComponent(reviewItemId)}`);
    },
    [prefix]
  );

  const nextPending = batch?.items.find(
    (item) => item.status === "pending" || item.status === "in_progress"
  );
  const handleAnswerNext = useCallback((): void => {
    if (nextPending) {
      openItem(nextPending.reviewItemId);
    }
  }, [nextPending, openItem]);

  const handleRunJudge = useCallback(async (): Promise<void> => {
    if (!id || !judgeId) {
      return;
    }
    setRunError("");
    try {
      const result = await runJudge({apiKey, batchId: id, evaluatorId: judgeId}).unwrap();
      const summary = unwrapBatchDetail(result)?.judges.find(
        (judge) => judge.evaluatorId === judgeId
      );
      setSelectedJudgeId(judgeId);
      toast.success(
        summary?.agreement.rate === undefined
          ? `${summary?.evaluatorName ?? "Judge"} ran; answer items to compare`
          : `${summary.evaluatorName} agrees with people ${formatPercent(summary.agreement.rate)}`
      );
    } catch (error) {
      setRunError(errorTitle(error) ?? "Could not run the judge.");
    }
  }, [apiKey, id, judgeId, runJudge, toast]);

  const header = batch
    ? {
        actions: (
          <Button
            disabled={!nextPending}
            iconName="play"
            onClick={handleAnswerNext}
            testID="ai-review-batch-answer-next"
            text={
              batch.counts.pending > 0 ? `Answer ${batch.counts.pending} remaining` : "All answered"
            }
          />
        ),
        meta: (
          <>
            <Badge
              iconName="list-check"
              secondary
              status="neutral"
              testID="ai-review-batch-question-set"
              value={batch.evaluatorName}
            />
            {batch.promptName ? (
              <Badge iconName="file-lines" secondary status="neutral" value={batch.promptName} />
            ) : undefined}
            {batch.datasetId ? (
              <Badge
                iconName="database"
                secondary
                status="neutral"
                testID="ai-review-batch-dataset"
                value={`Dataset ${batch.datasetName ?? batch.datasetId}`}
              />
            ) : undefined}
          </>
        ),
        title: batch.name,
      }
    : {};

  const chrome = (children: React.ReactNode): React.ReactElement => (
    <AiObservabilityChrome
      {...props}
      {...header}
      backHref={listHref}
      description={batch?.description}
      error={statusQuery.isError}
      isLoading={statusQuery.isLoading}
      screenName="ai-review-batch"
      status={unwrapObservabilityStatus(statusQuery.data)}
    >
      {children}
    </AiObservabilityChrome>
  );

  if (!id) {
    return chrome(
      <Box padding={4}>
        <Text color="secondaryLight">Missing batch id. Open a batch from Review batches.</Text>
      </Box>
    );
  }
  if (batchQuery.isLoading) {
    return chrome(
      <Box alignItems="center" padding={5} testID="ai-review-batch-loading">
        <Spinner />
      </Box>
    );
  }
  if (batchQuery.isError || !batch) {
    return chrome(
      <ObservabilityErrorState
        onRetry={() => batchQuery.refetch()}
        testID="ai-review-batch-error"
        text="Could not load this batch."
      />
    );
  }
  return chrome(
    <AiReviewBatchView
      aiBlockedMessage={aiBlockedMessage}
      batch={batch}
      isRunningJudge={runState.isLoading}
      judgeId={judgeId}
      judgeOptions={judgeOptions}
      onJudgeChange={setJudgeId}
      onOpenItem={openItem}
      onRunJudge={handleRunJudge}
      onSelectJudge={setSelectedJudgeId}
      runError={runError}
      selectedJudge={selectedJudge}
    />
  );
};
