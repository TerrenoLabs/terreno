import {router} from "expo-router";
import React, {useCallback, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {AiReviewQueueView} from "./AiReviewQueueView";
import {type ReviewStatus, unwrapReviewCounts, unwrapReviewList} from "./reviewTypes";
import {useAiObservabilityReviewApi} from "./useAiObservabilityReviewApi";

export const AiReviewScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const {useListQuery, useStatusQuery} = useAiObservabilityReviewApi(api);
  const [status, setStatus] = useState<ReviewStatus>("pending");
  const query = useListQuery(status);
  const statusQuery = useStatusQuery();
  const items = useMemo(() => unwrapReviewList(query.data), [query.data]);
  const counts = useMemo(() => unwrapReviewCounts(query.data), [query.data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const openItem = useCallback(
    (id: string): void => {
      router.push(`${prefix}/ai-review-item?id=${encodeURIComponent(id)}`);
    },
    [prefix]
  );
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
        onRetry={query.refetch}
        onStart={handleStart}
        onStatusChange={setStatus}
        status={status}
      />
    </AiObservabilityChrome>
  );
};
