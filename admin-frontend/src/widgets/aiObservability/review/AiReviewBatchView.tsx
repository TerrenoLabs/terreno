import {Badge, Banner, Box, Button, Card, Heading, SelectField, Text} from "@terreno/ui";
import React, {useMemo} from "react";
import {AgreementMeter, ProgressMeter} from "../shell/AgreementMeter";
import {formatStepReminder, HUMAN_JUDGING_ACTIVITY} from "../shell/evalPipeline";
import {ObservabilityStatusBadge} from "../shell/ObservabilityStatusBadge";
import {
  ObservabilityTable,
  type ObservabilityTableColumn,
  type ObservabilityTableRow,
} from "../shell/ObservabilityTable";
import {
  agreementTextColor,
  answerSubjectKey,
  formatAnswer,
  formatPercent,
  humanizeKey,
  previewText,
  type ReviewBatchDetail,
  type ReviewBatchJudgeSummary,
} from "./batchTypes";
import {dimensionLabel} from "./reviewTypes";

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
  onJudgeChange: (value: string) => void;
  onOpenItem: (reviewItemId: string) => void;
  onRunJudge: () => void;
  onSelectJudge: (evaluatorId: string) => void;
  runError?: string;
  selectedJudge?: ReviewBatchJudgeSummary;
}

/** Short column title for a question: its key in words, e.g. "faithful" becomes "Faithful". */
const questionTitle = (key: string): string => humanizeKey(key);

