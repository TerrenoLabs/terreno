import {Box, Button, Spinner, Text, useToast} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {AiReviewItemView} from "./AiReviewItemView";
import {unwrapCurrentUserId, unwrapReviewDetail, unwrapReviewList} from "./reviewTypes";
import {type ReviewActionBody, useAiObservabilityReviewApi} from "./useAiObservabilityReviewApi";

export const AiReviewItemScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const params = useLocalSearchParams<{id?: string | string[]}>();
  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const {useActionMutation, useCurrentUserQuery, useDetailQuery, useListQuery, useStatusQuery} =
    useAiObservabilityReviewApi(api);
  const detailQuery = useDetailQuery(id ?? "", {skip: !id});
  const pendingQuery = useListQuery("pending");
  const currentUserQuery = useCurrentUserQuery();
  const statusQuery = useStatusQuery();
  const [runAction, actionState] = useActionMutation();
  const [scores, setScores] = useState<Record<string, boolean | number | string>>({});
  const [comment, setComment] = useState("");
  const [submitError, setSubmitError] = useState("");
  const toast = useToast();

  const detail = useMemo(() => unwrapReviewDetail(detailQuery.data), [detailQuery.data]);
  const pending = useMemo(() => unwrapReviewList(pendingQuery.data), [pendingQuery.data]);
  const currentUserId = useMemo(
    () => unwrapCurrentUserId(currentUserQuery.data),
    [currentUserQuery.data]
  );
  const currentIndex = pending.findIndex((entry) => entry.id === id);
  const position = currentIndex >= 0 ? currentIndex + 1 : 1;
  const previous = currentIndex > 0 ? pending[currentIndex - 1] : undefined;
  const next = currentIndex >= 0 ? pending[currentIndex + 1] : pending[0];
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const queueHref = `${prefix}/ai-review`;

  // Reset reviewer input when navigation loads a different queue item.
  useEffect(() => {
    setScores(detail?.scores ?? {});
    setComment(detail?.comment ?? "");
    setSubmitError("");
  }, [detail]);

  const openItem = useCallback(
    (nextId: string): void => {
      router.push(`${prefix}/ai-review-item?id=${encodeURIComponent(nextId)}`);
    },
    [prefix]
  );

  const finishAndNavigate = useCallback(
    (remaining: number, nextId?: string): void => {
      if (remaining === 0) {
        toast.success("Queue clear");
        router.push(queueHref);
        return;
      }
      toast.success(`${remaining} pending ${remaining === 1 ? "item" : "items"} remaining`);
      if (nextId) {
        openItem(nextId);
        return;
      }
      router.push(queueHref);
    },
    [openItem, queueHref, toast]
  );

  const submitAction = useCallback(
    async (body: ReviewActionBody, nextId?: string): Promise<void> => {
      if (!id) {
        return;
      }
      await runAction({body, id}).unwrap();
      const remaining = Math.max(0, pending.length - (currentIndex >= 0 ? 1 : 0));
      finishAndNavigate(remaining, nextId);
    },
    [currentIndex, finishAndNavigate, id, pending.length, runAction]
  );

  const handleScoreChange = useCallback((key: string, value: boolean | number | string): void => {
    setScores((current) => ({...current, [key]: value}));
  }, []);

  const handleSubmit = useCallback(async (): Promise<void> => {
    if (!detail) {
      return;
    }
    const missing = detail.dimensions.find(
      (dimension) => dimension.required && scores[dimension.key] === undefined
    );
    if (missing) {
      setSubmitError(`Score ${missing.key} before submitting.`);
      return;
    }
    setSubmitError("");
    try {
      await submitAction({action: "submit", comment, scores}, next?.id);
    } catch {
      setSubmitError("Could not submit this review.");
    }
  }, [comment, detail, next?.id, scores, submitAction]);

  const handleSkip = useCallback(async (): Promise<void> => {
    setSubmitError("");
    try {
      await submitAction({action: "skip"}, next?.id);
    } catch {
      setSubmitError("Could not skip this review.");
    }
  }, [next?.id, submitAction]);

  const handleAssign = useCallback(async (): Promise<void> => {
    if (!id || !currentUserId) {
      setSubmitError("Could not identify the current admin.");
      return;
    }
    setSubmitError("");
    try {
      await runAction({
        body: {action: "assign", assigneeId: currentUserId},
        id,
      }).unwrap();
      toast.success("Assigned to you");
    } catch {
      setSubmitError("Could not assign this review.");
    }
  }, [currentUserId, id, runAction, toast]);

  if (!id) {
    return (
      <AiObservabilityChrome
        {...props}
        backHref={queueHref}
        error={statusQuery.isError}
        isLoading={statusQuery.isLoading}
        screenName="ai-review-item"
        status={unwrapObservabilityStatus(statusQuery.data)}
      >
        <Box padding={4}>
          <Text>Missing review item id. Open an item from the queue.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (detailQuery.isLoading || pendingQuery.isLoading) {
    return (
      <AiObservabilityChrome
        {...props}
        backHref={queueHref}
        error={statusQuery.isError}
        isLoading={statusQuery.isLoading}
        screenName="ai-review-item"
        status={unwrapObservabilityStatus(statusQuery.data)}
      >
        <Box alignItems="center" padding={5} testID="ai-review-item-loading">
          <Spinner />
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (detailQuery.isError || !detail) {
    return (
      <AiObservabilityChrome
        {...props}
        backHref={queueHref}
        error={statusQuery.isError}
        isLoading={statusQuery.isLoading}
        screenName="ai-review-item"
        status={unwrapObservabilityStatus(statusQuery.data)}
      >
        <Box gap={2} padding={4}>
          <Text color="error">Could not load this review item.</Text>
          <Button onClick={() => detailQuery.refetch()} text="Retry" />
        </Box>
      </AiObservabilityChrome>
    );
  }

  return (
    <AiObservabilityChrome
      {...props}
      backHref={queueHref}
      error={statusQuery.isError}
      isLoading={statusQuery.isLoading}
      screenName="ai-review-item"
      status={unwrapObservabilityStatus(statusQuery.data)}
    >
      <AiReviewItemView
        comment={comment}
        detail={detail}
        isPending={currentIndex >= 0}
        isSaving={actionState.isLoading}
        onAssign={handleAssign}
        onCommentChange={setComment}
        onNext={next ? () => openItem(next.id) : undefined}
        onPrevious={previous ? () => openItem(previous.id) : undefined}
        onScoreChange={handleScoreChange}
        onSkip={handleSkip}
        onSubmit={handleSubmit}
        position={position}
        scores={scores}
        submitError={submitError}
        totalPending={pending.length}
      />
    </AiObservabilityChrome>
  );
};
