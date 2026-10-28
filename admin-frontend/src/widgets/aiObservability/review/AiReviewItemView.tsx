import {Accordion, Badge, Box, Button, Card, Text, TextArea} from "@terreno/ui";
import React from "react";
import {ObservabilityStatusBadge} from "../shell/ObservabilityStatusBadge";
import {ReviewQuestionList} from "./ReviewQuestionList";
import {ReviewReadOnlyPanel} from "./ReviewReadOnlyPanel";
import {displayReviewValue, type ReviewDetail} from "./reviewTypes";

/** Page title for a review item: its place in the open queue, or that it is no longer open. */
export const reviewItemTitle = ({
  isPending,
  position,
  totalPending,
}: {
  isPending: boolean;
  position: number;
  totalPending: number;
}): string => {
  return isPending ? `Item ${position} of ${totalPending}` : "Review item";
};

export interface AiReviewItemHeaderMetaProps {
  detail: ReviewDetail;
  isPending: boolean;
}

/** Status badge and where the item came from, shown under the page title. */
export const AiReviewItemHeaderMeta: React.FC<AiReviewItemHeaderMetaProps> = ({
  detail,
  isPending,
}) => (
  <>
    <ObservabilityStatusBadge status={detail.status} testID="ai-review-item-status" />
    {detail.batchName ? (
      <Badge
        iconName="layer-group"
        secondary
        status="neutral"
        testID="ai-review-batch-name"
        value={`Batch ${detail.batchName}`}
      />
    ) : undefined}
    <Badge
      iconName={detail.traceId ? "list" : "database"}
      secondary
      status="neutral"
      testID="ai-review-item-source"
      value={detail.traceId ? "From a trace" : "From a dataset item"}
    />
    {isPending ? undefined : (
      <Text color="secondaryLight" size="sm" testID="ai-review-item-not-pending">
        Not in the pending queue
      </Text>
    )}
  </>
);

export interface AiReviewItemNavProps {
  onNext?: () => void;
  onPrevious?: () => void;
}

/** Outline Previous and Next buttons for the page header. */
export const AiReviewItemNav: React.FC<AiReviewItemNavProps> = ({onNext, onPrevious}) => (
  <>
    <Button
      disabled={!onPrevious}
      iconName="chevron-left"
      onClick={onPrevious ?? (() => undefined)}
      testID="ai-review-previous"
      text="Previous"
      variant="outline"
    />
    <Button
      disabled={!onNext}
      iconName="chevron-right"
      iconPosition="right"
      onClick={onNext ?? (() => undefined)}
      testID="ai-review-next"
      text="Next"
      variant="outline"
    />
  </>
);

export interface AiReviewItemViewProps {
  activeQuestionKey?: string;
  comment: string;
  detail: ReviewDetail;
  isSaving?: boolean;
  onAnswerRestYes?: () => void;
  onAssign: () => void;
  onCommentChange: (value: string) => void;
  onScoreChange: (key: string, value: boolean | number | string) => void;
  onSkip: () => void;
  onSubmit: () => void;
  scores: Record<string, boolean | number | string>;
  submitError?: string;
}

export const AiReviewItemView: React.FC<AiReviewItemViewProps> = ({
  activeQuestionKey,
  comment,
  detail,
  isSaving,
  onAnswerRestYes,
  onAssign,
  onCommentChange,
  onScoreChange,
  onSkip,
  onSubmit,
  scores,
  submitError,
}) => (
  <Box gap={4} testID="ai-review-item">
    <Box direction="row" gap={4} wrap>
      <Box flex="grow" minWidth={300}>
        <ReviewReadOnlyPanel fields={detail.panels.given} title="What the AI was given" />
      </Box>
      <Box flex="grow" minWidth={300}>
        <ReviewReadOnlyPanel color="ai" fields={detail.panels.wrote} title="What the AI wrote" />
      </Box>
    </Box>

    <Accordion isCollapsed testID="ai-review-raw-json" title="Raw JSON">
      <Text size="sm">
        {displayReviewValue({input: detail.rawInput, output: detail.rawOutput})}
      </Text>
    </Accordion>

    <Card padding={4} testID="ai-review-questions-card">
      <Box gap={4}>
        <ReviewQuestionList
          activeKey={activeQuestionKey}
          dimensions={detail.dimensions}
          instructions={detail.instructions}
          onAnswer={onScoreChange}
          onAnswerRestYes={onAnswerRestYes ?? (() => undefined)}
          scores={scores}
        />
        <TextArea
          onChange={onCommentChange}
          rows={2}
          testID="ai-review-comment"
          title="Note (optional)"
          value={comment}
        />
        {submitError ? (
          <Text color="error" testID="ai-review-submit-error">
            {submitError}
          </Text>
        ) : undefined}
        <Box alignItems="center" direction="row" gap={2} wrap>
          <Button
            loading={isSaving}
            onClick={onSubmit}
            testID="ai-review-submit-next"
            text="Submit and open next"
          />
          <Button
            disabled={isSaving}
            onClick={onAssign}
            testID="ai-review-assign"
            text="Assign to me"
            variant="outline"
          />
          <Button
            disabled={isSaving}
            onClick={onSkip}
            testID="ai-review-skip"
            text="Skip"
            variant="ghost"
          />
        </Box>
      </Box>
    </Card>
  </Box>
);