export const AiReviewBatchView: React.FC<AiReviewBatchViewProps> = ({
  aiBlockedMessage,
  batch,
  isRunningJudge,
  judgeId,
  judgeOptions,
  onJudgeChange,
  onOpenItem,
  onRunJudge,
  onSelectJudge,
  runError,
  selectedJudge,
}) => {
  const {counts, dimensions} = batch;
  const bestJudge = useMemo(() => {
    return batch.judges.reduce<ReviewBatchJudgeSummary | undefined>((best, judge) => {
      if (judge.agreement.rate === undefined) {
        return best;
      }
      if (!best || (best.agreement.rate ?? -1) < judge.agreement.rate) {
        return judge;
      }
      return best;
    }, undefined);
  }, [batch.judges]);

  const judgeColumns: ObservabilityTableColumn[] = useMemo(() => {
    return [
      {grow: 2, minWidth: 220, title: "Judge"},
      {grow: 2, minWidth: 220, title: "Agreement with people"},
      ...dimensions.map((dimension) => ({
        minWidth: 110,
        title: questionTitle(dimension.key),
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
            <Box alignItems="center" direction="row" gap={2} wrap>
              <Text bold={isSelected}>{judge.evaluatorName}</Text>
              {isSelected ? (
                <Badge
                  secondary
                  status="info"
                  testID={`ai-review-batch-judge-selected-${judge.evaluatorId}`}
                  value="Selected"
                />
              ) : undefined}
            </Box>
            {judge.judgePromptName ? (
              <Text color="secondaryDark" size="sm">
                {judge.judgePromptName}
              </Text>
            ) : undefined}
          </Box>,
          <AgreementMeter
            key="rate"
            rate={judge.agreement.rate}
            testID={`ai-review-batch-judge-rate-${judge.evaluatorId}`}
          />,
          ...judge.agreement.questions.map((question) =>
            question.covered ? (
              <Text bold color={agreementTextColor(question.rate)} key={question.key}>
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

  // Human and judge answers pair by dataset item when the batch came from a dataset, else by trace.
  const itemBySubject = useMemo(() => {
    return new Map(batch.items.map((item) => [answerSubjectKey(item), item]));
  }, [batch.items]);

  const disagreementRows: ObservabilityTableRow[] = useMemo(() => {
    if (!selectedJudge) {
      return [];
    }
    return selectedJudge.agreement.disagreements.map((row, index) => {
      const item = itemBySubject.get(answerSubjectKey(row));
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
        key: `${answerSubjectKey(row)}-${row.key}-${index}`,
        onClick: item
          ? () => {
              onOpenItem(item.reviewItemId);
            }
          : undefined,
      };
    });
  }, [dimensions, itemBySubject, onOpenItem, selectedJudge]);

  const itemColumns: ObservabilityTableColumn[] = useMemo(() => {
    return [
      {minWidth: 40, title: "#"},
      {grow: 3, minWidth: 260, title: "Output"},
      {minWidth: 130, title: "Status"},
      ...dimensions.map((dimension) => ({
        minWidth: 110,
        title: questionTitle(dimension.key),
      })),
    ];
  }, [dimensions]);

  // Disagreements come from the backend so item cells flag exactly what the agreement rate counts.
  const disagreementKeys = useMemo(() => {
    return new Set(
      (selectedJudge?.agreement.disagreements ?? []).map(
        (row) => `${answerSubjectKey(row)}:${row.key}`
      )
    );
  }, [selectedJudge]);

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
          <ObservabilityStatusBadge key="status" status={item.status} />,
          ...dimensions.map((dimension) => {
            const human = item.scores?.[dimension.key];
            const judge = judgeScores?.[dimension.key];
            const isDisagreement = disagreementKeys.has(
              `${answerSubjectKey(item)}:${dimension.key}`
            );
            return (
              <Box gap={1} key={dimension.key}>
                <Text>{formatAnswer(human)}</Text>
                {isDisagreement ? (
                  <Text color="error" size="sm">
                    {`Judge said ${formatAnswer(judge)}`}
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
  }, [batch.items, dimensions, disagreementKeys, onOpenItem, selectedJudge]);

  return (
    <Box gap={4} testID="ai-review-batch">
      <Box direction="row" gap={4} testID="ai-review-batch-stats" wrap>
        <Card flex="grow" minWidth={220} padding={4}>
          <Box gap={2}>
            <Text color="secondaryLight" size="sm">
              Answered by people
            </Text>
            <ProgressMeter
              done={counts.done}
              testID="ai-review-batch-progress"
              total={counts.total}
            />
          </Box>
        </Card>
        <Card flex="grow" minWidth={220} padding={4}>
          <Box gap={2}>
            <Text color="secondaryLight" size="sm">
              Best judge
            </Text>
            <AgreementMeter rate={bestJudge?.agreement.rate} testID="ai-review-batch-best-judge" />
            {bestJudge ? (
              <Text numberOfLines={1} size="sm">
                {bestJudge.evaluatorName}
              </Text>
            ) : undefined}
          </Box>
        </Card>
        <Card flex="grow" minWidth={160} padding={4}>
          <Box gap={2}>
            <Text color="secondaryLight" size="sm">
              Judges run
            </Text>
            <Text bold size="lg" testID="ai-review-batch-judge-count">
              {String(batch.judges.length)}
            </Text>
          </Box>
        </Card>
      </Box>
      {batch.datasetId ? (
        <Box testID="ai-eval-step-banner">
          <Banner
            hasIcon
            status="info"
            text={formatStepReminder({
              activity: HUMAN_JUDGING_ACTIVITY,
              detail: `answer each item of ${batch.datasetName ?? "this dataset"} once. Answers are saved on the dataset, so every judge experiment reuses them while the questions stay the same.`,
              step: 2,
            })}
          />
        </Box>
      ) : undefined}
      {batch.questionsStale ? (
        <Box testID="ai-review-batch-questions-stale">
          <Banner
            hasIcon
            status="warning"
            text={`The questions in ${batch.evaluatorName} changed after this batch was created. Answers given before the change no longer count. Send the dataset to human review again to judge those items again.`}
          />
        </Box>
      ) : undefined}

      <Card padding={4} testID="ai-review-batch-judges">
        <Box gap={3}>
          <Box gap={1}>
            <Heading size="sm">Which judge matches people?</Heading>
            <Text color="secondaryLight">
              Run an LLM judge on the same items. Agreement counts only items people answered and
              only the questions the judge also answers.
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
              variant="secondary"
            />
          </Box>
          {aiBlockedMessage ? (
            <Text color="secondaryLight" testID="ai-review-batch-ai-blocked">
              {aiBlockedMessage}
            </Text>
          ) : undefined}
          {runError ? (
            <Text color="error" testID="ai-review-batch-run-error">
              {runError}
            </Text>
          ) : undefined}
          {counts.done === 0 ? (
            <Text color="secondaryLight" size="sm">
              No answers from people yet. Answer a few items first so there is something to compare.
            </Text>
          ) : undefined}
          {batch.judges.length === 0 ? (
            <Text color="secondaryLight" testID="ai-review-batch-judges-empty">
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
              <Text color="secondaryLight">
                {selectedJudge.agreement.compared === 0
                  ? "Nothing to compare yet."
                  : "No disagreements on the answered items."}
              </Text>
            ) : (
              <ObservabilityTable
                columns={[
                  {grow: 3, minWidth: 260, title: "Output"},
                  {grow: 2, minWidth: 220, title: "Question"},
                  {minWidth: 90, title: "People"},
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
          <Heading size="sm">Items and answers from people</Heading>
          <Box gap={1}>
            {dimensions.map((dimension) => (
              <Text color="secondaryLight" key={dimension.key} size="sm">
                <Text bold size="sm">
                  {questionTitle(dimension.key)}
                </Text>
                {`: ${dimensionLabel(dimension)}`}
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
