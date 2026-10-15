import {Badge, Box, Button, Card, Heading, SelectField, Text} from "@terreno/ui";
import React, {useMemo} from "react";
import {
  ObservabilityTable,
  type ObservabilityTableColumn,
  type ObservabilityTableRow,
} from "../shell/ObservabilityTable";
import {
  agreementStatus,
  agreementVerdict,
  answerMatches,
  formatAnswer,
  formatPercent,
  previewText,
  type ReviewBatchDetail,
  type ReviewBatchJudgeSummary,
} from "./batchTypes";
import {dimensionLabel, reviewStatusLabel} from "./reviewTypes";

export interface JudgeOption {
  label: string;
  value: string;
}

export interface AiReviewBatchViewProps {
  /** Why judges cannot run right now (no server AI and no saved key). */
  aiBlockedMessage?: string;
  batch: ReviewBatchDetail;
  isRunningJudge?: boolean;
  judgeId: string;
  judgeOptions: JudgeOption[];
  onAnswerNext?: () => void;
  onJudgeChange: (value: string) => void;
  onOpenItem: (reviewItemId: string) => void;
  onRunJudge: () => void;
  onSelectJudge: (evaluatorId: string) => void;
  runError?: string;
  selectedJudge?: ReviewBatchJudgeSummary;
}

const questionTitle = (index: number, key: string): string => `Q${index + 1} ${key}`;

