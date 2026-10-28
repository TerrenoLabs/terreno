import type {FindExactlyOnePlugin, FindOneOrNonePlugin} from "@terreno/api";
import type mongoose from "mongoose";

import type {JudgeAgreement} from "../observability/judgeAgreement";

export interface ObsPromptVariable {
  key: string;
  label?: string;
  required: boolean;
  reviewerNote?: string;
}

export interface ObsPromptUsage {
  costUsd?: number;
  inputTokens?: number;
  model?: string;
  outputTokens?: number;
}

export interface ObsPromptRef {
  /** Set when this version was pulled in by another prompt's reference, to that prompt's name. */
  includedBy?: string;
  label?: string;
  name: string;
  version: number;
}

export interface ObsPromptDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  description?: string;
  folder: string;
  name: string;
  tags: string[];
  updated: Date;
}

export interface ObsPromptStatics
  extends FindExactlyOnePlugin<ObsPromptDocument>,
    FindOneOrNonePlugin<ObsPromptDocument> {}

export interface ObsPromptModel extends mongoose.Model<ObsPromptDocument>, ObsPromptStatics {}

export interface ObsPromptVersionDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  config?: Record<string, unknown>;
  created: Date;
  deleted: boolean;
  inputSchema?: Record<string, unknown>;
  outputFieldNotes?: Record<string, string>;
  outputSchema?: Record<string, unknown>;
  promptId: mongoose.Types.ObjectId;
  sensitive: boolean;
  system?: string;
  template?: string;
  type: "chat" | "text";
  updated: Date;
  variables: ObsPromptVariable[];
  version: number;
}

export interface ObsPromptVersionStatics
  extends FindExactlyOnePlugin<ObsPromptVersionDocument>,
    FindOneOrNonePlugin<ObsPromptVersionDocument> {}

export interface ObsPromptVersionModel
  extends mongoose.Model<ObsPromptVersionDocument>,
    ObsPromptVersionStatics {}

export interface ObsPromptLabelDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  label: string;
  promptId: mongoose.Types.ObjectId;
  updated: Date;
  versionId: mongoose.Types.ObjectId;
}

export interface ObsPromptLabelStatics
  extends FindExactlyOnePlugin<ObsPromptLabelDocument>,
    FindOneOrNonePlugin<ObsPromptLabelDocument> {}

export interface ObsPromptLabelModel
  extends mongoose.Model<ObsPromptLabelDocument>,
    ObsPromptLabelStatics {}

export interface ObsTraceDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  endedAt?: Date;
  errorSummary?: string;
  flaggedForDataset: boolean;
  input?: unknown;
  name: string;
  output?: unknown;
  prompts: ObsPromptRef[];
  /** App-defined scope (tenant, workspace) set by `harness.createTask({trace: {scope}})`. */
  scope?: string;
  sensitive: boolean;
  sessionId?: string;
  startedAt: Date;
  status: "error" | "ok";
  tags: string[];
  updated: Date;
  usage?: ObsPromptUsage;
  userId?: mongoose.Types.ObjectId;
}

export interface ObsTraceStatics
  extends FindExactlyOnePlugin<ObsTraceDocument>,
    FindOneOrNonePlugin<ObsTraceDocument> {}

export interface ObsTraceModel extends mongoose.Model<ObsTraceDocument>, ObsTraceStatics {}

export interface ObsSpanDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  durationMs?: number;
  endedAt?: Date;
  error?: string;
  input?: unknown;
  kind: "AGENT" | "CHAIN" | "EVALUATOR" | "LLM" | "RETRIEVER" | "TOOL";
  name: string;
  output?: unknown;
  parentSpanId?: mongoose.Types.ObjectId;
  sensitive?: boolean;
  startOffsetMs?: number;
  startedAt: Date;
  status: "error" | "ok";
  traceId: mongoose.Types.ObjectId;
  updated: Date;
  usage?: ObsPromptUsage;
}

export interface ObsSpanStatics
  extends FindExactlyOnePlugin<ObsSpanDocument>,
    FindOneOrNonePlugin<ObsSpanDocument> {}

export interface ObsSpanModel extends mongoose.Model<ObsSpanDocument>, ObsSpanStatics {}

export interface ObsScoreDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  comment?: string;
  confidence?: number;
  created: Date;
  dataType: "boolean" | "categorical" | "numeric";
  deleted: boolean;
  evaluatorId?: mongoose.Types.ObjectId;
  name: string;
  source: "code" | "human" | "llm-judge" | "user-feedback";
  spanId?: mongoose.Types.ObjectId;
  traceId: mongoose.Types.ObjectId;
  updated: Date;
  value: boolean | number | string;
}

export interface ObsScoreStatics
  extends FindExactlyOnePlugin<ObsScoreDocument>,
    FindOneOrNonePlugin<ObsScoreDocument> {}

