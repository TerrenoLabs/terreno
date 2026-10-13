import {Accordion, Badge, Box, Button, Card, Heading, Text, TextArea} from "@terreno/ui";
import React from "react";
import {ReviewReadOnlyPanel} from "./ReviewReadOnlyPanel";
import {ReviewScoreField} from "./ReviewScoreField";
import {displayReviewValue, type ReviewDetail, reviewStatusLabel} from "./reviewTypes";

export interface AiReviewItemViewProps {
  comment: string;
  detail: ReviewDetail;
  isPending: boolean;
  isSaving?: boolean;
  onAssign: () => void;
  onCommentChange: (value: string) => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onScoreChange: (key: string, value: boolean | number | string) => void;
  onSkip: () => void;
  onSubmit: () => void;
  position: number;
  scores: Record<string, boolean | number | string>;
  submitError?: string;
  totalPending: number;
}

export const AiReviewItemView: React.FC<AiReviewItemViewProps> = ({
  comment,
  detail,
  isPending,
  isSaving,
  onAssign,
  onCommentChange,
  onNext,
  onPrevious,
  onScoreChange,
  onSkip,
  onSubmit,
  position,
  scores,
  submitError,
  totalPending,
}) => (
  <Box gap={4} testID="ai-review-item">
    <Box alignItems="center" direction="row" gap={3} justifyContent="between" wrap>
      <Box gap={1}>
        <Heading size="md">
          {isPending
            ? `Item ${position} of ${totalPending} pending`
            : `${reviewStatusLabel(detail.status)} — not in pending queue`}
        </Heading>
        <Box direction="row" gap={2}>
          <Badge status="info" value={reviewStatusLabel(detail.status)} />
          <Text color="secondaryDark">{`Trace ${detail.traceId}`}</Text>
        </Box>
      </Box>
      <Box direction="row" gap={2}>
        <Button
          disabled={!onPrevious}
          onClick={onPrevious ?? (() => undefined)}
          text="Previous"
          variant="secondary"
        />
        <Button
          disabled={!onNext}
          onClick={onNext ?? (() => undefined)}
          text="Next"
          variant="secondary"
        />
      </Box>
    </Box>

    <Box direction="row" gap={3} wrap>
      <Box flex="grow" minWidth={300}>
        <ReviewReadOnlyPanel fields={detail.panels.given} title="What the AI was given" />
      </Box>
      <Box flex="grow" minWidth={300}>
        <ReviewReadOnlyPanel fields={detail.panels.wrote} title="What the AI wrote" />
      </Box>
    </Box>

    <Accordion isCollapsed testID="ai-review-raw-json" title="Raw JSON">
      <Text size="sm">
        {displayReviewValue({input: detail.rawInput, output: detail.rawOutput})}
      </Text>
    </Accordion>

    <Card padding={3}>
      <Box gap={3}>
        <Heading size="sm">Score this output</Heading>
        {detail.instructions ? <Text>{detail.instructions}</Text> : undefined}
        {detail.dimensions.map((dimension) => (
          <ReviewScoreField
            dimension={dimension}
            key={dimension.key}
            onChange={(value) => {
              onScoreChange(dimension.key, value);
            }}
            value={scores[dimension.key]}
          />
        ))}
        <TextArea
          onChange={onCommentChange}
          testID="ai-review-comment"
          title="Comment (optional)"
          value={comment}
        />
        {submitError ? <Text color="error">{submitError}</Text> : undefined}
        <Box direction="row" gap={2} wrap>
          <Button
            loading={isSaving}
            onClick={onSubmit}
            testID="ai-review-submit-next"
            text="Submit & next"
          />
          <Button
            disabled={isSaving}
            onClick={onSkip}
            testID="ai-review-skip"
            text="Skip"
            variant="secondary"
          />
          <Button
            disabled={isSaving}
            onClick={onAssign}
            testID="ai-review-assign"
            text="Assign to me"
            variant="outline"
          />
        </Box>
      </Box>
    </Card>
  </Box>
);