export const AiReviewBatchView: React.FC<AiReviewBatchViewProps> = ({
  aiBlockedMessage,
  batch,
  isRunningJudge,
  judgeId,
  judgeOptions,
  onAnswerNext,
  onJudgeChange,
  onOpenItem,
  onRunJudge,
  onSelectJudge,
  runError,
  selectedJudge,
}) => {
  const {counts, dimensions} = batch;
  const progressRate = counts.total > 0 ? counts.done / counts.total : 0;

  const judgeColumns: ObservabilityTableColumn[] = useMemo(() => {
    return [
      {grow: 2, minWidth: 220, title: "Judge"},
      {grow: 2, minWidth: 200, title: "Agreement with humans"},
      ...dimensions.map((dimension, index) => ({
        minWidth: 110,
        title: questionTitle(index, dimension.key),
      })),
      {minWidth: 90, title: "Compared"},
    ];
  }, [dimensions]);

  const judgeRows: ObservabilityTableRow[] = useMemo(() => {
    return batch.judges.map((judge) => {
      const isSelected = judge.evaluatorId === selectedJudge?.evaluatorId;
      return {
        accessibilityLabel: `Show disagreements for ${judge.evaluatorName}`,
        cells: [
          <Box gap={1} key="judge">
            <Text bold={isSelected}>{`${isSelected ? "▸ " : ""}${judge.evaluatorName}`}</Text>
            {judge.judgePromptName ? (
              <Text color="secondaryDark" size="sm">
                {judge.judgePromptName}
              </Text>
            ) : undefined}
          </Box>,
          <Box alignItems="center" direction="row" gap={2} key="rate" wrap>
            <Badge
              status={agreementStatus(judge.agreement.rate)}
              testID={`ai-review-batch-judge-rate-${judge.evaluatorId}`}
              value={formatPercent(judge.agreement.rate)}
            />
            <Text color="secondaryDark" size="sm">
              {agreementVerdict(judge.agreement.rate)}
            </Text>
          </Box>,
          ...judge.agreement.questions.map((question) =>
            question.covered ? (
              <Text
                color={question.rate !== undefined && question.rate < 0.75 ? "error" : "primary"}
                key={question.key}
              >
                {formatPercent(question.rate)}
              </Text>
            ) : (
              <Text color="secondaryDark" key={question.key}>
                Not asked
              </Text>
            )
          ),
          `${judge.agreement.matches}/${judge.agreement.compared}`,
        ],
        key: judge.evaluatorId,
        onClick: () => {
          onSelectJudge(judge.evaluatorId);
        },
      };
    });
  }, [batch.judges, onSelectJudge, selectedJudge?.evaluatorId]);

  const itemByTrace = useMemo(() => {
    return new Map(batch.items.map((item) => [item.traceId, item]));
  }, [batch.items]);

  const disagreementRows: ObservabilityTableRow[] = useMemo(() => {
    if (!selectedJudge) {
      return [];
    }
    return selectedJudge.agreement.disagreements.map((row, index) => {
      const item = itemByTrace.get(row.traceId);
      const dimension = dimensions.find((entry) => entry.key === row.key);
      return {
        cells: [
          previewText(item?.output, 120),
          dimension ? dimensionLabel(dimension) : row.key,
          formatAnswer(row.human),
          <Text color="error" key="judge">
            {row.judge === undefined ? "No answer" : formatAnswer(row.judge)}
          </Text>,
        ],
        key: `${row.traceId}-${row.key}-${index}`,
        onClick: item
          ? () => {
              onOpenItem(item.reviewItemId);
            }
          : undefined,
      };
    });
  }, [dimensions, itemByTrace, onOpenItem, selectedJudge]);

  const itemColumns: ObservabilityTableColumn[] = useMemo(() => {
    return [
      {minWidth: 40, title: "#"},
      {grow: 3, minWidth: 260, title: "Output"},
      {minWidth: 100, title: "Status"},
      ...dimensions.map((dimension, index) => ({
        minWidth: 110,
        title: questionTitle(index, dimension.key),
      })),
    ];
  }, [dimensions]);

  const itemRows: ObservabilityTableRow[] = useMemo(() => {
    return batch.items.map((item, index) => {
      const judgeScores = selectedJudge
        ? item.judgeAnswers[selectedJudge.evaluatorId]?.scores
        : undefined;
      return {
        accessibilityLabel: `Open item ${index + 1}`,
        cells: [
          String(index + 1),
          previewText(item.output, 140),
          <Badge
            key="status"
            status={
              item.status === "done" ? "success" : item.status === "skipped" ? "neutral" : "warning"
            }
            value={reviewStatusLabel(item.status)}
          />,
          ...dimensions.map((dimension) => {
            const human = item.scores?.[dimension.key];
            const judge = judgeScores?.[dimension.key];
            const isDisagreement =
              human !== undefined &&
              selectedJudge !== undefined &&
              !answerMatches(dimension, human, judge);
            return (
              <Box gap={1} key={dimension.key}>
                <Text>{formatAnswer(human)}</Text>
                {isDisagreement ? (
                  <Text color="error" size="sm">
                    {`judge: ${formatAnswer(judge)}`}
                  </Text>
                ) : undefined}
              </Box>
            );
          }),
        ],
        key: item.reviewItemId,
        onClick: () => {
          onOpenItem(item.reviewItemId);
        },
      };
    });
  }, [batch.items, dimensions, onOpenItem, selectedJudge]);

  return (
    <Box gap={4} testID="ai-review-batch">
      <Box alignItems="center" direction="row" gap={3} justifyContent="between" wrap>
        <Box flex="grow" gap={1} minWidth={260}>
          <Heading size="md" testID="ai-review-batch-title">
            {batch.name}
          </Heading>
          <Box direction="row" gap={2} wrap>
            <Badge status="info" value={batch.evaluatorName} />
            {batch.promptName ? <Badge status="neutral" value={batch.promptName} /> : undefined}
            <Badge
              status={counts.pending === 0 ? "success" : "warning"}
              testID="ai-review-batch-progress"
              value={`${counts.done} of ${counts.total} answered`}
            />
          </Box>
          {batch.description ? (
            <Text color="secondaryDark" size="sm">
              {batch.description}
            </Text>
          ) : undefined}
        </Box>
        <Button
          disabled={!onAnswerNext}
          iconName="play"
          onClick={onAnswerNext ?? (() => undefined)}
          testID="ai-review-batch-answer-next"
          text={counts.pending > 0 ? `Answer ${counts.pending} remaining` : "All answered"}
        />
      </Box>
      <Box color="neutralLight" height={6} rounding="md" testID="ai-review-batch-progress-bar">
        <Box
          color="success"
          height={6}
          rounding="md"
          width={`${Math.round(progressRate * 100)}%`}
        />
      </Box>

      <Card padding={4} testID="ai-review-batch-judges">
        <Box gap={3}>
          <Box gap={1}>
            <Heading size="sm">Which judges match the humans?</Heading>
            <Text color="secondaryDark">
              Run an LLM judge on the same items. Agreement counts only items people answered and
              only the questions the judge also answers. 90% or more is green.
            </Text>
          </Box>
          <Box alignItems="end" direction="row" gap={3} wrap>
            <Box flex="grow" minWidth={260}>
              <SelectField
                onChange={onJudgeChange}
                options={judgeOptions}
                placeholder={
                  judgeOptions.length === 0
                    ? "No LLM judges share these questions"
                    : "Choose a judge"
                }
                testID="ai-review-batch-judge-select"
                title="LLM judge"
                value={judgeId}
              />
            </Box>
            <Button
              disabled={!judgeId || Boolean(aiBlockedMessage)}
              iconName="gavel"
              loading={isRunningJudge}
              onClick={onRunJudge}
              testID="ai-review-batch-run-judge"
              text={`Run on ${counts.total} items`}
            />
          </Box>
          {aiBlockedMessage ? (
            <Text color="secondaryDark" testID="ai-review-batch-ai-blocked">
              {aiBlockedMessage}
            </Text>
          ) : undefined}
          {runError ? (
            <Text color="error" testID="ai-review-batch-run-error">
              {runError}
            </Text>
          ) : undefined}
          {counts.done === 0 ? (
            <Text color="secondaryDark" size="sm">
              No human answers yet. Answer a few items first so there is something to compare.
            </Text>
          ) : undefined}
          {batch.judges.length === 0 ? (
            <Text color="secondaryDark" testID="ai-review-batch-judges-empty">
              No judge has run on this batch yet.
            </Text>
          ) : (
            <ObservabilityTable
              columns={judgeColumns}
              rows={judgeRows}
              testID="ai-review-batch-judges-table"
            />
          )}
        </Box>
      </Card>

      {selectedJudge ? (
        <Card padding={4} testID="ai-review-batch-disagreements">
          <Box gap={3}>
            <Heading size="sm">
              {`Where ${selectedJudge.evaluatorName} disagrees (${selectedJudge.agreement.disagreements.length})`}
            </Heading>
            {disagreementRows.length === 0 ? (
              <Text color="secondaryDark">
                {selectedJudge.agreement.compared === 0
                  ? "Nothing to compare yet."
                  : "No disagreements on the answered items."}
              </Text>
            ) : (
              <ObservabilityTable
                columns={[
                  {grow: 3, minWidth: 260, title: "Output"},
                  {grow: 2, minWidth: 220, title: "Question"},
                  {minWidth: 90, title: "Human"},
                  {minWidth: 90, title: "Judge"},
                ]}
                rows={disagreementRows}
                testID="ai-review-batch-disagreements-table"
              />
            )}
          </Box>
        </Card>
      ) : undefined}

      <Card padding={4} testID="ai-review-batch-items">
        <Box gap={3}>
          <Heading size="sm">Items and human answers</Heading>
          <Box gap={1}>
            {dimensions.map((dimension, index) => (
              <Text color="secondaryDark" key={dimension.key} size="sm">
                {`${questionTitle(index, dimension.key)} — ${dimensionLabel(dimension)}`}
              </Text>
            ))}
          </Box>
          <ObservabilityTable
            columns={itemColumns}
            rows={itemRows}
            testID="ai-review-batch-items-table"
          />
        </Box>
      </Card>
    </Box>
  );
};
