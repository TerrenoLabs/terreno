import {router} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {unwrapEvaluatorList} from "../evaluators/evaluatorTypes";
import {useAiObservabilityEvaluatorsApi} from "../evaluators/useAiObservabilityEvaluatorsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {AiReviewQueueActions, AiReviewQueueView} from "./AiReviewQueueView";
import {type ReviewStatus, unwrapReviewCounts, unwrapReviewList} from "./reviewTypes";
import {useAiObservabilityReviewApi} from "./useAiObservabilityReviewApi";

const QUEUE_DESCRIPTION =
  "Answer yes or no questions about AI outputs, oldest first. Items arrive from Traces and from review batches.";

export const AiReviewScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const {useListQuery, useStatusQuery} = useAiObservabilityReviewApi(api);
  const {useListQuery: useEvaluatorListQuery} = useAiObservabilityEvaluatorsApi(api);
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const query = useListQuery(status);
  const statusQuery = useStatusQuery();
  const evaluatorsQuery = useEvaluatorListQuery();
  const items = useMemo(() => unwrapReviewList(query.data), [query.data]);
  const counts = useMemo(() => unwrapReviewCounts(query.data), [query.data]);
  const questionSetNames = useMemo(() => {
    return Object.fromEntries(
      unwrapEvaluatorList(evaluatorsQuery.data).map((evaluator) => [evaluator.id, evaluator.name])
    );
  }, [evaluatorsQuery.data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const openItem = useCallback(
    (id: string): void => {
      router.push(`${prefix}/ai-review-item?id=${encodeURIComponent(id)}`);
    },
    [prefix]
  );
  const openBatches = useCallback((): void => {
    router.push(`${prefix}/ai-review-batches`);
  }, [prefix]);
  const openTraces = useCallback((): void => {
    router.push(`${prefix}/ai-traces`);
  }, [prefix]);
  const handleStart = useCallback((): void => {
    const oldest = status === "pending" ? items[0] : undefined;
    if (!oldest) {
      return;
    }
    openItem(oldest.id);
  }, [items, openItem, status]);

  return (
    <AiObservabilityChrome
      {...props}
      actions={
        <AiReviewQueueActions
          canStart={counts.pending > 0 && status === "pending"}
          onOpenBatches={openBatches}
          onStart={handleStart}
        />
      }
      description={QUEUE_DESCRIPTION}
      error={statusQuery.isError}
      isLoading={statusQuery.isLoading}
      screenName="ai-review"
      status={unwrapObservabilityStatus(statusQuery.data)}
    >
      <AiReviewQueueView
        counts={counts}
        isError={query.isError}
        isLoading={query.isLoading}
        items={items}
        onOpenItem={openItem}
        onOpenTraces={openTraces}
        onRetry={query.refetch}
        onStatusChange={setStatus}
        questionSetNames={questionSetNames}
        status={status}
      />
    </AiObservabilityChrome>
  );
};