export interface ObsScoreModel extends mongoose.Model<ObsScoreDocument>, ObsScoreStatics {}

export interface EvaluatorDimension {
  dataType: "boolean" | "categorical" | "numeric";
  key: string;
  /** Question shown to human reviewers, e.g. "Does the summary mention every todo?" */
  question?: string;
  range?: string;
  required: boolean;
}

export interface EvaluatorRunModes {
  allowManualRun: boolean;
  availableInExperiments: boolean;
  liveSampleRate: number;
}

export interface ObsEvaluatorDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  assertion?: {constraint: string; path: string};
  confidenceAlertBelow: number;
  created: Date;
  deleted: boolean;
  description?: string;
  dimensions: EvaluatorDimension[];
  instructions?: string;
  judgePromptName?: string;
  name: string;
  runModes: EvaluatorRunModes;
  target: "dataset item" | "full trace" | "generation span";
  type: "human" | "json-assert" | "llm-judge";
  updated: Date;
}

export interface ObsEvaluatorStatics
  extends FindExactlyOnePlugin<ObsEvaluatorDocument>,
    FindOneOrNonePlugin<ObsEvaluatorDocument> {}

export interface ObsEvaluatorModel
  extends mongoose.Model<ObsEvaluatorDocument>,
    ObsEvaluatorStatics {}

export interface ObsReviewItemDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  assigneeId?: mongoose.Types.ObjectId;
  batchId?: mongoose.Types.ObjectId;
  comment?: string;
  created: Date;
  datasetItemId?: mongoose.Types.ObjectId;
  deleted: boolean;
  enqueuedAt: Date;
  evaluatorId: mongoose.Types.ObjectId;
  reason: "dataset_candidate" | "eval" | "feedback" | "manual";
  scores?: Record<string, boolean | number | string>;
  spanId?: mongoose.Types.ObjectId;
  status: "done" | "in_progress" | "pending" | "skipped";
  /** Trace under review. Unset when reviewers judge a dataset item that has no source trace. */
  traceId?: mongoose.Types.ObjectId;
  updated: Date;
}

export interface ObsReviewItemStatics
  extends FindExactlyOnePlugin<ObsReviewItemDocument>,
    FindOneOrNonePlugin<ObsReviewItemDocument> {}

export interface ObsReviewItemModel
  extends mongoose.Model<ObsReviewItemDocument>,
    ObsReviewItemStatics {}

export interface ObsReviewBatchDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  /** Dataset the batch was built from, when reviewers judge dataset items. */
  datasetId?: mongoose.Types.ObjectId;
  deleted: boolean;
  description?: string;
  evaluatorId: mongoose.Types.ObjectId;
  name: string;
  promptName?: string;
  /** Question-set fingerprint when the batch was created (see `questionSetFingerprint`). */
  questionsFingerprint?: string;
  traceIds: mongoose.Types.ObjectId[];
  updated: Date;
}

export interface ObsReviewBatchStatics
  extends FindExactlyOnePlugin<ObsReviewBatchDocument>,
    FindOneOrNonePlugin<ObsReviewBatchDocument> {}

export interface ObsReviewBatchModel
  extends mongoose.Model<ObsReviewBatchDocument>,
    ObsReviewBatchStatics {}

export interface ObsJudgeRunResult {
  confidence?: number;
  datasetItemId?: mongoose.Types.ObjectId;
  error?: string;
  scores?: Record<string, boolean | number | string>;
  traceId?: mongoose.Types.ObjectId;
}

export interface ObsJudgeRunDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  batchId: mongoose.Types.ObjectId;
  completedAt: Date;
  created: Date;
  deleted: boolean;
  evaluatorId: mongoose.Types.ObjectId;
  modelId?: string;
  results: ObsJudgeRunResult[];
  updated: Date;
}

export interface ObsJudgeRunStatics
  extends FindExactlyOnePlugin<ObsJudgeRunDocument>,
    FindOneOrNonePlugin<ObsJudgeRunDocument> {}

export interface ObsJudgeRunModel extends mongoose.Model<ObsJudgeRunDocument>, ObsJudgeRunStatics {}

export interface ObsDatasetAnnotatedBy {
  label: string;
  reviewItemId?: string;
  userId?: string;
}

export interface ObsDatasetDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  deleted: boolean;
  description?: string;
  expectedOutputSchema?: Record<string, unknown>;
  inputSchemaPromptName?: string;
  name: string;
  tags: string[];
  updated: Date;
}

export interface ObsDatasetStatics
  extends FindExactlyOnePlugin<ObsDatasetDocument>,
    FindOneOrNonePlugin<ObsDatasetDocument> {}

export interface ObsDatasetModel extends mongoose.Model<ObsDatasetDocument>, ObsDatasetStatics {}

/** One question set's human answers for a dataset item. */
export interface ObsDatasetHumanAnswer {
  answeredAt: Date;
  /** `questionSetFingerprint` of the question set when the reviewer answered. */
  fingerprint: string;
  reviewItemId: string;
  scores: Record<string, boolean | number | string>;
  userId?: string;
}

export interface ObsDatasetItemDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  annotatedBy?: ObsDatasetAnnotatedBy;
  created: Date;
  datasetId: mongoose.Types.ObjectId;
  deleted: boolean;
  expectedOutput?: unknown;
  /** Human answers keyed by question-set (human evaluator) id. */
  humanAnswers?: Record<string, ObsDatasetHumanAnswer>;
  input: unknown;
  metadata?: Record<string, unknown>;
  origin: "manual" | "synthetic" | "trace";
  outcomeClass?: "fn" | "fp" | "tn" | "tp";
  proofread: boolean;
  sourceTraceId?: mongoose.Types.ObjectId;
  tags: string[];
  updated: Date;
}

export interface ObsDatasetItemStatics
  extends FindExactlyOnePlugin<ObsDatasetItemDocument>,
    FindOneOrNonePlugin<ObsDatasetItemDocument> {}

export interface ObsDatasetItemModel
  extends mongoose.Model<ObsDatasetItemDocument>,
    ObsDatasetItemStatics {}

export interface ScoreThreshold {
  /** `agreement` gates compare a judge prompt version's answers with human answers. */
  aggregate: "agreement" | "mean" | "trueRate";
  dimension: string;
  evaluatorName: string;
  op: "eq" | "gte" | "lte";
  value: number;
}

export interface ExperimentGateResult extends ScoreThreshold {
  actual?: number;
  passed: boolean;
  version: number;
}

export interface ExperimentEstimate {
  costUsd?: number;
  generations: number;
  wallClockSeconds: number;
}

export type ExperimentKind = "judge" | "prompt";

export interface ExperimentAggregates {
  /** Judge experiments: agreement with the human answers per judge prompt version. */
  agreement?: Record<string, JudgeAgreement>;
  gates: ExperimentGateResult[];
  lowConfidenceItemIds: string[];
  outlierItemIds: string[];
  progress: {completed: number; total: number};
  totalCostUsd?: number;
}

export interface ObsExperimentDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  backgroundTaskId?: mongoose.Types.ObjectId;
  created: Date;
  datasetId: mongoose.Types.ObjectId;
  deleted: boolean;
  estimate?: ExperimentEstimate;
  evaluatorIds: mongoose.Types.ObjectId[];
  includeUnproofread: boolean;
  /** Judge experiments: the llm-judge evaluator whose prompt versions are compared. */
  judgeEvaluatorId?: mongoose.Types.ObjectId;
  kind: ExperimentKind;
  modelOverride?: string;
  name: string;
  promptName: string;
  /** Judge experiments: question-set fingerprint of the human answers compared. */
  questionsFingerprint?: string;
  /** Judge experiments: the human question set whose answers are the reference. */
  questionSetId?: mongoose.Types.ObjectId;
  results?: ExperimentAggregates;
  status: "completed" | "failed" | "pending" | "running";
  /** Judge experiments: agreement rate (0–1) a version must reach to pass. */
  targetAgreement?: number;
  thresholds: ScoreThreshold[];
  updated: Date;
  versions: number[];
}

export interface ObsExperimentStatics
  extends FindExactlyOnePlugin<ObsExperimentDocument>,
    FindOneOrNonePlugin<ObsExperimentDocument> {}

export interface ObsExperimentModel
  extends mongoose.Model<ObsExperimentDocument>,
    ObsExperimentStatics {}

export interface ExperimentVersionEvaluatorScore {
  confidence?: number;
  error?: string;
  scores?: Record<string, boolean | number | string>;
}

export interface ExperimentVersionResult {
  error?: string;
  evaluatorScores: Record<string, ExperimentVersionEvaluatorScore>;
  output?: unknown;
}

export interface ObsExperimentItemDocument extends mongoose.Document<mongoose.Types.ObjectId> {
  created: Date;
  datasetItemId: mongoose.Types.ObjectId;
  deleted: boolean;
  experimentId: mongoose.Types.ObjectId;
  failed: boolean;
  /** Judge experiments: the human answers the judge versions are compared with. */
  humanScores?: Record<string, boolean | number | string>;
  updated: Date;
  versionResults: Record<string, ExperimentVersionResult>;
}

export interface ObsExperimentItemStatics
  extends FindExactlyOnePlugin<ObsExperimentItemDocument>,
    FindOneOrNonePlugin<ObsExperimentItemDocument> {}

export interface ObsExperimentItemModel
  extends mongoose.Model<ObsExperimentItemDocument>,
    ObsExperimentItemStatics {}
